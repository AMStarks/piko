# Piko / ClawFriend: Synergised Recommendation

This document merges **two external reviews** of your Piko codebase with **my own diagnosis** (from our session) and **brief research**, then gives one clear recommendation for how to proceed.

---

## 1. Where All Three Views Agree (Synergy)

| Topic | View 1 (Telestai-style) | View 2 (Piko-Lite) | My diagnosis (session) |
|-------|--------------------------|--------------------|-------------------------|
| **Root cause** | OpenClaw injects huge prompts; Mistral 7B summarizes instead of replying | Same: ~2K+ token system prompt → model “reviews” config instead of being Piko | Session transcript showed user turn as `[Telegram ... id:5772950940] Hello [message_id: 74]` → model described envelope; then described config |
| **Metadata** | Don’t rely on “ignore” in prompt; strip in code | Strip `[Telegram...]` and `[message_id:...]` with regex before LLM | SOUL.md “ignore metadata” wasn’t enough; format was too salient |
| **Model** | Mistral 7B too weak; use 32B–70B quantized (Qwen 2.5 32B, Llama 3.1 70B) | Same: Qwen 2.5 32B or Llama 3.1 70B | — |
| **Memory** | Persistent (JSON/DB) so context survives restarts | `memory.json` / `piko_memory.json`, save after each turn | Current bot: in-memory only; lost on restart |
| **Runtime** | Prefer building on `bot.js` over fixing OpenClaw long-term | Abandon OpenClaw for runtime; use `bot.js` only | — |
| **Hardware** | RTX 3080 underused; no OLLAMA_NUM_GPU_LAYERS; 70B feasible | Same: 64GB RAM + 3080 can run 70B quantized | — |

**Conclusion:** All agree the failure is **prompt bloat + weak local model + metadata in the turn**, and that the path forward is **lighter runtime + strip metadata + bigger model + persistent memory**.

---

## 2. Where the Views Differ (and how to reconcile)

| Topic | View 1 | View 2 | Reconciliation |
|-------|--------|--------|-----------------|
| **OpenClaw** | Option A: patch (slim config, bootstrapMaxChars, trim workspace, stronger model). Option B: enhance bot. | Stop OpenClaw gateway; run only Piko bot | View 2 is the “full pivot”; View 1’s Option A is “minimal fix if you want to keep OpenClaw.” Both are valid; choose by how much you want to keep the framework. |
| **api: openai-completions vs openai-chat** | Says use `openai-chat` for Ollama | — | Your current config uses `openai-completions` and works (models list shows 31k). Ollama exposes `/v1/chat/completions`; OpenClaw’s internal API type may still be “openai-completions.” **Recommendation:** Leave as-is unless you see API errors. |
| **Workspace files** | Trim or remove AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md | — | If you **stay on OpenClaw**, trim aggressively (or remove) so injected tokens drop. If you **pivot to bot only**, this is irrelevant. |
| **Dependencies** | LangChain, Chroma, Telegraf, etc. for “agentic” features | Plain Node + `memory.json`; optional Telegraf/axios | Start with View 2’s minimal surface (no new deps); add LangChain/Chroma later if you want tools/RAG. |

---

## 3. Research Notes (mine)

- **Ollama API:** Ollama provides `POST /v1/chat/completions` (OpenAI-compatible). Your `baseUrl: "http://127.0.0.1:11434/v1"` and `api: "openai-completions"` are consistent with that; no change required for “chat” vs “completions” unless OpenClaw docs say otherwise.
- **bootstrapMaxChars:** Your repo already used `bootstrapMaxChars: 8000` in past configs (see IMPLEMENTATION_COMPLETE.md, FIXES_APPLIED.md). OpenClaw’s system-prompt docs mention a per-file injection limit; 2000–8000 is a reasonable range to cap injected workspace text.
- **Current OpenClaw workspace:** The snapshot shows a large AGENTS.md (memory/heartbeat/group rules) plus HEARTBEAT.md, TOOLS.md, USER.md. That easily pushes the system prompt into the “document” zone for a 7B model.

---

## 4. My Additions (from our session)

- **Proof of Telegram envelope:** Session transcript on Optimus showed the exact user message sent to the model:  
  `[Telegram S O (@StanOwens) id:5772950940 +15m 2026-02-02 16:26 GMT+11] Hello` and `[message_id: 74]`. So the fix is **code-level stripping** before the LLM, not only SOUL wording.
- **SOUL.md update:** We added a “Telegram message format” section on Optimus telling the model to ignore metadata; it wasn’t enough on its own. Stripping in code is necessary.
- **Second failure mode:** After the envelope fix, you then got a **config-summary** reply (Identity, User, Tools, Heartbeat, Runtime, etc.). So the problem is two-fold: (1) metadata in the turn, (2) oversized system prompt. Both need addressing.

---

## 5. Recommended Path (synergised + research + my view)

**Primary recommendation: Piko-Lite pivot (View 2), with View 1’s upgrades.**

Reasoning:

