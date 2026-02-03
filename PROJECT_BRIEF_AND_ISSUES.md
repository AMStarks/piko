# OpenClaw Project Brief & Issues Report

**Date:** February 2, 2026  
**Project:** OpenClaw Setup on Optimus Server for Remote Cursor Project Management  
**Status:** Partially functional, multiple issues resolved, core functionality needs verification

---

## PROJECT GOALS

### Primary Objective
Set up OpenClaw (self-hosted AI assistant) on personal server (Optimus) to:
1. **Keep Cursor projects running autonomously** while away from computer
2. **Interact via iPhone** using messaging app (WhatsApp/Telegram)
3. **Control Cursor on MacBook** remotely through OpenClaw
4. **Eventually become "a friend"** - conversational AI with nuance, not just a tool

### Architecture
```
iPhone (WhatsApp/Telegram) 
  → OpenClaw (Optimus server)
    → Ollama (local LLM, free)
      → Cursor CLI (via SSH to MacBook)
        → Project updates/code changes
```

### Key Requirements
- **FREE** - Use local Ollama, no paid APIs
- **Privacy** - All processing on personal server
- **Conversational** - Model should have "friend" quality, not just functional
- **Remote control** - Manage Cursor projects from phone
- **Autonomous** - Continue project work while away

---

## WHAT WE'VE ACCOMPLISHED

### ✅ Completed Setup Steps

1. **OpenClaw Installation**
   - Installed OpenClaw v2026.1.30 on Optimus server
   - Upgraded Node.js from v20.19.6 to v22.22.0 (required)
   - Configured gateway on port 8081 (8080 was in use by Nginx)
   - Set up systemd service (`openclaw-gateway.service`)

2. **Ollama Integration (FREE Option)**
   - Discovered Ollama already running on server in Docker
   - Configured OpenClaw to use Ollama's OpenAI-compatible API
   - Endpoint: `http://localhost:11434/v1`
   - Models available: `llama3.1:latest` (8B), `llama3.2:latest` (3B), `mistral:latest` (7B)

3. **Model Configuration**
   - Initially tried `mistral-large:latest` (123B) - **FAILED** (needs 69GB RAM, only 29GB available)
   - Switched to `llama3.1:latest` (8B) - too slow on CPU
   - Currently using `llama3.1:latest` (8B) - better quality than 3B
   - Tested `llama3.2:latest` (3B) - faster but less capable

4. **Telegram Channel Setup**
   - Created Telegram bot via BotFather
   - Added bot token to OpenClaw
   - Approved pairing code
   - Channel is connected and receiving messages

5. **GPU Configuration**
   - Detected NVIDIA RTX 3080 (10GB VRAM)
   - Fixed driver/library version mismatch (rebooted server)
   - Enabled GPU runtime in Docker Compose
   - Ollama container has GPU access
   - GPU is working (3GB VRAM in use, 90% utilization during inference)

6. **Workspace Configuration**
   - Removed `BOOTSTRAP.md` (was causing meta-analysis responses)
   - Configured workspace files (SOUL.md, IDENTITY.md, USER.md)
   - Fixed config format errors

---

## TECHNICAL SETUP

### Server Specifications
- **Hostname:** Optimus
- **OS:** Ubuntu 24.04
- **IP:** 192.168.0.121 (local), 114.73.209.140:2222 (external)
- **CPU:** AMD Ryzen 5 5600 (6 cores, 12 threads)
- **RAM:** 31GB total, ~25GB available
- **GPU:** NVIDIA GeForce RTX 3080 (10GB VRAM)
- **SSH Key:** `~/.ssh/id_optimus`

### Current Configuration

**OpenClaw:**
- Version: 2026.1.30
- Gateway: Port 8081, running as systemd service
- Model: `openai/mistral:latest` (configured as "openai" provider, but using local Ollama)
- Workspace: `/root/.openclaw/workspace`
- Config: `/root/.openclaw/openclaw.json`

**Ollama (Local, FREE - NOT using Anthropic/OpenAI APIs):**
- Running in Docker container (`legion-ollama`)
- URL: `http://localhost:11434/v1` (OpenAI-compatible API endpoint)
- **Provider Configuration:** Using OpenClaw's `openai` provider name because Ollama provides OpenAI-compatible API
- **API Key:** `"ollama"` (placeholder, not actually used by Ollama)
- **Important:** We are using **LOCAL OLLAMA with Mistral 7B**, NOT Anthropic Claude or OpenAI GPT
- GPU: Enabled (RTX 3080, 3GB VRAM in use)
- Models: `mistral:latest` (7B, 4.4GB) - **currently active**, `llama3.1:latest` (8B), `llama3.2:latest` (3B)

