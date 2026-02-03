# Deploy Bot to Optimus

This `bot.js` handles **/cursor first** (before Ollama). **Chat** uses the same Piko backend as WebChat when `PIKO_WEBCHAT_URL` is set (e.g. `http://localhost:3000` on Optimus).

## Optimus-only /task and /cursor (recommended)

Set both in the service(s):  
`Environment=PIKO_TASK_OPTIMUS_ONLY=true` and `Environment=PIKO_CURSOR_OPTIMUS_ONLY=true`  
Then /task and /cursor **always run on Optimus** (no Mac try). One path only, no "Mac unreachable". The Cursor agent gets `HOME=/root`. For /cursor, the Optimus script (e.g. `run-cursor-optimus.sh`) runs the Cursor CLI; you may see DBus/Electron warnings in the reply — that’s normal headless. For /task, the agent runs in the project dir set via `PIKO_OPTIMUS_PROJECT_PATHS` (e.g. Legion:/opt/legion).

## Single instance only (fix "Conflict: getUpdates")

**Only one process in the world** may use this bot’s Telegram token at a time. If you see `Conflict: terminated by other getUpdates request` in the logs:

1. **Stop any other instance** using the same token:
   - On your **Mac**: quit any terminal or process running `node bot.js` (or `node telegram-bot/bot.js`). Check for background node processes using this token.
   - On **Optimus**: only `clawfriend-bot.service` should run the bot. Don’t run `node /root/telegram-ollama-bot/bot.js` manually while the service is active.
2. **Then restart** the instance you want (e.g. on Optimus: `sudo systemctl restart clawfriend-bot.service`).

The bot uses a lock file on startup (`/tmp/clawfriend-bot.lock`) so only one instance runs **per machine**; the duplicate is usually the bot running on both Optimus and your Mac.

## One-time deploy from your MacBook

1. **Copy the bot to Optimus** (from your MacBook, in the Piko project folder). You need both `bot.js` and `auth.js`:

   ```bash
   scp -i ~/.ssh/id_optimus telegram-bot/bot.js telegram-bot/auth.js root@192.168.0.121:/root/telegram-ollama-bot/
   ```

2. **Set the token on Optimus** (if not already set):

   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121 "grep -q TELEGRAM_TOKEN /etc/systemd/system/clawfriend-bot.service || (sudo sed -i 's|ExecStart=.*|ExecStart=/usr/bin/node /root/telegram-ollama-bot/bot.js\\nEnvironment=TELEGRAM_TOKEN=YOUR_TOKEN_HERE|' /etc/systemd/system/clawfriend-bot.service)"
   ```
   Or manually: `sudo nano /etc/systemd/system/clawfriend-bot.service` and add under `[Service]`:
   ```
   Environment=TELEGRAM_TOKEN=8589008863:AAGT...
   Environment=PIKO_WEBCHAT_URL=http://localhost:3000
   ```
   (Use your real token; keep it only on Optimus. `PIKO_WEBCHAT_URL` makes Telegram use the same Piko as WebChat; omit it to use Ollama directly.)

   If the bot already has the token in the file (e.g. hardcoded), skip this.

3. **Restart the bot**:

   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121 "sudo systemctl restart clawfriend-bot.service && systemctl is-active clawfriend-bot.service"
   ```

4. **Test in Telegram:** Send `/cursor --version`. You should get the Cursor CLI version from your MacBook, not an Easter-egg reply.

## If the current bot on Optimus has the token in the file

If `/root/telegram-ollama-bot/bot.js` on Optimus already has `TELEGRAM_TOKEN = '...'` and no `process.env.TELEGRAM_TOKEN`, then after copying our `bot.js` the token will be `YOUR_BOT_TOKEN` and the bot will fail. Either:

- **Option A:** On Optimus, after copying, run:  
  `sudo sed -i "s/YOUR_BOT_TOKEN/$(grep -o "8589008863:AAG[^\']*" /root/telegram-ollama-bot/bot.js 2\/dev\/null || echo "PASTE_TOKEN_HERE")/" /root/telegram-ollama-bot/bot.js`  
  (Replace PASTE_TOKEN_HERE with your real token if the grep finds nothing.)

- **Option B:** Edit `telegram-bot/bot.js` locally and set `TELEGRAM_TOKEN = 'your_real_token'` (only if this repo stays private), then `scp` again.

- **Option C:** Use `Environment=TELEGRAM_TOKEN=...` in the systemd service and keep the code as `process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN'` so the env overrides.

## Quick deploy (copy + restart)

```bash
cd /Users/starkers/Projects/Piko
scp -i ~/.ssh/id_optimus telegram-bot/bot.js root@192.168.0.121:/root/telegram-ollama-bot/bot.js
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "sudo systemctl restart clawfriend-bot.service"
```

If the existing bot on Optimus uses a hardcoded token, either add `Environment=TELEGRAM_TOKEN=...` to the service or patch the copied file with the token once (see above).
