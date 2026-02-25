# Phase 2 — Deploy WebChat on Optimus

Deploy Piko WebChat to Optimus, run it under systemd, and smoke-test from your Mac.

---

## 1. Deploy from MacBook

From the Piko repo root:

```bash
chmod +x scripts/webchat-deploy/deploy-to-optimus.sh
./scripts/webchat-deploy/deploy-to-optimus.sh
```

Or manually:

```bash
rsync -az --delete -e "ssh -i ~/.ssh/id_optimus" \
  webchat-piko/ root@192.168.0.121:/root/webchat-piko/
```

---

## 2. On Optimus — Node and Ollama

SSH in:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
```

- **Node:** If Node isn’t installed: `apt update && apt install -y nodejs` (or use nvm if you prefer).
- **Ollama:** Ensure Ollama is running and a chat model is pulled, e.g.:
  ```bash
  docker ps | grep ollama   # or however Ollama runs on Optimus
  curl -s http://localhost:11434/api/tags | head -20
  ollama run llama3.1:latest   # or llama3.1:8b — pull if needed
  ```
  If Ollama is in Docker (e.g. `legion-ollama`), use that container to pull/run the model; the WebChat server will call `http://localhost:11434` on the host (ensure port 11434 is published).

**Dual GPU (2× 3080):** Ollama already sees both GPUs (`NVIDIA_VISIBLE_DEVICES=all`). To spread a 32B model across both, add `OLLAMA_SCHED_SPREAD=1` to the Ollama container environment (e.g. in Legion’s `docker-compose.yml` under the `ollama` service) and restart the container. See **docs/PIKO_OPTIMUS_TWO_GPUS.md**.

---

## 3. Install systemd service (on Optimus)

From your Mac, copy the unit file and enable the service:

```bash
scp -i ~/.ssh/id_optimus scripts/webchat-deploy/piko-webchat.service root@192.168.0.121:/etc/systemd/system/
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "systemctl daemon-reload && systemctl enable piko-webchat.service && systemctl start piko-webchat.service && systemctl status piko-webchat.service"
```

On Optimus (if you’re already SSH’d):

```bash
cp /root/webchat-piko/../scripts/webchat-deploy/piko-webchat.service /etc/systemd/system/
# Or after deploy, the unit file is in the repo; copy from repo or scp as above.
systemctl daemon-reload
systemctl enable piko-webchat.service
systemctl start piko-webchat.service
systemctl status piko-webchat.service
```

To use a different model (e.g. `llama3.1:8b`), edit the service file:

```bash
sudo sed -i 's/OLLAMA_MODEL=.*/OLLAMA_MODEL=llama3.1:8b/' /etc/systemd/system/piko-webchat.service
sudo systemctl restart piko-webchat.service
```

**Integrations (Control → Integrations):** A drop-in `70-integrations.conf` enables Daily memory, EA synthesis (LLM), Meeting prep, and Gmail read body. The server loads `/root/webchat-piko/.env` via `EnvironmentFile`. To get **Telegram (alerts)** to show "Configured", add to `.env` on Optimus: `TELEGRAM_BOT_TOKEN=<same as bot>` and `TELEGRAM_CHAT_ID=<your chat ID>` (get chat ID by messaging @userinfobot in Telegram, or from the bot’s getUpdates). Run once to copy from bot if present: `cd /root/webchat-piko && bash scripts/webchat-deploy/set-integrations-optimus.sh`. **Gmail** and **iMessage** need OAuth and BlueBubbles credentials in `.env`; see Control → Integrations variable reference.

**Unified session (mandatory):** WebChat and Telegram always share one conversation. Session key is `PIKO_UNIFIED_SESSION_ID` or `main`.

- **WebChat:** `piko-webchat.service` sets `Environment=PIKO_UNIFIED_SESSION_ID=main`.
- **Telegram bot:** Set `Environment=PIKO_UNIFIED_SESSION_ID=main` in your Telegram bot service (e.g. `clawfriend-bot.service`); the bot defaults to `main` if unset.
- **New chat** (or `/new`) clears that shared history for both.

**Primary prompts (one .md source for both):** WebChat always uses `webchat-piko/prompts/` (IDENTITY.md, SOUL.md, INTERESTS.md). To have Telegram use the same when it falls back to Ollama (e.g. WebChat down), add to `clawfriend-bot.service`:

```ini
Environment=PIKO_PROMPTS_DIR=/root/webchat-piko/prompts
```

Then restart the Telegram bot. Edit only `webchat-piko/prompts/*.md`; both channels stay in sync.

**Grok API key (optional):** When Piko isn’t satisfied with a Cursor task result, it can ask Grok (xAI) for a suggestion. To enable:

