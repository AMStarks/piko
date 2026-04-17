"""
Piko OS — Phase 1: World Model + local Wiki.

- Reads `world_model.json` every run and injects it into the system prompt.
- Lets the model persist important facts/rules into `./wiki/*.md` via tool calls.
- Uses your existing SSH tunnel to vLLM (RunPod) at http://localhost:18000/v1
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from openai import OpenAI


CLOUD_BASE_URL = os.getenv("PIKO_CLOUD_BASE_URL", "http://localhost:18000/v1")
CLOUD_MODEL = os.getenv("PIKO_CLOUD_MODEL", "Qwen/Qwen2.5-72B-Instruct-AWQ")

PROJECT_ROOT = Path(__file__).resolve().parent
WIKI_DIR = Path(os.getenv("PIKO_WIKI_DIR", str(PROJECT_ROOT / "wiki"))).resolve()
WORLD_MODEL_PATH = Path(os.getenv("PIKO_WORLD_MODEL_PATH", str(PROJECT_ROOT / "world_model.json"))).resolve()


def _safe_slug(topic: str) -> str:
    topic = (topic or "").strip().lower()
    topic = re.sub(r"\s+", "_", topic)
    topic = re.sub(r"[^a-z0-9_\-]+", "", topic)
    return topic[:80] or "untitled"


def load_world_model() -> Dict[str, Any]:
    try:
        raw = WORLD_MODEL_PATH.read_text("utf-8")
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {"error": "World model must be a JSON object."}
    except FileNotFoundError:
        return {"error": "World model not found."}
    except Exception as e:
        return {"error": f"World model load failed: {e}"}


def write_to_wiki(topic: str, content: str) -> str:
    WIKI_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_slug(topic)}.md"
    filepath = (WIKI_DIR / filename).resolve()

    # Prevent path tricks: enforce write stays inside wiki dir.
    if WIKI_DIR not in filepath.parents:
        raise ValueError("Refusing to write outside wiki directory.")

    text = (content or "").strip()
    if not text:
        return f"Skipped: empty content for {filename}"

    filepath.write_text(text + "\n", encoding="utf-8")
    return f"Successfully saved knowledge to {filename}"


def run_piko() -> None:
    WIKI_DIR.mkdir(parents=True, exist_ok=True)
    client = OpenAI(base_url=CLOUD_BASE_URL, api_key="EMPTY")

    print("=== Piko OS [Phase 1: Memory & World Model] Online ===")
    print(f"Model: {CLOUD_MODEL}")
    print(f"World model: {WORLD_MODEL_PATH}")
    print(f"Wiki dir: {WIKI_DIR}")

    world_state = load_world_model()
    system_prompt = (
        "You are Piko, an autonomous digital employee.\n"
        f"Company: {world_state.get('company_name')}\n"
        f"Boss: {world_state.get('boss')}\n"
        f"Current Focus: {world_state.get('current_focus')}\n"
        f"Core Directive: {world_state.get('core_directive')}\n"
        f"Active Alerts: {world_state.get('active_alerts')}\n"
        f"Current Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        "You can write permanent Markdown notes into your Wiki.\n"
        "If Starkers provides an important fact, business rule, workflow, or decision, you MUST:\n"
        "1) acknowledge it briefly, then\n"
        "2) save it to the wiki using the `write_to_wiki` tool.\n"
        "When saving, keep the wiki note crisp, titled, and actionable.\n"
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

    tools = [
        {
            "type": "function",
            "function": {
                "name": "write_to_wiki",
                "description": "Save important permanent facts, business rules, or summaries to the local Markdown Wiki.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "description": "The title of the document (e.g., 'Inventory Rules')"},
                        "content": {"type": "string", "description": "The detailed markdown content to save."},
                    },
                    "required": ["topic", "content"],
                },
            },
        }
    ]

    while True:
        user_input = input("\nStarkers: ").strip()
        if user_input.lower() in {"quit", "exit"}:
            print("Piko: Shutting down systems. Catch you later.")
            return
        if not user_input:
            continue

        messages.append({"role": "user", "content": user_input})
        print("Piko: ", end="", flush=True)

        try:
            response = client.chat.completions.create(
                model=CLOUD_MODEL,
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
        except Exception as e:
            print(f"\n[RunPod Connection Error] Is the SSH tunnel on Port 18000 running? Details: {e}")
            continue

        msg = response.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None) or []

        if not tool_calls:
            if msg.content:
                print(msg.content)
                messages.append({"role": "assistant", "content": msg.content})
            continue

        if msg.content:
            print(msg.content)

        # One assistant message carrying tool_calls (required shape for follow-up tool results)
        assistant_payload: dict[str, Any] = {"role": "assistant", "content": msg.content or None}
        if hasattr(msg, "model_dump"):
            dumped = msg.model_dump()
            if dumped.get("tool_calls"):
                assistant_payload["tool_calls"] = dumped["tool_calls"]
        elif tool_calls:
            assistant_payload["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
                }
                for tc in tool_calls
            ]
        messages.append(assistant_payload)

        for tool_call in tool_calls:
            if tool_call.function.name != "write_to_wiki":
                continue
            try:
                args = json.loads(tool_call.function.arguments or "{}")
                topic = str(args.get("topic", "")).strip()
                content = str(args.get("content", "")).strip()
                print(f"\n[SYSTEM: Piko is writing '{_safe_slug(topic)}.md' to his Wiki...]")
                tool_result = write_to_wiki(topic, content)
            except Exception as e:
                tool_result = f"Wiki write failed: {e}"

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_call.function.name,
                    "content": tool_result,
                }
            )

        # Let the model summarize the writes (optional nice UX)
        try:
            second = client.chat.completions.create(model=CLOUD_MODEL, messages=messages)
            final_reply = second.choices[0].message.content or ""
            if final_reply.strip():
                print(f"Piko: {final_reply.strip()}")
                messages.append({"role": "assistant", "content": final_reply.strip()})
        except Exception:
            pass


if __name__ == "__main__":
    run_piko()

