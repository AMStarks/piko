# Piko WebChat

Chat with Piko in the browser. Single brain: memory (episodic, beliefs), response planner (beliefs → verbosity/tone/challenge), and SOUL/IDENTITY prompts. All channels POST to `/api/chat`. Phases 1–5: planner observability, behaviour validation, intent poller, tests, doctor, episodic pruning, belief conflict resolution, fork doc, shared chatClient, webhook verification, impact tracker, soft drive, Docker.

## Run locally

1. **Ollama** must be running with a chat model (e.g. `ollama run llama3.1:latest` or `llama3.1:8b`).
2. From this directory:
   ```bash
   node server.js
   ```
3. Open **http://localhost:3000** and send a message.

## Commands (Phase 1 + intent orders)

| Command | Description |
|---------|-------------|
| `/new` | New session (clear history). |
| `/status` | Help and capabilities. |
| `/calc 2+3*4` | Safe calculator (numbers and + - * / ( ) only). |
| `/time` [TZ] | Current time (default `PIKO_DEFAULT_TZ` or UTC). |
| `/read <path>` | Read file under sandbox (`PIKO_SANDBOX_DIR`). |
| `/ls` [path] | List directory under sandbox. |
| `/search "query"` | Web search (Tavily or Serper; set API key). |
| `/moltbook register <name> [desc]` | Register an agent on Moltbook (no API key). Returns claim_url or error. |
| `/moltbook feed` | Moltbook feed. `/moltbook post <title> \| <content>` to post (needs MOLTBOOK_API_KEY). |
| `/queue add <task>` | Add to task queue. `/queue list`, `/queue next` to run next. |
| `/remind <time> <text>` | Set reminder (e.g. `/remind 17:00 Call John`). `/remind list`. |
| `/schedule <time> <cmd>` | Schedule command (e.g. `/schedule 09:00 /task Weekly report`). |
| `/doctor` | Health: Node, sandbox, Ollama, intents. |
| **Phase 2** | |
| `/weather <city>` | Open-Meteo (no key). |
| `/news` | RSS from `PIKO_NEWS_RSS_URL` (default BBC). `/news <query>` with `NEWS_API_KEY`. |
| `/gmail unread` | Gmail API read-only; `GMAIL_ACCESS_TOKEN` or OAuth refresh. |
| **Phase 3** | |
| `/chart bar 10,20,30` | Bar chart; view at GET `/api/chart?type=bar&data=10,20,30`. |
| **Phase 4** | |
| `/profile` [work\|main] | Multi-session: set profile (work = /task,/queue,/read,/ls only). |
| `/task` / `/cursor` | Cursor Agent and CLI (see main Piko docs). |

**APIs:** `GET /api/health`, `GET /api/pending`, `GET /api/control`, `GET /api/intents` (for CLI), `GET /api/chart?type=bar&data=10,20,30`. **Control:** `POST /api/control/session-reset` with body `{ "sessionId": "main" }` clears that session's history (control access required). **Streaming:** `POST /api/chat` with `stream: true` → SSE.

**Phase 4:** Multi-session (`data/sessions.json`, `/profile`), WhatsApp adapter (adapters/whatsapp), BlueBubbles/iMessage adapter (adapters/bluebubbles), global CLI (`node scripts/piko-cli.js chat|doctor|intents`), optional Docker sandbox for /task (`PIKO_TASK_DOCKER=true`, `PIKO_TASK_DOCKER_IMAGE`), Voice button in WebChat (Web Speech API), local skills (`webchat-piko/skills/index.js`).

## Env (optional)

- `PORT` — default `3000`
- `OLLAMA_URL` — default `http://localhost:11434/v1/chat/completions`
- `OLLAMA_MODEL` — default `llama3.1:latest`
- `PIKO_DATA_DIR` — data root (default: `./data`). Holds memory, conversations (SQLite), learning, mind, truth.
- `PIKO_HISTORY_DIR` — nightly history dumps (default: `./history`).
- `PIKO_SANDBOX_DIR` — sandbox for `/read` and `/ls` (default: `./sandbox`).
- `PIKO_DEFAULT_TZ` — timezone for `/time` (e.g. `Australia/Sydney`).
- `PIKO_PLANNER_DEBUG` — set `1` or `true` to log plan/beliefs each turn (stress-test).
- `PIKO_EPISODIC_PRUNE_DAYS` — prune episodic memory older than N days (default `30`).
- `PIKO_CONTROLLED_DIVERGENCE` — set `1` or `true` to add optional “different angle” prompt line; override with `PIKO_DIVERGENCE_PROMPT`.
- `PIKO_WEBCHAT_URL` — used by intent-poller and scripts (e.g. `http://localhost:3000`).
- `TAVILY_API_KEY` or `SERPER_API_KEY` — for `/search`.
- `MOLTBOOK_API_KEY` — for `/moltbook` feed/post.
- **Webhook (adapters):** `PIKO_WEBHOOK_SECRET` or `BLUEBUBBLES_WEBHOOK_SECRET` + header (e.g. `x-webhook-signature`) for HMAC verification.
- **`PIKO_BASE_URL`** — optional; used for OAuth redirect URIs (Gmail, Slack, Notion). If you use a tunnel (ngrok/Cloudflare) or a public URL, set this to that base (e.g. `https://your-app.ngrok-free.app`) so sign-in works from the app. See **`docs/GMAIL_OAUTH_TUNNEL.md`** when Google blocks with “private IP” for Gmail.

Copy **`.env.example`** to `.env` and set values as needed. See **`docs/DEPLOYMENT_CHECKLIST.md`** and repo root **`docs/PIKO_REVIEW_V2_INTEGRATED_AND_PHASED.md`** for full rollout and deploy steps.

## Session keys and channels

Conversation history is keyed by **session id**. By default: **app and WebChat** use `"main"`; **Telegram** uses `"telegram-<chatId>"` so each chat has its own history (no cross-channel meta-replies). Set **`PIKO_UNIFIED_SESSION_ID=main`** (server and Telegram bot) to force one shared conversation. **Allowlist:** If you use `data/allowlist.json`, each channel must be allowed: source is derived from `sessionId` (e.g. `telegram-123` → source `telegram`, id `123`). Denied requests get **403** with `{ error: "channel not allowed", channel, id, hint }` and a clear server log. Add channels via `/allow <source> <id>` from WebChat or by editing the allowlist. See **`docs/PIKO_APP_VS_TELEGRAM_CHAT_DIAGNOSIS.md`** for full diagnosis and session-reset endpoint.

## Scripts

- **`npm test`** — planner, memory, beliefLoop tests.
- **`node scripts/doctor.js`** — Node, env, data dirs, Ollama; optional `PIKO_WEBCHAT_URL` for `/api/health`.
- **Intent poller** — runs in-server every 5 min (reminders, scheduled commands).

## Deploy to Optimus

From repo root run `./scripts/webchat-deploy/deploy-to-optimus.sh`, then on Optimus install the systemd service and start it. Full steps: **`webchat-piko/docs/DEPLOYMENT_CHECKLIST.md`** and **`scripts/webchat-deploy/PHASE2_RUNBOOK.md`**.
