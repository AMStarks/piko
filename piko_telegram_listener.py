"""
Piko Path B — Telegram listener (Mac).

Long-polls Telegram getUpdates and runs the **same** sovereign tool loop as `piko_core.py`:
High Architect prompt, Legion ledger tools, wiki, weather, gated email, Telegram nudge.

IMPORTANT: Only one client may call getUpdates per bot token. If clawfriend-bot
(or anything else) polls the same token on Optimus, STOP that service or use a
dedicated bot token for this listener.

Env (via webchat-piko/.env — loaded when yolo_protocol imports):
  TELEGRAM_BOT_TOKEN or TELEGRAM_TOKEN
  TELEGRAM_CHAT_ID (allowlist)

Brain (same resolution as piko_core.py):
  BRAIN_ENDPOINT / PIKO_BRAIN_BASE_URL / PIKO_OPENAI_BASE_URL / PIKO_BRAIN_PROFILE
  PIKO_CHAT_MODEL
  Legacy: PIKO_CLOUD_BASE_URL, PIKO_CLOUD_MODEL (if newer vars unset)
  OPENAI_API_KEY

Run from repo root (with .venv-os):
  ./scripts/run-telegram-listener.sh
  # or: .venv-os/bin/python piko_telegram_listener.py
"""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

import hitl_manager
import piko_core as core
from yolo_protocol import execute_tool_yolo

# yolo_protocol import side-effect: loads webchat-piko/.env into os.environ
TOKEN = (os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("TELEGRAM_TOKEN") or "").strip()


def _piko_api_headers(extra: dict | None = None) -> dict:
    """Headers for spine /api/* calls — X-Piko-Key when PIKO_API_KEY is set (strict auth)."""
    h = {"Content-Type": "application/json"}
    if extra:
        h.update(extra)
    key = (os.environ.get("PIKO_API_KEY") or "").strip()
    if key:
        h["X-Piko-Key"] = key
    return h
ALLOW_CHAT_ID = (
    os.environ.get("TELEGRAM_CHAT_ID")
    or os.environ.get("PIKO_ADMIN_CHAT_ID")
    or os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    or ""
).strip()

_CHAT_EXECUTOR = ThreadPoolExecutor(
    max_workers=max(1, int(os.environ.get("PIKO_TELEGRAM_WORKERS") or "4"))
)

MAX_TOOL_CHAIN = getattr(core, "MAX_TOOL_CHAIN", 5)

# One pending mission draft per chat (Strategic Approval Gate before ``create_legion_task_atomic``).
PENDING_TASK_DRAFTS: dict[str, dict[str, Any]] = {}

PROPOSED_TASK_MARKER = "PROPOSED_TASK:"

# Telegram UX parity:
# WebChat has deterministic "system.intents.read/manage" fast-paths (list schedules, cancel schedules).
# Without this, Telegram falls through to the LLM and can produce verbose persona output.
FASTPATH_INTENTS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(what|which).*(tasks|things).*(daily|scheduled|schedule|queue)\b", re.I),
    re.compile(r"\bwhat do you do\b", re.I),
    re.compile(r"\b(list|show).*(schedule|scheduled|queue|intents)\b", re.I),
    re.compile(r"\b(cancel|stop|remove|delete|clear).*(schedule|scheduled|those|them)\b", re.I),
    re.compile(r"\bhow can i cancel\b", re.I),
)


def _webchat_base_url() -> str:
    # Prefer stable direct base URLs over expiring tunnels.
    base = (
        (os.environ.get("PIKO_WEBCHAT_URL") or "").strip().rstrip("/")
        or (os.environ.get("PIKO_BASE_URL") or "").strip().rstrip("/")
        or "http://114.73.210.115:3000"
    )
    return base


def maybe_webchat_intents_fastpath(user_text: str) -> str | None:
    """
    For schedule/queue/intents questions, delegate to WebChat /api/chat so we reuse its
    deterministic circuit-breaker and the live intents.json store on Optimus.
    """
    t = (user_text or "").strip()
    if not t:
        return None
    if not any(p.search(t) for p in FASTPATH_INTENTS_PATTERNS):
        return None
    try:
        url = f"{_webchat_base_url()}/api/chat"
        payload = json.dumps({"message": t, "sessionId": "telegram-fastpath"}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers=_piko_api_headers(),
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            raw_out = r.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw_out)
        if isinstance(parsed, dict) and isinstance(parsed.get("reply"), str) and parsed["reply"].strip():
            return parsed["reply"].strip()[:4090]
    except Exception as e:
        print(f"[listener] webchat intents fastpath failed: {e}", flush=True)
        return None
    return None


