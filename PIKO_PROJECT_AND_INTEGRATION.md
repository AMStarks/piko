# Piko — Project Overview & Integration Guide

**Full write-up of the Piko project as it stands today, and how to integrate it into other projects.**

---

## 1. What Piko Is

**Piko** (also “ClawFriend” in Telegram) is a **unified AI companion** that:

- **Chats** with you via a local LLM (Ollama, default Llama 3.1 8B), with a consistent persona (IDENTITY, SOUL, MEMORY, INTERESTS).
- **Runs Cursor** on your behalf: `/cursor` for CLI (e.g. `--version`, `-help`) and **`/task`** for autonomous Cursor Agent runs (e.g. “refactor auth” in a project).
- Exposes **two entry points**: a **WebChat** (browser UI) and a **Telegram bot**, both backed by the **same** logic and prompts.
- Optionally uses **Grok (xAI)** as a “second opinion” when Piko (Ollama) decides a Cursor task result isn’t satisfactory.

**Current production setup:** Everything runs on **Optimus** (a Linux server). `/task` and `/cursor` are configured **Optimus-only** (no MacBook attempt). The Cursor Agent CLI runs on Optimus; WebChat and the Telegram bot run there under systemd.

---

## 2. Architecture

### 2.1 Components

| Component | Role | Location |
|-----------|------|----------|
| **WebChat server** (`webchat-piko/server.js`) | Serves the chat UI and **single API**: `POST /api/chat`. Handles /new, /status, /task, /cursor, and normal chat (Ollama). Writes nightly history dumps. | Optimus, `piko-webchat.service`, port 3000 |
| **WebChat UI** (`webchat-piko/public/index.html`) | Browser client; sends messages to `/api/chat`, displays replies. Cmd+Enter sends. | Served by WebChat server |
| **Telegram bot** (`telegram-bot/bot.js`) | Polls Telegram `getUpdates`; for chat it calls **WebChat** `POST /api/chat` (when `PIKO_WEBCHAT_URL` is set) or falls back to Ollama. Handles /task, /cursor, /new, /status **before** delegating to WebChat. | Optimus, `clawfriend-bot.service` |
| **Ollama** | Local LLM (Llama 3.1 8B). Used for chat and for “discernment” after /task (satisfied or not). | Optimus (e.g. Docker or host), port 11434 |
| **Cursor Agent** | Headless Cursor agent for `/task`. Runs on Optimus via `agent --api-key ... -p --force "task"`. | `/root/.local/bin/agent` on Optimus |
| **Cursor CLI** (optional) | Used for `/cursor` (e.g. version, help). Runs via a wrapper script on Optimus. | `run-cursor-optimus.sh` + Cursor CLI on Optimus |
| **Grok (xAI)** | Optional. When discernment says “NOT_SATISFIED”, WebChat can call Grok for a short suggestion. | API only; `GROK_API_KEY` on WebChat service |

### 2.2 Data flow

```
User (browser or Telegram)
    │
    ├─► WebChat UI  ──► POST /api/chat (message, sessionId)
    │                        │
    └─► Telegram bot ────────┼──► WebChat server (server.js)
                             │         │
                             │         ├─ /new, /status → immediate reply
                             │         ├─ /task → run Cursor agent (Optimus) → optional discernment + Grok
                             │         ├─ /cursor → run Cursor CLI (Optimus)
                             │         └─ else → Ollama chat (system prompt + history)
                             │
                             └──► If WebChat down: Telegram uses Ollama directly (fallback)
```

- **Single backend for “brain”:** WebChat server holds sessions, loads prompts from `webchat-piko/prompts/`, and talks to Ollama. Telegram is a **client** of that backend when `PIKO_WEBCHAT_URL` is set.
- **Unified history (optional):** If both services set the same `PIKO_UNIFIED_SESSION_ID`, WebChat and Telegram share one conversation history; `/new` clears it for both.

### 2.3 Repo layout (relevant to Piko)

