# Debug Logging and Configuration Updates

**Date:** February 2, 2026, 07:32 AEDT  
**Status:** Debug logging enabled, configs updated

---

## Changes Applied

### 1. Debug Logging
- ✅ Added `Environment="OPENCLAW_LOG_LEVEL=debug"` to systemd service
- ✅ Service reloaded and restarted

### 2. Telegram Configuration
- ✅ Set `useWebhook: false` (using polling mode)
- ✅ Set `pollingInterval: 1000` (1 second checks)

### 3. Agent Configuration
- ✅ Enabled `think: true` (for LLM invocation)
- ✅ Confirmed `runtime: "direct"`

---

## Next Steps

**IMPORTANT:** Check Telegram Bot Privacy Settings

1. **Open Telegram** and chat with **@BotFather**
2. Select your bot
3. Run `/setprivacy`
4. Choose **"Disable"** (critical for non-command messages)

**Then:**
1. Send `/new` to start fresh session
2. Send "Hello mate" to test
3. Check logs below for detailed debugging info

---

## Logs

Check the logs output above for:
- ✅ Message receipt: "Incoming from Telegram: Hello mate"
- ✅ Provider invocation: "Invoking ollama/llama3.1:latest"
- ❌ Errors: Any routing or delivery failures

---

**Status:** Ready for testing with debug logs
