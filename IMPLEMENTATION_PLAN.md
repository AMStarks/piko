# OpenClaw Meta-Analysis Fix - Implementation Plan

**Date:** February 2, 2026  
**Based on:** Expert feedback from Grok, Anthropic, and ChatGPT  
**Status:** Implementing fixes

---

## Synthesis of Expert Feedback

### Key Consensus Points

1. **Root Cause:** OpenClaw's prompt construction is wrapping messages as "documents to analyze" rather than conversational turns
2. **Not a Model Issue:** Model works fine directly - proven conclusively
3. **Not a Config Issue:** Ollama setup is correct
4. **Likely Causes:**
   - OpenClaw's system prompt injection (workspace files under "Project Context")
   - Telegram adapter mis-classifying messages as structured events
   - Possible v2026.1.30 regression

### Recommended Fixes (Prioritized)

1. **Aggressive SOUL.md rewrite** - Strong, explicit instructions
2. **Config tweaks** - Reduce bootstrap injection, aggressive compaction
3. **Switch to llama3.1** - Better instruction following than Mistral 7B
4. **Inspect actual prompts** - Use `/context detail` to see what's being sent
5. **Test with `/new`** - Fresh session to clear context

---

## Implementation Steps

### ✅ Step 1: Aggressive SOUL.md Rewrite
**Action:** Replace SOUL.md with explicit, aggressive instructions  
**Status:** ✅ Complete

### ✅ Step 2: Remove Noise Files
**Action:** Delete TOOLS.md, HEARTBEAT.md (add noise)  
**Status:** ✅ Complete

### ✅ Step 3: Config Tweaks
**Action:** Add `bootstrapMaxChars: 8000` and `compaction: {mode: "aggressive"}`  
**Status:** ✅ Complete

### ✅ Step 4: Switch to Llama3.1
**Action:** Change model from `mistral:latest` to `llama3.1:latest`  
**Status:** ✅ Complete

### ✅ Step 5: Restart Gateway
**Action:** Restart service to apply changes  
**Status:** ✅ Complete

### ⏳ Step 6: Test and Inspect
**Action:** 
1. Send `/new` via Telegram (fresh session)
2. Send "Hello mate"
3. Check response
4. If still meta-analysis, use `/context detail` to inspect prompt

**Status:** ⏳ Pending user test

---

## Next Actions (If Still Fails)

### Option A: Inspect Actual Prompt
- Send `/context detail` via Telegram after a failed message
- Check logs: `openclaw logs --follow` or `/tmp/openclaw/openclaw-2026-02-02.log`
- Look for prompt structure in JSONL entries

### Option B: Bypass Telegram
- Test if OpenClaw has CLI input or HTTP endpoint
- If direct input works but Telegram doesn't → Telegram adapter bug

### Option C: Version Check
- Try downgrading to version before 2026.1.30
- Or upgrade to latest if available
- Check OpenClaw GitHub issues for similar reports

---

## Expected Outcome

**If fixes work:**
- Natural response to "Hello mate" → "Hello! How can I help you?"
- No meta-analysis
- Can proceed with Cursor integration

**If still fails:**
- Need to inspect actual prompt structure
- Likely Telegram adapter bug or version regression
- May need OpenClaw maintainer help

---

**Last Updated:** February 2, 2026, 00:55 AEDT