**Telegram:**
- Bot token configured
- Pairing approved
- Channel active

---

## ISSUES ENCOUNTERED & RESOLUTIONS

### Issue #1: Node.js Version Mismatch ✅ RESOLVED
**Problem:** OpenClaw requires Node.js v22+, but v20.19.6 was installed  
**Resolution:** Installer automatically upgraded to v22.22.0  
**Status:** ✅ Fixed

---

### Issue #2: Gateway Port Conflict ✅ RESOLVED
**Problem:** Port 8080 already in use by Nginx  
**Resolution:** Changed gateway port to 8081 in config and systemd service  
**Status:** ✅ Fixed

---

### Issue #3: Model Too Large (RAM Constraint) ✅ RESOLVED
**Problem:** `mistral-large:latest` (123B) requires 69GB RAM, only 29GB available  
**Error:** `model requires more system memory (69.4 GiB) than is available (29.1 GiB)`  
**Resolution:** Switched to `llama3.1:latest` (8B, 4.9GB) which fits in RAM  
**Status:** ✅ Fixed

---

### Issue #4: Model Validation Errors ✅ RESOLVED
**Problem:** OpenClaw didn't recognize Ollama models (`Unknown model: openai/mistral:latest`)  
**Root Cause:** OpenClaw's internal model registry didn't include Ollama models  
**Resolution:** Added explicit model definitions in `models.providers.openai` section of config  
**Status:** ✅ Fixed

---

### Issue #5: Context Window Too Small ✅ RESOLVED
**Problem:** `Model context window too small (8192 tokens). Minimum is 16000.`  
**Resolution:** Updated `contextWindow` to 16000 and `maxTokens` to 8000 (later reduced to 512)  
**Status:** ✅ Fixed

---

### Issue #6: API Key Not Found ✅ RESOLVED
**Problem:** `No API key found for provider "openai"`  
**Root Cause:** Auth profile not copied to agent directory  
**Resolution:** Copied `auth-profiles.json` from `~/.openclaw/identity/` to `~/.openclaw/agents/main/agent/`  
**Status:** ✅ Fixed

---

### Issue #7: GPU Driver/Library Version Mismatch ✅ RESOLVED
**Problem:** `Failed to initialize NVML: Driver/library version mismatch`  
- Kernel module: 580.95.05
- Libraries: 580.126.09
- Ollama couldn't use GPU

**Resolution:**
- Rebooted server to sync driver versions
- Enabled GPU runtime in Docker Compose
- Verified GPU access in container

**Status:** ✅ Fixed (GPU now working)

---

### Issue #8: Extremely Slow Response Times ⚠️ PARTIALLY RESOLVED
**Problem:** 
- Initial responses: 3-5 minutes
- Simple greetings: 8-10 seconds (after optimizations)
- User experience: Unacceptable delays

**Root Causes:**
1. **CPU-only inference** - Initially no GPU acceleration
2. **Model size** - 8B model on CPU is fundamentally slow
3. **OpenClaw overhead** - Adds 20-30 seconds per request
4. **Cold starts** - First request loads model (~45 seconds)

**Solutions Applied:**
1. ✅ Enabled GPU (should help, but performance still similar to CPU)
2. ✅ Switched to `llama3.1:latest` (8B) - better than 3B for quality
3. ✅ Reduced `maxTokens` to 512 for faster responses

**Current Performance:**
- Warm responses: ~8-10 seconds
- GPU utilization: 90% during inference
- VRAM usage: 3GB/10GB

**Status:** ⚠️ Improved but still slow
- GPU is working but not providing expected speedup
- Likely due to small model size (8B) - GPU benefits larger models more
- Architecture (OpenClaw + Ollama) adds overhead

---

#### Issue #9: Meta-Analysis Instead of Conversation ❌ **CRITICAL - NOT RESOLVED**
**Problem:** OpenClaw responds with analysis of message format/structure instead of natural conversation  
**Example Response:** "Here is the content of the provided text, formatted for easier reading: [code block with runtime status and message log] This text appears to be the runtime status and a message received on Telegram..."

**What We've Tried (ALL FAILED):**
1. ❌ Deleted `BOOTSTRAP.md` from workspace
2. ❌ Switched models: `llama3.2:latest` (3B) → `llama3.1:latest` (8B) → `mistral:latest` (7B)
3. ❌ Rewrote `SOUL.md` with explicit "don't analyze" instructions
4. ❌ Deleted ALL workspace files except minimal `SOUL.md`
5. ❌ Fixed config format (model field structure)
6. ✅ Verified model works fine when tested directly via Ollama CLI

**Evidence Model Works:**
- Direct Ollama test: `ollama run mistral:latest "Hello"` → Natural response ✅
- Through OpenClaw: Same model → Meta-analysis ❌

