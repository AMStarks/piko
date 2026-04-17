"""Traffic-cop router: local Piko vs RunPod Qwen over SSH tunnel.

Env vars (optional):
  PIKO_LOCAL_BASE_URL   default: http://localhost:11434/v1
  PIKO_LOCAL_MODEL      default: piko:finetune
  PIKO_CLOUD_BASE_URL   default: http://localhost:18000/v1
  PIKO_CLOUD_MODEL      default: Qwen/Qwen2.5-72B-Instruct-AWQ
"""

from __future__ import annotations

import os

from openai import OpenAI


LOCAL_BASE_URL = os.getenv("PIKO_LOCAL_BASE_URL", "http://localhost:11434/v1")
LOCAL_MODEL = os.getenv("PIKO_LOCAL_MODEL", "piko:finetune")

CLOUD_BASE_URL = os.getenv("PIKO_CLOUD_BASE_URL", "http://localhost:18000/v1")
CLOUD_MODEL = os.getenv("PIKO_CLOUD_MODEL", "Qwen/Qwen2.5-72B-Instruct-AWQ")

_COMPLEX_HINTS = (
    "python",
    "sql",
    "sqlite",
    "postgres",
    "mysql",
    "database",
    "schema",
    "migration",
    "docker",
    "compose",
    "kubernetes",
    "k8s",
    "terraform",
    "ansible",
    "script",
    "cli",
    "argparse",
    "bug",
    "traceback",
    "stack trace",
    "error",
    "log",
    "regex",
    "algorithm",
    "optimize",
    "forecast",
    "pandas",
    "numpy",
    "statsmodels",
    "qdrant",
    "redis",
)


def _stream_print(stream) -> str:
    buf = ""
    for chunk in stream:
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            print(text, end="", flush=True)
            buf += text
    return buf


def _decide_simple_or_complex(piko_client: OpenAI, user_input: str) -> str:
    # Fast heuristic override: avoid "8B thinks it's simple" failures.
    text = user_input.strip().lower()
    if len(text) >= 140:
        return "COMPLEX"
    if any(hint in text for hint in _COMPLEX_HINTS):
        return "COMPLEX"

    classifier_prompt = (
        "Analyze the request below.\n"
        "If it likely requires complex coding, math, SQL, deep debugging, or long multi-step logic, answer COMPLEX.\n"
        "Otherwise answer SIMPLE.\n\n"
        f"Request: {user_input!r}\n\n"
        "Answer with exactly one word: SIMPLE or COMPLEX."
    )
    r = piko_client.chat.completions.create(
        model=LOCAL_MODEL,
        messages=[{"role": "user", "content": classifier_prompt}],
        temperature=0.0,
        max_tokens=5,
    )
    decision = (r.choices[0].message.content or "").strip().upper()
    return "COMPLEX" if "COMPLEX" in decision else "SIMPLE"


def chat_loop() -> None:
    piko_client = OpenAI(base_url=LOCAL_BASE_URL, api_key="EMPTY")
    qwen_client = OpenAI(base_url=CLOUD_BASE_URL, api_key="EMPTY")

    local_messages = [
        {
            "role": "system",
            "content": "You are Piko, a highly capable, slightly witty AI assistant. Keep answers clear and concise.",
        }
    ]
    cloud_messages = [
        {
            "role": "system",
            "content": "You are Qwen 72B powering Piko. Be direct and helpful. Keep answers concise unless asked.",
        }
    ]

    print("=== Piko Multi-Agent System Online ===")
    print(f"Local: {LOCAL_MODEL} @ {LOCAL_BASE_URL}")
    print(f"Cloud: {CLOUD_MODEL} @ {CLOUD_BASE_URL}")
    print("(Type 'quit' to exit)\n")

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in {"quit", "exit", "q"}:
            print("Piko: See ya later, boss!")
            return
        if not user_input:
            continue

        try:
            decision = _decide_simple_or_complex(piko_client, user_input)
        except Exception as e:
            print(f"[Router error: can't reach local Piko at {LOCAL_BASE_URL}: {e}]")
            continue

        if decision == "COMPLEX":
            print("\nPiko (Front Desk): Routing to Qwen 72B…")
            print("Qwen: ", end="", flush=True)
            cloud_messages.append({"role": "user", "content": user_input})
            try:
                stream = qwen_client.chat.completions.create(
                    model=CLOUD_MODEL,
                    messages=cloud_messages,
                    stream=True,
                )
                reply = _stream_print(stream)
                print("\n")
                cloud_messages.append({"role": "assistant", "content": reply})
            except Exception as e:
                print(f"\n[Cloud connection error: {e}]\n")
        else:
            print("\nPiko (Front Desk): I got this one.")
            print("Piko: ", end="", flush=True)
            local_messages.append({"role": "user", "content": user_input})
            try:
                stream = piko_client.chat.completions.create(
                    model=LOCAL_MODEL,
                    messages=local_messages,
                    stream=True,
                )
                reply = _stream_print(stream)
                print("\n")
                local_messages.append({"role": "assistant", "content": reply})
            except Exception as e:
                print(f"\n[Local connection error: {e}]\n")


if __name__ == "__main__":
    chat_loop()

