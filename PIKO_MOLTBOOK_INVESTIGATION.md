# Getting Piko onto Moltbook — Investigation & Options

**Note:** "Moltbook" can mean two things:
- **Moltbook.com** — the social network for AI agents (register, post, comment). See **PIKO_ON_MOLTBOOK.md** for how to get Piko onto that (send `/task` with the skill.md instruction, or run the registration curl yourself).
- **A second machine** (e.g. another laptop) — this doc treats that case: use Piko from Moltbook (client), run Piko on Moltbook (full instance), or use Moltbook as a Cursor host.

---

## 1. What “Piko on Moltbook” can mean

| Goal | What you do | Where Piko runs |
|------|-------------|------------------|
| **A. Use Piko from Moltbook** | On Moltbook, open the WebChat URL in a browser (or call the API from an app). | Piko stays on **Optimus**. Moltbook is just a client. |
| **B. Run Piko on Moltbook** | Deploy the WebChat app (and optionally Ollama) **on Moltbook** so you can chat at `http://moltbook:3000` (or localhost). | Piko runs on **Moltbook**. No Optimus needed for that instance. |
| **C. Moltbook as Cursor host** | When you send `/task` or `/cursor`, have Piko run Cursor on Moltbook (like the old MacBook path) instead of or in addition to Optimus. | Backend still on Optimus; Cursor runs on Moltbook via SSH. |

---

## 2. Option A — Use Piko from Moltbook (easiest)

**No deployment on Moltbook.** Ensure Moltbook can reach Optimus on your LAN (or via tunnel).

1. **On Moltbook:** Open a browser and go to the WebChat URL:
   - LAN: **http://192.168.0.121:3000**
   - If you use a tunnel (e.g. Cloudflare, Tailscale): use the tunnel’s HTTPS URL to the same port.

2. **Optional:** From Moltbook you can also call the API (e.g. from a script or app):
   ```bash
   curl -s -X POST http://192.168.0.121:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"message":"Hello","sessionId":"moltbook-1"}'
   ```

**Requirements:** Optimus and `piko-webchat.service` running; Moltbook on same network (or tunnel) and no firewall blocking port 3000.

---

## 3. Option B — Run Piko on Moltbook (full local instance)

Run the **same** WebChat app (and optionally Ollama) on Moltbook so Piko lives there. Good if Moltbook is your main machine or you want a second, independent Piko.

### 3.1 What we need to know about Moltbook

- **OS:** macOS or Linux? (Affects how we run the server and Ollama.)
- **Access:** SSH from your MacBook? (e.g. `ssh user@moltbook` or `ssh user@192.168.0.xxx`.) Hostname or IP?
- **Node:** Is Node.js installed? (Need it for `server.js`.)
- **Ollama:** Do you want chat on Moltbook to use Ollama **on Moltbook**? If yes, Ollama must be installed and a model pulled (e.g. `llama3.1:latest`). If no, you can point `OLLAMA_URL` to another host (e.g. Optimus) so Moltbook’s WebChat uses Optimus’s Ollama.

### 3.2 Deploy WebChat to Moltbook (high level)

1. **Copy the app to Moltbook**  
   From your Mac (Piko repo root), use the deploy script (once you set Moltbook’s host/user/key):
   ```bash
   MOLTBOOK_HOST=192.168.0.XXX MOLTBOOK_USER=youruser ./scripts/webchat-deploy/deploy-to-moltbook.sh
   ```
   Or rsync by hand (see script in `scripts/webchat-deploy/deploy-to-moltbook.sh`).

2. **On Moltbook — install Node** (if needed)  
   - macOS: `brew install node` or install from nodejs.org.  
   - Linux: `apt install nodejs` or equivalent.

3. **On Moltbook — run the server**  
   - **macOS:** No systemd. Run in terminal or under launchd:
     ```bash
     cd /path/to/webchat-piko && node server.js
     ```
     Or use a launchd plist so it starts on login (see runbook).
   - **Linux:** Same as Optimus: copy `piko-webchat.service`, set `WorkingDirectory` and paths for Moltbook, then `systemctl enable --now piko-webchat.service`.