def _webchat_delegate_timeout_fallback(user_text: str) -> str:
    """Visible reply when webchat HTTP times out (async synthesis may still arrive later)."""
    t = (user_text or "").strip().lower()
    if any(k in t for k in ("reorder", "inventory", "stock", "csv", "purchase order", " po", "list all", "export")):
        return (
            "Still working on that — it's a big list. "
            "I'll send the full answer here as soon as it's ready."
        )
    if any(k in t for k in ("proactive", "background", "what else", "capabilities", "what do you do")):
        return (
            "That one is taking longer than expected. I should still send a fuller answer shortly. "
            "If nothing arrives, ask again in one shorter question."
        )
    return (
        "Still working on that — I'll send the answer here as soon as it's ready."
    )


def maybe_webchat_chat_delegate(user_text: str, session_id: str = "telegram-main") -> str | None:
    """
    Route normal chat to WebChat /api/chat (fast 8B loop). Sovereign tool loop stays for /legion etc.
    Set PIKO_TELEGRAM_USE_WEBCHAT=0 to force Path B process_piko_logic for all chat.
    """
    raw = (os.environ.get("PIKO_TELEGRAM_USE_WEBCHAT") or "1").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return None
    t = (user_text or "").strip()
    if not t or t.startswith("/"):
        return None
    try:
        url = f"{_webchat_base_url()}/api/chat"
        payload = json.dumps({"message": t, "sessionId": session_id}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers=_piko_api_headers(),
        )
        timeout = int(os.environ.get("PIKO_TELEGRAM_WEBCHAT_TIMEOUT_SEC") or "120")
        with urllib.request.urlopen(req, timeout=max(30, timeout)) as r:
            raw_out = r.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw_out)
        if isinstance(parsed, dict) and isinstance(parsed.get("reply"), str) and parsed["reply"].strip():
            return parsed["reply"].strip()[:4090]
    except (TimeoutError, socket.timeout):
        print("[listener] webchat chat delegate timed out", flush=True)
        return _webchat_delegate_timeout_fallback(user_text)
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), (TimeoutError, socket.timeout)):
            print("[listener] webchat chat delegate timed out (URLError)", flush=True)
            return _webchat_delegate_timeout_fallback(user_text)
        print(f"[listener] webchat chat delegate failed: {e}", flush=True)
        return "I hit a network error reaching Piko webchat. I'm still online — try again in a moment."
    except Exception as e:
        print(f"[listener] webchat chat delegate failed: {e}", flush=True)
        return "I hit an error handling that message, but I'm still online. Try again."
    return None


def _strip_bot_command_suffix(first_token: str) -> str:
    """Telegram sends ``/legion@MyBot``; normalize to ``/legion``."""
    t = (first_token or "").strip()
    if "@" in t:
        return t.split("@", 1)[0].strip()
    return t


def extract_proposed_task(text: str) -> tuple[str, dict[str, Any] | None]:
    """Split assistant text into visible head + optional draft dict (requires non-empty title)."""
    if PROPOSED_TASK_MARKER not in text:
        return text, None
    idx = text.index(PROPOSED_TASK_MARKER)
    head = text[:idx].rstrip()
    tail = text[idx + len(PROPOSED_TASK_MARKER) :].lstrip()
    try:
        obj, _end = json.JSONDecoder().raw_decode(tail)
    except json.JSONDecodeError:
        return text, None
    if not isinstance(obj, dict):
        return text, None
    if not str(obj.get("title") or "").strip():
        return text, None
    return head, obj


def normalize_draft(obj: dict[str, Any]) -> dict[str, Any]:
    try:
        d = int(obj.get("denarii") or 0)
    except (TypeError, ValueError):
        d = 0
    d = max(0, d)
    try:
        p = int(obj.get("parent_id") or 0)
    except (TypeError, ValueError):
        p = 0
    p = max(0, p)
    out: dict[str, Any] = {
        "title": str(obj.get("title") or "").strip()[:500],
        "description": str(obj.get("description") or "").strip()[:8000],
        "denarii": d,
        "parent_id": p,
    }
    bu = str(obj.get("business_unit") or "").strip()
    if bu:
        out["business_unit"] = bu[:200]
    return out


