# Memory ontology — review and recommendation

**Context:** A concrete design was proposed (JSON schemas, write-permission system, one-week simulation). We already implemented a first version: `data/memory/`, `lib/memory.js`, `lib/beliefLoop.js`, server wiring, 3AM consolidation. This doc reviews the proposal against the implementation and recommends what to adopt and in what order.

**Design refs:** `docs/MEMORY_ONTOLOGY_AND_BELIEF_LOOP.md` (repo root), current code in `webchat-piko/lib/memory.js` and `webchat-piko/lib/beliefLoop.js`.

---

## 1. What already matches

| Proposal | Current implementation | Verdict |
|----------|------------------------|--------|
| Layer 1 interaction (summary, topics, tone) | `appendInteraction({ content_summary, topics, tone })`; no `id`/`salience_score` yet | Aligned |
| Layer 2 episodic (event, significance, reinforcement) | `appendEpisodic({ event, perceived_significance, emotional_weight, linked_beliefs, reinforcement_count })`; `reinforceEpisodic()` exists | Aligned |
| Layer 3B user beliefs (proposition, confidence, evidence) | `getUserBeliefs()` / `addUserBelief(proposition, confidence, evidence)` | Aligned |
| Layer 4 self-model read-only | `getSelfBeliefs()`; writes not exposed | Aligned |
| Layer 5 reflective (private) | `getReflective()` / `appendReflective()`; not in prompt | Aligned |
| Pending queue → consolidate → promote/drop | Pending beliefs, daily consolidation, promote ≥0.7, drop ≤0.15 | Aligned |
| Identity gate before promoting | `identityGate(proposition)` with SOUL + self_model | Aligned |
| Salience → episodic + candidates | Ingest: if `salient` then append episodic + add up to 2 pending | Aligned |

So the **flow** (ingest → salience → pending → consolidate → identity gate → promote) is in place. The gaps are in **schema richness**, **permission auditability**, and **counter-evidence / decay**.

---

## 2. Gaps (proposal vs current)

### 2.1 Schema

- **IDs:** Proposal uses stable `id` (e.g. `int_2026_02_01_001`, `epi_*`, `usr_pref_*`). We use array index / no id. **Impact:** Harder to reference in `linked_beliefs`, in write-decision logs, and in a future simulation.
- **Layer 1:** Proposal adds `salience_score` (provisional). We don’t store it; we only use a boolean `salient` at ingest time to decide whether to write episodic + pending.
- **Layer 2:** Proposal adds `id`, `timestamp`, `decay_rate` and “decay applies weekly”. We have no `decay_rate` or decay logic.
- **Layer 3B:** Proposal has `id`, `counter_evidence[]`, `created_at`; “nothing ever 1.0”. We have no `counter_evidence`; consolidation only bumps confidence up; we cap at 0.98.
- **Layer 4:** Proposal has `id`, `stability`, `origin`, `mutable`. We have a separate `data/mind/self_model.json`; `data/memory/self_beliefs.json` exists but isn’t populated from SOUL.
- **Layer 5:** Proposal has `id`, `related_beliefs`, `expiry`. We have `text` + `at`; no expiry, just count-based prune.

### 2.2 Write permission system

- Proposal: explicit **levels** (0–3) and a **write decision object** (write_target, proposed_change, justification, risk_flags, decision, review_required) for auditability.
- Current: Permission is implicit (ingest writes L1 + conditionally L2/pending; consolidation writes L3B after identity gate). No structured log of “who decided what and why”.

### 2.3 Consolidation semantics

- Proposal: Counter-evidence reduces confidence (e.g. Day 4: “quick and light” → confidence 0.68, `counter_evidence += 1`); nuance preserved.
- Current: Consolidation only **increases** confidence (+0.05 per run); no scan for counter-evidence, no decrease, no `counter_evidence[]`.

### 2.4 Simulation / drift

- Proposal: One-week, day-by-day trace with observable belief drift and explicit counter-evidence.
- Current: No simulation harness; no formal “day N” or replay of interactions to validate drift.

---

## 3. Recommendation (prioritised)

### 3.1 Adopt soon (high value, low risk)

1. **Stable IDs**
   - **Where:** `lib/memory.js` (and optionally beliefLoop when creating episodic/pending).
   - **What:** Add `id` to Layer 1 (e.g. `int_YYYY_MM_DD_nnn`), Layer 2 (`epi_...`), Layer 3B (`usr_pref_*` or `usr_*`), Layer 5 (`ref_...`). Pending can use `pend_...` or same as 3B once promoted.
   - **Why:** Enables `linked_beliefs`, write-decision references, and simulation scripts without changing flow.

2. **counter_evidence and confidence down**
   - **Where:** `lib/memory.js` (user belief schema + helpers), `lib/beliefLoop.js` (consolidation).
   - **What:** Add `counter_evidence[]` to user beliefs; in consolidation, optionally scan recent interactions/episodic for contradicting signals and apply a small confidence decrease (e.g. −0.1 when counter-evidence is found); cap confidence at e.g. 0.95 (never 1.0).
   - **Why:** Matches proposal’s “nuance preserved” and “nothing is ever 1.0”; makes the one-week story (Day 4 quick request) implementable.

