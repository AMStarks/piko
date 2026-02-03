# OpenClaw Meta-Analysis Issue - Complete Report

**Date:** February 2, 2026  
**Status:** Critical issue preventing normal operation  
**Setup:** OpenClaw v2026.1.30 on Optimus server with local Ollama (Mistral 7B)

---

## The Core Problem

**OpenClaw is analyzing messages instead of responding to them.**

When a user sends "Hello mate" via Telegram, OpenClaw responds with meta-analysis like:

> "Here is the content of the provided text, formatted for easier reading: [code block showing runtime status and message log] This text appears to be the runtime status and a message received on Telegram from a user named StanOwens."

**Expected behavior:** Natural response like "Hello! How can I help you?"

**Actual behavior:** Analysis of message format, structure, and metadata instead of conversational response.

---

## Our Setup (What We've Done)

### Architecture
```
Telegram → OpenClaw Gateway (port 8081) → Ollama (localhost:11434) → Mistral 7B model
```

### Configuration Details

**OpenClaw:**
- Version: 2026.1.30
- Gateway: Running on port 8081 (8080 was in use by Nginx)
- Service: `openclaw-gateway.service` (systemd user service)
- Config: `/root/.openclaw/openclaw.json`
- Workspace: `/root/.openclaw/workspace`

**Model Configuration:**
- **Provider:** `openai` (OpenClaw's provider name, but we're using Ollama)
- **Model:** `openai/mistral:latest` (configured in `agents.defaults.model.primary`)
- **Actual Model:** Mistral 7B running locally via Ollama
- **Ollama Endpoint:** `http://localhost:11434/v1` (OpenAI-compatible API)
- **API Key:** `"ollama"` (placeholder, not used by Ollama)

**Important:** We are **NOT** using Anthropic or OpenAI APIs. We're using **local Ollama** with Mistral 7B, configured to use OpenClaw's "openai" provider because Ollama provides an OpenAI-compatible API.

**Ollama Setup:**
- Running in Docker container (`legion-ollama`)
- URL: `http://localhost:11434`
- Models available: `mistral:latest` (7B, 4.4GB), `llama3.1:latest` (8B), `llama3.2:latest` (3B)
- GPU: NVIDIA RTX 3080 (10GB VRAM) - enabled and working
- Direct Ollama test: Mistral responds naturally when tested directly

**Telegram:**
- Bot token configured
- Pairing approved
- Channel active and receiving messages

---

## What We've Tried (All Failed)