def maybe_autoproposal_from_user(user_text: str) -> dict[str, Any] | None:
    """
    Deterministic fallback: if the user message clearly implies "create/track a new task",
    generate a draft without relying on the model obeying prompt format.
    """
    t = (user_text or "").strip()
    if not t:
        return None
    low = t.lower()
    keywords = (
        "track ",
        "tracking ",
        "start tracking",
        "add a task",
        "add task",
        "create a task",
        "create task",
        "new task",
        "open a task",
        "register a task",
        "we should track",
        "let's track",
        "lets track",
    )
    if not any(k in low for k in keywords):
        return None

    bu = ""
    if "ausmaker" in low:
        bu = "AusMaker Supplies"
    elif (os.environ.get("PIKO_ACTIVE_BU") or "").strip():
        bu = (os.environ.get("PIKO_ACTIVE_BU") or "").strip()

    # Title heuristics
    title = t
    for prefix in ("piko, ", "piko ", "hey piko, ", "hey piko "):
        if title.lower().startswith(prefix):
            title = title[len(prefix) :].strip()
    title = re.sub(r"^[\"'\\s]+|[\"'\\s]+$", "", title).strip()
    title = title[:120] if len(title) > 120 else title
    if not title:
        return None

    # Default denarii: modest but non-zero to encourage stewardship.
    den = 200 if ("weekly" in low or "report" in low or "audit" in low) else 100

    draft: dict[str, Any] = {
        "title": title,
        "description": f"Operator request: {t}"[:8000],
        "denarii": den,
        "parent_id": 0,
    }
    if bu:
        draft["business_unit"] = bu
    return normalize_draft(draft)


def format_mission_proposal(head: str, draft: dict[str, Any]) -> str:
    lines: list[str] = []
    h = (head or "").strip()
    if h:
        lines.append(h)
    lines.append("🎖 MISSION PROPOSAL")
    lines.append(f"Title: {draft['title']}")
    lines.append(f"Description: {draft.get('description') or '—'}")
    lines.append(f"Denarii: {draft.get('denarii', 0)}")
    lines.append(f"Parent id: {draft.get('parent_id', 0)}")
    if draft.get("business_unit"):
        lines.append(f"Business unit: {draft['business_unit']}")
    lines.append("")
    lines.append("Reply Yes or Proceed to dispatch to the active Legion ledger.")
    lines.append("Or say what to change; No / Cancel to discard.")
    return "\n".join(lines)[:4090]


def _is_cancel_message(t: str) -> bool:
    low = t.strip().lower()
    if low in ("n", "no", "cancel", "abort", "stop", "nevermind", "never mind", "hold"):
        return True
    return bool(re.match(r"^(no|cancel|abort|stop|never mind)\b", low))


def _is_affirmation_message(t: str) -> bool:
    low = t.strip().lower()
    if low in (
        "y",
        "yes",
        "yep",
        "ok",
        "okay",
        "sure",
        "please",
        "proceed",
        "go ahead",
        "confirm",
        "do it",
        "dispatch",
        "approved",
        "sounds good",
        "lock it in",
    ):
        return True
    return bool(re.match(r"^(yes|yep|ok|okay|proceed|go ahead|confirm|dispatch|do it|please do)\b", low))


def _looks_like_amendment(t: str) -> bool:
    low = t.lower()
    if len(t) > 140:
        return True
    keys = (
        "denarii",
        "change",
        "instead",
        "edit",
        "make it",
        "lower",
        "higher",
        "retitle",
        "rename",
        "parent",
        "description",
        "title should",
        "don't dispatch",
        "dont dispatch",
        "wait",
    )
    return any(k in low for k in keys)


