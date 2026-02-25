# Is Piko learning? — review guide

Use this to assess whether Piko’s learning system is operating and whether learning is actually influencing behavior. Definition of learning (from `webchat-piko/docs/LEARNING.md`): *Piko learns when future actions are measurably influenced by past outcomes, through persistent, inspectable state, without altering model weights.*

---

## 1. Verification levels (from LEARNING.md)

| Level | Question | What to check | Pass condition |
|-------|----------|----------------|----------------|
| **Existence** | Is the loop alive? | Journal entries only when signal changes; last run file updates; cycleHistory grows. | Journal has recent dated entries when engagement/context changed; Control “Last run” shows Posted / Rate limit / Fetch-only; `cycleHistory` has recent entries. |
| **Causality** | Does reflection affect the next action? | Journal “What I’ll try next” and “This cycle’s focus” → next post content/title. | Next post (title or body) visibly aligns with the stated intention (e.g. “try a question” → question title). |
| **Accumulation** | Is tactical learning reinforcing? | Recurring themes in journal and experiments. | Same or similar “What I’ll try next” / experiment lines appear over several cycles. |
| **Consolidation** | Is learning durable? | Refinements approved; behavior follows. | `MOLTBOOK_REFINEMENTS.md` has dated entries that match journal themes; posts respect those refinements. |

---

## 2. Evidence to gather

**From Control or `/memory` / `/goals`:**

- **Last run** — Outcome and timestamp (Posted, Rate limit, Ollama failed, etc.). Confirms the poster is running and what it did last.
- **Last cycle / cycleHistory** — At least one recent entry with `plannedForNext`, and when Phase A ran, `followedPlan` and `notes`. Confirms internal feedback is being stored.
- **Next experiments** — List of “what to try next” from critique. Look for variety (not the same line every time) and concreteness.
- **Journal (last 2–3 entries)** — Four-bullet structure; “Last cycle: intended … followed … notes” reflected in the text when Phase A has run; “What I’ll try next” present and specific.
- **Feedback signals (Phase B)** — If you use `/++`/`/--`, counts should appear; next journal after that should mention the signal (e.g. “Human flagged tooLong”).

**From recent posts (Moltbook or Control):**

- **Title/style** — Do recent posts vary (questions, short phrases, not all “The X of Y”)? Do they match recent “This cycle’s focus” or “What I’ll try next”?
- **Refinements** — Do posts respect approved refinements (e.g. title diversity, “calculating = shrewd”)?

---

## 3. Quick verdict

**“Is the system operating?”**  
→ Yes if: **Last run** is recent and shows a normal outcome (Posted, Rate limit, or Fetch-only), and either (a) journal has a recent four-bullet entry, or (b) `cycleHistory` has at least one entry with `followedPlan` and `notes`.

**“Is Piko learning?”**  
→ **Existence:** Pass if the above holds.  
→ **Causality:** Pass if at least one recent post clearly matches a prior “What I’ll try next” or “This cycle’s focus.”  
→ **Accumulation:** Pass if journal/experiments show repeated themes (same or similar tactics).  
→ **Consolidation:** Pass if you’ve approved at least one refinement that came from journal/experiment themes and posts now follow it.

**Overall:** You can say **Piko is learning** when Existence and Causality pass, and either Accumulation or Consolidation (or both) show progress. Learning is “durable” when Consolidation passes.

---

## 4. Common gaps

- **No journal entries** — Signal guard didn’t fire (no engagement change, no new posts, no newPostsContext change). Normal when nothing changed; wait for a run after a post or engagement update.
- **No Phase A (followedPlan/notes)** — Either no `plannedForNext` (experiments empty and no “What I’ll try next” in journal) or self-eval failed (Ollama). Fix: ensure critique runs and/or use journal “What I’ll try next” as fallback (already implemented).
- **Repetitive experiments** — Critique keeps suggesting the same thing. Phase B feedback and the tightened critique prompt (use last intention, suggest something different) should help; also check that engagement or feedback signals are present so the model has something to react to.
- **Learning not durable** — Tactical learning happens but refinements never get approved. Use `docs/PIKO_LEARNING_CONSOLIDATION_CHECKLIST.md` periodically to turn repeated tactics into refinements.

---

## 5. After the improvements (Phase B, last-run, critique, journal nudge)

- **Last run** — Visible on Control; no need to SSH to see last outcome.
- **Phase B** — One-tap feedback gives the journal concrete signal; check that journal entries reference “Human feedback” when you’ve used `/++`/`/--`.
- **Critique** — Should suggest something different from the last stated intention; experiments should be more varied.
- **Journal** — “You just posted” nudge and last-cycle block keep entries focused on the most recent action and intention.

Re-run this review after a few cycles (e.g. 5–10 poster runs or 2–3 days of cron) to see if Causality and Accumulation improve.

---

## 6. Live data review (Optimus, 2026-02-08)

Review run against live data on Optimus (`piko-memory.json`, `moltbook-journal.md`, poster log, `MOLTBOOK_REFINEMENTS.md`).

**Existence — Pass.** Loop is alive: `lastCycle` 2026-02-08T11:30:13Z; journal has entries from 03:26 through 11:30; `cycleHistory` has 6 entries, all with `plannedForNext`, and cycles 2–6 have `followedPlan` and `notes` (Phase A running). Poster log shows Posted / Rate limit alternating. No `moltbook-last-run.txt` yet (deploy with last-run writing not yet on server).

**Causality — Weak.** Intentions are set and self-eval runs: e.g. cycle 6 intended “Explore more speculative hypotheses”, got `followedPlan: false`, notes “I stuck to critical analysis without exploring speculative hypotheses”. Cycle 5 intended “more abstract concept for title, not sci-fi buzzwords”, got `followedPlan: false`, “You relied on sci-fi buzzwords”. So the loop correctly detects mismatch. But recent titles are still formulaic (“Beneath the Surface of Ephemeral Power”, “Fracturing the Code of Reality”, “Beyond the Event Horizon”) — the model keeps stating “vary formulas, avoid Calculus of X” in journal/experiments but output still drifts toward similar structures. Causality is partial: reflection and evaluation exist; behavior change is lagging.

**Accumulation — Pass.** Journal and `nextExperiments` repeatedly reinforce: vary titles, avoid “Calculus of X” / “Efficiency Through X”, use concise headings, abstract concepts, fewer sci-fi buzzwords. Multiple experiments are present and somewhat varied (“more speculative hypotheses”, “more abstract concept for title”, “more concise headings”, “more personal anecdotes”, “more visuals”).

**Consolidation — Partial.** One refinement approved (2026-02-08): title variety, no “Calculus of X”/“Efficiency Through X”/“Echoes of X”, use questions/metaphors/punchy phrases, “calculating” = shrewd not math. So strategic direction is in place. Posts still often use “Beneath/Beyond the X”, “Fracturing the Y” — refinement is in the prompt but not yet fully reflected in titles.

**Summary:** Piko is learning in the sense that the loop exists, Phase A is feeding back “did I follow my intention?”, and tactics are accumulating and one refinement is approved. Causality is weak: the model often does not follow its stated intention (correctly flagged by self-eval). After deploying the latest improvements (Phase B, last-run file, critique tightening, journal nudge), re-run this review to see if causality and title diversity improve.
