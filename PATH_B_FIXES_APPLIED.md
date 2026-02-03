# Path B Fixes Applied (Internal Test Loop)

**Date:** 2026-02-02  
**Goal:** Agent replies naturally on Telegram (no meta, no TTS/placeholder). Internal test → review → fix → repeat until working.

---

## Changes Made

### 1. Workspace: minimal stubs instead of delete-only

OpenClaw was **recreating** AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md (7k+ chars) after each gateway restart. Deleting them only worked until the next start.

**Fix:** Replaced them with **minimal one-line stubs** so OpenClaw doesn’t overwrite with long defaults:

- `AGENTS.md` → `# See SOUL.md and IDENTITY.md.` (31 bytes)
- `HEARTBEAT.md` → `# No heartbeat tasks.` (22 bytes)
- `TOOLS.md` → `# Local notes only.` (20 bytes)
- `USER.md` → `# User: friend.` (16 bytes)

Total injected workspace is now ~850 chars instead of 10k+.

### 2. bootstrapMaxChars

Set `agents.defaults.bootstrapMaxChars` to **2000** in `/root/.openclaw/openclaw.json` so injected context is capped even if any file grows.

### 3. SOUL.md rules 4 and 5

- **Rule 4:** Do NOT say you converted text to speech, created audio, or provide placeholder links. Plain text only; no TTS in this chat.
- **Rule 5:** If asked “what can you do?”, say you’re a chat companion and can help with questions and conversation. Do NOT list TTS, audio, or features that involve links/placeholders. Keep the answer short and plain text only.

(Stops the model from “listing” TTS as a capability and then “doing” it when the user says Hello.)

### 4. Script: apply-workspace-stubs.sh

Added `scripts/path-b-openclaw-deploy/apply-workspace-stubs.sh`. On Optimus, after a gateway restart you can run:

```bash
cd /root/path-b-openclaw-deploy && ./apply-workspace-stubs.sh
```

to re-apply minimal stubs if OpenClaw overwrote them.

---

## Internal Test Results

| Test | Result |
|------|--------|
| Workspace after restart | Stubs stayed (AGENTS.md 31 bytes, etc.). No 7k default. |
| `openclaw agent --agent main --message "Hello"` | **Pass:** "Hello! How can I assist you today?" (~15–22 s). |
| `openclaw agent --agent main --message "What can you do?"` | Not re-tested to completion (timeout); rule 5 added to avoid listing TTS. |

---

## What You Should Do

1. **Test on Telegram:** Send “Hello” and then “What can you do?”. You should get short, plain-text replies with no TTS, no placeholder links, no “I have converted your text to speech.”
2. **If workspace gets overwritten again:** SSH to Optimus and run:
   ```bash
   cd /root/path-b-openclaw-deploy && chmod +x apply-workspace-stubs.sh && ./apply-workspace-stubs.sh
   systemctl --user restart openclaw-gateway.service
   ```
3. **If the agent still invents TTS/placeholders:** We can add one more SOUL line, e.g. “Never mention converting text to speech, audio files, or links to listen. You only send text messages.”

---

## Summary

- **Workspace:** Minimal stubs applied; bootstrapMaxChars 2000.
- **SOUL:** Rules 4 and 5 added (no TTS/placeholders; “what can you do” = chat companion only).
- **CLI test:** “Hello” returns a natural greeting.
- **Telegram:** Please re-test; the same agent and SOUL are used for Telegram.