4. **Ollama on Moltbook (optional)**  
   - If you want chat to run **on Moltbook**: install Ollama on Moltbook, run it, and pull a model (e.g. `ollama run llama3.1:latest`). Leave `OLLAMA_URL` default (`http://localhost:11434/...`) in the service or env.
   - If you want Moltbook’s WebChat to use **Optimus’s** Ollama: set on Moltbook `OLLAMA_URL=http://192.168.0.121:11434/v1/chat/completions` (and ensure Optimus allows access to 11434 from Moltbook).

5. **Telegram**  
   The **same** Telegram bot token can only be used by **one** process in the world. So:
   - Either keep the bot on **Optimus** only and use Moltbook only for WebChat in the browser, or  
   - Run a **second** Telegram bot on Moltbook with a **different** token (second “Piko” bot), and point it at Moltbook’s WebChat (`PIKO_WEBCHAT_URL=http://localhost:3000`).

### 3.3 Files added for Option B

- **`scripts/webchat-deploy/deploy-to-moltbook.sh`** — Deploys `webchat-piko/` to Moltbook via rsync. Uses `MOLTBOOK_HOST`, `MOLTBOOK_USER`, optional `MOLTBOOK_SSH_KEY`, optional `MOLTBOOK_DEST`.
- **`scripts/webchat-deploy/MOLTBOOK_RUNBOOK.md`** — Step-by-step: prerequisites, deploy, Node/Ollama on Moltbook, macOS vs Linux, optional launchd/systemd, and Telegram note.

---

## 4. Option C — Moltbook as Cursor host for /task and /cursor

Today, `/task` and `/cursor` are **Optimus-only** (`PIKO_TASK_OPTIMUS_ONLY=true`, `PIKO_CURSOR_OPTIMUS_ONLY=true`). To run Cursor **on Moltbook** when you send a command from Telegram or WebChat (on Optimus):

1. **Optimus** would need to SSH to Moltbook (with a key and user/host).
2. **Code changes:** In `webchat-piko/server.js` and `telegram-bot/bot.js`, the “Mac” path (currently `MACBOOK_USER` / `MACBOOK_IP`) could be made configurable so a second host (Moltbook) is tried, or used instead of the Mac. That would mean:
   - Adding env vars (e.g. `MOLTBOOK_USER`, `MOLTBOOK_IP`, `MOLTBOOK_SSH_KEY`, `CURSOR_WORKDIR_MOLTBOOK`).
   - Logic like: if “use Moltbook for Cursor”, run the existing SSH + Cursor/agent command but targeting Moltbook instead of the Mac.

This is a small but explicit change; we can do it once you confirm you want /task and /cursor to run on Moltbook and share Moltbook’s SSH details (user, host/IP, key path on Optimus).

---

## 5. Recommendation and next steps

- **If you only want to use Piko from Moltbook:** Use **Option A** — open **http://192.168.0.121:3000** (or your tunnel URL) on Moltbook. No new scripts or deploy needed.
- **If you want a full Piko instance on Moltbook:** Use **Option B**. I’ve added `deploy-to-moltbook.sh` and `MOLTBOOK_RUNBOOK.md`. You’ll need to set Moltbook’s hostname/IP, user, and (if different) SSH key; then follow the runbook for Node, Ollama, and how to run the server (macOS vs Linux).
- **If you want /task and /cursor to run on Moltbook:** We’ll implement **Option C** (configurable Cursor host + Moltbook env vars and SSH from Optimus to Moltbook).

To tailor the runbook and script, it would help to know:
- Moltbook’s **OS** (macOS or Linux),
- **Hostname or IP** (e.g. `moltbook.local` or `192.168.0.xxx`),
- **SSH user** (e.g. your username),
- **SSH key** you use from your Mac to Moltbook (e.g. `~/.ssh/id_ed25519` or `~/.ssh/id_moltbook`).

Once you provide those (or confirm Option A/B/C), we can lock the runbook to your setup.