**Root Cause Hypothesis:**
- OpenClaw's prompt construction is likely the issue
- May be injecting system prompts that trigger analysis mode
- Or formatting messages in a way that causes model to analyze rather than respond
- Workspace files don't seem to affect behavior (tried everything)

**Status:** ❌ **CRITICAL - Blocking all functionality**
- Cannot test conversation quality
- Cannot proceed with Cursor integration
- Cannot achieve "friend" goal
- See `OPENCLAW_META_ANALYSIS_ISSUE.md` for detailed analysis

---

### Issue #10: Config Format Error ✅ RESOLVED
**Problem:** Gateway failed to start after model change  
**Error:** `agents.defaults.model: Invalid input: expected object, received string`  
**Resolution:** Fixed model field to be object `{"primary": "openai/llama3.1:latest"}` instead of string  
**Status:** ✅ Fixed

---

### Issue #11: WhatsApp Channel Issues ⚠️ WORKAROUND
**Problem:** 
- WhatsApp Web connection requires interactive terminal for QR code
- User wanted it to appear as "actual contact" (not possible with WhatsApp Web)
- Network issues (`getaddrinfo EAI_AGAIN web.whatsapp.com`)

**Resolution:** Switched to Telegram (creates actual bot contact)  
**Status:** ⚠️ Telegram working, WhatsApp abandoned

---

### Issue #12: Model Quality vs. Hardware Constraints ⚠️ ONGOING
**Problem:** Balancing model quality (for "friend" nuance) with hardware constraints

