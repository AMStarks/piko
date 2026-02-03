# Telegram Setup for Fresh OpenClaw Installation

**Date:** February 2, 2026  
**Status:** Ready for Telegram bot configuration

---

## Current Status

✅ OpenClaw built from source (latest main branch)  
✅ Ollama configured and working  
✅ Workspace files configured (SOUL.md, IDENTITY.md, USER.md)  
✅ Gateway running on port 8081  

---

## Telegram Bot Setup

### Step 1: Get Bot Token (if needed)

If you don't have a bot token yet:

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow prompts to name your bot (e.g., "ClawFriend")
4. Get your bot token (format: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Add Telegram Channel to OpenClaw

**Option A: Via CLI (Recommended)**

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels add telegram
```

When prompted, paste your bot token.

**Option B: Manual Config**

Edit `~/.openclaw/openclaw.json` and add:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN_HERE"
    }
  }
}
```

Then restart:
```bash
systemctl --user restart openclaw-gateway.service
```

### Step 3: Approve Pairing

1. Send a message to your bot on Telegram (e.g., "Hello")
2. OpenClaw will respond with a pairing code
3. Approve the pairing:

```bash
openclaw pairing approve telegram <PAIRING_CODE>
```

### Step 4: Test

Send "Hey mate" to your bot. You should get a natural, conversational response (not meta-analysis).

---

## Your Previous Bot Token

If you still have the token from before (`8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g`), you can use it directly:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels add telegram
# Paste: 8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g
```

---

## Troubleshooting

- **Bot not responding:** Check gateway logs: `journalctl --user -u openclaw-gateway.service -f`
- **Pairing failed:** Make sure you sent a message to the bot first
- **Plugin not found:** Run `openclaw plugins enable telegram` and restart

---

**Next Steps:** After Telegram is working, we'll set up Cursor CLI integration.