def handle_pending_draft_for_chat(chat_id: int | str, text: str) -> str | None:
    """
    If this chat has a pending mission proposal, handle cancel / confirm / amend.
    Returns a Telegram string to send, or None to fall through to normal ``process_piko_logic``.
    """
    key = str(chat_id)
    draft = PENDING_TASK_DRAFTS.get(key)
    if not draft:
        return None
    raw = (text or "").strip()
    if not raw:
        return None

    if _is_cancel_message(raw):
        PENDING_TASK_DRAFTS.pop(key, None)
        return "Mission cancelled. The Legion ledger was not changed."

    if _is_affirmation_message(raw) and not _looks_like_amendment(raw):
        spec: dict[str, Any] = {
            "title": draft["title"],
            "description": draft.get("description") or "",
            "denarii": int(draft.get("denarii") or 0),
            "parent_id": int(draft.get("parent_id") or 0),
        }
        if draft.get("business_unit"):
            spec["business_unit"] = draft["business_unit"]
        print(f"[listener] confirming draft -> {draft.get('title')!r}", flush=True)
        obj: dict[str, Any] | None = None
        dispatch_source = "remote"
        # Prefer remote create via ios-hub so the task lands in the Optimus tenant DB and the served manifest refreshes.
        try:
            url = f"{_webchat_base_url()}/api/ios-hub"
            payload = {
                "action": "legion_task_create",
                "title": spec["title"],
                "description": spec.get("description") or "",
                "denarii": spec.get("denarii", 0),
                "parent_id": spec.get("parent_id", 0),
                "business_unit": spec.get("business_unit"),
                "source": "telegram",
                "sessionId": "telegram-legion-create",
            }
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers=_piko_api_headers(),
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                raw_out = r.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw_out)
            if isinstance(parsed, dict) and parsed.get("ok") is True:
                obj = parsed
        except Exception as e:
            print(f"[listener] remote legion_task_create failed: {e}", flush=True)
            obj = None

        if obj is None:
            dispatch_source = "local"
            out = core.create_legion_task_atomic(json.dumps(spec))
            try:
                obj = json.loads(out) if isinstance(out, str) else {"ok": False, "error": "non-string response"}
            except json.JSONDecodeError:
                return f"❌ Unexpected response from ledger:\n{str(out)[:900]}"
            if not obj.get("ok"):
                return f"❌ Could not dispatch: {obj.get('error') or str(out)[:500]}"

        PENDING_TASK_DRAFTS.pop(key, None)
        tid = None
        bu = None
        if dispatch_source == "remote":
            tid = obj.get("task_id")
            bu = spec.get("business_unit") or (os.environ.get("PIKO_ACTIVE_BU") or "").strip() or None
        else:
            disp = obj.get("dispatch") if isinstance(obj.get("dispatch"), dict) else {}
            tid = disp.get("id")
            bu = disp.get("business_unit") or spec.get("business_unit") or (
                (os.environ.get("PIKO_ACTIVE_BU") or os.environ.get("PIKO_LEGION_BUSINESS_UNIT_DEFAULT") or "").strip()
                or None
            )
        extra = ""
        if obj.get("warning"):
            extra = f"\n⚠️ {obj['warning']}"
        return (
            f"✅ Mission dispatched\n"
            f"• Task: {draft['title']}\n"
            f"• ID: #{tid}\n"
            f"• Business unit: {bu or '(active tenant)'}\n"
            f"• Path: {dispatch_source} (remote writes show up in iOS immediately)\n"
            f"• Manifest refreshed (iOS / HUD).{extra}"
        )

    augment = (
        "[Context: A Legion mission draft awaits Starkers confirmation. Current draft JSON:]\n"
        f"{json.dumps(draft, indent=2)}\n\n"
        f"[Starkers replied:]\n{raw}\n\n"
        "If they want changes, reply with an updated summary and a fresh PROPOSED_TASK: line plus a single-line JSON "
        "object (title, description, denarii, parent_id; optional business_unit). "
        "Do NOT call create_legion_task_atomic. If they asked a question only, answer briefly; omit PROPOSED_TASK "
        "unless you revise the draft."
    )
    reply = process_piko_logic(augment)
    head, new_d = extract_proposed_task(reply)
    if new_d:
        nd = normalize_draft(new_d)
        if nd.get("title"):
            PENDING_TASK_DRAFTS[key] = nd
            return format_mission_proposal(head, nd)
    return reply


def try_hitl_command(text: str) -> str | None:
    """``/approve`` and ``/reject`` for async dangerous-tool queue."""
    raw = (text or "").strip()
    if not raw:
        return None
    parts = raw.split(None, 2)
    cmd = _strip_bot_command_suffix(parts[0]).lower()
    if cmd == "/approve" and len(parts) >= 2:
        return hitl_manager.approve_hitl(parts[1].strip())
    if cmd == "/reject" and len(parts) >= 2:
        return hitl_manager.reject_hitl(parts[1].strip())
    if cmd in ("/hitl", "/pending"):
        pending = hitl_manager.list_pending()
        if not pending:
            return "No pending HITL approvals."
        lines = ["Pending dangerous-tool approvals:", ""]
        for p in pending[:15]:
            lines.append(f"• `{p.get('id')}` — {p.get('tool_name')} ({p.get('created_at', '')[:19]})")
        lines.append("\nUse /approve <id> or /reject <id>")
        return "\n".join(lines)[:4090]
    return None


