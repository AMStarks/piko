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

**Unified history (WebChat + Telegram):** To have both channels share the same conversation history, set the same session key on both services:

- **WebChat:** Add `Environment=PIKO_UNIFIED_SESSION_ID=main` to `piko-webchat.service` (or any string you like).
- **Telegram bot:** Add `Environment=PIKO_UNIFIED_SESSION_ID=main` to `clawfriend-bot.service` (same value).
- Restart both services. Then WebChat and Telegram use one shared history. **New chat** (or `/new`) clears that shared history for both.

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
