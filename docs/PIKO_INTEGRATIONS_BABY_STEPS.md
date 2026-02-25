# Piko integrations — baby steps

Complete these in order. Each step is one small action. Do them on **Optimus** (SSH: `ssh -i ~/.ssh/id_optimus root@192.168.0.121`) unless noted.

---

## Before you start

- You already have **Daily memory**, **EA synthesis**, **Meeting prep**, and **Gmail read body** set to **On** via the server drop-in. What’s left is: **Telegram alerts**, **Gmail (EA look-in)**, **iMessage (EA)**, and **cron** so scripts actually run.

---

## Part A — Telegram (alerts)

So the server can send EA look-in messages to your Telegram chat.

### Step A1 — Get your Telegram chat ID

1. In Telegram, open a chat with **@userinfobot** (search for it, start chat).
2. Send any message (e.g. `hi`).
3. The bot replies with your **Id:** a number like `123456789`. That’s your **TELEGRAM_CHAT_ID**. Copy it.

### Step A2 — Get your bot token (if you don’t have it)

- You already use a Telegram bot for Piko (ClawFriend). The **token** is the one you used when you created the bot with @BotFather (looks like `1234567890:ABCdef...`). If you don’t have it, create a new bot with @BotFather and use that token (and use the same chat ID from A1).

### Step A3 — Add both to the server’s .env on Optimus

1. SSH to Optimus:  
   `ssh -i ~/.ssh/id_optimus root@192.168.0.121`
2. Edit the env file:  
   `nano /root/webchat-piko/.env`
3. Add two lines (use your real values):

   ```
   TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
   TELEGRAM_CHAT_ID=123456789
   ```

4. Save (Ctrl+O, Enter, Ctrl+X).

### Step A4 — Restart the server

On Optimus:

```bash
sudo systemctl restart piko-webchat.service
```

### Step A5 — Check

- Open **Control → Integrations** in the browser (e.g. `http://192.168.0.121:3000/control-integrations`). **Telegram (alerts)** should show **Configured**.
- Next time the EA look-in cron runs (every 30 min), you should get a Telegram message if there’s something to say.

---

## Part B — Gmail (EA look-in)

So Piko can mention “N unread emails” (and optionally read body) in the look-in.

### Step B1 — Create a Google Cloud project and OAuth consent (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick one).
3. **APIs & Services → Enable APIs** — enable **Gmail API**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Desktop app**. Create. Download the JSON or note **Client ID** and **Client secret**.

### Step B2 — Get a refresh token (one-time, on your Mac or a machine with a browser)