3. **salience_score on Layer 1**
   - **Where:** Ingest prompt and `appendInteraction`.
   - **What:** Ask LLM for a numeric `salience_score` (0–1) in the ingest JSON; store it on the interaction record. Use it (e.g. threshold 0.6) to decide episodic creation instead of or in addition to boolean `salient`.
   - **Why:** Keeps “cheap and lossy” but makes salience inspectable and tunable; aligns with “episodic only if salience > threshold”.

### 3.2 Adopt next (auditability and debuggability)

4. **Write decision object (log only)**
   - **Where:** New `lib/memoryWrites.js` or inside `memory.js`: `logWriteDecision(decision)`. Call it from beliefLoop (and any future writer) for: “pending_candidate_added”, “belief_promoted”, “belief_rejected”, “episodic_created”.
   - **What:** Append to `data/memory/write_decisions.json` (or a daily log file) with `write_target`, `proposed_change`, `justification[]`, `risk_flags[]`, `decision`, `timestamp`. No need to change approval logic at first—just record what happened.
   - **Why:** “Debug it at 2am”; rollback and forensics without changing write levels yet.

5. **Explicit write levels in code**
   - **Where:** `lib/memory.js` or a small `lib/memoryPermissions.js`.
   - **What:** Define `WRITE_LEVELS = { 0: 'interaction', 1: 'episodic', 2: 'belief', 3: 'self_model' }` and have each write path (e.g. `appendInteraction`, `appendEpisodic`, `addUserBelief`) check the level and call `logWriteDecision`. Optionally, `attemptWrite(target, change, justification)` that returns the decision object and then the caller performs the write if `decision.decision === 'approved'`.
   - **Why:** Makes the “filesystem with chmod” explicit in code; prepares for future human-in-the-loop for Level 3.

### 3.3 Defer or do lightly

6. **Reflective expiry**
   - Add an optional `expiry` (ISO date) to reflective entries and prune in `appendReflective` or in consolidation. Low effort; improves alignment with “auto-expire”.

7. **Episodic decay**
   - Proposal: “decay applies weekly”. Requires a clear policy (e.g. `reinforcement_count` decay or a `decay_rate` and a weekly job that reduces confidence/strength of episodic entries). Defer until you have enough episodic data to see bloat; then implement a simple weekly decay step.

8. **Self-model in memory/**
   - You already have `data/mind/self_model.json` and SOUL. Keeping Layer 4 “self-model” as read-only from mind + SOUL is enough; no need to duplicate into `data/memory/self_beliefs.json` unless you want a single “memory store” for all layers.

9. **System prompt: “Write decisions (today’s updates)”**
   - Proposal suggests injecting `{{recent_write_decisions}}` into the prompt. Recommendation: **don’t** inject raw write decisions into the chat prompt by default—they’re for you and for debugging. Optionally expose on `/control` or a small “memory audit” view.

### 3.4 One-week simulation

10. **Simulation harness**
    - **Where:** e.g. `scripts/memory_simulation_week.js` or a small test.
    - **What:** Replay a fixed script of “Day 0 state + Day 1–7 interactions” (e.g. inject interactions, run ingest + consolidation per day), then assert final belief confidence and presence of one counter_evidence entry. Use the proposal’s week as the golden script.
    - **Why:** Validates that drift is observable and matches the “runnable in your head” story; catches regressions when you add counter-evidence or decay.

---

## 4. Summary table

| Item | Action | Effort (rough) |
|------|--------|----------------|
| Stable IDs (L1, L2, 3B, 5, pending) | Add | Small |
| counter_evidence + confidence down in consolidation | Add | Small |
| salience_score on Layer 1, threshold for episodic | Add | Small |
| logWriteDecision + write_decisions.json | Add | Small |
| WRITE_LEVELS + attemptWrite (optional) | Add | Small |
| Reflective expiry | Optional | Small |
| Episodic decay (weekly) | Defer | Medium |
| Self-model in memory/ | Skip or minimal | — |
| Write decisions in system prompt | Don’t (use /control or audit view) | — |
| One-week simulation script | Add | Medium |

---

## 5. Verdict

- The **proposal is the right end-state**: concrete schemas, permission levels, and a week-long trace make the system inspectable and debuggable. It fits the existing design and extends what’s already built.
- **Implement in this order:** (1) IDs + counter_evidence + salience_score, (2) write-decision logging, (3) optional write-level checks, (4) one-week simulation. Defer episodic decay until you need it; keep self-model in mind/ and SOUL; keep write decisions out of the main chat prompt and reserve them for audit/control.

That gives you the “cognitive data contract” and “guardrails, not vibes” without a rewrite—mostly additive schema and one new consolidation behaviour (confidence down on counter-evidence).