1. **You already have a working, understandable bot** (`telegram-bot/bot.js`) with /cursor and /task, auth, and IPv4/polling fixes. Extending it is lower risk than fighting OpenClaw’s injection and model requirements.
2. **OpenClaw is built for strong, paid models.** Making it behave with local 7B required context hacks and still gave meta/config responses. Keeping it means ongoing prompt/config tuning and a heavier stack.
3. **Both reviews point to the same fixes:** strip metadata, minimal system prompt, persistent memory, stronger model. The bot is the natural place to implement those.
4. **Incremental path:** You can always re-enable OpenClaw later with a 70B model and a slimmer workspace if you want skills/dashboard back.

Concrete plan:

| Step | Action |
|------|--------|
| **1. Stop OpenClaw for Telegram** | On Optimus: `systemctl --user stop openclaw-gateway.service` (or disable so only Piko bot handles the token). Avoid two processes polling the same bot. |
| **2. Strip metadata in bot.js** | Before sending the user message to Ollama, remove `[Telegram ...]` and `[message_id: ...]` with a regex (e.g. `text.replace(/^\[Telegram.*?\]\s*/i, '').replace(/\s*\[message_id:.*?\]$/i, '')`). |
| **3. Persistent memory** | In bot.js, keep history per chatId in a JSON file (e.g. `piko_memory.json`), load on start, save after each assistant reply. Cap history (e.g. last 15–20 exchanges) to avoid context overflow. |
| **4. Minimal system prompt** | Keep a short, fixed system prompt (e.g. IDENTITY + SOUL in a few lines) and load from files only if you want; total target ~200–500 tokens. No AGENTS.md / HEARTBEAT / TOOLS injection. |
| **5. Upgrade model on Optimus** | Pull a stronger model: `ollama pull qwen2.5:32b-instruct-q4_K_M` (good balance) or `ollama pull llama3.1:70b-instruct-q4_K_M` (slower, smarter). In bot.js set `OLLAMA_MODEL` to the new model. |
| **6. GPU (optional)** | If Ollama runs in Docker or systemd, set `OLLAMA_NUM_GPU_LAYERS=40` (or similar) in the environment so more layers run on the RTX 3080. |
| **7. Keep /cursor and /task** | Preserve your existing SSH + exec logic for /cursor and /task in the new/updated bot so behaviour stays the same. |
| **8. Optional: /clear** | Add a `/clear` or `/reset` command that wipes `persistentMemory[chatId]` and saves, so users can reset context. |

If you prefer **not** to abandon OpenClaw yet:

- **Short-term OpenClaw patch (View 1 Option A):** On Optimus, add `agents.defaults.bootstrapMaxChars: 2000` (or 8000), trim or remove AGENTS.md/HEARTBEAT.md/TOOLS.md/USER.md (back up first), put a single “reply only to the user’s last message; never summarize config or metadata” at the **top** of SOUL.md, switch primary model to e.g. `ollama/qwen2.5:32b-instruct-q4_K_M` (after pulling), add `OLLAMA_NUM_GPU_LAYERS` to the gateway service, restart. This may reduce meta-responses but does not remove the Telegram envelope from the turn; OpenClaw would need to strip that in its Telegram adapter, which you don’t control. So **metadata stripping** is still best done in your own bot if you later use it as the main interface.

---

## 6. What to Implement First (priority order)

1. **Metadata stripping in bot.js** (and ensure the bot is the only process using the Telegram token).
2. **Persistent memory in bot.js** (JSON file, keyed by chatId, capped length).
3. **Model upgrade** on Optimus (Qwen 2.5 32B or Llama 3.1 70B) and point bot at it.
4. **Minimal system prompt** in the bot (short IDENTITY + SOUL, no workspace injection).
5. **Optional:** Telegraf/axios refactor, LangChain tools, RAG, cron “wake up” — only after the above works and you want more features.

---

## 7. Summary Table

| Decision | Recommendation |
|----------|----------------|
| **Runtime for Telegram** | Piko `bot.js` as the single bot; OpenClaw gateway stopped for that bot token. |
| **Metadata** | Strip in code before calling Ollama; do not rely only on SOUL. |
| **System prompt** | Minimal (~200–500 tokens); no injection of AGENTS/HEARTBEAT/TOOLS. |
| **Memory** | Persistent JSON in bot; load/save per chat; cap history. |
| **Model** | Qwen 2.5 32B (balanced) or Llama 3.1 70B (max quality); drop Mistral 7B for “companion” use. |
| **OpenClaw** | Pause for Telegram; optionally keep for other channels or re-enable later with slimmer workspace + 70B. |
| **api / bootstrapMaxChars** | Leave `openai-completions` unless you see errors; use `bootstrapMaxChars` only if you stay on OpenClaw. |

This combines both external views, your repo’s history, and the session diagnosis into one path: **Piko-Lite pivot with metadata stripping, persistent memory, and a stronger local model**, and keeps the door open to patch OpenClaw instead if you prefer to stay on the framework.