1. Use Google’s OAuth Playground or a small script to sign in and get a **refresh_token** (and optionally **access_token**). Many people use a script like [this](https://developers.google.com/gmail/api/quickstart/nodejs) or the OAuth 2.0 Playground to get the refresh token.
2. You need: **GMAIL_CLIENT_ID**, **GMAIL_CLIENT_SECRET**, **GMAIL_REFRESH_TOKEN**.

### Step B3 — Put them in .env on Optimus

1. SSH to Optimus.
2. `nano /root/webchat-piko/.env`
3. Add (use your real values):

   ```
   GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=xxx
   GMAIL_REFRESH_TOKEN=1//xxx
   ```

4. Save and exit.

### Step B4 — Restart and check

```bash
sudo systemctl restart piko-webchat.service
```

- **Control → Integrations**: **Gmail (EA look-in)** should show **Configured**.
- **Gmail read body** is already On; the server will use the token to fetch body snippets when the EA look-in runs.

---

## Part C — iMessage (EA)

So the same look-in message can be sent to an iMessage chat (via BlueBubbles).

### Step C1 — BlueBubbles server running

- You need **BlueBubbles Server** running on a Mac (e.g. your Mac mini), signed into iMessage, and an **API key** created in BlueBubbles settings. If you haven’t set this up, see **docs/BLUEBUBBLES_PIKO_IMESSAGE_SETUP.md**.

### Step C2 — Get BlueBubbles URL and API key

- **BLUEBUBBLES_URL**: e.g. `http://192.168.0.48:1234` (your Mac running BlueBubbles; must be reachable from Optimus).
- **BLUEBUBBLES_API_KEY**: from BlueBubbles Server → Settings → API.
- **PIKO_EA_IMESSAGE_CHAT_GUID**: the **chat GUID** of the iMessage chat you want to receive look-ins (you can get this from BlueBubbles API or when the adapter receives a message).

### Step C3 — Add to .env on Optimus

1. SSH to Optimus.
2. `nano /root/webchat-piko/.env`
3. Add:

   ```
   BLUEBUBBLES_URL=http://192.168.0.48:1234
   BLUEBUBBLES_API_KEY=your_api_key
   PIKO_EA_IMESSAGE_CHAT_GUID=your-chat-guid
   ```

4. Save and exit.

### Step C4 — Restart and check

```bash
sudo systemctl restart piko-webchat.service
```

- **Control → Integrations**: **iMessage (EA)** should show **Configured**.

---

## Part D — Cron (so scripts actually run)

The server doesn’t run EA look-in or daily memory by itself; **cron** does.

### Step D1 — Open crontab on Optimus

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
crontab -e
```

### Step D2 — Add these lines (adjust paths if yours differ)

**EA look-in (every 30 min):**

```bash
*/30 * * * * cd /root/webchat-piko && . ./.env 2>/dev/null; export $(grep -v '^#' .env 2>/dev/null | xargs); node scripts/ea-lookin.js >> /root/webchat-piko/logs/ea-lookin.log 2>&1
```

**Intent poller (every 5 min, for reminders):**

```bash
*/5 * * * * cd /root/webchat-piko && PIKO_WEBCHAT_URL=http://localhost:3000 node scripts/intent-poller.js >> /root/webchat-piko/logs/intent-poller.log 2>&1
```

**Daily memory (once per day, after midnight):**

```bash
5 0 * * * cd /root/webchat-piko && . ./.env 2>/dev/null; export $(grep -v '^#' .env 2>/dev/null | xargs); node scripts/daily-memory-summarize.js >> /root/webchat-piko/logs/daily-memory.log 2>&1
```

**Rabbit-hole learning (e.g. 3am):**

```bash
0 3 * * * cd /root/webchat-piko && node scripts/rabbit-hole-daily.js >> /root/webchat-piko/logs/rabbit-hole-daily.log 2>&1
```

### Step D3 — Create log directory

```bash
mkdir -p /root/webchat-piko/logs
```

### Step D4 — Save and exit

- In `crontab -e`, save (e.g. `:wq` in vim or Ctrl+X then Y in nano).

### Step D5 — Check cron is loaded

```bash
crontab -l
```

You should see the lines you added.

---

## Quick reference — what lives where

| What | Where |
|------|--------|
| Telegram token & chat ID | `/root/webchat-piko/.env` on Optimus |
| Gmail OAuth | Same `.env` |
| BlueBubbles + iMessage chat GUID | Same `.env` |
| Cron entries | `crontab -e` on Optimus (root) |
| Integration toggles (Daily memory, EA synthesis, etc.) | Already set in `70-integrations.conf`; no action needed |

---

## If something doesn’t show “Configured”

- **Telegram:** Ensure both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are in `.env`, then restart `piko-webchat.service`.
- **Gmail:** Ensure `GMAIL_ACCESS_TOKEN` or (`GMAIL_REFRESH_TOKEN` + `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET`) are in `.env`, then restart.
- **iMessage:** Ensure `PIKO_EA_IMESSAGE_CHAT_GUID`, `BLUEBUBBLES_URL`, and `BLUEBUBBLES_API_KEY` are in `.env`, then restart.
- After editing `.env`, always run: `sudo systemctl restart piko-webchat.service`.
