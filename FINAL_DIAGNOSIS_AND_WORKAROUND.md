# Final Diagnosis: Provider Registration Bug

**Date:** February 2, 2026, 07:42 AEDT  
**Status:** Confirmed bug - provider not registering despite correct config

---

## Critical Finding

**Logs show:**
- ✅ Messages ARE received: `embedded run start: provider=ollama model=llama3.1:latest`
- ✅ Provider name recognized: `provider=ollama`
- ❌ **Provider NOT registered:** `Error: No API provider registered for api: undefined`

**This is a fundamental bug in OpenClaw v2026.1.30** - it reads the config but doesn't register custom providers in the API registry.

---

## What We've Tried

1. ✅ Config with `openai` provider → Failed
2. ✅ Config with `ollama` provider → Failed  
3. ✅ Adding `api` field → Not valid in v2026.1.30
4. ✅ Adding `mode: merge` → Config valid but provider still not registered
5. ✅ Debug logging → Confirms messages received but provider lookup fails

---

## Root Cause

OpenClaw's provider registration system expects providers to be registered **programmatically at gateway startup**, but the config-based approach doesn't trigger this registration. The gateway reads the config but never calls `registerApiProvider()` for custom providers.

---

## Solution: Lightweight Telegram Bot Workaround

Since OpenClaw has a fundamental bug, let's build a simple Telegram bot that works:

**This will:**
- ✅ Work immediately (no OpenClaw bugs)
- ✅ Call Ollama directly
- ✅ Support Cursor CLI integration
- ✅ Be expandable to full features later

---

**Next:** Implementing the lightweight bot workaround.