```
Piko/
├── webchat-piko/           # WebChat app (main backend + UI)
│   ├── server.js           # HTTP server, POST /api/chat, static files
│   ├── public/
│   │   └── index.html      # Chat UI
│   ├── prompts/            # Single source of truth for persona
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   ├── MEMORY.md
│   │   ├── INTERESTS.md
│   │   └── README.md
│   ├── scripts/
│   │   └── heartbeat.js     # Optional cron script (proactive / memory)
│   ├── package.json
│   └── README.md
├── telegram-bot/
│   ├── bot.js              # Telegram getUpdates → WebChat or Ollama
│   ├── auth.js             # isBotConfigured(), isTaskAllowed()
│   └── DEPLOY_TO_OPTIMUS.md
├── scripts/
│   └── webchat-deploy/
│       ├── deploy-to-optimus.sh
│       ├── piko-webchat.service
│       ├── set-cursor-key.sh
│       ├── set-grok-key.sh
│       ├── PHASE2_RUNBOOK.md
│       ├── PHASE3_RUNBOOK.md
│       └── TASK_OPTIMUS_DIAGNOSTIC.md
└── (many .md docs: plans, runbooks, options)
```

---

## 3. Current Functionality

### 3.1 Commands (same in WebChat and Telegram)

| Command | Description |
|---------|-------------|
| **/new** | Start a new session (clears in-memory history for that session key). |
| **/status** | Short help: what Piko can do, /cursor, /task, Optimus-only note. |
| **/cursor [arg]** | Run Cursor CLI on Optimus (e.g. `--version`, `-help`). Single hyphen in Telegram for flags. |
| **/task [project] "description"** | Run Cursor Agent on Optimus. Default project is `Piko`; `Legion` maps to `/opt/legion` via `PIKO_OPTIMUS_PROJECT_PATHS`. Requires `CURSOR_API_KEY`. After run, Piko (Ollama) does “discernment”; if not satisfied and `GROK_API_KEY` set, Grok suggests a follow-up. |

### 3.2 Chat

- **Normal messages** go to Ollama with system prompt (IDENTITY + SOUL + MEMORY + INTERESTS) and rolling conversation history (capped per session).
- **Session key:** From request: `sessionId` (WebChat) or derived from Telegram chatId / `PIKO_UNIFIED_SESSION_ID`.

### 3.3 Prompts (persona)

- **IDENTITY.md** — Who Piko is (Christian AI companion, coding, empathy).
- **SOUL.md** — Behavior: concise, no meta-commentary, respond only to user content, suggest follow-ups from conversation or INTERESTS.
- **MEMORY.md** — Long-term curated facts/preferences (loaded if present).
- **INTERESTS.md** — User interests so Piko can suggest relevant topics.

Edits to these files require a server restart (or a future “reload prompts” endpoint) to take effect.

### 3.4 Other behavior

- **Nightly history:** Server dumps all session histories to `HISTORY_DIR/YYYY-MM-DD.txt` (e.g. for heartbeat or logs).
- **Single-instance Telegram:** Bot uses a lock file so only one process per machine polls `getUpdates` (avoids conflict with another bot or OpenClaw).
- **Optimus-only mode:** `PIKO_TASK_OPTIMUS_ONLY=true` and `PIKO_CURSOR_OPTIMUS_ONLY=true` so /task and /cursor never try the Mac.

---

## 4. Configuration & Deployment

### 4.1 WebChat server (piko-webchat.service)

| Env | Purpose |
|-----|--------|
| `PORT` | Default 3000. |
| `OLLAMA_URL` | Default `http://localhost:11434/v1/chat/completions`. |
| `OLLAMA_MODEL` | Default `llama3.1:latest`. |
| `PIKO_HISTORY_DIR` | Nightly dumps; default `./history`. |
| `CURSOR_API_KEY` or `CURSOR_API_KEY_BOT` | Required for /task. Set via override or `set-cursor-key.sh`. |
| `GROK_API_KEY` | Optional; second opinion when discernment is NOT_SATISFIED. |
| `PIKO_TASK_OPTIMUS_ONLY` | `true` → /task only on Optimus. |
| `PIKO_CURSOR_OPTIMUS_ONLY` | `true` → /cursor only on Optimus. |
| `PIKO_OPTIMUS_PROJECT_PATHS` | e.g. `Legion:/opt/legion`. |
| `AGENT_CLI_OPTIMUS` | e.g. `/root/.local/bin/agent`. |
| `PIKO_UNIFIED_SESSION_ID` | Same as Telegram → shared history. |

### 4.2 Telegram bot (clawfriend-bot.service)

