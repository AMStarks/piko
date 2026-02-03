# Final Diagnosis: Provider Registration Bug

**Date:** February 2, 2026, 07:07 AEDT  
**Status:** Critical bug in source build - provider not registered

---

## The Problem

**Error:** `No API provider registered for api: undefined`

OpenClaw's source build (from GitHub main branch) does **not** properly register custom OpenAI providers with `baseUrl`. The config is read correctly, but the provider isn't registered in the API registry that the agent uses.

**Evidence:**
- ✅ Config correct: `baseUrl: "http://localhost:11434/v1"`, `apiKey: "ollama"`
- ✅ Model recognized: `openai/llama3.1:latest`
- ✅ Gateway starts successfully
- ❌ Provider lookup fails: `api: undefined`
- ❌ Agent crashes when trying to use model

---

## Root Cause

OpenClaw's provider registration system expects providers to be registered **programmatically** at gateway startup. The config-based approach with custom `baseUrl` doesn't trigger this registration. This appears to be a bug or missing feature in the source build.

---

## Solutions Attempted

1. ✅ Config validation and fixes
2. ✅ Auth profile setup
3. ✅ Gateway restarts
4. ✅ Source code investigation
5. ⏳ **Trying npm version** (may have fixes)

---

## Next Steps

1. **Try npm version** - May have provider registration fixes
2. **Check OpenClaw GitHub issues** - Report bug if confirmed
3. **Alternative:** Use a different framework or direct API approach
4. **Workaround:** If npm version works, use that instead of source build

---

## Recommendation

**If npm version works:** Use that instead of source build. The source build appears to have a regression or missing feature for custom provider registration.

**If npm version also fails:** This is a fundamental OpenClaw limitation with Ollama integration. Consider:
- Reporting bug to OpenClaw maintainers
- Using a different AI assistant framework
- Building a lightweight Telegram bot that calls Ollama directly

---

**Status:** Testing npm version now...