def try_direct_legion_command(text: str) -> str | None:
    """``/legion`` help only (natural language + confirmation gate handles new missions)."""
    raw = (text or "").strip()
    if not raw:
        return None
    parts = raw.split(None, 1)
    cmd0 = _strip_bot_command_suffix(parts[0])
    cmd = cmd0.lower()

    if cmd == "/legion":
        return (
            "🎖 Legion — Conversational Steward mode\n\n"
            "Describe a new mission in plain language. Piko will summarize and show a MISSION PROPOSAL.\n"
            "Reply Yes or Proceed to write to the active tenant ledger and refresh the iOS manifest.\n\n"
            "/menu — inline buttons."
        )

    return None


MENU_TEXT = "Piko Field Radio — choose an action:"
MENU_KEYBOARD = {
    "inline_keyboard": [
        [{"text": "Legion: all tasks", "callback_data": "legion_all"}],
        [{"text": "Legion: submitted", "callback_data": "legion_status:submitted"}],
        [{"text": "Legion: Audit", "callback_data": "audit"}],
        [{"text": "⚡️ Remediate Stale", "callback_data": "remediate_stale"}],
        [{"text": "✂️ Quality Gate", "callback_data": "quality_gate"}],
        [{"text": "🧭 Hierarchy integrity", "callback_data": "hierarchy_audit"}],
        [{"text": "🧹 Wiki housekeeping", "callback_data": "wiki_housekeeping"}],
        [{"text": "Wiki: Architecture Log", "callback_data": "wiki_arch_log"}],
        [{"text": "App: Generate manifest", "callback_data": "manifest"}],
        [{"text": "Help", "callback_data": "help"}],
    ]
}


TG_CHUNK_LIMIT = 4090