| Env | Purpose |
|-----|--------|
| `TELEGRAM_TOKEN` or `TELEGRAM_BOT_TOKEN` | Required. |
| `PIKO_WEBCHAT_URL` | e.g. `http://localhost:3000` so chat uses WebChat API. |
| `PIKO_PROMPTS_DIR` | e.g. `/root/webchat-piko/prompts` for Ollama fallback. |
| Same /task and /cursor vars | `CURSOR_API_KEY`, `PIKO_TASK_OPTIMUS_ONLY`, `PIKO_CURSOR_OPTIMUS_ONLY`, `AGENT_CLI_OPTIMUS`, `PIKO_OPTIMUS_PROJECT_PATHS`, `HOME=/root`. |
| `PIKO_UNIFIED_SESSION_ID` | Same as WebChat for shared history. |
| `PIKO_BOT_LOCK_FILE` | Optional; default `/tmp/clawfriend-bot.lock`. |

### 4.3 Deploy steps (summary)

1. **WebChat:** From repo root: `./scripts/webchat-deploy/deploy-to-optimus.sh`. On Optimus: install `piko-webchat.service`, enable, start. Configure Cursor/Grok via overrides or runbooks.
2. **Telegram:** Copy `telegram-bot/bot.js` and `auth.js` to Optimus; run via `clawfriend-bot.service` with token and `PIKO_WEBCHAT_URL` set.
3. **Single bot instance:** Only one process may use the Telegram token (lock file on Optimus). Disable any other consumer (e.g. OpenClaw Telegram) to avoid getUpdates conflict.

Details: **scripts/webchat-deploy/PHASE2_RUNBOOK.md**, **telegram-bot/DEPLOY_TO_OPTIMUS.md**.

---

## 5. API Surface for Integration

Piko’s only HTTP API is the WebChat server.

### 5.1 POST /api/chat

**Request:**

- **Method:** POST  
- **Content-Type:** application/json  
- **Body:**
  - `message` (string, required) — User message (plain text). Can be a command: `/new`, `/status`, `/task ...`, `/cursor ...`, or normal chat.
  - `sessionId` (string, optional) — Client-defined session key. If omitted or not used, server may use a default. When `PIKO_UNIFIED_SESSION_ID` is set on the server, that overrides and all clients share one session.

**Response:**

- **200 OK**
  - `reply` (string) — Piko’s reply (or command output). Truncation may be applied for long /task output.
- **400** — Invalid JSON or missing `message`.
- **502** — Ollama error (e.g. model unavailable).

**Example:**

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","sessionId":"my-app-1"}'
# → {"reply":"Hi! How can I help you today?"}
```

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"/status"}'
# → {"reply":"Piko is up. /cursor and /task run on Optimus only..."}
```

### 5.2 Static assets

