# Piko

**Private LLM agent:** chat in the browser or on Telegram, run Cursor tasks and CLI from one place. One backend, one brain — all on your own infra.

---

## What it is

Piko is a **unified AI companion** that:

- **Chats** with you via a **local LLM** (Ollama, default Llama 3.1 8B) with a consistent persona (identity, behaviour, memory, interests).
- **Runs Cursor** for you: **`/task`** for autonomous Cursor Agent runs (e.g. “refactor auth” in a project), **`/cursor`** for CLI (e.g. version, help).
- Exposes **two entry points**: **WebChat** (browser) and a **Telegram bot**, both backed by the same logic and prompts.
- Optionally uses **Grok (xAI)** as a second opinion when the local model isn’t satisfied with a task result.

Everything can run on a single Linux server (e.g. systemd + Ollama); no cloud LLM required.

---

## Features

| Feature | Description |
|--------|-------------|
| **Chat** | Natural conversation with Ollama; persona from markdown prompts (IDENTITY, SOUL, MEMORY, INTERESTS). |
| **/task** | Run the Cursor Agent on the server (e.g. “fix the bug in auth”). Requires Cursor API key. |
| **/cursor** | Run the Cursor CLI (e.g. `--version`, `-help`). |
| **/new** | Start a new session (clear history). |
| **/status** | Short help and capability summary. |
| **WebChat** | Browser UI; single API: `POST /api/chat`. |
| **Telegram** | Same brain via Telegram; when WebChat is up, the bot calls it; otherwise falls back to Ollama. |
| **History** | Optional nightly dumps of session history; optional heartbeat script for proactive nudges. |

---

## Quick start

### Run WebChat locally

1. **Ollama** running with a chat model (e.g. `ollama run llama3.1:latest`).
2. From the repo:
   ```bash
   cd webchat-piko && node server.js
   ```
3. Open **http://localhost:3000** and chat (or use `/status`, `/task ...`, `/cursor ...`).

### Deploy to a server (e.g. Optimus)

1. Deploy the app:  
   `./scripts/webchat-deploy/deploy-to-optimus.sh`  
   (or rsync `webchat-piko/` to the server.)
2. On the server: install Node, run Ollama, install the systemd unit (`piko-webchat.service`), set env (e.g. `CURSOR_API_KEY` for `/task`, optional `GROK_API_KEY`).
3. Optionally run the Telegram bot (`telegram-bot/bot.js`) with `PIKO_WEBCHAT_URL` pointing at the WebChat server.

See **scripts/webchat-deploy/PHASE2_RUNBOOK.md** and **telegram-bot/DEPLOY_TO_OPTIMUS.md** for step-by-step server setup.

---

## Repo layout

| Path | Purpose |
|------|--------|
| **webchat-piko/** | WebChat server + UI; prompts in `prompts/`; optional `scripts/heartbeat.js`. |
| **telegram-bot/** | Telegram bot (`bot.js`, `auth.js`); calls WebChat or Ollama. |
| **scripts/webchat-deploy/** | Deploy script, systemd unit, runbooks, helpers for Cursor/Grok keys. |
| **PIKO_PROJECT_AND_INTEGRATION.md** | Full project overview and integration guide. |

---

## Integration

Any client can talk to Piko via the WebChat API:

```http
POST /api/chat
Content-Type: application/json

{"message": "Hello", "sessionId": "optional-key"}
```

Response: `{"reply": "…"}`. Same format for chat and for commands (`/task`, `/cursor`, etc.) — the server handles them and returns the result as `reply`.

See **PIKO_PROJECT_AND_INTEGRATION.md** for the full API and integration options.

---

## Docs (in repo)

- **PIKO_PROJECT_AND_INTEGRATION.md** — Architecture, config, API, how to integrate Piko elsewhere.
- **scripts/webchat-deploy/PHASE2_RUNBOOK.md** — Deploy WebChat on a Linux server.
- **telegram-bot/DEPLOY_TO_OPTIMUS.md** — Deploy the Telegram bot.
- **PIKO_TOOLS_OPENCLAW_LIST_REVIEW.md** — Mapping of “OpenClaw-style” skills to what Piko has or can add.
- **PIKO_ON_MOLTBOOK.md** — Registering Piko on Moltbook (agent social network).

---

## Requirements

- **Node.js** (e.g. 16+)
- **Ollama** with a chat model (e.g. Llama 3.1 8B)
- For **/task**: Cursor Agent CLI and API key on the server
- For **Telegram**: bot token; only one process per token (lock file used)

Piko is “OpenClaw in spirit” (one agent, skills, channels, private LLM) but implemented as a thin stack (Node + Ollama + Cursor) so you keep full control and everything stays local.
