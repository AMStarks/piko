# Root Cause Found: AGENTS.md Still Being Injected

**Date:** February 2, 2026, 01:02 AEDT  
**Critical Discovery:** Context breakdown reveals AGENTS.md (7,804 chars) is still being injected

---

## The Problem

**Context breakdown shows:**
- `AGENTS.md`: **7,804 chars** being injected (HUGE!)
- `TOOLS.md`: 850 chars (we thought we deleted it)
- `HEARTBEAT.md`: 167 chars (we thought we deleted it)
- Total "Project Context": **10,813 chars**

**This is the root cause!** AGENTS.md is a massive file with instructions that's confusing the model.

---

## Why This Happened

We deleted AGENTS.md earlier, but:
1. It may have been recreated by OpenClaw
2. Or it was in a different location
3. Or the deletion didn't persist

The context breakdown proves it's still there and being injected.

---

## Fix Applied

**Deleted:**
- `AGENTS.md` (7,804 chars - the main culprit)
- `TOOLS.md` (850 chars)
- `HEARTBEAT.md` (167 chars)

**Kept (minimal):**
- `SOUL.md` (497 chars - aggressive instructions)
- `IDENTITY.md` (632 chars - basic info)
- `USER.md` (478 chars - basic context)

**Expected result:** Context should drop from 10,813 chars to ~1,600 chars (just SOUL + IDENTITY + USER)

---

## Next Test

1. Send `/new` via Telegram (fresh session)
2. Send `Hey mate`
3. Check response

**Expected:** Natural response, no Python code, no JSON analysis

**If still fails:** The issue is deeper in OpenClaw's prompt construction (Telegram adapter or version bug)

---

**Status:** AGENTS.md deleted, gateway restarted. Ready for test.