**Available Models:**
- `llama3.1:70b` - Best quality, needs 45GB RAM (don't have)
- `mistral-large:latest` - Great quality, needs 69GB RAM (don't have)
- `llama3.1:latest` (8B) - Good quality, fits RAM, but slower
- `llama3.2:latest` (3B) - Fast, but less nuanced
- `mistral:latest` (7B) - Alternative option

**Current Choice:** `llama3.1:latest` (8B) - compromise between quality and speed

**Status:** ⚠️ Ongoing trade-off
- Larger models would be better for "friend" quality
- Hardware constraints limit options
- May need to accept current quality or upgrade hardware

---

## CURRENT STATE

### ✅ What's Working
- OpenClaw gateway running (port 8081)
- Ollama integrated and responding
- GPU enabled and accessible
- Telegram channel connected
- Config validated and correct
- Workspace cleaned (BOOTSTRAP.md removed)
- Model responding (though quality needs testing)

### ❌ **CRITICAL BLOCKER**
- **Meta-analysis issue** - OpenClaw analyzes messages instead of responding naturally
- **Cannot test conversation quality** - All responses are meta-analysis
- **Cannot proceed** - This blocks all functionality until resolved

### ❌ What's Not Working / Missing
- **Cursor integration** - `cursor-agent` skill not installed
- **SSH to MacBook** - Not configured
- **End-to-end workflow** - Can't actually control Cursor projects yet
- **WhatsApp channel** - Abandoned in favor of Telegram
- **Performance** - Still slower than desired (8-10 seconds)

---

## PERFORMANCE METRICS

### Response Times
- **Cold start (first request):** ~45 seconds (model loading)
- **Warm responses:** ~8-10 seconds
- **Direct Ollama test (llama3.1):** ~3 minutes (CPU-only, before GPU)
- **Direct Ollama test (llama3.2):** ~14 seconds (CPU-only)
- **With GPU (llama3.1):** ~8-10 seconds (similar to CPU - unexpected)

### Resource Usage
- **GPU:** RTX 3080, 3GB/10GB VRAM in use, 90% utilization during inference
- **RAM:** ~25GB available, model uses ~5GB
- **CPU:** AMD Ryzen 5 5600 (6 cores)

### Bottlenecks
1. **Model size** - 8B on CPU/GPU is still relatively slow
2. **OpenClaw overhead** - Adds processing time
3. **Architecture complexity** - Multiple layers (Telegram → OpenClaw → Ollama → Response)

---

## WHAT HELP IS NEEDED

### Primary Questions

1. **Why is GPU not providing expected speedup?**
   - GPU is enabled and working (90% utilization, 3GB VRAM)
   - Performance similar to CPU (~8-10 seconds)
   - Expected: 1-3 seconds with GPU
   - **Question:** Is this normal for 8B models, or is something misconfigured?

2. **Is 8-10 seconds acceptable, or should we optimize further?**
   - Current: 8-10 seconds per response
   - User expectation: Not specified, but likely wants faster
   - **Question:** Should we accept this, switch to smaller model, or optimize architecture?

3. **Model quality for "friend" use case**
   - Current: `llama3.1:latest` (8B)
   - Goal: Conversational AI with nuance, personality
   - **Question:** Is 8B model sufficient, or do we need larger model (requiring hardware upgrade)?

4. **Architecture optimization**
   - Current: Telegram → OpenClaw → Ollama → Response
   - Overhead: OpenClaw adds 20-30 seconds
   - **Question:** Should we simplify architecture (direct Telegram bot + Ollama), or keep OpenClaw for its features?

5. **Cursor integration path forward**
   - Missing: `cursor-agent` skill installation
   - Missing: SSH configuration to MacBook
   - **Question:** What's the best approach to integrate Cursor CLI with OpenClaw?

### Specific Technical Questions

1. **GPU Performance:**
   - Why is RTX 3080 only providing marginal speedup?
   - Is 8B model too small to benefit from GPU?
   - Should we try larger quantized models?

2. **Model Selection:**
   - Should we try `mistral:latest` (7B) instead of `llama3.1:latest` (8B)?
   - Are there quantized 70B models that would fit in 25GB RAM?
   - What's the best model for "friend" quality within hardware constraints?

3. **OpenClaw Configuration:**
   - Are there performance tuning options we're missing?
   - Should we adjust `maxTokens`, `contextWindow`, or other parameters?
   - Is there a way to reduce OpenClaw overhead?

4. **Architecture:**
   - Should we build a lightweight alternative (direct Telegram bot)?
   - Or optimize current OpenClaw setup?
   - What are the trade-offs?

---

## FILES & DOCUMENTATION

### Key Files Created
- `openclaw-setup.sh` - Automated setup script
- `OPTIMUS_OPENCLAW_SETUP.md` - Setup guide
- `OLLAMA_SETUP.md` - Ollama integration guide
- `TOP_10_MODELS_FRIEND_NUANCE.md` - Model comparison
- `OPENCLAW_ROOT_CAUSE_ANALYSIS.md` - Performance analysis
- `GPU_DRIVER_FIX.md` - GPU troubleshooting
- `OPENCLAW_ISSUES_SUMMARY.md` - Issues summary
- `PROJECT_BRIEF_AND_ISSUES.md` - This document

### Configuration Files (on server)
- `/root/.openclaw/openclaw.json` - Main config
- `/root/.openclaw/workspace/` - Workspace files
- `/opt/legion/docker-compose.yml` - Ollama Docker config

---

## NEXT STEPS (Pending Guidance)

1. **URGENT: Fix meta-analysis issue** - OpenClaw must respond naturally, not analyze messages
   - Need to understand how OpenClaw constructs prompts
   - Need to know if we can override system prompts
   - Need to verify Ollama configuration is correct
2. **Test conversation quality** - Once meta-analysis is fixed
3. **Investigate GPU performance** - Why not faster? (secondary priority)
4. **Decide on architecture** - Keep OpenClaw or simplify? (depends on #1)
5. **Model selection** - Is 7B sufficient or need larger? (can't evaluate until #1 fixed)
6. **Install cursor-agent skill** - Enable Cursor integration (blocked by #1)
7. **Configure SSH to MacBook** - Enable remote Cursor control (blocked by #1)

---

## SUMMARY

**Project Status:** Partially functional, needs optimization and completion

**Key Achievements:**
- ✅ OpenClaw installed and running
- ✅ Ollama integrated (free, local)
- ✅ Telegram channel working
- ✅ GPU enabled
- ✅ Most configuration issues resolved

**Key Challenges:**
- ❌ **CRITICAL: Meta-analysis instead of conversation** - OpenClaw analyzes messages instead of responding
- ⚠️ Response times still slow (8-10 seconds) - but can't test properly due to meta-analysis
- ⚠️ GPU not providing expected speedup
- ⚠️ Model quality vs. hardware constraints - can't evaluate due to meta-analysis
- ❌ Cursor integration not yet implemented
- ❌ End-to-end workflow not tested

**Critical Questions:**
1. **Why is OpenClaw doing meta-analysis?** - Model works fine directly, so it's OpenClaw's prompt construction
2. **How does OpenClaw construct prompts?** - What system messages does it add?
3. **Can we override OpenClaw's system prompts?** - Workspace files don't seem to help
4. **Is our Ollama configuration correct?** - Using `openai` provider name with Ollama's OpenAI-compatible API
5. **Is this a known OpenClaw bug?** - v2026.1.30 - should we try different version?

---

**Last Updated:** February 2, 2026, 00:53 AEDT  
**Prepared For:** Seeking expert guidance on OpenClaw meta-analysis issue and Ollama integration

**See Also:** `OPENCLAW_META_ANALYSIS_ISSUE.md` for detailed analysis of the critical meta-analysis problem
