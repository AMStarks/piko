# Piko learning — improvements

Concrete improvements, ordered by impact vs effort. All stay within the current contract (LEARNING.md): no self-rewriting, no hidden state, human-only strategic changes.

---

## 1. Phase B: external feedback signals (high impact, medium effort)

**Why:** Engagement is sparse and lagging. Critique and journal often have little to react to, so they repeat. You already have a clear spec in `PIKO_LEARNING_PHASE_B_SPEC.md`.

**What:** Implement tagged feedback (`clarity`, `tooLong`, `goodQuestions`, `tooAbstract`, `moreExamples`) and one-tap commands in chat: `/++ <signal>`, `/-- <signal>`. Poster reads `data/moltbook-feedback.json` and injects “Human feedback signals: clarity 2, tooLong 1, …” into the journal prompt. No reset in v1 (cumulative counts).

**Result:** Dense, immediate signal for Piko without writing refinements. Journal and “What I’ll try next” get a real lever; critique has something besides engagement to work with.

**Checklist:** See Phase B spec §8 (feedback file, read in poster, journal prompt block, server handlers, whitelist, .gitignore; optional Control card).

---

## 2. Ensure Phase A runs more often (medium impact, low effort)

**Why:** Self-eval only runs when `plannedForNext` is non-empty. Today that comes only from `nextExperiments[0]`. If critique failed or experiments are empty, the cycle entry has no `followedPlan`/`notes`, and the next journal doesn’t get “Last cycle: intended … followed …”.

**What:** When building the cycle entry after a post, set `plannedForNext` from **experiment first, else journal “What I’ll try next”** (same as “This cycle’s focus” already uses via `getLastJournalTryNext()`). So whenever the model had a stated intention (from critique or journal), Phase A can evaluate it.

**Code change (poster):** Where you currently have:
```js
const plannedForNext = (memory.selfAssessment?.nextExperiments?.[0]) ? memory.selfAssessment.nextExperiments[0].slice(0, 100) : '';
```
use:
```js
const experimentLine = memory.selfAssessment?.nextExperiments?.[0];
const tryNext = getLastJournalTryNext();
const plannedForNext = (experimentLine || tryNext || '').trim().slice(0, 100);
```

**Result:** More cycles get internal feedback; journal sees “Last cycle: intended X, followed: yes/no” more consistently.

---

## 3. Lightweight observability (medium impact, low effort)

**Why:** You already have “what to check” in OPERATIONAL_FEEDBACK; making it visible without SSH helps you judge health at a glance.

**What:**
- **Control:** Add a single “Last run” line: last poster outcome (e.g. “Posted”, “Rate limit”, “Fetch-only”, “Error”) and timestamp. Poster can append one line to a small file (e.g. `data/moltbook-last-run.txt`: `2026-02-08T14:30:00 Posted` or `2026-02-08T15:00:00 Rate limit`). Server includes it in the control payload; Control shows it.
- **Optional:** Expose `moltbook.feedbackSignals` on Control when Phase B exists, so you see cumulative counts without chat.

**Result:** Quick “is the loop alive?” without tailing logs or calling `/cycle`.

---

## 4. Critique prompt tightening (medium impact, low effort)

**Why:** When engagement is flat, “What will you try differently?” can produce generic or repeated answers. Giving the model a bit more structure can improve usefulness.

**What:** In `runCritiqueStep`, add to the prompt (one of these or both):
- “If your last post had a stated intention (e.g. from ‘What I’ll try next’), say what you’ll try that’s different from that, not the same.”
- Or pass in `lastCycle.plannedForNext` when available: “You previously said you’d try: … This post was: … In one short sentence, what will you try differently next time (concrete, not generic)?”

**Result:** Experiments list stays more varied and actionable; less “try shorter titles” every time.

---

## 5. Journal prompt: optional “since last journal” nudge (low–medium impact, low effort)

**Why:** Sometimes the only signal change is “new post by Piko” with no engagement delta. The journal still runs but might not clearly tie to “what just happened.”

**What:** When `lastCycle` exists and the signal guard fired because Piko just posted (e.g. you can infer from state: latest post is very recent), add one line to the journal prompt: “You just posted. Reflect on whether that post matched your intention and what you’ll try next.” (Or reuse the lastCycle block you already have; this is just a small extra nudge so the model doesn’t write a generic entry.)

**Result:** Slightly more focused journal entries right after a post.

---

## 6. Consolidation reminder (strategic, no code)

**Why:** Learning becomes durable only when journal/experiments turn into approved refinements (LEARNING.md §3). It’s easy to leave refinements static.

**What:** Periodically (e.g. weekly) scan the last N journal entries and `nextExperiments`. If the same theme appears repeatedly (e.g. “shorter titles”, “more questions”), consider proposing a refinement (or adding it to MOLTBOOK_REFINEMENTS.md) and using `/aim approve` so it becomes part of direction. No new code; a habit or a short checklist in the runbook.

**Result:** Tactical learning accumulates into strategic, persistent behavior.

---

## 7. Optional: “no post” reason in last-run (low impact, low effort)

**Why:** When the poster runs but doesn’t post, it’s useful to know whether it was rate limit vs “Ollama failed” vs “fallback skipped” without reading full logs.

**What:** When you add the “last run” file (§3), write the reason when no post: e.g. `Rate limit`, `Ollama failed`, `Skipped fallback`, `Fetch-only`. Server/Control show “Last run: 14:30 — Rate limit” or “Last run: 14:30 — Posted”.

**Result:** Faster diagnosis when something looks stuck.

---

## Priority suggestion

| Priority | Item | Rationale |
|----------|------|-----------|
| 1 | Phase B | Biggest gain: dense feedback without writing refinements; unblocks better journal and critique. |
| 2 | plannedForNext fallback (§2) | Quick change; more cycles get Phase A and “Last cycle” in journal. |
| 3 | Last-run file + Control (§3, §7) | Cheap observability; easier to confirm “it’s operating.” |
| 4 | Critique prompt (§4) | Reduces repetitive experiments when engagement is flat. |
| 5 | Journal nudge (§5) | Small polish for post-after journal entries. |
| 6 | Consolidation habit (§6) | Process, not code; makes learning durable. |

If you want to implement next, the two quick wins are **§2 (plannedForNext fallback)** and **§3 (last-run file)**; then Phase B when you’re ready for the bigger step.
