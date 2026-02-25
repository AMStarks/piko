# Stability and integration — recommendation

**Context:** Post-planner feedback: you're in "stability and integration" territory, not "add features." The missing loop is **behaviour → belief validation**; add **planner observability**; stress-test 2–4 weeks before Tier 6; choose Option A (constraint engine) vs Option B (direction engine) consciously.

**Reality check:** Conversation persistence is **already implemented** (SQLite via `lib/sessionStore.js`, `conversations.db`). So "SQLite conversations" is done; the rest of the feedback stands.

---

## 1. What the feedback gets right

- **Planner placement and minimal design are correct.** Plan before generation, pure function, no LLM, threshold at 0.7 — keep it that way.
- **The real gap is behaviour feedback into belief validation.** Right now beliefs move from content patterns (ingest + consolidation). They should also move from **whether planner decisions were validated** (user asked for shorter/longer, corrected, affirmed tone, ignored follow-ups). That turns "learning about the user" into "learning whether its assumptions work."
- **Planner observability is cheap and high-value.** Dev-only log (`beliefs_considered`, `plan`, `confidence_sources`) so you can debug planner behaviour instead of guessing. Do this before adding more cognition.
- **Stress-test 2–4 weeks before Tier 6.** Do not add scratch self, intrinsic drives, identity revisable, or emotional modelling yet. Watch for over-verbosity creep, over-challenge creep, beliefs stabilizing too fast or never decaying. Get empirical behaviour before expanding.
- **Fork: Option A vs B.** Option A = planner as constraint engine (tone/structure only, no drives, no proactive without prompt). Option B = planner as direction engine (soft drives, salience influences follow-ups, background reflection). You're positioned for A; can evolve to B later. Don't blend accidentally.
- **Restraint produces depth.** Do not add drives, auto-calibration, identity rewrite, or emotion yet.

---

## 2. Recommendation (next three moves)

### Move 1: Planner observability (do first)

- **What:** When `PIKO_PLANNER_DEBUG=1` (or `PIKO_LOG_CONSOLE`) and a plan is created, log one line or a small object: `beliefs_considered` (ids or proposition snippets that influenced), `plan` (verbosity, tone, follow_up_questions, challenge_level, proactivity), `reason` (already on plan).
- **Where:** `lib/planner.js` — optional `logPlan(context, plan)` that runs only if env is set; call it from `server.js` after `createResponsePlan()`.
- **Effort:** ~20–30 min. No new files; keeps planner auditable at 2 AM.

### Move 2: Behaviour → belief validation (lightweight)

- **What:** After each response, extract **signals** from the next user message (or the same turn if you have a "reaction" path later). Signals: (1) correction (already exists: `appendCorrection`), (2) "shorter"/"brief"/"tl;dr" → counter to depth-preference belief, (3) "longer"/"more detail"/"expand" → support for depth-preference, (4) explicit affirm of tone/structure (e.g. "that length was perfect"), (5) ignored follow-up (harder; defer).
- **How:** A small **behaviour validation** step that runs in `setImmediate` after the reply is stored. Input: last exchange (user message, assistant reply). Heuristics only at first: regex for shorter/longer/detail; correction already fires `appendCorrection`. For (2)–(4): if depth-preference belief exists, call `memory.addCounterEvidenceToBelief` (for "shorter") or nudge confidence / append evidence (for "longer" or affirm). Use small deltas (e.g. −0.05 / +0.03) so consolidation still owns the main drift.
- **Where:** New `lib/behaviourValidation.js` (or a section in `beliefLoop.js`): `recordBehaviourSignals(sessionId, lastUserMessage, lastAssistantReply)` that reads last user message, classifies, and updates memory layer (user beliefs) or enqueues a note for consolidation. Call from chat path after `beliefLoop.ingestRecentExperience(key)`.
- **Effort:** ~1–2 h for heuristic-only. Optional later: one LLM call "Was this response validated (positive/negative/neutral)?" for richer signal.
- **Important:** Do not auto-rewrite planner or prompt from this. Only adjust **belief confidence and counter_evidence**. Planner keeps using the same rules; the beliefs it reads become better grounded.

### Move 3: Run 2–4 weeks without architecture change

- **What:** No new memory layers, no scratch self, no drives, no identity rewrite. Use the system normally. Periodically inspect: write_decisions, user_beliefs, planner logs (if enabled). Note: over-verbosity creep? Beliefs stuck or drifting too fast? Challenge level appropriate?
- **Then:** Re-evaluate. If the loop (behaviour → belief validation) is visible and stable, consider episodic pruning or one soft drive. If not, tune validation and observability first.

---

## 3. What not to do next

- Do **not** add intrinsic drives, auto-calibration, identity rewrite, or emotional modelling.
- Do **not** add scratch self or memory importance until behaviour validation has run for a few weeks and you've seen belief movement from signals.
- Do **not** blend Option A and Option B without deciding: stay explicitly "constraint engine" for now.

---

## 4. Where to put this on the roadmap

Add under **§9 Added to the roadmap** in `docs/PIKO_FORWARD_RECOMMENDATION.md` (or keep in this doc and reference it):

- **Planner observability** — Dev-only log when `PIKO_PLANNER_DEBUG=1`: beliefs_considered, plan, reason. (Do first.)
- **Behaviour → belief validation** — Lightweight post-response signals (correction, shorter/longer, affirm) that adjust belief confidence and counter_evidence; heuristic-only at first. (Do second.)
- **Stress-test 2–4 weeks** — No new cognition; inspect planner and belief drift; then re-evaluate Tier 6. (Do third.)
- **Fork (Option A vs B)** — Document "planner as constraint engine" vs "planner as direction engine"; choose A explicitly for now; evolve to B only when intentional.

---

## 5. Summary

| Feedback item | Recommendation | Order |
|---------------|----------------|--------|
| Behaviour → belief validation | Do it. Lightweight: heuristic signals (correction, shorter/longer, affirm) → belief confidence and counter_evidence. No LLM required at first. | After observability |
| Planner observability | Do it. Optional log when PIKO_PLANNER_DEBUG=1: beliefs_considered, plan, reason. | First |
| Stress-test 2–4 weeks | Do it. No scratch self, drives, identity rewrite, emotion. Inspect and tune. | Third |
| Option A vs B fork | Document and choose A (constraint engine) explicitly; defer B. | Now (doc only) |
| SQLite conversations | Already done (sessionStore + conversations.db). | — |
| Don't add drives / auto-calibration / identity / emotion | Agree. Restraint. | — |

**Verdict:** The feedback is right: the next win is **closing the loop** (behaviour → belief validation) and **making the planner inspectable**, then **proving the loop works** with a few weeks of real use. Implement observability first, then behaviour validation with heuristics, then hold the line on architecture until you have data.
