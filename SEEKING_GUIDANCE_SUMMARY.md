# OpenClaw Setup - Seeking Guidance

**Date:** February 2, 2026  
**Status:** Critical blocker preventing normal operation  
**Setup Presupposition:** Our configuration is correct; issue is likely in OpenClaw's prompt construction

---

## Critical Issue: Meta-Analysis Instead of Conversation

**Problem:** OpenClaw analyzes message format/structure instead of responding naturally.

**User sends:** "Hello mate"  
**OpenClaw responds:** "Here is the content of the provided text, formatted for easier reading: [code block with runtime status] This text appears to be the runtime status and a message received on Telegram..."

**Expected:** "Hello! How can I help you?"

**Impact:** Blocks all functionality - cannot test conversation, cannot proceed with Cursor integration, cannot achieve goals.

---

## Our Setup (Explicit Details)

### We Are Using LOCAL OLLAMA - NOT Anthropic or OpenAI

**Important:** We are **NOT** using paid APIs from Anthropic or OpenAI. We are using **local Ollama** running on our server with **Mistral 7B model**.

**Configuration:**
- **OpenClaw Provider:** `openai` (this is just the provider name in OpenClaw's config)
- **Actual Backend:** Local Ollama at `http://localhost:11434/v1`
- **Model:** Mistral 7B (`mistral:latest`) running locally
- **API Key:** `"ollama"` (placeholder, not used by Ollama)
- **Why "openai" provider?** Ollama provides an OpenAI-compatible API, so OpenClaw treats it as an OpenAI provider

**Ollama Details:**
- Running in Docker container (`legion-ollama`)
- Endpoint: `http://localhost:11434/v1` (OpenAI-compatible)
- Models: `mistral:latest` (7B, 4.4GB), `llama3.1:latest` (8B), `llama3.2:latest` (3B)
- GPU: NVIDIA RTX 3080 (10GB VRAM) - enabled and working
- **Direct test works:** `ollama run mistral:latest "Hello"` → Natural response ✅

**OpenClaw:**
- Version: 2026.1.30
- Gateway: Port 8081
- Config: `/root/.openclaw/openclaw.json`
- Workspace: `/root/.openclaw/workspace` (minimal files)

---

## What We've Tried (All Failed)

1. ❌ Deleted `BOOTSTRAP.md` (should be deleted after setup)
2. ❌ Switched models: 3B → 8B → 7B (Mistral)
3. ❌ Rewrote `SOUL.md` with explicit "don't analyze" instructions
4. ❌ Deleted ALL workspace files except minimal `SOUL.md`
5. ❌ Fixed config format errors
6. ✅ Verified model works fine directly (not through OpenClaw)

**Conclusion:** The model is fine. The problem is in how OpenClaw constructs prompts.

---

## What We Might Have Done Wrong

### Possible Mistakes:

1. **Provider Configuration**
   - Using `openai` provider name with Ollama - is this correct?
   - Should we use a different provider name or configuration method?
   - Is there an `ollama` provider we should use instead?

2. **Model Name Format**
   - Configuring as `openai/mistral:latest` - should it be just `mistral:latest`?
   - Does the `openai/` prefix cause issues?

3. **System Prompt Override**
   - We've tried workspace files (`SOUL.md`, `IDENTITY.md`, etc.)
   - Maybe OpenClaw has a different way to override system prompts?
   - Are we missing a configuration option?

4. **OpenClaw Version**
   - Using v2026.1.30 - could this be a bug in this version?
   - Should we try a different version?

5. **Workspace File Structure**
   - Maybe OpenClaw expects files in a different location or format?
   - Are we missing required files or have files in wrong places?

### What We're Confident About:

✅ Ollama is configured correctly (works fine directly)  
✅ Model works fine (tested independently)  
✅ OpenClaw gateway is running  
✅ Telegram channel is connected  
✅ Config file is valid (no errors)  
✅ GPU is working  

**Presupposition:** Our setup is fundamentally correct. The issue is likely:
- How OpenClaw constructs prompts for Ollama
- A missing configuration option we don't know about
- A bug or limitation in OpenClaw v2026.1.30
- Our misunderstanding of how to configure local models

---

## Current Configuration

### `/root/.openclaw/openclaw.json`
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/mistral:latest"
      }
    }
  },
  "models": {
    "providers": {
      "openai": {
        "baseURL": "http://localhost:11434/v1",
        "apiKey": "ollama",
        "models": [
          {
            "id": "mistral:latest",
            "name": "mistral:latest",
            "contextWindow": 16000,
            "maxTokens": 512
          }
        ]
      }
    }
  }
}
```

### Workspace Files (Minimal)
- `SOUL.md`: "You are a helpful AI assistant. Respond naturally to messages. Do not analyze or describe messages - just respond to them directly."
- `IDENTITY.md`: Basic info (name, emoji)
- `USER.md`: Basic user context
- All other files deleted

---

## Questions for Guidance

1. **Is our Ollama configuration correct?**
   - Using `openai` provider with Ollama's OpenAI-compatible API
   - Is there a better way to configure local Ollama with OpenClaw?

2. **How does OpenClaw construct prompts?**
   - What system messages does it add?
   - Can we see/view the actual prompt being sent to Ollama?
   - Is there logging that shows the constructed prompt?

3. **How do we override system prompts?**
   - We've tried workspace files - they don't seem to affect behavior
   - Is there a config option we're missing?
   - Are workspace files read correctly?

4. **Is this a known issue?**
   - Has anyone else experienced meta-analysis with local Ollama?
   - Is this a bug in OpenClaw v2026.1.30?
   - Should we try a different version?

5. **What's the correct way to use local Ollama?**
   - Our approach: OpenAI-compatible API via `openai` provider
   - Is there documentation we're missing?
   - Are there examples of working Ollama + OpenClaw setups?

---

## What We Need

**Immediate:** Fix meta-analysis issue so OpenClaw responds naturally  
**Then:** Proceed with Cursor integration and "friend" quality conversation

**We believe our setup is correct** - we just need to understand:
- How OpenClaw constructs prompts
- How to properly configure local Ollama
- Whether this is a bug or configuration issue

---

**See Also:**
- `OPENCLAW_META_ANALYSIS_ISSUE.md` - Detailed analysis of the meta-analysis problem
- `PROJECT_BRIEF_AND_ISSUES.md` - Complete project overview and all issues

---

**Last Updated:** February 2, 2026, 00:53 AEDT
