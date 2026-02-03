# WebChat + Llama 3.1 8B — Migration Plan

**Goal:** Replace (or run alongside) the current OpenClaw/Telegram stack with a **new WebChat UI** backed by **Llama 3.1 8B** on Ollama. Reuse what works from the old setup, then remove the old framework once the new one is validated.

**Short answer:** Yes, this approach can work. Below is a concrete plan so you can decide whether to proceed.

---

## 1. Why this makes sense

| Current pain | How WebChat + Llama 3.1 8B helps |
|--------------|-----------------------------------|
| Telegram envelope (`[Telegram ...]`) confuses the model | WebChat sends **plain user text** — no envelope, no meta-noise. |
| OpenClaw config/workspace is complex and brittle | New stack = **one small app** (frontend + API) + Ollama. No gateway, no workspace stubs. |
| 32B is slow (20–40+ s) on your hardware | **Llama 3.1 8B** is much faster (~5–15 s), fits 10GB VRAM, and you already use it in the lightweight Telegram bot. |
| Meta-responses / API-key hallucinations | Same **SOUL/IDENTITY** rules, but cleaner context (no Telegram metadata) so the model behaves better. |

You keep: **Piko’s identity and behavior** (SOUL/IDENTITY), **Ollama**, **optional /cursor and /task** if you want them in the web UI. You drop: **OpenClaw gateway, Clawd, OpenClaw workspace**, and (if you choose) the **Telegram bot**.

---

## 2. New framework — scope

**Stack:**

- **Frontend:** Simple WebChat UI (single page: message list + input). No framework required; vanilla HTML/JS or a small React/Vue app if you prefer.
- **Backend:** Minimal API server (e.g. Node) that:
  - Serves the static chat UI.
  - Exposes a **POST /chat** (or similar) that accepts user message + optional session id.
  - Builds messages: `[system: IDENTITY + SOUL, ...history, user message]`.
  - Calls **Ollama** `http://localhost:11434/v1/chat/completions` with model **`llama3.1:8b`** (or `llama3.1:latest` if that’s 8B on your box).
  - Returns the assistant reply; frontend appends it to the thread.
- **Identity/behavior:** Reuse **IDENTITY.md** and **SOUL.md** from `telegram-bot/` (or from `scripts/path-b-openclaw-deploy/workspace/`) as the system prompt. No OpenClaw workspace.
- **Optional:**  
  - **/cursor** and **/task** in WebChat: same logic as in `bot.js` (SSH to MacBook, run Cursor/agent).  
  - **Session persistence:** in-memory by default; optional file or DB later.

**Deploy:** Run the Node (or other) server on **Optimus** (e.g. port 3000). Ollama already runs there. Optionally put behind nginx or a tunnel (e.g. Cloudflare) for HTTPS/access from outside LAN.

---

## 3. What to take from the old framework

