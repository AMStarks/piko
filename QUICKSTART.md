# Piko — Quick start (5 minutes)

Get Piko running locally, then optionally add Telegram or deploy to a server.

---

## Prerequisites

- **Node.js** 18+
- **Ollama** with a chat model (e.g. `ollama run llama3.1:latest`)

---

## 1. Run WebChat locally

```bash
git clone https://github.com/AMStarks/piko.git
cd piko/webchat-piko
npm install
PORT=3000 node server.js
```

- **Ollama** must be running (default: `http://localhost:11434`). Set `OLLAMA_URL` if different.
- Open **http://localhost:3000** and send a message (or try `/status`, `/doctor`).

---

## 2. Optional: Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather), get the token.
2. From repo root:
   ```bash
   cd telegram-bot && npm install
   TELEGRAM_TOKEN=your_token PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js
   ```
3. Chat with your bot; it forwards to Piko WebChat.

---

## 3. Optional: Deploy to Optimus (or any Linux server)

1. From repo root:  
   `./scripts/webchat-deploy/deploy-to-optimus.sh`  
   (set `OPTIMUS` and `SSH_KEY` if needed.)
2. On the server: install Node, run Ollama, copy `piko-webchat.service`, set env (e.g. `CURSOR_API_KEY` for `/task`), enable and start the service.
3. See **scripts/webchat-deploy/PHASE2_RUNBOOK.md** and **telegram-bot/DEPLOY_TO_OPTIMUS.md** for full steps.

---

## 4. One-click health check

From repo root:

```bash
npm run piko -- doctor
```

(Requires WebChat server running; uses `PIKO_WEBCHAT_URL` or `http://localhost:3000`.)

---

## Next

- **Commands:** `/status`, `/doctor`, `/queue`, `/remind`, `/schedule`, `/task`, `/cursor` — see **webchat-piko/README.md**.
- **Control dashboard:** http://localhost:3000/control
- **Recovery:** **RECOVERY.md**
- **Full overview:** **PIKO_PROJECT_AND_INTEGRATION.md**
