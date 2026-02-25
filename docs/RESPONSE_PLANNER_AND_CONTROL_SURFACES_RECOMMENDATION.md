# Response planner and control surfaces — recommendation

**Context:** A design doc proposed (1) phases of what becomes necessary after memory + belief, (2) a **response planning layer** so beliefs actually affect behaviour, (3) impact tracker / auto-calibration / meta-reflection as "last 5%," and (4) a concrete `lib/planner.js` sketch. This note reviews that against the current codebase and gives a single, implementable recommendation.

**Relevant code:** Chat path in `server.js` builds `systemContent = corpus + truth + getMemoryBlockForPrompt(8,3) + SYSTEM_PROMPT + learning + sticky + pending question + RAG`. Mind (goals, tensions, beliefs from `data/mind/`) is **not** currently injected into the chat system prompt; only memory-layer user beliefs and episodic are.

---

## 1. What the doc gets right

- **Beliefs without a behaviour layer are inert.** Right now the model sees "Stable beliefs about the user: …" as text. It can use them, but there is no explicit *instruction* like "this turn: high verbosity, analytical tone." A planner turns beliefs (and goals, tensions) into **constraints**, not just context.
- **Order of phases is right:** planner first (behaviour arbitration), then soft drives, then forgetting/reconciliation, then identity checks, then meta-absence, then the fork. Doing impact/calibration/reflection *before* a planner would add feedback loops that don’t yet have a clear "what to change" lever.
- **Control surfaces, not more features.** The doc is right that the next step is not another capability but **how** existing ones (memory, wisdom, goals, tensions) influence the reply.
- **Meta-absence:** Growth should be felt, not announced. No "I’ve learned X about you" unless asked. That’s a prompt/guardrail, not a new subsystem.
- **Fork before emotion:** Choosing "companion as mirror" vs "companion as continuity" before adding emotion models is the right moment.

---

## 2. What to do next (one thing)

**Implement a minimal response planning layer and wire it into the chat prompt.**

- **Scope:** One new module and one insertion point in the chat path. No new data stores, no new crons.
- **Role of the planner:** Run *before* building the system prompt. Input: current user message (optional), plus loaded context (memory user beliefs, mind goals/tensions, optional wisdom/truth summary). Output: a **plan object** (verbosity, tone, follow_up_questions, challenge_level, assume_familiarity). The plan is **constraints for this turn**, not prose.
- **How it affects behaviour:** Append a short, explicit line to the system prompt, e.g.  
  **Response plan (this turn):** verbosity high, tone analytical, 0 follow-up questions, challenge moderate, assume familiarity.  
  So the model gets a direct instruction; beliefs and goals/tensions influence the plan, and the plan shapes the reply.

### Recommendation for v1

1. **`lib/planner.js`**
   - `createResponsePlan(context)` where `context` has at least: `userBeliefs` (from memory), `mind` (from loadMind(): goals, tensions, self_model). Optionally: `userMessage`, `recentEpisodic`.
   - **Pure function, no LLM:** rules only. Examples:
     - If any user belief with "depth" or "structure" (or similar) has confidence ≥ 0.7 → `verbosity: 'high'`.
     - If no such belief or confidence < 0.5 → `verbosity: 'medium'`.
     - If active goals length > 0 and message seems goal-relevant (e.g. contains "plan", "today", "next") → `follow_up_questions: 1`, `proactivity: 'moderate'`.
     - If active tensions length > 0 → `challenge_level: 'moderate'`.
     - Defaults: `tone: 'analytical'`, `assume_familiarity: true`, `follow_up_questions: 0`, `challenge_level: 'low'`.
   - Return a single object: `{ verbosity, tone, follow_up_questions, challenge_level, assume_familiarity, proactivity }` plus optional `reason` (one line for debugging).
   - Keep the function **deterministic and testable** (no AI call inside planner in v1).

2. **Chat path in `server.js`**
   - Before building `systemContent`:  
     `const plan = createResponsePlan({ userBeliefs: memory.getUserBeliefs(), mind: loadMind(), userMessage: message, recentEpisodic: memory.getEpisodic().slice(-3) });`
   - Append to the system prompt (e.g. right after the memory block or before SYSTEM_PROMPT):  
     `\n\n**Response plan (this turn):** verbosity ${plan.verbosity}, tone ${plan.tone}, follow-up questions ${plan.follow_up_questions}, challenge ${plan.challenge_level}, assume familiarity ${plan.assume_familiarity}.${plan.proactivity ? ' ' + plan.proactivity + ' proactivity.' : ''}\n\n`
   - No need to inject the full JSON; one sentence is enough. Optionally log `plan` (or `plan.reason`) in debug so you can inspect why a turn was shaped that way.

3. **No new env or config for v1**  
   Thresholds (e.g. 0.7 for "depth" → high verbosity) can be constants in `planner.js`. Tune later.