### Attempt 1: Removed BOOTSTRAP.md
**Action:** Deleted `BOOTSTRAP.md` from workspace (it's meant to be deleted after initial setup)  
**Result:** ❌ Still doing meta-analysis

### Attempt 2: Switched Models
**Action:** Changed from `llama3.1:latest` (8B) to `llama3.2:latest` (3B) to `mistral:latest` (7B)  
**Result:** ❌ Still doing meta-analysis (even though Mistral responds naturally when tested directly)

### Attempt 3: Simplified Workspace Files
**Action:** Rewrote `SOUL.md` with explicit instructions: "Respond directly, don't analyze messages"  
**Result:** ❌ Still doing meta-analysis

### Attempt 4: Deleted All Workspace Files
**Action:** Removed all `.md` files except minimal `SOUL.md` with one-line instruction  
**Result:** ❌ Still doing meta-analysis

### Attempt 5: Fixed Config Format
**Action:** Corrected model field from string to object `{"primary": "openai/mistral:latest"}`  
**Result:** ✅ Config valid, but ❌ still doing meta-analysis

### Attempt 6: Verified Model Works Directly
**Action:** Tested Mistral directly via Ollama CLI - responds naturally  
**Result:** ✅ Model works fine when not through OpenClaw

---

## Evidence That Model Works Fine

**Direct Ollama Test:**
```bash
docker exec legion-ollama ollama run mistral:latest "Hello, how are you?"
```

**Response:** Natural, conversational: "I'm just a computer program, so I don't have feelings, but I'm here to help you! How can I assist you today?"

**Conclusion:** The model itself is fine. The problem is in how OpenClaw is using it.

---

## Current Configuration Files

### `/root/.openclaw/openclaw.json`
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/mistral:latest"
      },
      "models": {
        "openai/mistral:latest": {"alias": "mistral"},
        "openai/llama3.1:latest": {},
        "openai/llama3.2:latest": {}
      },
      "workspace": "/root/.openclaw/workspace",
      "compaction": {"mode": "safeguard"},
      "maxConcurrent": 4
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
          },
          {
            "id": "llama3.1:latest",
            "name": "llama3.1:latest",
            "contextWindow": 16000,
            "maxTokens": 512
          }
        ]
      }
    }
  }
}
```

### `/root/.openclaw/workspace/SOUL.md`
```
You are a helpful AI assistant. Respond naturally to messages. Do not analyze or describe messages - just respond to them directly.
```

### Workspace Files
- `SOUL.md` - Minimal instruction (1 line)
- `IDENTITY.md` - Basic info (name, emoji)
- `USER.md` - Basic user context
- `HEARTBEAT.md` - Empty
- `TOOLS.md` - Project notes
- `AGENTS.md` - **DELETED** (was causing confusion)

---

## What We Think Might Be Wrong

### Hypothesis 1: OpenClaw's Prompt Construction
OpenClaw might be constructing prompts that include:
- System messages that tell the model to "analyze" or "format" messages
- Context that includes message metadata in a way that triggers analysis mode
- Instructions that override our workspace files

**Evidence:** Even with minimal workspace files, the behavior persists.

### Hypothesis 2: OpenClaw's Default System Prompt
OpenClaw might have a hardcoded system prompt that we can't override, or it's adding instructions that cause meta-analysis.

**Evidence:** We've tried everything in workspace files, but behavior doesn't change.

### Hypothesis 3: Message Format/Context Injection
OpenClaw might be sending messages to the model in a format like:
```
"Here is a Telegram message: [Telegram S O (@StanOwens) id: 5772950940] Hello mate."
```
This format might trigger the model to analyze rather than respond.

**Evidence:** The responses show the model is seeing message metadata and runtime status.

### Hypothesis 4: Model Provider Configuration
Using `openai` provider name with Ollama might cause OpenClaw to format prompts differently than expected.

**Evidence:** We're using OpenAI-compatible API but with local Ollama - might be a mismatch.

---

## What We Haven't Tried (Due to Uncertainty)

1. **OpenClaw system prompt override** - Don't know if/how to override default system prompts
2. **Different provider configuration** - Not sure if there's a better way to configure Ollama
3. **OpenClaw source code inspection** - Haven't looked at how it constructs prompts
4. **OpenClaw version issue** - Using v2026.1.30, might be a bug in this version
5. **Workspace file location/format** - Maybe OpenClaw expects different file structure

---

## Technical Details

### Server
- **Hostname:** Optimus
- **OS:** Ubuntu 24.04
- **IP:** 192.168.0.121 (local)
- **CPU:** AMD Ryzen 5 5600 (6 cores)
- **RAM:** 31GB total, ~25GB available
- **GPU:** NVIDIA RTX 3080 (10GB VRAM) - enabled

### OpenClaw Logs
- Location: `/tmp/openclaw/openclaw-2026-02-02.log`
- Shows: Model is `openai/mistral:latest`, runs complete, but responses are meta-analysis
- Duration: ~3-5 seconds per response (acceptable speed)

### Ollama Logs
- Container: `legion-ollama`
- Direct API test: Works fine, natural responses
- Through OpenClaw: Meta-analysis responses

---

## Questions for Guidance

1. **Is this a known OpenClaw issue?** Has anyone else experienced meta-analysis instead of natural responses?

2. **How does OpenClaw construct prompts?** What system messages does it add? Can we override them?

3. **Is our Ollama configuration correct?** Using `openai` provider name with Ollama's OpenAI-compatible API - is this the right approach?

4. **Are workspace files being read correctly?** We've simplified to minimal files, but behavior doesn't change.

5. **Is there a system prompt configuration we're missing?** OpenClaw docs don't clearly show how to override default prompts.

6. **Could this be a version bug?** v2026.1.30 - should we try a different version?

7. **Should we use a different provider name?** Instead of `openai`, is there an `ollama` provider or better way to configure?

8. **What's the correct way to use local Ollama with OpenClaw?** Our setup follows OpenAI-compatible API pattern, but maybe there's a better way.

---

## What We Need

**Primary Goal:** Get OpenClaw to respond naturally to messages instead of analyzing them.

**Secondary Goals:**
- Remote Cursor project management (not yet implemented)
- Fast response times (currently 3-5 seconds, acceptable)
- "Friend" quality conversation (can't test until meta-analysis is fixed)

---

## Summary

**Setup:** OpenClaw v2026.1.30 + local Ollama (Mistral 7B) + Telegram  
**Problem:** Meta-analysis instead of natural conversation  
**What we've tried:** Everything in workspace files, model switching, config fixes  
**What works:** Direct Ollama testing (model is fine)  
**What doesn't work:** OpenClaw's responses (always meta-analysis)  
**Presupposition:** Our setup is correct; this is likely an OpenClaw configuration or prompt construction issue

**We need guidance on:**
- How OpenClaw constructs prompts
- How to override system prompts
- Correct Ollama configuration with OpenClaw
- Whether this is a known issue or bug

---

**Last Updated:** February 2, 2026, 00:53 AEDT  
**Prepared For:** Seeking expert guidance on OpenClaw prompt construction and Ollama integration
