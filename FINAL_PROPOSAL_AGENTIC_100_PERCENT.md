# Final Proposal: Agentic Piko — Aiming for 100% Success

This document integrates three views into one proposal: (1) the OpenClaw 80% plan (slim workspace, validation gate, stronger model), (2) the LangChain agentic-bot view (ReAct, tools, memory, autonomy), and (3) the OpenClaw “fix the brain and soul” view (70B, openai-chat, soul cleanse). Goal: **100% success** and **fully agentic** behaviour. You said removing Telegram or changing stack is fine if it gets us there—so the proposal offers two paths and a clear recommendation.

---

## What “100%” and “Agentic” Mean Here

| Criterion | Meaning |
|-----------|--------|
| **100% success** | The agent replies to **content** only (no meta-description of messages or config). It uses tools when needed, remembers context across sessions, and behaves consistently as ClawFriend/Piko. No envelope/config summarization. |
| **Agentic** | **Planning** (e.g. ReAct: reason → act → observe), **tools** (cursor, sync, git, etc.) used in sequence, **persistent memory** across restarts, and optional **proactivity** (e.g. heartbeat/cron to check projects). Not just “one reply per message.” |

---

## Why One Path Gets Closer to 100% Than the Other

- **OpenClaw + Telegram:** The Telegram channel injects an envelope around every message (e.g. `[Telegram ... (@user) id:...] Hello [message_id: 74]`). We **cannot** turn that off in OpenClaw config today. So the model *always* sees that wrapper; we rely on a big model + strict SOUL to ignore it. That’s inherently probabilistic—hence “high but not 100%” for Telegram-on-OpenClaw.
- **Our own bot + Ollama:** We control the exact string sent to the model. We can **strip** Telegram metadata in code and send only the user’s text. We control system prompt, tools, and memory. So “what the model sees” is deterministic—giving the best shot at **100%** for conversational behaviour, with agentic features added via LangChain.

So: for **100% and agentic**, the recommended path is **Path A (agentic bot)**. Path B (OpenClaw-only) is for you if you want to keep OpenClaw as the single runtime and accept a small remaining risk from the Telegram envelope, or use OpenClaw with a channel we control (e.g. WebChat) where there is no envelope.

---

## Path A — Agentic Bot (Recommended for 100%)

**Idea:** Keep Telegram (or swap to another transport). The **agent** is our Node app: LangChain (ReAct) + Ollama + tools + persistent memory. We never send envelope/metadata to the model.