**Outcome:** Beliefs and goals/tensions **actually change behaviour** in a visible, debuggable way. You can run a few chats and confirm "when I have usr_pref_depth at 0.78, I get 'verbosity high' in the plan and longer answers."

---

## 3. What to defer or do carefully

### Impact tracker, auto-calibration, meta-reflection ("last 5%")

- **Impact tracker:** Agree in principle: measuring "did this wisdom/goal help?" is valuable. **Recommendation:** Add it only when you have **one clear, implementable signal** (e.g. "user confirmed wisdom w001" or "user created a reminder after a suggestion"). Wire that one path to a simple `data/impact.json` and a `getImpactBlockForPrompt()` that returns a line or two. Don’t build a full deployment/success-rate system until you have at least one real signal.
- **Auto-calibration (changing temp/length from follow-rate):** High risk of drift and hard-to-debug behaviour. **Recommendation:** Defer until you have many weeks of explicit "advice followed" data and a human gate (e.g. "suggested calibration: shorter; approve? Y/n"). Do not let the system auto-adjust sampling or prompt length without a review step.
- **Meta-reflection (weekly private retro):** You already have scripts like `meta-reflection-weekly.js`. **Recommendation:** Keep weekly reflection as **input to you** (and optionally to a small "private journal" or sticky-ideas style block). Do **not** let the reflection output automatically rewrite system prompt or planner defaults. If you want "next week’s behaviour shifts," make that a **manual** step: you read the note and, if you agree, change a config or a line in SOUL/planner.

### Phases 2–5 (after planner)

- **Phase 2 (soft drives):** Agree with "one or two drives, max; only when interacting." Implement only after the planner exists and you feel the system is still "inert" in tone. Start with a single drive, e.g. "maintain conversational coherence" encoded as a planner rule (e.g. "if last turn was a question, prefer answering or explicitly deferring").
- **Phase 3 (forgetting / reconciliation):** You already have counter_evidence and consolidation. Next step is episodic pruning and belief conflict detection when you see bloat (e.g. too many episodic entries or contradictory beliefs). No need to do this before the planner.
- **Phase 4 (identity immune system):** Good long-term idea. Implement as a **periodic check** (e.g. weekly) that produces a short report ("possible overfitting to Andrew: …") for you to review, not an automatic dampening loop.
- **Phase 5 (meta-absence):** Add to SOUL or system prompt: "Do not announce what you have learned about the user; do not narrate your internal processes. Let growth show in behaviour, not in commentary." No new code beyond prompt text.

### Phase 6 (the fork)

- **Recommendation:** Document both paths (mirror vs continuity) in a short design note: different ceilings (e.g. pushback vs deep emotional modelling), different brakes (e.g. independence vs strong relational identity). Decide which path you want **before** adding emotion or dependency-modelling features. No implementation until that choice is explicit.

---

## 4. Summary table

| Proposal | Recommendation | Effort |
|----------|----------------|--------|
| **Response planner** | Do first. `lib/planner.js` (pure function, rules from beliefs + goals + tensions) → one-line plan in system prompt. | ~2–3 h |
| Impact tracker | Only when you have one clear "advice followed" signal; wire that path to impact.json + getImpactBlockForPrompt(). | Defer until signal exists |
| Auto-calibration (temp/length) | Defer. If ever, add human approval step. | Defer |
| Meta-reflection → auto behaviour change | Keep reflection; do not auto-rewrite prompt/planner. Manual step only. | 0 (already have reflection) |
| Soft drives (Phase 2) | After planner. One drive, e.g. coherence, as planner rule. | After planner |
| Forgetting / conflict (Phase 3) | You have counter_evidence. Add episodic pruning when needed. | Later |
| Identity immune system (Phase 4) | Periodic report for human review, not auto-dampening. | Later |
| Meta-absence (Phase 5) | Add one paragraph to SOUL/prompt. | ~15 min |
| Fork (Phase 6) | Document both paths; decide before emotion models. | 1 h doc |

---

## 5. Verdict

- The doc is right: **the missing piece is a response planner** so that memory, beliefs, goals, and tensions actually **drive** behaviour instead of only appearing as context.
- Do **exactly one thing next:** implement a minimal, rule-based planner and inject its output as a one-line "Response plan (this turn): …" into the chat system prompt. No LLM inside the planner in v1; no new data stores; no impact/calibration/reflection automation yet.
- Treat impact tracking, auto-calibration, and automatic behaviour change from meta-reflection as **later, gated** steps. That keeps the system understandable and avoids the "sprawling myth-machine" risk while still moving toward "beliefs that matter."

**Concrete next action:** Implement `lib/planner.js` with `createResponsePlan(context)` (rules only, beliefs + mind), then in the chat path load context, call `createResponsePlan(context)`, and append the one-line plan to `systemContent`. Test with a high-confidence "depth" belief and confirm verbosity and tone in the plan and in the reply.