| From | Use in new framework |
|------|----------------------|
| **telegram-bot/IDENTITY.md** | System prompt: “who Piko is”. |
| **telegram-bot/SOUL.md** | System prompt: “how Piko behaves” (direct reply, no meta-commentary, etc.). |
| **telegram-bot/bot.js** | Ollama URL, model name, message shape (`system` + `history` + user), session/history trimming (e.g. last 20 messages, cap 30). |
| **telegram-bot/bot.js** (optional) | `/cursor` and `/task` logic (SSH, CURSOR_CLI, AGENT_CLI, timeouts) if you want those in WebChat. |
| **scripts/path-b-openclaw-deploy/workspace/** | Alternative source for IDENTITY.md/SOUL.md if you prefer the stricter OpenClaw-era SOUL; otherwise telegram-bot versions are enough. |
| **Deploy pattern** | Same idea: copy app to Optimus, systemd service, restart on deploy. No OpenClaw scripts. |

**Explicitly not carried over:** OpenClaw gateway, OpenClaw config (`openclaw.json`), OpenClaw workspace stubs, Clawd, OpenClaw Telegram channel integration.

---

## 4. Phased plan

### Phase 1 — Build the new framework (local or on Optimus)

1. **Scaffold**
   - New directory, e.g. `webchat-piko/` (or `piko-webchat/`).
   - `package.json` + small Node server (Express/Fastify or plain http) that:
     - Serves `index.html` (and any static assets).
     - Reads IDENTITY.md + SOUL.md from a `workspace/` or `prompts/` dir (copied from telegram-bot).
   - Single-page UI: messages list, input box, “Send”, optional “New chat”.
2. **Chat API**
   - `POST /api/chat`: body `{ "message": "user text", "sessionId": "optional-id" }`.
   - Backend: load system prompt (IDENTITY + SOUL), get or create session history, append user message, call Ollama with `llama3.1:8b` (or `llama3.1:latest`), return `{ "reply": "..." }`.
   - In-memory sessions keyed by sessionId (e.g. UUID per “New chat”).
3. **Align with current bot**
   - Same system prompt construction and same history trimming as in `bot.js` so behavior matches.
4. **Optional**
   - Add `/cursor` and `/task` parsing in the API (e.g. `message.startsWith('/cursor')` → run same SSH logic as bot.js, return command output as “reply”).

**Exit condition:** You can open the app in a browser, send a few messages, and get natural Piko replies from Llama 3.1 8B with no Telegram envelope and no OpenClaw.

---

### Phase 2 — Deploy and validate on Optimus

1. **On Optimus**
   - Ensure Ollama is running and `llama3.1:8b` (or `llama3.1:latest`) is pulled.
   - Install Node if needed, clone/copy `webchat-piko/` to e.g. `/root/webchat-piko/`.
   - Run the server (e.g. port 3000), optionally bound to `0.0.0.0` for LAN access.
2. **Systemd**
   - Add a service, e.g. `piko-webchat.service`, so it starts on boot and restarts on failure.
3. **Smoke test**
   - From your Mac (or another device on LAN): open `http://192.168.0.121:3000`, chat, “Hello”, “What can you do?” — confirm no envelope, no API-key or TTS hallucinations.
4. **Optional**
   - Nginx reverse proxy, Cloudflare tunnel, or simple firewall rule so you can reach it from outside LAN if desired.

**Exit condition:** WebChat is the primary way you talk to Piko on Optimus, and behavior is acceptable (fast enough, correct persona, no meta junk).

---

### Phase 3 — Remove the old framework

1. **OpenClaw (Clawd)**
   - Stop and disable OpenClaw gateway (and any Clawd-related) services.
   - Optionally uninstall OpenClaw / remove its config and workspace from Optimus.
   - Remove or archive from this repo: `scripts/path-b-openclaw-deploy/`, `scripts/optimus-openclaw-*.json`, `openclaw-setup.sh`, and any OpenClaw-specific docs you no longer need.
2. **Telegram**
   - **Option A — Keep:** Leave the lightweight Telegram bot running for mobile/Telegram-only use; it already uses Llama 3.1 and SOUL/IDENTITY. WebChat = primary, Telegram = secondary.
   - **Option B — Remove:** Stop `clawfriend-bot.service`, remove or archive `telegram-bot/` and Telegram-related deployment steps.
3. **Repo cleanup**
   - Update README or PIKO_CURSOR_READY.md to point to WebChat as the main interface and document the new deploy (Optimus, systemd, port).
   - Delete or move to an `archive/` folder the obsolete OpenClaw/Telegram-only runbooks and configs.

**Exit condition:** No OpenClaw in use; optional Telegram; single “Piko” experience via WebChat + Llama 3.1 8B.

---

## 5. Decisions for you

Before implementing, it helps to decide:

1. **Telegram**
   - Keep the current lightweight Telegram bot as a second interface (WebChat + Telegram), or retire it and use only WebChat?
2. **/cursor and /task in WebChat**
   - Include them in the web UI (e.g. type `/cursor -version` or “run task: refactor auth”) or keep WebChat as chat-only and use Cursor/task elsewhere?
3. **Hosting**
   - WebChat only on LAN (`http://192.168.0.121:3000`) or expose via tunnel/HTTPS for access from outside?
4. **Model name**
   - Use `llama3.1:8b` explicitly or `llama3.1:latest` (match what’s on Optimus)?

---

## 6. Summary

| Step | Action |
|------|--------|
| 1 | Build `webchat-piko/`: static UI + Node API calling Ollama with Llama 3.1 8B, system prompt from IDENTITY + SOUL. |
| 2 | Deploy on Optimus (systemd, port 3000), test in browser. |
| 3 | Remove OpenClaw (services, config, scripts). Optionally keep or remove Telegram bot. |
| 4 | Update docs to describe WebChat as the main Piko interface. |

**Risks:** Low. You’re reusing a known-good pattern (Ollama + SOUL/IDENTITY from the lightweight bot) and dropping the parts that caused envelope and complexity issues. The only dependency is Ollama + Llama 3.1 8B on Optimus, which you already have or can pull.

If you want to proceed, the next step is **Phase 1**: create `webchat-piko/` and implement the minimal chat API and UI as above. Once you’re happy with the plan (and the four decisions in §5), we can start implementing Phase 1 in the repo.
