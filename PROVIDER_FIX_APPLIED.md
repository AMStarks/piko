# Provider Registration Fix Applied

**Date:** February 2, 2026, 07:10 AEDT  
**Status:** Fix implemented - testing

---

## Fix Applied

Added missing fields to `~/.openclaw/openclaw.json`:

1. **`models.mode: "merge"`** - Enables custom provider overriding
2. **`models.providers.openai.api: "openai-chat"`** - Critical: Registers the API type

---

## Updated Config

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "http://localhost:11434/v1",
        "apiKey": "ollama",
        "api": "openai-chat",
        "models": [...]
      }
    }
  }
}
```

---

## Testing

Gateway restarted. Please test by sending a message to your Telegram bot.

**Expected:** Bot responds naturally (no meta-analysis, no errors)

**If still fails:** Check logs for new errors or try `api: "openai-completions"` instead.

---

**Status:** Ready for testing
