# Piko — Feedback synthesis and recommendations

**Purpose:** Synthesise three recent feedback passes (Progress + Priorities, four-layer structural review, 00:14 export review) into one narrative, **correct what is already implemented**, and give **prioritised recommendations** for the next phase.

---

## 1. Correction: What is already in place

Several items in the feedback are **already implemented** in the current codebase (Phases 1–5). Updating the record avoids duplicate work.

| Feedback said | Actual state |
|---------------|--------------|
| **SQLite conversations** — "Replace in-memory Map → sessionStore" | **Done.** `lib/sessionStore.js` uses better-sqlite3; `data/conversations.db`; getHistory/append/clear. Restart-proof. |
| **Pino + request IDs** — "lib/logger.js → structured JSON logs" | **Done.** `lib/logger.js` uses pino; server assigns `req.requestId` and passes it to `log()`. |
| **Rate limiting** — "60/min per IP on /api/chat" | **Done.** `lib/rateLimit.js` — 60/min per key (IP); used in server before chat handler. |
| **Config schema** — "Zod/convict startup validation" | **Done.** `lib/config.js` — `validate()` at startup (PORT, MODEL_PRIMARY); server requires it on boot. |
| **Behaviour signals → belief update** — "Reply → behaviour signals → belief update" | **Done.** Phase 1: `beliefLoop.applyBehaviourSignals(sessionId, userMessage, reply)` after ingest; correction/shorter/longer/affirm heuristics adjust confidence. |
| **Cron intent-poller** — "Reminders actually fire" | **Done.** Phase 1: server runs `node scripts/intent-poller.js` every 5 min via node-cron. |
| **Shared chatClient.js** — "Adapters DRY" | **Done.** Phase 4: `lib/chatClient.js`; intent-poller uses it; adapters can require it. |
| **piko-doctor** — "systemctl status + ollama ping" | **Done.** Phase 2: `scripts/doctor.js` — Node, env, data dirs, Ollama GET /api/tags, optional /api/health. |
| **Episodic pruning** — "Prune >30 days" | **Done.** Phase 3: `memory.pruneEpisodicOlderThanDays()`; env `PIKO_EPISODIC_PRUNE_DAYS`. |
| **Belief conflict resolution** | **Done.** Phase 3: `beliefLoop.resolveBeliefConflicts()` — depth vs brevity pair; lower confidence of weaker. |
| **Dockerize** | **Done.** Phase 5: Dockerfile + docker-compose.yml; see `webchat-piko/docs/DOCKER.md`. |
| **Webhook HMAC** | **Done.** Phase 4: BlueBubbles uses `webhookVerify.verifyHmac` when secret set. |

So the "Production Gaps (Fix These 4, 8h)" and "OpenClaw Cherry-Picks (3h)" from the first review are **already addressed**. The "Next 7 Days" list can be trimmed to **observability + belief lifecycle** (below).

---

## 2. Synthesis of the three feedback passes

### 2.1 Shared verdict

- **Architecture:** A- companion / early research-grade. Single brain, planner as constraint engine, beliefs → behaviour not text, no self-mythologising. Restraint is the main strength.
- **Ops:** C+ → improving. SQLite, pino, rate limit, config validation, tests, doctor, Docker are in place. Remaining gaps are **belief lifecycle governance** and **observability depth** (not missing basics).
- **Risk:** You are building a **belief graph** (temporal reinforcement, arbitration, constraint matrix). As belief count and planner levers grow, emergent risks appear: belief entanglement, planner saturation, personality crystallisation. Not there yet, but on trajectory.

### 2.2 What all three emphasise

1. **Do not expand; refactor and govern.** Add belief hierarchy, compression, and inertia before adding more planner levers or drives.
2. **Belief lifecycle.** Today beliefs accumulate; they don’t reorganise. At 40–60 beliefs you get redundancy, axis crowding, planner dilution. Need: compression cycle, tiering, and (optional) lineage.
3. **Planner discipline.** Keep it as constraint engine. Avoid stacking many more dimensions; consider grouping dimensions if you add more.
4. **Fork A vs B.** Stay explicit: epistemically adaptive (A) vs stable personality (B). Current design is A. Crossing to B needs trait crystallisation, safeguards, anti-dependency design.

### 2.3 Specific points from each pass

| Source | Point | Takeaway |
|--------|--------|----------|
| Progress + Priorities | App Store path (6 mo), Month 6 vision | Useful product roadmap; no code change. |
| Four-layer review | Belief hierarchy (Tier 1/2/3), compression cycle, context bucketing, inertia (stable beliefs decay slower) | **Adopt as next refactor themes.** |
| Four-layer review | "Drive weight > 0.3 or relational reinforcement = irreversible" | **Keep soft drives bounded; no relational reinforcement.** |
| 00:14 export | Ollama mocks in tests, integration test for full loop, webhookVerify tests | **Improve test robustness.** |
| 00:14 export | Base64 fallback for webhook sig, document webhook secret in README/env.example | **Small hardening + docs.** |
| 00:14 export | Belief conflict: "average confidences or flag" when not depth/brevity | **Extend conflict resolution beyond depth/brevity later.** |