1. Create an API key at [xAI Console](https://console.x.ai/team/default/api-keys) (sign in at x.ai).
2. On Optimus, set it **only in the environment** (never commit the key):
   - **Option A — systemd override (recommended):**  
     `sudo systemctl edit piko-webchat.service`  
     In the `[Service]` section add:  
     `Environment=GROK_API_KEY=your_key_here`  
     Save, then: `sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service`
   - **Option B — edit unit file:**  
     `sudo nano /etc/systemd/system/piko-webchat.service`  
     Uncomment and set: `Environment=GROK_API_KEY=your_key_here`  
     Then: `sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service`
3. Optional: `Environment=GROK_MODEL=grok-4` (default) or e.g. `grok-2` if you prefer.

If `GROK_API_KEY` is not set, discernment still runs (Ollama decides satisfied or not) but Grok is not called.

**/task when Mac is off (Optimus fallback):** If SSH to the Mac fails, Piko runs the Cursor agent on Optimus. For that, install the Cursor CLI on Optimus (e.g. `curl https://cursor.com/install-fsS | sudo -E bash`) so `agent` is available. Optional: set `AGENT_CLI_OPTIMUS=/root/.local/bin/agent` if it’s not in PATH. To run `/task Legion ...` in `/opt/legion` on Optimus, add:  
`Environment=PIKO_OPTIMUS_PROJECT_PATHS=Legion:/opt/legion`  
Add `Environment=HOME=/root` so the agent script has HOME set. **Optimus-only /task (recommended):** set `Environment=PIKO_TASK_OPTIMUS_ONLY=true` so Piko never tries the Mac for /task and always runs the Cursor agent on Optimus (simpler, one path). Then `sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service`. For Telegram, add the same env vars (and `CURSOR_API_KEY`) to `clawfriend-bot.service`.

**Intent poller (Phase 2):** To process reminders and scheduled commands every 5 min on Optimus:

```bash
mkdir -p /root/webchat-piko/logs
crontab -e
# Add:
*/5 * * * * cd /root/webchat-piko && PIKO_WEBCHAT_URL=http://localhost:3000 /usr/bin/node scripts/intent-poller.js >> /root/webchat-piko/logs/intent-poller.log 2>&1
```

Optional: `PIKO_INTENT_POLLER_RUN_QUEUE=true` to run one queue item per poll.

**Rabbit-hole learning (12am–6am):** To run daily exploration in quiet hours, add to crontab (e.g. 3am):
```bash
0 3 * * * cd /root/webchat-piko && node scripts/rabbit-hole-daily.js >> /root/webchat-piko/logs/rabbit-hole-daily.log 2>&1
```
Ensure `data/learning/topics.txt` exists (one topic per line). See **docs/PIKO_DASHBOARD_AND_CONTROL_INTENT.md** §3 for influencing topics.

**Discord adapter (Phase 2):** See **adapters/discord/README.md**. Copy `adapters/discord` to Optimus, `npm install`, set `DISCORD_TOKEN` and `PIKO_WEBCHAT_URL=http://localhost:3000`, run under systemd or PM2.

**Moltbook "All posts" + learning — operational invariants (forever rules):**

The list is built by merging the Moltbook API result with local `data/moltbook-state.json`. The Moltbook API does not expose a full "my posts" history; local accumulation is the only way to get a complete list. Learning (journal, goals, `piko-memory.json`) and "All posts" both depend on the poster running with a valid API key. If **any** of the following break, "All posts" will show only 1 item and `/goals` will say "No goals file yet":

1. **Cron** runs the poster from the **same** app directory **with env loaded** (cron does not load `.env` by default):
   - **Use the wrapper** so `MOLTBOOK_API_KEY` is available:
     ```bash
     */30 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1
     ```
   - On Optimus, create **`/root/webchat-piko/.env`** (not in repo) with at least:
     `MOLTBOOK_API_KEY=your_agent_key`
   - Optional: `OLLAMA_URL`, `OLLAMA_MODEL`. The wrapper sources `.env` before running the poster.
2. **systemd** runs the web server from the **same** directory: **`/root/webchat-piko`** (so it reads **`data/moltbook-state.json`** and **`data/piko-memory.json`** there).
3. **State file** exists and has **`posts.length >= 2`** (otherwise there is no history to show beyond the single API post).

No env overrides for DATA_DIR: poster and server must share the same `data/` path.

**Phase 3:** Control UI at **http://192.168.0.121:3000/control**. Charts: `/chart bar 10,20,30`. Slack adapter: **adapters/slack/README.md**. Streaming: `POST /api/chat` with `stream: true` → SSE.

**Phase 4:** Multi-session: `/profile work` or `/profile main` (work = /task,/queue,/read,/ls only); `data/sessions.json`. WhatsApp: **adapters/whatsapp/README.md** (Baileys, scan QR). BlueBubbles/iMessage: **adapters/bluebubbles/README.md** (webhook, macOS). Global CLI: `node scripts/piko-cli.js chat "msg" | doctor | intents` (set `PIKO_WEBCHAT_URL`). Optional Docker sandbox for /task: `PIKO_TASK_DOCKER=true`, `PIKO_TASK_DOCKER_IMAGE=your-image`. Voice: 🎤 button in WebChat (Web Speech API). Local skills: **webchat-piko/skills/index.js** (loadable handlers).

---

## 4. Smoke test

From your Mac (or any device on the same LAN):

1. Open **http://192.168.0.121:3000**
2. Send: **Hello**
3. Send: **What can you do?**

Check: natural Piko replies, no `[Telegram ...]` envelope, no “API keys not configured” or TTS/link hallucinations.

---

## 5. Useful commands (on Optimus)

| Command | Purpose |
|--------|--------|
| `systemctl status piko-webchat.service` | Status |
| `systemctl restart piko-webchat.service` | Restart after code/config change |
| `journalctl -u piko-webchat.service -f` | Follow logs |

---

## Quick reference

- **WebChat URL (LAN):** http://192.168.0.121:3000  
- **App on Optimus:** `/root/webchat-piko/`  
- **Service:** `piko-webchat.service`
