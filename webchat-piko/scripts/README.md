# Piko scripts

## heartbeat.js

Runs on a schedule (e.g. cron) to:

1. **MEMORY suggestion:** Reads yesterday's history dump (`history/YYYY-MM-DD.txt`), asks Ollama for one short line the user could add to MEMORY.md (durable fact or preference). Writes the suggestion to `memory/suggestions/YYYY-MM-DD.txt` for you to review and paste into MEMORY.md.
2. **Proactive Telegram nudge:** If `TELEGRAM_CHAT_ID` and `TELEGRAM_BOT_TOKEN` are set, sends a short nudge to you (Ollama-generated or fallback: "Piko here—anything you want to pick up today?").

### Env (optional)

- `PIKO_PROMPTS_DIR` — prompts folder (default: `../prompts`).
- `PIKO_HISTORY_DIR` — history dumps folder (default: `../history`).
- `PIKO_SUGGESTIONS_DIR` — where to write MEMORY suggestions (default: `../memory/suggestions`).
- `OLLAMA_URL` — Ollama API (default: `http://localhost:11434`).
- `OLLAMA_MODEL` — model for suggestions/nudge (default: `llama3.1:latest`).
- `TELEGRAM_BOT_TOKEN` (or `TELEGRAM_TOKEN`) — bot token for nudge.
- `TELEGRAM_CHAT_ID` — your Telegram chat ID (so the bot can send you the nudge).

### Run

From this directory or from `webchat-piko/`:

```bash
node scripts/heartbeat.js
```

### Cron (on Optimus)

Example: run daily at 09:00:

```bash
0 9 * * * cd /root/webchat-piko && /usr/bin/node scripts/heartbeat.js >> /root/webchat-piko/logs/heartbeat.log 2>&1
```

Create the log dir first: `mkdir -p /root/webchat-piko/logs`. Set env in cron (e.g. `TELEGRAM_CHAT_ID=... TELEGRAM_BOT_TOKEN=...`) or in a small wrapper script that sources env and runs the heartbeat.