---

## 3. Recommendations for improvement (prioritised)

### 3.1 Already done — no action

- SQLite conversations, Pino + request ID, rate limit, config validation.
- Behaviour validation (applyBehaviourSignals), intent-poller cron, chatClient, doctor, episodic pruning, belief conflict (depth/brevity), Docker, webhook HMAC.

### 3.2 High priority — belief lifecycle (refactor, not features)

These stabilise the system before belief count grows. Order by dependency.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| **B1** | **Belief hierarchy (tiers)** | 3–4 h | Introduce Tier 1 (identity/global), Tier 2 (domain preferences), Tier 3 (interaction-level). Store `tier` on each belief; conflict arbitration respects tier (higher tier wins or merges down). Prevents peers-only conflict. |
| **B2** | **Belief compression cycle** | 3–4 h | Every N interactions (or nightly): detect semantically similar beliefs (e.g. embedding or keyword overlap), merge if overlap > threshold; prune low-confidence stale; recalc reinforcement. Prevents unbounded growth and axis crowding. |
| **B3** | **Inertia control** | 1–2 h | Beliefs stable for 50+ interactions decay slower; new beliefs decay faster. Add `last_changed_at` or reinforcement count; use in decay formula. Avoids uniform drift and flattens nuance. |

**Exit:** Belief count can grow without planner dilution; conflict and decay are tier-aware and age-aware.

### 3.3 Medium priority — observability and tests

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| **O1** | **Structured log for 2AM/cron** | ~1 h | Ensure belief consolidation, pruning, and weekly retro log one structured line (e.g. `log('info', 'belief_consolidation', { promoted, rejected, pending })`) so 2AM failures are debuggable. |
| **O2** | **Integration test (chat → ingest → plan)** | 2–3 h | One test: stub Ollama, POST /api/chat or call build-system-prompt path, then assert plan shape and that ingest/applyBehaviourSignals don’t throw. No real LLM. |
| **O3** | **webhookVerify tests + base64** | ~1 h | Unit tests for valid/invalid HMAC; support base64 signature if adapter sends it (in addition to hex). |

### 3.4 Lower priority — when you touch the area

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| **L1** | **Context bucketing (planner)** | 4–6 h | Tag interactions by domain (technical, philosophical, casual, emotional, meta). Belief drift can be partially domain-scoped so nuance isn’t averaged out. Optional until you see flattening. |
| **L2** | **Conflict resolution beyond depth/brevity** | 2 h | When two beliefs conflict (e.g. "love X" vs "hate X"), add consolidation step: average confidence or flag for manual review. Depth/brevity already handled. |
| **L3** | **Document webhook secret** | ~15 min | In README or `.env.example`: `BLUEBUBBLES_WEBHOOK_SECRET`, `PIKO_WEBHOOK_SECRET`, header name. |
| **L4** | **Dynamic memory block size** | ~30 min | `getMemoryBlockForPrompt(maxBeliefs, maxEpisodic)` or derive from model context size env so you don’t overfill context on larger models. |

### 3.5 Explicitly out of scope for now

- **More planner levers** — Avoid adding more dimensions until B1–B3 are in place.
- **Relational reinforcement / drive weight > 0.3** — Would change the nature of the system; don’t cross without explicit fork decision.
- **Trait crystallisation (path B)** — Only if you decide to move from A to B; then design safeguards and anti-dependency.

---

## 4. Suggested order for the next phase

1. **Observe (no code).** Run 2–4 weeks with current build; inspect `write_decisions.json` and belief drift. Confirm the loop is stable before refactoring.
2. **B1 Belief hierarchy** — Implement tiers; wire into conflict resolution and (optionally) planner.
3. **O1 + O2** — Cron structured log + one integration test. So you can debug and regress.
4. **B2 Belief compression** — Nightly or every N interactions; merge similar, prune stale.
5. **B3 Inertia** — Decay rate by stability/age.
6. **O3 + L3** — webhookVerify tests and base64; webhook secret in docs.

Then re-evaluate: if belief count and planner use are stable, consider L1 (context bucketing) or L2 (broader conflict resolution).

---

## 5. One-line summary

**You’re not missing production basics (SQLite, pino, rate limit, config, tests, doctor, Docker, webhook) — those are done. The next step is belief lifecycle governance (hierarchy, compression, inertia) and observability/tests, not new features. Refactor before expanding.**