def chunk_tg_text(text: str, limit: int = TG_CHUNK_LIMIT) -> list[str]:
    """Split long replies at newline/space boundaries instead of truncating."""
    body = (text or "").strip()
    if not body:
        return ["(empty reply)"]
    chunks: list[str] = []
    while len(body) > limit:
        cut = body.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = body.rfind(" ", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(body[:cut].rstrip())
        body = body[cut:].lstrip()
    if body:
        chunks.append(body)
    return chunks


def send_tg(chat_id: int | str, text: str) -> None:
    if not TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    for body in chunk_tg_text(text):
        payload = json.dumps({"chat_id": chat_id, "text": body}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = json.loads(r.read().decode("utf-8", errors="replace"))
        if not raw.get("ok"):
            print(f"[listener] sendMessage failed: {raw}", flush=True)
            break


def send_menu(chat_id: int | str) -> None:
    if not TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = json.dumps(
        {
            "chat_id": chat_id,
            "text": MENU_TEXT,
            "reply_markup": MENU_KEYBOARD,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = json.loads(r.read().decode("utf-8", errors="replace"))
    if not raw.get("ok"):
        print(f"[listener] sendMenu failed: {raw}", flush=True)


def answer_callback(callback_id: str, text: str | None = None) -> None:
    if not TOKEN:
        return
    url = f"https://api.telegram.org/bot{TOKEN}/answerCallbackQuery"
    payload = {"callback_query_id": callback_id}
    if text:
        payload["text"] = (text or "")[:190]
        payload["show_alert"] = False
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except Exception:
        return


def delete_webhook_force() -> dict[str, Any]:
    """Clear bot webhook so getUpdates long-polling is allowed."""
    if not TOKEN:
        return {"ok": False, "description": "no token"}
    url = f"https://api.telegram.org/bot{TOKEN}/deleteWebhook?drop_pending_updates=true"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except Exception as e:
        return {"ok": False, "description": str(e)}


def get_updates(offset: int | None) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{TOKEN}/getUpdates?timeout=30"
    if offset is not None:
        url += f"&offset={offset}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def process_piko_logic(user_text: str) -> str:
    """Same agentic JSON tool loop as piko_core (no stdin). Telegram uses Strategic Approval Gate prompt."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": core.build_sovereign_system_prompt(telegram_path_b=True)},
        {"role": "user", "content": user_text},
    ]

    rounds = 0
    while rounds < MAX_TOOL_CHAIN:
        rounds += 1
        raw = core._openai_client().chat.completions.create(
            model=core.CHAT_MODEL,
            messages=messages,
            temperature=0.2,
        ).choices[0].message.content
        res = (raw or "").strip()
        if not res:
            return "[Error: empty model response]"

        tool_data = core._extract_tool_json_object(res)
        if tool_data is None:
            messages.append({"role": "assistant", "content": res})
            return res

        t_name = tool_data.get("name")
        t_args = tool_data.get("arguments", {})
        if not isinstance(t_name, str) or not t_name.strip():
            messages.append({"role": "assistant", "content": res})
            return res
        if not isinstance(t_args, dict):
            t_args = {}

        print(f"[tool] {t_name}", flush=True)

        if t_name == "write_to_wiki":
            result = core.write_to_wiki(t_args.get("topic"), t_args.get("content"))
        elif t_name == "perform_legion_audit":
            result = core.perform_legion_audit(
                bool(t_args.get("write_wiki", False)),
                str(t_args.get("wiki_topic") or "Legion_Audit"),
            )
        elif t_name == "remediate_stale_tasks":
            result = core.remediate_stale_tasks()
        elif t_name == "evaluate_task_quality":
            result = core.evaluate_task_quality(bool(t_args.get("dry_run", False)))
        elif t_name == "decompose_task":
            raw_sub = t_args.get("sub_tasks")
            if isinstance(raw_sub, str):
                try:
                    raw_sub = json.loads(raw_sub)
                except Exception:
                    raw_sub = []
            sub_list = raw_sub if isinstance(raw_sub, list) else []
            try:
                tid_d = int(t_args.get("task_id"))
            except (TypeError, ValueError):
                tid_d = 0
            result = core.decompose_task(tid_d, sub_list)
        elif t_name == "audit_hierarchy_integrity":
            result = core.audit_hierarchy_integrity(bool(t_args.get("dry_run", False)))
        elif t_name == "perform_housekeeping":
            result = core.perform_housekeeping(bool(t_args.get("dry_run", False)))
        elif t_name == "measure_brain_latency":
            result = core.measure_brain_latency()
        elif t_name == "review_maintenance_log":
            result = core.review_maintenance_log(bool(t_args.get("dry_run", False)))
        elif t_name == "generate_app_manifest":
            result = core.generate_app_manifest(int(t_args.get("limit_wiki", 25)))
        elif t_name == "create_legion_task_atomic":
            result = json.dumps(
                {
                    "ok": False,
                    "error": "Telegram Path B: do not call create_legion_task_atomic from the model.",
                    "hint": "Summarize the mission, then end with PROPOSED_TASK: and a one-line JSON object "
                    "(title, description, denarii, parent_id). Starkers confirms in chat before the ledger write.",
                },
                indent=2,
            )
        else:
            os.environ["PIKO_HITL_CHANNEL"] = "telegram"
            os.environ["PIKO_HITL_ASYNC"] = "1"
            try:
                result = execute_tool_yolo(t_name, json.dumps(t_args))
            finally:
                os.environ.pop("PIKO_HITL_ASYNC", None)
                os.environ.pop("PIKO_HITL_CHANNEL", None)

        messages.append({"role": "assistant", "content": res})
        messages.append(
            {
                "role": "user",
                "content": f"Tool Result: {result}\nProceed to the next step or reply to the user.",
            }
        )

    return f"[Stopped after {MAX_TOOL_CHAIN} tool rounds.]"


def _allowed_update(upd: dict[str, Any]) -> bool:
    """
    Allowlisted by chat id for both message and callback_query.
    """
    if not ALLOW_CHAT_ID:
        return False
    msg = upd.get("message") or {}
    cq = upd.get("callback_query") or {}
    if msg.get("chat", {}).get("id") is not None:
        return str(msg.get("chat", {}).get("id")) == str(ALLOW_CHAT_ID)
    if cq.get("message", {}).get("chat", {}).get("id") is not None:
        return str(cq.get("message", {}).get("chat", {}).get("id")) == str(ALLOW_CHAT_ID)
    return False


def _handle_callback(upd: dict[str, Any]) -> tuple[int | str | None, str | None]:
    cq = upd.get("callback_query") or {}
    cb_id = cq.get("id")
    data = (cq.get("data") or "").strip()
    msg = cq.get("message") or {}
    chat_id = msg.get("chat", {}).get("id")
    if not cb_id or not data or chat_id is None:
        return None, None

    # quick ack so Telegram UI stops "loading"
    answer_callback(cb_id, "Working…")

    if data == "help":
        return chat_id, (
            "Commands:\n"
            "- /menu: show buttons\n"
            "- /legion — Legion quick help (mission proposals + Yes to dispatch)\n"
            "- You can also type free text; buttons just reduce friction.\n"
            "- Quality Gate moves tasks to rejected/review_required; uphold or overturn with update_legion_task.\n"
            "- Hierarchy integrity audit closes delegated parents when all children are terminal.\n"
            "- Wiki housekeeping archives old top-level wiki/*.md into wiki/archive/.\n"
            "- Sovereign shell (git pull / systemctl / nvidia-smi) needs Mac terminal Y/N; not from Telegram.\n"
            "Safety: only this allowlisted chat can control Piko."
        )

    if data == "legion_all":
        return chat_id, execute_tool_yolo("query_legion_tasks", "{}")

    if data.startswith("legion_status:"):
        status = data.split(":", 1)[1].strip()
        return chat_id, execute_tool_yolo("query_legion_tasks", json.dumps({"status": status}))

    if data == "manifest":
        # manifest is implemented in core (not in yolo_protocol)
        return chat_id, core.generate_app_manifest(25)

    if data == "audit":
        # Deterministic audit tool in core; optionally you can add a write-to-wiki toggle later.
        return chat_id, core.perform_legion_audit(write_wiki=True, wiki_topic="Legion_Audit")

    if data == "remediate_stale":
        return chat_id, core.remediate_stale_tasks()

    if data == "quality_gate":
        return chat_id, core.evaluate_task_quality(dry_run=False)

    if data == "hierarchy_audit":
        return chat_id, core.audit_hierarchy_integrity(dry_run=False)

    if data == "wiki_housekeeping":
        return chat_id, core.perform_housekeeping(dry_run=False)

    if data == "wiki_arch_log":
        # Deterministic (non-LLM) path: read ledger → format → write wiki.
        ledger = execute_tool_yolo("query_legion_tasks", "{}")
        tasks: list[dict] = []
        if isinstance(ledger, str) and ledger.lstrip().startswith("["):
            try:
                tasks = json.loads(ledger)
            except Exception:
                tasks = []

        lines: list[str] = []
        lines.append(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} — Architecture Log")
        lines.append("")
        if tasks:
            lines.append("| Task ID | Title | Status | Assignee |")
            lines.append("| --- | --- | --- | --- |")
            for t in tasks:
                tid = (t or {}).get("id", "")
                title = str((t or {}).get("title", "")).replace("\n", " ").strip()
                status = str((t or {}).get("status", "")).strip()
                assignee = (t or {}).get("assignee", "")
                lines.append(f"| {tid} | {title} | {status} | {assignee} |")
            lines.append("")
        else:
            lines.append("No tasks found in the Legion Ledger for this query.")
            lines.append("")

        lines.append("Next actions for Starkers:")
        if not tasks:
            lines.append("- Add or schedule next Legion tasks.")
        else:
            lines.append("- Review submitted items and either approve, activate, or add clarifying notes.")
            lines.append("- Identify blockers and record dependencies.")

        content = "\n".join(lines).strip() + "\n"
        result = core.write_to_wiki("Architecture_Log", content)
        return chat_id, f"{result} (created/updated architecture_log.md)"

    return chat_id, f"Unknown action: {data}"


def _allowed_chat(msg: dict[str, Any]) -> bool:
    if not ALLOW_CHAT_ID:
        return False
    cid = msg.get("chat", {}).get("id")
    return str(cid) == str(ALLOW_CHAT_ID)


def _handle_incoming_text(reply_to: int, text: str) -> None:
    """Process one chat message off the poll loop so slow webchat cannot block getUpdates."""
    try:
        direct = try_direct_legion_command(text)
        if direct is not None:
            send_tg(reply_to, direct)
            return

        hitl = try_hitl_command(text)
        if hitl is not None:
            send_tg(reply_to, hitl)
            return

        gated = handle_pending_draft_for_chat(reply_to, text)
        if gated is not None:
            send_tg(reply_to, gated)
            return

        auto = maybe_autoproposal_from_user(text)
        if auto is not None:
            PENDING_TASK_DRAFTS[str(reply_to)] = auto
            send_tg(reply_to, format_mission_proposal("", auto))
            return

        fast = maybe_webchat_intents_fastpath(text)
        if fast is not None:
            send_tg(reply_to, fast)
            return

        delegated = maybe_webchat_chat_delegate(text, session_id=f"telegram-{reply_to}")
        if delegated is not None:
            send_tg(reply_to, delegated)
            return

        try:
            reply = process_piko_logic(text)
        except Exception as e:
            reply = f"[Piko error] {e}"
            print(f"[err] {e}", flush=True)
        head, proposal = extract_proposed_task(reply)
        if proposal:
            nd = normalize_draft(proposal)
            PENDING_TASK_DRAFTS[str(reply_to)] = nd
            reply = format_mission_proposal(head, nd)
        send_tg(reply_to, reply)
    except Exception as e:
        print(f"[listener] handle incoming failed: {e}", flush=True)
        try:
            send_tg(reply_to, "I hit an error on that message. Try again in a moment.")
        except Exception:
            pass


def run_listener() -> None:
    if not TOKEN:
        print("Set TELEGRAM_BOT_TOKEN (and TELEGRAM_CHAT_ID) in webchat-piko/.env", file=sys.stderr)
        sys.exit(1)
    if not ALLOW_CHAT_ID:
        print("Set TELEGRAM_CHAT_ID in webchat-piko/.env for allowlist.", file=sys.stderr)
        sys.exit(1)

    prof = (os.environ.get("PIKO_BRAIN_PROFILE") or "").strip() or "(unset)"
    print("=== Piko Telegram listener [Path B] — Sovereign / High Architect ===", flush=True)
    print(f"brain={core.BRAIN_ENDPOINT} model={core.CHAT_MODEL} PIKO_BRAIN_PROFILE={prof}", flush=True)
    print(f"Allow chat id: {ALLOW_CHAT_ID}", flush=True)
    print("Waiting for getUpdates (Ctrl+C to stop)…", flush=True)
    print("NOTE: stop other pollers using the same bot token (e.g. Optimus clawfriend-bot).", flush=True)

    wh = delete_webhook_force()
    print(f"[listener] deleteWebhook: {wh.get('ok', wh)}", flush=True)

    offset: int | None = None
    while True:
        try:
            data = get_updates(offset)
            if not data.get("ok"):
                print(f"[listener] getUpdates: {data}", flush=True)
                time.sleep(3)
                continue
            for upd in data.get("result", []):
                offset = upd["update_id"] + 1
                if not _allowed_update(upd):
                    continue

                if upd.get("callback_query"):
                    try:
                        reply_to, reply = _handle_callback(upd)
                        if reply_to is not None and reply:
                            send_tg(reply_to, reply)
                    except Exception as e:
                        # Ensure callback failures are visible to the operator (otherwise it looks like "nothing happened").
                        cq = upd.get("callback_query") or {}
                        cb_id = cq.get("id")
                        if cb_id:
                            answer_callback(str(cb_id), f"Error: {e}")
                        chat_id = (cq.get("message") or {}).get("chat", {}).get("id")
                        if chat_id is not None:
                            send_tg(chat_id, f"[Callback error] {e}")
                        print(f"[listener] callback error: {e}", flush=True)
                    continue

                msg = upd.get("message") or {}
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                reply_to = msg.get("chat", {}).get("id")
                print(f"[in] {text[:200]!r}", flush=True)

                lower = text.lower()
                # Telegram may include bot username suffix (e.g. /menu@MyBot). Treat those as menu commands too.
                if lower in ("/start", "menu") or lower.startswith("/menu"):
                    send_menu(reply_to)
                    continue

                _CHAT_EXECUTOR.submit(_handle_incoming_text, reply_to, text)
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace") if e.fp else ""
            if e.code == 409:
                print("[listener] HTTP 409 — trying deleteWebhook (webhook vs poll)…", flush=True)
                print(f"[listener] deleteWebhook => {delete_webhook_force()}", flush=True)
                print(
                    "[listener] If this repeats: another process is still calling getUpdates on this token "
                    "(stop clawfriend-bot / second bot).",
                    flush=True,
                )
            else:
                print(f"[listener] HTTP {e.code} {err[:300]}", flush=True)
            time.sleep(5)
        except OSError as e:
            print(f"[listener] network: {e}", flush=True)
            time.sleep(5)
        except KeyboardInterrupt:
            print("\nListener stopped.", flush=True)
            break
        except Exception as e:
            print(f"[listener] {e}", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    run_listener()
