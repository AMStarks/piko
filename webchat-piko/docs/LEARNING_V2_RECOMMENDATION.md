# Recommendation: pressing forward after v2.0 and formalisation feedback

You have two inputs:

1. **Piko Learning System v2.0** — Extension with persistent `piko-memory.json`, multi-horizon goals, explicit **critique → plan → act** cycle, and commands (`/goals`, `/memory`, `/experiments`, `/cycle`).
2. **Formalisation** — A strict definition of learning (four primitives, one loop, two layers, verification levels, guardrails) with no new features; it documents and tightens what you already have.

---

## Recommendation in three steps

### Step 1: Lock the current system in writing (now)

- Treat the **formalisation** as the single source of truth for “what learning is” and “what Piko is allowed to do.”
- **Done:** Added **`webchat-piko/docs/LEARNING.md`** that captures it (primitives, loop, signal guard, two layers, verification, guardrails, files).
- **Next:** Run the **existing** observe → reflect (journal) → act (post) loop for **another 1–2 weeks** and use the **four verification levels** in LEARNING.md to check that learning is real (journal entries when signal changes; journal content influencing next posts; optional refinement approval).
- **Do not** implement full v2.0 yet. You already have journals and the loop; the formalisation gives you a clear contract and a way to verify it.

### Step 2: Verify, then decide (after 1–2 weeks)

- **If Level 1–2 hold** (journal exists and seems to affect posts): you have confirmed learning. You can stop here or move to Step 3.
- **If journals feel empty:** Increase signal (e.g. relax guard slightly or ensure cron/engagement are stable).
- **If journals feel noisy:** Tighten the signal guard or prompt.
- **If refinement proposals feel obvious:** That’s a sign the system is working; keep using approve/reject to consolidate.

### Step 3: Optional incremental v2.0 (only if you want more structure)

If you want **goal-tracking and a planning horizon** without a big redesign:

- **Phase A:** Add **`data/piko-memory.json`** with a **minimal** schema: e.g. `goals` (immediate/week/month/aim) and `metrics` (totalPosts, last10Avg, etc.) updated each cycle. No new prompts yet; just load/store from the existing poster and optionally display on Control.
- **Phase B:** Add a single **`/goals`** command (read current goals; optionally “set immediate” or “set week” with your approval). No automatic critique/plan LLM step yet.
- **Phase C (only if A–B are stable):** Introduce a **critique** step (one short prompt: “Given last post and engagement, one sentence: what to try next?”) and feed that into the post prompt. Keep output natural language, not rigid JSON.
- **Defer:** Full v2.0 (explicit critique→plan JSON, multiple new commands, nightly “full memory cleanup”) until the minimal memory + /goals + optional critique are running and useful.

This gives you **persistent goals and metrics** and a **single human-facing command** without committing to the full v2.0 prompt chain and JSON contract.

---

## Why not implement full v2.0 immediately

- v2.0 adds a new file, several new prompts (critique, plan), JSON outputs, and four new commands. That’s a lot of surface area and failure modes (e.g. JSON parse failures, prompt drift).
- Your **current** system already matches the formalisation: observe → signal guard → reflect (journal) → act. The formalisation document is there to make that contract explicit and to give you verification levels. Adding v2.0 on top before verifying the current loop is riskier than: (1) lock the contract in LEARNING.md, (2) verify with the four levels, (3) add one slice of v2.0 at a time if you still want more structure.

---

## Summary

| Action | When |
|--------|------|
| **Use LEARNING.md as the learning contract** | Now (done). |
| **Run existing loop, verify with four levels** | Next 1–2 weeks. |
| **Full v2.0 (critique→plan, /goals, /memory, etc.)** | Defer. |
| **Optional minimal v2.0 (memory.json + /goals, then maybe one critique prompt)** | Only after verification, if you want more structure. |

So: **press forward by formalising and verifying.** Treat LEARNING.md as the canonical description of Piko’s learning. Use the verification levels to confirm the current system is learning. Add v2.0-style features only incrementally and only if you still want goal-tracking and explicit planning after that.
