"""Scholar critique — heavy text model reviews scribe output vs official text."""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from . import db

OLLAMA_URL = (os.getenv("OLLAMA_URL") or os.getenv("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
# The Scholar may live on a different host than the local worker Ollama
# (e.g. qwen3.6:27b on Rodimus while the Scribe runs vision locally).
SCHOLAR_OLLAMA_URL = (os.getenv("SCHOLAR_OLLAMA_URL") or OLLAMA_URL).rstrip("/")
SCHOLAR_MODEL = (
    os.getenv("EGYPTIAN_SCHOLAR_MODEL")
    or os.getenv("PIKO_HEAVY_MODEL")
    or os.getenv("PIKO_LEGION_MODEL")
    or "llama3.1:8b"
)
SCHOLAR_FALLBACK_MODEL = os.getenv("EGYPTIAN_SCHOLAR_FALLBACK_MODEL") or "llama3.1:8b"


def _prompt_text() -> str:
    p = Path(__file__).resolve().parent / "prompts" / "scholar.txt"
    if p.exists():
        return p.read_text(encoding="utf-8")
    return "Critique the transcription against the official text."


def ollama_text(prompt: str, model: Optional[str] = None, url: Optional[str] = None) -> Dict[str, Any]:
    model = model or SCHOLAR_MODEL
    base = (url or SCHOLAR_OLLAMA_URL).rstrip("/")
    body = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": _prompt_text()},
            {"role": "user", "content": prompt},
        ],
        "options": {
            "temperature": 0.2,
            # Without an explicit num_ctx Ollama loads at the server default
            # (32k on 0.23), blowing VRAM and evicting the resident chat model.
            "num_ctx": int(os.getenv("EGYPTIAN_SCHOLAR_NUM_CTX", "8192")),
        },
    }
    # Hybrid-reasoning models (qwen3*) think by default; keep critiques
    # deterministic and fast unless explicitly enabled.
    if model.lower().startswith("qwen3") and os.getenv("EGYPTIAN_SCHOLAR_THINK") != "1":
        body["think"] = False
    req = urllib.request.Request(
        f"{base}/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.getenv("EGYPTIAN_SCHOLAR_TIMEOUT_SEC", "300"))) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e), "model": model}
    content = (((payload or {}).get("message") or {}).get("content")) or ""
    return {"ok": True, "model": model, "review_markdown": content}


def critique_harvest(harvest_id: int, model: Optional[str] = None) -> Dict[str, Any]:
    conn = db.connect()
    item = db.get_harvest(conn, int(harvest_id))
    if not item:
        conn.close()
        return {"ok": False, "error": "harvest_not_found", "harvest_id": harvest_id}
    tr = db.latest_transcription(conn, int(harvest_id))
    if not tr:
        conn.close()
        return {"ok": False, "error": "transcription_missing", "harvest_id": harvest_id}

    user_prompt = (
        f"Title: {item.get('title')}\n"
        f"Source: {item.get('source')} / {item.get('source_id')}\n"
        f"Source URL: {item.get('source_url')}\n\n"
        f"Official museum text:\n{item.get('official_text') or '(none)'}\n\n"
        f"Scribe model: {tr.get('model')}\n"
        f"Gardiner tokens: {tr.get('gardiner_tokens')}\n"
        f"Scribe notes: {tr.get('notes')}\n"
        f"Raw transcription JSON:\n{tr.get('raw_json')}\n"
    )
    result = ollama_text(user_prompt, model=model)
    if not result.get("ok") and not model:
        # Retry on the LOCAL Ollama with the lightweight fallback — covers both
        # a missing heavy model and the scholar host being unreachable.
        fb = SCHOLAR_FALLBACK_MODEL
        if fb and (fb != SCHOLAR_MODEL or SCHOLAR_OLLAMA_URL != OLLAMA_URL):
            result = ollama_text(user_prompt, model=fb, url=OLLAMA_URL)
            if result.get("ok"):
                result["fallback_from"] = SCHOLAR_MODEL
    if not result.get("ok"):
        conn.close()
        return {**result, "harvest_id": harvest_id}

    cid = db.insert_critique(
        conn,
        harvest_id=int(harvest_id),
        transcription_id=int(tr["id"]),
        model=str(result.get("model") or ""),
        review_markdown=str(result.get("review_markdown") or ""),
    )
    conn.close()
    return {
        "ok": True,
        "harvest_id": harvest_id,
        "transcription_id": tr["id"],
        "critique_id": cid,
        "model": result.get("model"),
        "review_markdown": result.get("review_markdown"),
    }
