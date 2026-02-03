# Piko WebChat (Phase 1)

Chat with Piko in the browser. Backend calls Ollama (Llama 3.1 8B) with SOUL/IDENTITY prompts. No OpenClaw, no Telegram envelope.

## Run locally

1. **Ollama** must be running with a chat model (e.g. `ollama run llama3.1:latest` or `llama3.1:8b`).
2. From this directory:
   ```bash
   node server.js
   ```
3. Open **http://localhost:3000** and send a message.

## Env (optional)

- `PORT` — default `3000`
- `OLLAMA_URL` — default `http://localhost:11434/v1/chat/completions`
- `OLLAMA_MODEL` — default `llama3.1:latest`
- `PIKO_HISTORY_DIR` — directory for nightly history dumps (default: `./history`). If set, each night at midnight the server writes all session history to `YYYY-MM-DD.txt` in this directory (e.g. on Optimus: `/root/webchat-piko/history/2026-02-02.txt`).

## Deploy to Optimus (Phase 2)

From repo root run `./scripts/webchat-deploy/deploy-to-optimus.sh`, then on Optimus install the systemd service and start it. Full steps: **`scripts/webchat-deploy/PHASE2_RUNBOOK.md`**.
