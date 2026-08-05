"""Vision scribe — Ollama multimodal transcription (Gardiner-oriented)."""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from . import db

OLLAMA_URL = (os.getenv("OLLAMA_URL") or os.getenv("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
SCRIBE_MODEL = (
    os.getenv("EGYPTIAN_SCRIBE_MODEL")
    or os.getenv("PIKO_SCRIBE_MODEL")
    or "llama3.2-vision:11b"
)


def _prompt_text() -> str:
    p = Path(__file__).resolve().parent / "prompts" / "scribe.txt"
    if p.exists():
        return p.read_text(encoding="utf-8")
    return "Transcribe hieroglyphs to Gardiner tokens as JSON only."


def _extract_json(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    # Fallback: pull Gardiner-like tokens from markdown/prose when the model ignores JSON.
    tokens = re.findall(r"\b([A-Z]{1,2}\d{1,3}[A-Za-z]?)\b", raw)
    # Prefer tokens that look like Gardiner codes (letter + digits)
    gardiner = [t for t in tokens if re.match(r"^[A-Z]{1,2}\d{1,3}[A-Za-z]?$", t)]
    # de-dupe preserving order
    seen = set()
    ordered = []
    for t in gardiner:
        if t not in seen:
            seen.add(t)
            ordered.append(t)
    return {
        "notes": raw[:2000],
        "raw_text": raw[:4000],
        "gardiner_tokens": ordered[:40],
        "confidence": 0.2 if ordered else 0.0,
        "script": "egyptian_hieroglyphic" if ordered else "unknown",
    }


def ollama_vision(image_path: str, prompt: Optional[str] = None, model: Optional[str] = None) -> Dict[str, Any]:
    path = Path(image_path)
    if not path.exists():
        return {"ok": False, "error": f"image_not_found:{image_path}"}
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    model = model or SCRIBE_MODEL
    body = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": prompt or _prompt_text(),
                "images": [b64],
            }
        ],
        "options": {"temperature": 0.1},
    }
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.getenv("EGYPTIAN_SCRIBE_TIMEOUT_SEC", "180"))) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        return {"ok": False, "error": f"ollama_http_{e.code}", "detail": detail, "model": model}
    except Exception as e:
        return {"ok": False, "error": str(e), "model": model}

    content = (((payload or {}).get("message") or {}).get("content")) or ""
    parsed = _extract_json(content)
    tokens = parsed.get("gardiner_tokens") if isinstance(parsed, dict) else []
    if not isinstance(tokens, list):
        tokens = []
    return {
        "ok": True,
        "model": model,
        "raw": parsed if parsed else {"raw_text": content},
        "gardiner_tokens": tokens,
        "confidence": float(parsed.get("confidence") or 0) if isinstance(parsed, dict) else 0.0,
        "notes": (parsed.get("notes") if isinstance(parsed, dict) else "") or "",
        "content_preview": content[:500],
    }


def transcribe_harvest(harvest_id: int, model: Optional[str] = None) -> Dict[str, Any]:
    conn = db.connect()
    item = db.get_harvest(conn, int(harvest_id))
    if not item:
        conn.close()
        return {"ok": False, "error": "harvest_not_found", "harvest_id": harvest_id}
    image_path = item.get("image_path")
    if not image_path or not Path(image_path).exists():
        conn.close()
        return {"ok": False, "error": "image_missing", "harvest_id": harvest_id, "image_path": image_path}

    result = ollama_vision(image_path, model=model)
    if not result.get("ok"):
        conn.close()
        return {**result, "harvest_id": harvest_id}

    tid = db.insert_transcription(
        conn,
        harvest_id=int(harvest_id),
        payload={
            "model": result.get("model"),
            "raw": result.get("raw"),
            "gardiner_tokens": result.get("gardiner_tokens"),
            "confidence": result.get("confidence"),
            "notes": result.get("notes"),
        },
    )
    conn.close()
    return {
        "ok": True,
        "harvest_id": harvest_id,
        "transcription_id": tid,
        "model": result.get("model"),
        "gardiner_tokens": result.get("gardiner_tokens"),
        "confidence": result.get("confidence"),
        "notes": result.get("notes"),
    }


def transcribe_path(image_path: str, model: Optional[str] = None) -> Dict[str, Any]:
    return ollama_vision(image_path, model=model)
