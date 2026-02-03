# API Provider Registration Issue

**Error:** `No API provider registered for api: undefined`

**Status:** Investigating provider registration with custom Ollama endpoint

---

## Problem

OpenClaw is trying to use the model but can't resolve the API provider. The error suggests the provider name is becoming `undefined` during resolution.

**Logs show:**
- `provider=openai model=llama3.1:latest` (correct)
- But then: `Error: No API provider registered for api: undefined`

---

## Current Config

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "http://localhost:11434/v1",
        "apiKey": "ollama",
        "models": [...]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/llama3.1:latest"
      }
    }
  }
}
```

---

## Possible Solutions

1. **Use `openclaw configure --section model`** to set up the model properly
2. **Check if provider needs to be registered differently** for custom endpoints
3. **Try using environment variables** instead of config file
4. **Check OpenClaw source** for provider registration logic

---

**Next:** Try interactive model configuration or check if there's a provider registration step we're missing.