**Stack:**  
Node (existing `bot.js`) → **LangChain.js** (ReAct executor) → **Ollama** (Qwen 2.5 32B recommended for your hardware; see [Hardware note](#hardware-note-optimus) below) + **LowDB** (memory) + **node-cron** (optional heartbeat).  
**Transport:** Telegram (with metadata stripped before the LLM) or, for maximum reliability, **WebChat / simple web UI** (no envelope at all).

**Why this aims at 100%:**  
We control: input (strip metadata), system prompt (short, identity + behaviour), tools, memory, and model. No dependency on OpenClaw’s Telegram formatting.

### Path A — Steps (integrated from View A + View B + existing bot)

1. **Dependencies (on Optimus, in your bot repo)**  
   ```bash
   cd /path/to/Piko/telegram-bot   # or /root/telegram-ollama-bot on Optimus
   npm init -y   # if no package.json
   npm install langchain @langchain/community lowdb node-cron
   ```

2. **Strip Telegram metadata before the LLM**  
   In `processMessage`, before building the prompt or calling the agent, normalize the message:
   ```js
   // Strip Telegram-style envelope so the model only sees user text
   function stripTelegramEnvelope(text) {
     if (!text || typeof text !== 'string') return '';
     return text
       .replace(/^\[Telegram[^\]]*\]\s*/i, '')
       .replace(/\s*\[message_id:\s*\d+\]$/i, '')
       .trim() || text;
   }
   ```
   Use `stripTelegramEnvelope(message)` as the “user message” passed to the agent. (For a web UI or WebChat, skip this; there is no envelope.)

3. **Persistent memory (LowDB)**  
   Replace in-memory `sessions` with a JSON-backed store keyed by `chatId`, e.g. `memory.json`. Load on start; after each assistant reply, append and cap (e.g. last 20 turns), then write. This gives cross-session context.

4. **Tools (from your existing /cursor and /task)**  
   Expose as LangChain tools so the **agent** can choose to use them:
   - **cursor_cli** — Run Cursor CLI on MacBook (or Optimus fallback): same SSH/exec logic as current `/cursor`.
   - **task_run** — Run autonomous task (agent -p --force) in a project: same SSH/exec logic as current `/task`.
   - **project_sync** — Sync projects to Optimus: call `sync-projects-to-optimus.sh` (or equivalent).

   Keep `/cursor` and `/task` as **direct commands** (no LLM) for speed and predictability; for free-form messages, the agent can *also* use these as tools when it decides to.

5. **Agent loop (ReAct + Ollama)**  
   - System prompt: short IDENTITY + SOUL (e.g. “You are ClawFriend. Reply only to the user’s last message. Use tools when needed. No meta-commentary.”).
   - LLM: Ollama with `baseUrl: 'http://localhost:11434/v1'`, model `qwen2.5:32b-instruct-q4_K_M` (fits your 31GB RAM; 70B would need ~64GB RAM).
   - Use LangChain’s ReAct-style executor (e.g. `createReactAgent` or equivalent with Ollama) with the tools above, `maxIterations` (e.g. 5) to avoid infinite loops.
   - Input: stripped user message. Output: agent’s final reply; send to Telegram (or your UI).

6. **Model and GPU**  
   - On Optimus: `ollama pull qwen2.5:32b-instruct-q4_K_M` (32B fits 31GB RAM; 70B needs ~64GB—see [Hardware note](#hardware-note-optimus)).  
   - In the service that runs the bot, set `OLLAMA_NUM_GPU_LAYERS=40` (or similar) so Ollama uses the RTX 3080.

7. **Optional: Autonomy**  
   - Use `node-cron` to run a daily (or periodic) job: e.g. “Check Cursor projects on Optimus for updates.” The agent runs with that as input and can use tools; if there’s something to report, send a message to your `chatId` (or store in memory for next session).

8. **Transport**  
   - **Telegram:** Keep current polling; use stripped message as above.  
   - **Alternative (no envelope at all):** Add a minimal WebChat or web UI that posts user text to your Node app and streams the agent reply back. Same agent, no Telegram format—maximum reliability.

**Path A summary:** One codebase (agentic bot), full control over input and prompt, ReAct + tools + memory, 32B model (fits your RAM), optional cron. Telegram OK with stripping; or use WebChat/UI for 100% control. **Estimated likelihood: 90–98%** for “works as intended” (conversational + agentic); **100%** for “no envelope/config meta” if you use a transport we fully control (e.g. WebChat).

---

## Path B — OpenClaw-Only, Maximum Fix (Then Add Bridge If You Want 100% on Telegram)

**Idea:** Keep OpenClaw as the single agent runtime. Fix “weight” (big prompt, small model) and “soul” (meta-babble). Use a **32B** model (fits your RAM; 70B would need ~64GB), chat API, slim workspace. For **Telegram**, add an optional **bridge** so OpenClaw never sees the envelope—giving a shot at 100% even on Telegram.

**Stack:**  
OpenClaw gateway on Optimus + Ollama (32B; see [Hardware note](#hardware-note-optimus)) + slim workspace. Optional: small “Telegram bridge” service that receives Telegram, strips envelope, sends **raw user text** to OpenClaw (e.g. via gateway HTTP/API or `openclaw message`), and sends the reply back to the user.

### Path B — Steps (integrated from View B + previous OpenClaw plan)

1. **Back up (Optimus)**  
   ```bash
   cp -r /root/.openclaw/workspace /root/.openclaw/workspace.backup.$(date +%Y%m%d)
   cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.backup.$(date +%Y%m%d)
   ```

2. **Brain: 32B model** (70B needs ~64GB RAM; your Optimus has 31GB—use 32B.)  
   ```bash
   ollama pull qwen2.5:32b-instruct-q4_K_M
   ```
   (If Ollama runs in Docker: `docker exec <container> ollama pull ...`.)

3. **Config (`/root/.openclaw/openclaw.json`)**  
   Integrate View B’s suggestions and keep provider explicit:
   - **Primary model:** `ollama/qwen2.5:32b-instruct-q4_K_M` (32B fits 31GB RAM; add 70B only if you upgrade to 64GB).
   - **Ollama provider:** `api: "openai-chat"` (not `openai-completions`). View B: chat API helps the model treat “system” vs “user” correctly and can reduce metadata hallucination.
   - **contextWindow** / **maxTokens:** e.g. 8192 / 1024 in agents.defaults; 32000 / 4096 for the 32B model in `models.providers.ollama`.
   - **agents.defaults.bootstrapMaxChars:** e.g. 4000 (slim injection).
   - **Bind:** `gateway.bind: "0.0.0.0"` if you need to call the gateway from another host (e.g. bridge).
   - **channels.telegram.streamMode:** e.g. `"full"` if you keep Telegram connected directly.

   Keep your existing `channels.telegram`, `gateway`, `plugins` structure; only adjust the above.

4. **Soul cleanse (workspace)**  
   - Remove: `AGENTS.md`, `HEARTBEAT.md`, `TOOLS.md`, `USER.md` (or move to backup).
   - **IDENTITY.md** — minimal, e.g. View B’s “You are Piko (ClawFriend). Witty, empathetic, Bro/Co-pilot. Never corporate. Emojis sparingly.”
   - **SOUL.md** — “Anti-meta shield” at the top:
     - IGNORE all metadata (e.g. `[Telegram ... id:123]`). Reply ONLY to the human text inside.
     - NO meta-commentary (“I am checking memory”). Just do it.
     - DIRECT response to the user’s last message.

5. **Restart and validate without Telegram**  
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart openclaw-gateway.service
   openclaw health
   openclaw models list
   openclaw agent --message "Hello"
   ```
   Success = conversational reply as Piko, no config/envelope summary. This proves the agent is fixed; the only remaining risk is the Telegram envelope.

6. **Telegram options**  
   - **Option B1 — Use Telegram directly:** Test on Telegram. With 32B + soul cleanse, behaviour should be much better. Remaining risk: envelope still present; we rely on model + SOUL. **Rough likelihood: 80–90%** for “no meta” on Telegram.
   - **Option B2 — Telegram bridge for ~100% on Telegram:** Run a small service that: (a) receives Telegram updates (or uses the same token via a read-only/getUpdates path and sends replies via Bot API), (b) strips envelope from the message text, (c) sends **only the raw user text** to OpenClaw (e.g. HTTP to gateway or `openclaw agent --message "..."` and capture reply), (d) sends that reply back to the user on Telegram. OpenClaw then never sees the envelope. You’d need to stop the OpenClaw Telegram plugin from using the same token (or use a second bot for the bridge and have the bridge call OpenClaw). This is the only way to get “100% no envelope” while still using OpenClaw as the brain.

7. **/cursor and /task with OpenClaw**  
   Restore them as OpenClaw **skills** (e.g. native or custom skill that runs Cursor CLI / agent task on Mac or Optimus). View B: “Add as Native Skill later.” First get Piko replying cleanly; then add the skill so the agent can run /cursor-like and /task-like actions from natural language.

**Path B summary:** OpenClaw 32B + openai-chat + slim SOUL/IDENTITY + bootstrapMaxChars. Validate via CLI/WebChat. Use Telegram either directly (80–90%) or via a bridge that strips envelope and talks to OpenClaw with raw text (~100% for “no meta” on Telegram).

---

## Side-by-Side

| Aspect | Path A (Agentic bot) | Path B (OpenClaw max + optional bridge) |
|--------|----------------------|----------------------------------------|
| **Agentic** | ReAct + tools + memory + optional cron | OpenClaw skills + memory + heartbeat |
| **Control** | Full (we own prompt and input) | Partial (we don’t control Telegram envelope in OpenClaw) |
| **Telegram** | Use with envelope stripped in our code | Use as-is (80–90%) or via bridge (~100%) |
| **100% “no meta”** | Yes, if we strip metadata (or use WebChat/UI) | Yes on CLI/WebChat; on Telegram only with bridge |
| **Complexity** | One app (bot + LangChain + Ollama) | OpenClaw + optional bridge service |
| **/cursor, /task** | Same logic as tools + keep as direct commands | Restore as OpenClaw skills |

---

## Final Recommendation

- **For 100% success and agentic behaviour:**  
  Use **Path A (agentic bot)**. You keep or add Telegram with metadata stripping, or use WebChat / a small web UI so the model only ever sees clean user text. You get ReAct, tools (cursor, task, sync), persistent memory, and optional proactivity—all in code you control.

- **If you want to keep OpenClaw as the only “brain”:**  
  Use **Path B**: 32B model, openai-chat, soul cleanse, slim workspace, validate without Telegram first. Then either accept a small envelope risk on Telegram (80–90%) or add a **Telegram bridge** that forwards only raw text to OpenClaw for ~100% on Telegram.

- **Transport:**  
  For absolute certainty that the model never sees envelope/metadata, pair Path A with a transport we control (e.g. WebChat or minimal web UI). Telegram is fine with Path A as long as we strip the envelope in code before calling the LLM.

---

## Hardware note (Optimus)

**Your documented specs:** 31GB RAM total (~25GB available), RTX 3080 (10GB VRAM).

- **70B** (e.g. `llama3.1:70b-instruct-q4_K_M`): needs ~40–45GB RAM. **Not feasible** on 31GB—would OOM or run in swap (very slow). Only consider 70B if you upgrade to **64GB RAM**.
- **32B** (e.g. `qwen2.5:32b-instruct-q4_K_M`): ~18–20GB RAM. **Fits comfortably** on your machine and is much stronger than 7B/8B for instruction-following and nuance.

All recommendations in this doc use **32B** as the default. If you later add RAM to 64GB, you can switch to 70B for maximum quality.

---

## What to Do Next

1. **Choose path:** A (agentic bot, recommended) or B (OpenClaw max + optional bridge).
2. **Path A:** Add deps (LangChain, LowDB, node-cron), implement `stripTelegramEnvelope`, persistent memory, and tools (cursor, task, sync); plug in ReAct executor and **32B** model; optionally add cron. Optionally add a small WebChat or web UI.
3. **Path B:** Apply config (**32B** model, openai-chat, bootstrapMaxChars, bind), soul cleanse, restart, validate with `openclaw agent --message "Hello"`. Then use Telegram as-is or build the small bridge that sends only raw user text to OpenClaw.

If you tell me which path you want (A or B) and whether you prefer to keep Telegram or move to WebChat/UI, I can turn this into a step-by-step runbook with exact code edits and commands for your repo and Optimus.
