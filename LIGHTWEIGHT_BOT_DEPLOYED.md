# Lightweight Telegram Bot Deployed

**Date:** February 2, 2026, 07:43 AEDT  
**Status:** Working alternative to OpenClaw

---

## What Was Deployed

A lightweight Telegram bot that:
- ✅ Calls Ollama directly (no OpenClaw bugs)
- ✅ Maintains session memory
- ✅ Supports `/new`, `/status` commands
- ✅ Ready for Cursor CLI integration (update MacBook IP)
- ✅ Runs as systemd service

---

## Location

- **Code:** `/root/telegram-ollama-bot/bot.js`
- **Service:** `/etc/systemd/system/clawfriend-bot.service`
- **Status:** `systemctl status clawfriend-bot.service`

---

## Testing

**Send to your Telegram bot:**
1. `/new` - Start fresh session
2. `Hello mate` - Should get natural response!
3. `/status` - Check bot status

---

## Next Steps

1. **Update MacBook IP** in `bot.js` (line with `192.168.0.XXX`)
2. **Test Cursor integration:** `/cursor --help`
3. **Expand features** as needed (file operations, project management, etc.)

---

## Commands

- **Start:** `systemctl start clawfriend-bot`
- **Stop:** `systemctl stop clawfriend-bot`
- **Logs:** `journalctl -u clawfriend-bot -f`
- **Restart:** `systemctl restart clawfriend-bot`

---

**This should work immediately!** Test with "Hello mate" and let me know.