- **GET /** → `public/index.html`  
- **GET /&lt;path&gt;** → Other files under `public/` (e.g. CSS/JS if added).  

No other API routes exist (no REST resources, no webhooks). Session state is in-memory; restart clears it unless you add persistence.

---

## 6. Integrating Piko Into Other Projects

You can integrate Piko in three main ways: **use the HTTP API**, **add a new channel adapter**, or **embed the logic**.

### 6.1 Use the HTTP API (recommended)

Any app that can send HTTP requests can talk to Piko:

1. **Endpoint:** `POST /api/chat` on the WebChat server (on Optimus: `http://192.168.0.121:3000` or your tunnel URL).
2. **Payload:** `{"message": "user text", "sessionId": "optional-session-key"}`.
3. **Response:** `{"reply": "Piko's reply"}`.

Use cases:

- **Mobile app (e.g. React Native, Flutter):** Same JSON; add auth/HTTPS as needed (e.g. via tunnel).
- **CLI or script:** `curl` or any HTTP client.
- **Another bot (Discord, Slack):** On message received → POST to `/api/chat` with a stable `sessionId` per user/channel → send `reply` back.
- **PWA:** The existing WebChat is already a client; making it a PWA + tunnel (see MOBILE_AND_OTHER_APPS_OPTIONS.md) gives mobile “app” feel without a new backend.

No change to Piko required; ensure the WebChat server is reachable (LAN or tunnel) and optionally set `PIKO_UNIFIED_SESSION_ID` if you want one global session across clients.

### 6.2 Add a new channel adapter (e.g. Discord, Slack)

Pattern: **receive message from platform → POST /api/chat → send reply**.

- Run a small process (Node, Python, etc.) on the same network as the WebChat server (e.g. on Optimus).
- On each user message, call `POST http://localhost:3000/api/chat` with `message` and a `sessionId` derived from the channel (e.g. `discord-<channel_id>`).
- Post the returned `reply` back to the channel.

This keeps one Piko brain; you only add an adapter. No changes to `server.js` required. See MOBILE_AND_OTHER_APPS_OPTIONS.md for Discord/Slack notes.

### 6.3 Embed or reuse the logic

If you need Piko inside another Node app (same process):

- **Option A — HTTP:** Your app calls the existing WebChat server (localhost or internal URL). Easiest.
- **Option B — Copy/link handler:** Reuse the same logic (command parsing, Ollama call, session map) by extracting a shared module that both `server.js` and your app call. This would require a small refactor (e.g. `handleApiChat` and dependencies moved into a `piko-core.js` or similar) and is only worth it if you cannot use HTTP.

Current codebase does not expose a shared “core” package; integration is designed around the HTTP API.

### 6.4 Integration checklist

- [ ] WebChat server reachable (localhost on Optimus, or tunnel for external).
- [ ] POST /api/chat with `message` (+ optional `sessionId`).
- [ ] Handle 200 + `reply`; optionally 400/502.
- [ ] If you need /task: ensure `CURSOR_API_KEY` is set on the WebChat service.
- [ ] For shared history with WebChat/Telegram: set same `PIKO_UNIFIED_SESSION_ID` on server and use that concept in your client (e.g. same sessionId in requests).

---

## 7. Security & Operational Notes

- **Secrets:** Keep `TELEGRAM_TOKEN`, `CURSOR_API_KEY`, and `GROK_API_KEY` out of the repo. Use systemd overrides or env files on the server; use `set-cursor-key.sh` / `set-grok-key.sh` as documented.
- **Network:** WebChat listens on `0.0.0.0:3000`; expose only via LAN or a tunnel (e.g. Cloudflare Tunnel, Tailscale) if you need external access.
- **Telegram:** Only one active getUpdates consumer per token; lock file on Optimus prevents duplicate bot processes on the same host.
- **/task:** Runs arbitrary Cursor Agent commands in project dirs; restrict who can send /task (e.g. private Telegram, or add auth in front of `/api/chat` for other clients).

---

## 8. Extension Points (future)

- **Proactive / heartbeat:** Optional cron + script (e.g. `webchat-piko/scripts/heartbeat.js`) to summarize history, suggest MEMORY updates, or send a Telegram nudge. See PIKO_MEMORY_HEARTBEAT_AND_GROWTH.md.
- **RULES.md / GOALS.md:** Load more prompt files for safety and goals; same `loadSystemPrompt()` pattern.
- **GET /api/pending-prompts:** If you add proactive messages, a simple endpoint could return them for the WebChat UI or other clients.
- **PWA + tunnel:** Turn WebChat into an installable app and expose via HTTPS tunnel for mobile (MOBILE_AND_OTHER_APPS_OPTIONS.md).
- **More tools:** Add more commands or tool-calling (e.g. web search, read_file) in the server and optionally in the prompt; see PIKO_TOOLS_AND_SKILLS.md for ideas.

---

## 9. Summary Table

| Aspect | Current state |
|--------|----------------|
| **Entry points** | WebChat (browser), Telegram bot |
| **Backend** | Single WebChat server (Node), one API: POST /api/chat |
| **LLM** | Ollama (Llama 3.1 8B); optional Grok for /task follow-up |
| **/task, /cursor** | Optimus-only; Cursor Agent + CLI on Linux |
| **Prompts** | webchat-piko/prompts/ (IDENTITY, SOUL, MEMORY, INTERESTS) |
| **Integration** | Any client → POST /api/chat with message (+ sessionId) → use reply |
| **Deploy** | Optimus: piko-webchat.service + clawfriend-bot.service; see PHASE2_RUNBOOK.md, DEPLOY_TO_OPTIMUS.md |

Integrating Piko into another project is primarily **calling POST /api/chat**; for new channels, add a thin adapter that forwards messages to that endpoint and returns the reply.
