# Token Revocation Instructions (Recommended Fix)

**Date:** February 2, 2026, 07:55 AEDT  
**Status:** Webhook requires HTTPS, reverting to polling with token revocation option

---

## Why Token Revocation?

The persistent 409 conflict is caused by Telegram holding onto old connections. **Revoking the token** forces Telegram to drop all existing connections, giving us a clean slate.

---

## Step-by-Step: Revoke and Regenerate Token

### Step 1: Revoke Current Token

1. **Open Telegram** on your iPhone
2. **Search for @BotFather**
3. **Send:** `/revoke`
4. **Select your bot** (Piko_servicedog_bot)
5. **Confirm revocation**

This invalidates the current token: `8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g`

### Step 2: Create New Bot (or Regenerate Token)

**Option A: Create New Bot**
1. In @BotFather, send: `/newbot`
2. Name it: `ClawFriendBot` (or any name)
3. Username: `ClawFriendBot` (must end in `bot`)
4. **Copy the new token**

**Option B: Regenerate Token for Existing Bot**
1. In @BotFather, send: `/mybots`
2. Select your bot
3. Choose "API Token"
4. Choose "Revoke current token" or "Generate new token"
5. **Copy the new token**

### Step 3: Update Bot Code

**On Optimus:**
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
nano /root/telegram-ollama-bot/bot.js
```

**Find this line:**
```javascript
const TELEGRAM_TOKEN = '8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g';
```

**Replace with your new token:**
```javascript
const TELEGRAM_TOKEN = 'YOUR_NEW_TOKEN_HERE';
```

**Save and exit** (Ctrl+X, Y, Enter)

### Step 4: Restart Bot

```bash
systemctl restart clawfriend-bot.service
systemctl status clawfriend-bot.service
```

### Step 5: Test

1. **Find your new bot** in Telegram (search for the username you created)
2. **Send:** `/start`
3. **Send:** `Hello mate`
4. **Should get response!**

---

## Alternative: Wait for Conflict to Clear

If you don't want to revoke the token, you can:
1. Wait 60-90 seconds for Telegram to release the connection
2. Send "Hello mate" and check if it works

But **token revocation is faster and more reliable**.

---

## Current Bot Status

- ✅ Bot code ready (polling mode, conflict handling)
- ✅ Service configured with restart policies
- ⏳ Waiting for token update OR conflict to clear

---

**Recommendation:** Revoke and regenerate token for fastest resolution.
