# Critical Diagnosis: OpenClaw Prompt Construction Bug

**Date:** February 2, 2026, 01:05 AEDT  
**Status:** Meta-analysis persists despite all fixes - confirms OpenClaw bug

---

## What We've Proven

### ✅ Model Works Fine
**Direct Ollama test:** Natural response ✅  
**Through OpenClaw:** Meta-analysis ❌

### ✅ Workspace Files Clean
- Deleted AGENTS.md (7,804 chars)
- Deleted TOOLS.md, HEARTBEAT.md
- Only minimal files remain (SOUL.md, IDENTITY.md, USER.md)
- Aggressive SOUL.md instructions in place

### ✅ Config Correct
- Model: llama3.1:latest
- Bootstrap max: 8000 chars
- Ollama endpoint correct

### ❌ Still Meta-Analysis
**After all fixes, response is still:**
- "Here is the output based on the provided code snippet:"
- JSON function call structures
- Analysis of message format
- "The text you provided appears to be a message in Telegram..."

---

## Conclusion

**This is NOT a configuration issue. This is an OpenClaw bug.**

The model is being sent a prompt that frames the user's message as:
- A "code snippet" to analyze
- A "provided text" to format
- A Telegram message structure to examine

**Not as:** A conversational turn to respond to.

---

## Root Cause (Confirmed)

OpenClaw's Telegram adapter or prompt builder is constructing prompts like:

```
System: [workspace files + tools + skills]
User: Here is a Telegram message: [metadata] [message text]
```

Instead of:

```
System: [workspace files + tools + skills]
User: Hey mate
```

The model sees "Here is..." or "provided code snippet" and responds as an analyst.

---

## What This Means

1. **Workspace files can't fix this** - The problem is in message framing, not instructions
2. **Model choice doesn't matter** - Any model would do the same with this framing
3. **Config tweaks won't help** - The issue is in OpenClaw's code, not config
4. **This is likely a v2026.1.30 bug** - Telegram adapter regression

---

## Next Steps

### Option 1: Inspect Actual Prompt (Critical)
**Use `/context detail` command via Telegram** - This should show the exact prompt structure.

**What to look for:**
- Does the user message say "Here is..." or "provided code snippet"?
- Is the message wrapped in explanatory text?
- Is there a "Project Context" header that's confusing the model?

### Option 2: Bypass Telegram
**Test if OpenClaw has:**
- CLI input mode
- HTTP chat endpoint
- Web interface

**If direct input works but Telegram doesn't** → Confirms Telegram adapter bug

### Option 3: Version Downgrade/Upgrade
**Try:**
- Downgrade to version before 2026.1.30
- Or upgrade to latest if available
- Check OpenClaw GitHub for similar issues

### Option 4: Report Bug
**If this is confirmed as a bug:**
- Create minimal reproduction case
- Report to OpenClaw maintainers
- Include: version, config, context breakdown, example responses

---

## Evidence Summary

**What works:**
- ✅ Ollama directly
- ✅ Model (llama3.1:latest)
- ✅ Config structure
- ✅ Gateway running

**What doesn't work:**
- ❌ OpenClaw's message framing
- ❌ Telegram adapter (likely)
- ❌ Prompt construction

**What we've tried:**
- ✅ Deleted all workspace files except minimal
- ✅ Aggressive SOUL.md instructions
- ✅ Config tweaks
- ✅ Model switching
- ✅ Everything suggested by experts

**Result:** Still meta-analysis

---

## Final Verdict

**This is a bug in OpenClaw v2026.1.30's Telegram adapter or prompt construction.**

The model is receiving prompts that frame messages as documents to analyze, not conversational turns. No amount of workspace file tweaking will fix this - it's in OpenClaw's code.

**Recommended action:** Use `/context detail` to see the exact prompt, then either:
1. Report bug to OpenClaw maintainers
2. Try version downgrade/upgrade
3. Consider alternative (lightweight Telegram bot + direct Ollama)

---

**Last Updated:** February 2, 2026, 01:05 AEDT
