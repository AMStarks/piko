# Piko — Recovery & troubleshooting

What to do when something breaks.

---

## Ollama unreachable

**Symptoms:** Chat fails, `/doctor` says “Ollama: unreachable”, or 502 from `/api/chat`.

**Checks:**

1. **Ollama running:** `curl -s http://localhost:11434/api/tags` (or your `OLLAMA_URL`).
2. **Env:** WebChat service must have `OLLAMA_URL` (default `http://localhost:11434/v1/chat/completions`) and `OLLAMA_MODEL` (e.g. `llama3.1:latest`).
3. **Restart:** Restart Ollama, then restart Piko WebChat (`systemctl restart piko-webchat` or restart `node server.js`).

---

## /task fails or “Task skipped”

**Symptoms:** “Task skipped: CURSOR_API_KEY not set” or “agent not installed or timed out”.

**Checks:**

1. **Cursor API key:** Set `CURSOR_API_KEY` (or `CURSOR_API_KEY_BOT`) on the WebChat process. On Optimus, use the runbook’s override or `set-cursor-key.sh`.
2. **Agent CLI:** On Optimus, Cursor Agent must be installed (e.g. `/root/.local/bin/agent`). Set `AGENT_CLI_OPTIMUS` if the path differs.
3. **Project path:** `PIKO_OPTIMUS_PROJECT_PATHS` maps project names to dirs (e.g. `Legion:/opt/legion`). Default project dir is `PROJECTS_OPTIMUS` + project name.
4. **Run by hand:** On the server, `cd /path/to/project && agent --api-key '...' --model auto -p --force 'your task'` to confirm the agent works.

---

## Adapter not responding (Telegram, Discord, Slack, WhatsApp, etc.)

**Symptoms:** Messages to the bot get no reply or “Piko error: …”.

**Checks:**

1. **WebChat up:** Adapters call `POST $PIKO_WEBCHAT_URL/api/chat`. Ensure WebChat is running and reachable from where the adapter runs (same host or network).
2. **Env:** Adapter needs `PIKO_WEBCHAT_URL` (e.g. `http://localhost:3000` or `http://192.168.0.121:3000`). Token/env for each platform (e.g. `DISCORD_TOKEN`, `TELEGRAM_TOKEN`).
3. **Allowlist:** If you use allowlists (`data/allowlist.json`), the adapter’s session/id must be allowed for that source.
4. **Restart:** Restart the adapter process; check its logs for connection or API errors.

---

## Intent poller not running (reminders / scheduled commands)

**Symptoms:** Reminders never fire; scheduled commands don’t run.

**Checks:**

1. **Cron:** Intent poller must run every 5 minutes, e.g.  
   `*/5 * * * * cd /path/to/webchat-piko && node scripts/intent-poller.js`
2. **Env:** If poller runs on another host, set `PIKO_WEBCHAT_URL` so it can POST to `/api/chat` for scheduled commands.
3. **Data:** `webchat-piko/data/intents.json` holds reminders and scheduled items. Ensure the file is writable; check that reminders have `time` and scheduled have `run` in the future.
4. **Pending:** Reminders append to `data/pending-notifications.txt`. WebChat or clients can read `GET /api/pending` to fetch and clear them.

---

## Control dashboard or /api/control empty/wrong

**Checks:**

1. **Ollama:** Dashboard health comes from pinging Ollama; if Ollama is down, health shows unreachable.
2. **Intents:** Counts come from `data/intents.json`. If the file is missing or invalid, counts may be zero.
3. **Logs:** Check server stdout/stderr and, if configured, `data/piko.log` (see logging in PIKO_NEXT_BUILD_PLAN.md).

---

## Skills not loading

**Symptoms:** Custom commands in `webchat-piko/skills/` don’t run.

**Checks:**

1. **File:** `webchat-piko/skills/index.js` must exist and export `{ skills: [ { pattern, handler } ] }`.
2. **Pattern:** `pattern` is a string (e.g. `/notes `) for `message.startsWith(pattern)` or a RegExp.
3. **Restart:** Skills are loaded at server startup; restart WebChat after changing `skills/index.js`.

---

## Quick reference

| Issue           | First check                          | Then |
|----------------|--------------------------------------|------|
| No chat reply  | Ollama running, OLLAMA_URL correct   | Restart Ollama + WebChat |
| /task skipped  | CURSOR_API_KEY, agent CLI on server  | Run agent by hand on server |
| Bot no reply   | PIKO_WEBCHAT_URL, WebChat reachable  | Restart adapter, check allowlist |
| No reminders   | Cron for intent-poller, intents.json | Fix cron, check run times |
| Skills missing | skills/index.js export, restart      | Fix export, restart server |

For full deployment and env details, see **PIKO_PROJECT_AND_INTEGRATION.md** and **scripts/webchat-deploy/PHASE2_RUNBOOK.md**.
