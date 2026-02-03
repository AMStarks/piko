# Critical Bug: API Provider Not Registered

**Error:** `No API provider registered for api: undefined`  
**Status:** OpenClaw source build doesn't register custom OpenAI providers

---

## Problem

OpenClaw recognizes the model (`openai/llama3.1:latest`) and provider (`openai`) in config, but when it tries to use it, the `api` field is `undefined`, causing the provider lookup to fail.

**Logs show:**
- ✅ `provider=openai model=llama3.1:latest` (correct)
- ❌ `Error: No API provider registered for api: undefined`

---

## Root Cause

OpenClaw's provider registration system expects providers to be registered **programmatically** at startup, but our config-based approach with `baseUrl` isn't triggering that registration. The gateway reads the config but doesn't register the provider in the API registry.

---

## Possible Solutions

1. **Use OpenClaw's official Ollama integration** (if it exists)
2. **Find provider registration code** and trigger it manually
3. **Use environment variables** instead of config
4. **Report as bug** to OpenClaw maintainers
5. **Use npm version** instead of source build (might have fixes)

---

## Next Steps

1. Check if OpenClaw has native Ollama support
2. Look for provider registration hooks in gateway code
3. Try using npm version to see if it works
4. Consider using a different approach (direct API calls, different framework)

---

**This is a fundamental issue with how OpenClaw handles custom providers in the source build.**
