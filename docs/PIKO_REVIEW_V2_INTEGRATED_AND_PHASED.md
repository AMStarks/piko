# Piko — Review v2: Integrated feedback and phased rollout

**Purpose:** Integrate external feedback (structural maturity, cognitive coherence, risk vectors, strategic insight, codebase review, embedding spec) into one review; **accept** what aligns with our prior analysis, **reject** or correct what does not; then list **all recommendations to adopt** and a **phased rollout** for your review.

**Companion to:** `docs/PIKO_HOLISTIC_REVIEW_AND_IMPROVEMENT.md` (first review). This doc is the second, synthesis layer.

---

## Part 1 — Integrated feedback (four layers)

### 1. Structural maturity — **Accepted**

Feedback: You have a typed memory ontology, deterministic belief loop, planner before generation, manual control on identity, explicit roadmap staging, and no self-modifying prompt logic. That moves the system from “AI wrapper with memory” to **“belief-mediated behavioural system.”**

**Verdict: Accept.** This matches the codebase: `lib/memory.js` (layers 1–5 + pending, IDs, write_decisions), `lib/beliefLoop.js` (ingest → consolidation → identity gate), `lib/planner.js` (pure function → constraints), SOUL/corpus as manual-edit-only. We avoided: memory bolted on, vague planner, beliefs that don’t affect behaviour, and no manual override. No change to make; this is the correct framing.

---

### 2. Cognitive coherence — **Accepted**

Feedback: Information flows in a psychologically believable direction: Interaction → episodic memory → belief confidence adjustment → planner thresholds → constrained response → new interaction. Beliefs generate **constraints**, not language. That prevents drift and avoids magical introspection, background “thinking,” and fake sentience theatre.

**Verdict: Accept.** The chat path does exactly this: memory block + plan (from beliefs/goals/tensions) → system prompt → LLM → reply → ingest. We do not let beliefs directly generate text. No change.

---

### 3. What’s quietly impressive (three design decisions) — **Accepted**

| Decision | Feedback | Verdict |
|----------|----------|--------|
| **Belief threshold ≥ 0.7** | Damping; prevents oscillation, overreaction, tone instability. | Accept. Already in planner and consolidation (PROMOTE_THRESHOLD 0.7). Keep. |
| **Planner as pure function** | No LLM, no self-interpretation, no recursive planning; predictable, auditable, controllable. | Accept. `lib/planner.js` is pure. Do not add LLM inside planner. |
| **Manual edit for identity** | System cannot mythologize itself; protects long-term. | Accept. SOUL/corpus and self-model are not auto-rewritten; identity gate blocks beliefs that contradict. Keep. |

---

### 4. Where you are on the evolution curve — **Accepted**

Feedback: **Tier: Reflective Companion Prototype.** Not sentient, not agentic, not autonomous—but belief-aware and behaviour-modulated. You are in the **most dangerous architectural window**: small additions can create exponential complexity.

**Verdict: Accept.** Our prior “stress-test 2–4 weeks” and “do not expand” match this. Next step is **observe and prove**, not add features.

---

### 5. Emerging risks (drift vectors) — **Accepted with phase**

| Risk | Feedback | Our position |
|------|----------|--------------|
| **Belief stabilization too early** | Planner becomes static; companion predictable; growth illusion collapses. Need slow decay, re-evaluation, conflict resolution. | **Accept.** Add to Phase 3 (after loop proven): episodic pruning, belief decay or re-evaluation, conflict-resolution mechanics. Not before observability + behaviour validation. |
| **Overfitting to you** | High-signal, structured user → system becomes echo chamber. Solution later: controlled divergence prompts. | **Accept.** Document as “later”; do not implement now. In phased plan as Phase 5 (optional). |
| **Planner becoming personality** | If planner scope expands too fast, personality gets hardcoded. Keep personality emergent through belief drift, not enumerated states. | **Accept.** Do not add many new planner levers (e.g. “humour”, “warmth”) as explicit knobs; keep verbosity, tone, follow-ups, challenge. Personality stays emergent. |

---

### 6. The real insight — **Accepted**

Feedback: You’re building a **constrained adaptive stance engine**, not sentience. “Sentience” talk often masks memory theatre, emotional scripting, self-narrative inflation. Your system is **cognitively humble.**

**Verdict: Accept.** This aligns with our design: no self-narrating, no “I’ve learned X about you” unless asked, no auto-rewrite of identity. No change.

---

### 7. What to pay attention to next (observe, don’t add) — **Accepted**

Feedback: Monitor (1) Does challenge_level adjust meaningfully? (2) Does verbosity correlate with engagement? (3) Do beliefs drift gradually or jump? (4) Is tone stable across days? (5) Does it feel more coherent after 30 interactions? If yes → architecture sound. If no → tuning before expansion.

**Verdict: Accept.** Fold into Phase 1 “stress-test”: same discipline, with these five as explicit check questions.

---

### 8. Strategic fork (A vs B) — **Accepted**

Feedback: Soon you’ll decide: **A) Sharpen you** vs **B) Accompany you.** Right now optimized for A. That’s the right place.

**Verdict: Accept.** Already in our roadmap as “Fork (Phase 6)” and “Option A vs B.” Formalise in Phase 4 with a one-page fork doc; decide before emotion or dependency modelling.

---

### 9. Honest assessment — **Accepted**

Feedback: Advanced hobbyist to early research-grade architecture. Avoided magical thinking, designed damping, preserved manual authority, built belief–behaviour loop. Next mistake would be trying to make it “feel alive” theatrically; let it earn that through stability.

**Verdict: Accept.** No change to architecture; keep restraint in phased plan.

---

## Part 2 — Corrections and rejections

### 2.1 Already done (correct earlier feedback)

| Claim in feedback | Actual state | Action |
|-------------------|--------------|--------|
| “Move conversation/session history into something persistent (SQLite)” | **Done.** `lib/sessionStore.js`, `data/conversations.db`, getHistory/append/clear. | None. |
| “Introduce structured logging (pino) + request IDs” | **Done.** `lib/logger.js`, request ID, pino. | None. |
| “Memory ontology implementation — implement data/memory/* and consolidation” | **Done.** `data/memory/*.json`, `lib/memory.js`, `lib/beliefLoop.js`, ingest after chat, 3 AM consolidation, write_decisions. | None. |
| “Claims & corrections — finish wiring truth engine” | **Largely done.** Truth engine in `lib/truth.js`; correction detection in chat; claims/corrections/wisdom_cache. Any remaining “wire everywhere” is small. | Optional: audit one pass for any missing wiring; not a phase-1 block. |

### 2.2 Rejected or deferred (not in phased adoption)

| Suggestion | Reason |
|------------|--------|
| **Fine-tuning / LoRA** (e.g. “small LoRA on your chat history”) | Far future; operational and data burden; not required for “earn through stability.” Defer; not in phased rollout. |
| **Cursor discernment fully local** (second Ollama instead of Grok) | Nice-to-have; not core to companion loop. Backlog only. |
| **“belief-changes.log”** (in one review) | We use `data/memory/write_decisions.json` for audit. No separate log needed. |
| **Making “personality” an explicit planner output** | Rejected. Keep personality emergent; do not add enumerated personality states to planner. |

### 2.3 Accepted but scoped (optional / later phase)

| Suggestion | Our scope |
|------------|-----------|
| **Vector embeddings for semantic recall** | Accept the *goal* and the spec (e.g. nomic-embed-text, LanceDB, embed on ingest, query in getMemoryBlockForPrompt). Place in **Phase 3** (richer recall) after loop is proven and pruning exists. Do not do before behaviour validation and stress-test. |
| **Larger model (34B+)** | Accept as hardware/ops choice. Not a code recommendation; up to you. Omit from phased *code* rollout. |
| **Docker / docker-compose** | Accept as deployment polish. Phase 5 (optional). |
| **Controlled divergence prompts** (reduce overfitting to you) | Accept as later, Phase 5 (optional). Not before fork decision. |

---

## Part 3 — All recommendations we adopt (single list)

Below is the **full set of recommendations** we accept and will phase. Duplicates from multiple feedback sources are merged; “already done” items are excluded.

1. **Planner observability** — When `PIKO_PLANNER_DEBUG=1`, log beliefs_considered, plan, reason (dev-only). No behaviour change.
2. **Behaviour → belief validation** — Post-response signals (correction, shorter/longer, affirm) → adjust belief confidence and counter_evidence; heuristic-only at first; call after ingest.
3. **Intent poller in cron (Optimus)** — So reminders and scheduled commands actually run.
4. **Stress-test 2–4 weeks** — No new cognition; observe five questions (challenge_level, verbosity, belief drift, tone, coherence over 30 interactions).
5. **Tests** — At least: one integration test for key chat path (or /api/chat), one for planner (belief → verbosity), one for memory or belief consolidation.
6. **Wire “advice followed”** — One path (e.g. iOS creates reminder after Piko suggestion) → POST /api/metrics/advice-followed.
7. **Doctor script** — Optional CLI or script: Node, Ollama, env, data dirs, optional GET /api/health.
8. **File I/O fallbacks** — Sensible defaults for missing prompt/learning files so server doesn’t crash.
9. **Ingest error handling** — In belief loop ingest: try/catch; on failure log and optionally append a non-fatal note (no “memory ingest failed” in user reply unless you explicitly want that). Avoid silent stagnation.
10. **Deduplication in ingest** — If the same or near-duplicate candidate belief is already in pending, skip or merge. Prevents queue bloat.
11. **Episodic pruning** — When episodic entries exceed a cap or age (e.g. >30 days), prune or archive. Prevents unbounded growth.
12. **Belief conflict resolution / re-evaluation** — When two beliefs conflict (e.g. “prefers depth” vs “prefers brevity”), have a simple rule or periodic pass: lower confidence of one, or merge into nuanced belief. After Phase 1–2.
13. **Shared adapter lib** — Extract `postChat(url, message, sessionId)` to e.g. `lib/chatClient.js`; use in adapters.
14. **Webhook signature verification** — Wire `lib/webhookVerify.js` in any webhook endpoint you enable.
15. **Tap-to-talk (iOS)** — Mic → STT → POST /api/chat → TTS; no wake word initially.
16. **Fork doc** — One-page: “Mirror” (sharpen you) vs “Continuity” (accompany you); decide before emotion or dependency modelling.
17. **Impact tracker** — Only when one clear signal exists (e.g. wisdom confirmed, reminder created); then `data/impact.json` and `getImpactBlockForPrompt()`.
18. **Semantic recall (embeddings)** — Per provided spec: Ollama nomic-embed-text, LanceDB (or similar), embed on ingest; in `getMemoryBlockForPrompt()` query top-k by similarity; fallback to keyword if embed fails. After pruning and loop proven.
19. **Consolidation robustness** — Optional: batch or throttle Ollama calls in consolidation if queue is large; retries on failure; log and continue. Prevents one bad call from blocking consolidation.
20. **Fork doc (Option A vs B)** — Document “planner as constraint engine” (A) vs “planner as direction engine” (B); choose A explicitly for now; evolve to B only when intentional.

---

## Part 4 — Phased rollout (for your review)

Phases are ordered by dependency and “prove first, then extend.” Nothing in a later phase is required to *start* an earlier phase.

---

### Phase 1 — Prove the loop (no expansion)

**Goal:** Make the existing loop auditable and outcome-sensitive; run intents; observe for 2–4 weeks without adding cognition.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| 1.1 | Planner observability | ~30 min | `PIKO_PLANNER_DEBUG=1` → log plan, beliefs_considered, reason. |
| 1.2 | Behaviour → belief validation | 1–2 h | Heuristic: correction, “shorter”/“longer”, affirm → adjust belief confidence/counter_evidence; call after ingest. |
| 1.3 | Intent poller in cron (Optimus) | ~5 min | Add cron line so reminders and scheduled commands run. |
| 1.4 | Stress-test 2–4 weeks | 0 (discipline) | No new memory/drives/identity/emotion. Observe: challenge_level, verbosity vs engagement, belief drift (gradual vs jump), tone stability, coherence after ~30 interactions. |

**Exit criterion:** You have 2–4 weeks of usage; planner logs (if enabled) and write_decisions/user_beliefs are inspectable; you can answer the five observe questions. Then proceed to Phase 2.

---

### Phase 2 — Harden (reliability and product)

**Goal:** Tests, one impact path, doctor, resilience so the loop and server are debuggable and trustworthy.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| 2.1 | Tests | 4–8 h | At least: one integration test (chat path or /api/chat), one planner test (belief → verbosity), one memory/consolidation test. |
| 2.2 | Wire “advice followed” | 1–2 h | One path (e.g. iOS reminder created after suggestion) → POST /api/metrics/advice-followed. |
| 2.3 | Doctor script | ~1 h | Optional: script or CLI that checks Node, Ollama, env, data dirs, optional GET /api/health. |
| 2.4 | File I/O fallbacks | ~30 min | Sensible defaults for missing prompt/learning files. |
| 2.5 | Ingest error handling | ~30 min | Try/catch in ingest; log on failure; avoid silent stagnation. |
| 2.6 | Deduplication in ingest | ~30 min | If candidate belief already in pending (same or near-duplicate), skip or merge. |

**Exit criterion:** Tests exist and pass; one real “advice followed” path works; doctor (if built) runs; no crash on missing file. Then Phase 3.

---

### Phase 3 — Richer recall and resilience (no new cognition)

**Goal:** Episodic and belief lifecycle so the system doesn’t bloat or lock in too early; optional semantic recall.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| 3.1 | Episodic pruning | ~1 h | Prune or archive episodic entries older than N days (e.g. 30) or over cap. |
| 3.2 | Belief conflict resolution / re-evaluation | 1–2 h | Simple rule or periodic pass: when two beliefs conflict, lower confidence or merge into nuanced belief. |
| 3.3 | Consolidation robustness | ~30 min | Retries on Ollama failure; log and continue; optional batching if queue large. |
| 3.4 | Semantic recall (embeddings) | 2–4 h | Per spec: nomic-embed-text, LanceDB (or similar), embed on ingest; top-k in getMemoryBlockForPrompt(); keyword fallback. Optional in Phase 3. |

**Exit criterion:** Episodic and beliefs don’t grow unbounded; conflict or decay is visible; optional semantic recall works. Then Phase 4.

---

### Phase 4 — Product and strategic clarity

**Goal:** UX polish, adapter/maintainability, and the fork decision documented.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| 4.1 | Fork doc (A vs B + Option A/B) | ~1 h | One-page: Mirror vs Continuity; planner as constraint vs direction engine; decide before emotion/dependency. |
| 4.2 | Shared adapter lib | ~1 h | Extract postChat to lib/chatClient.js; use in adapters. |
| 4.3 | Webhook signature verification | ~30 min per endpoint | Wire webhookVerify where webhooks are used. |
| 4.4 | Tap-to-talk (iOS) | 4–6 h | Mic → STT → POST /api/chat → TTS. |
| 4.5 | Impact tracker | When signal exists | Only when one clear path exists (e.g. wisdom confirmed, reminder created); then data/impact.json + getImpactBlockForPrompt(). |

**Exit criterion:** Fork is explicit; adapters use shared client; webhooks verified if used; tap-to-talk optional; impact only when you have the signal.

---

### Phase 5 — Optional / when ready

**Goal:** Things that are explicitly optional or depend on fork/hardware.

| # | Recommendation | Effort | Notes |
|---|----------------|--------|--------|
| 5.1 | One soft drive | Later | e.g. “maintain conversational coherence” as planner rule; only after Phases 1–3 and fork. |
| 5.2 | Controlled divergence (reduce overfitting) | Later | Internal prompts or sampling that introduce controlled divergence; not before fork. |
| 5.3 | Docker / docker-compose | Optional | One-command deploy; volume for data/memory. |
| 5.4 | Larger model (34B+) | Optional | Hardware choice; not in code rollout. |

**No exit criterion;** pick by need.

---

## Part 5 — What we do *not* do (until re-evaluation)

- Do **not** add intrinsic drives, auto-calibration, identity rewrite, or emotional modelling before Phase 1–2 and stress-test.
- Do **not** add scratch self or memory importance before behaviour validation has run and you’ve seen belief movement.
- Do **not** blend Option A (constraint engine) and Option B (direction engine) without documenting and deciding.
- Do **not** expand planner with many new enumerated levers (e.g. “humour”, “warmth”); keep personality emergent.
- Do **not** try to make the system “feel alive” theatrically; let it earn that through stability and observability.

---

## Part 6 — Summary table (phased)

| Phase | Theme | Key items |
|-------|--------|-----------|
| **1** | Prove the loop | Planner observability, behaviour validation, intent cron, stress-test 2–4 weeks |
| **2** | Harden | Tests, advice-followed, doctor, file fallbacks, ingest errors, deduplication |
| **3** | Recall & resilience | Episodic pruning, belief conflict/decay, consolidation robustness, optional embeddings |
| **4** | Product & strategy | Fork doc, shared adapter, webhook verification, tap-to-talk, impact when signal exists |
| **5** | Optional | Soft drive, controlled divergence, Docker, larger model |

---

## Part 7 — How to use this doc

1. **Review** Phase 1–4 and the “do not do” list. Adjust phases or items if you disagree.
2. **Start with Phase 1.** Do 1.1–1.3; then run 1.4 (stress-test) for 2–4 weeks before committing to Phase 2.
3. **Track** which items are done (e.g. tick in this doc or in PIKO_FORWARD_RECOMMENDATION §9).
4. **Re-evaluate** after Phase 3: Is belief drift healthy? Is planner still constraint-only? Then consider Phase 4 and fork.
5. Keep **PIKO_HOLISTIC_REVIEW_AND_IMPROVEMENT.md** and **PIKO_FORWARD_RECOMMENDATION.md** as companions; this doc is the integrated, phased execution plan.

---

**Status:** This is the second review: feedback integrated, accept/reject explicit, all adopted recommendations listed, phased rollout defined for your review.

---

## Phase 2 implementation (done)

- **2.1 Tests:** `webchat-piko/tests/` — planner.test.js, memory.test.js, beliefLoop.test.js. Run: `npm test` (or `node --test tests/planner.test.js tests/memory.test.js tests/beliefLoop.test.js`).
- **2.2 advice-followed:** Already wired — `POST /api/metrics/advice-followed` calls `recordAdviceFollowed()`. iOS or any client can POST when user acts on Piko’s advice.
- **2.3 Doctor:** `webchat-piko/scripts/doctor.js` — checks Node, env, data dirs, Ollama (GET /api/tags), optional `PIKO_WEBCHAT_URL` for GET /api/health. Run: `node scripts/doctor.js`.
- **2.4 File I/O fallbacks:** RAG loop in `getRagContext` now wraps each learning file read in try/catch and continues on error. Prompt/learning loaders already had try/catch or defaults.
- **2.5 Ingest error handling:** Full `ingestRecentExperience` body wrapped in try/catch; on failure logs via `lib/logger` and `PIKO_LOG_CONSOLE`; no silent stagnation.
- **2.6 Deduplication in ingest:** Before adding each candidate belief, we check pending for same or near-duplicate proposition (normalize + substring match); skip add if duplicate.

---

## Things to do when you deploy (Phase 1 & 2)

See **webchat-piko/docs/DEPLOYMENT_CHECKLIST.md** — section *Phase 1 & 2 — when you next deploy*:

1. Sync code, then `npm install` on server.
2. Run **doctor:** `node scripts/doctor.js` (optional `PIKO_WEBCHAT_URL=http://localhost:3000`).
3. Run **tests:** `npm test`.
4. Intent poller runs in-server every 5 min; optional to remove standalone cron.
5. Optional: `PIKO_PLANNER_DEBUG=1` for stress-test.
6. Restart service: `systemctl restart piko-webchat.service`.

---

## Phase 3 implementation (done)

- **3.1 Episodic pruning:** `memory.pruneEpisodicOlderThanDays(days)` — removes episodic entries older than N days (default 30, env `PIKO_EPISODIC_PRUNE_DAYS`). Called from the 3 AM cron after belief consolidation.
- **3.2 Belief conflict resolution:** `beliefLoop.resolveBeliefConflicts()` — finds depth vs brevity belief pair and lowers confidence of the weaker one. Called from the 3 AM cron after pruning.
- **3.3 Consolidation robustness:** `detectCounterEvidence` and `identityGate` LLM calls wrapped in `withRetry` (2 retries); on final failure we log and continue (empty contradictions or reject promote). No single Ollama failure blocks the nightly run.
- **3.4 Semantic recall (embeddings):** Optional; not implemented in this pass. See embedding spec in prior feedback; add in a later slice when desired.

---

## Phase 4 implementation (done)

- **4.1 Fork doc:** `docs/FORK_A_VS_B.md` — One-page: Mirror (A) vs Continuity (B); planner as constraint vs direction engine; decide before emotion/dependency.
- **4.2 Shared adapter lib:** `webchat-piko/lib/chatClient.js` — `postChat(baseUrl, message, sessionId, options)` with timeout. `webchat-piko/scripts/intent-poller.js` uses it. Adapters at repo root (`adapters/slack`, `discord`, `whatsapp`, `bluebubbles`) can optionally require it via `require('../../webchat-piko/lib/chatClient')` when run from monorepo.
- **4.3 Webhook signature verification:** BlueBubbles adapter (`adapters/bluebubbles/server.js`) verifies webhook when `BLUEBUBBLES_WEBHOOK_SECRET` or `PIKO_WEBHOOK_SECRET` is set; header `x-webhook-signature` (or `BLUEBUBBLES_WEBHOOK_SIGNATURE_HEADER`). Uses `webchat-piko/lib/webhookVerify.js` when available.
- **4.4 Tap-to-talk (iOS):** Spec only — `Piko-iOS/docs/TAP_TO_TALK_SPEC.md` (Mic → STT → POST /api/chat → TTS; no wake word in v1). Implementation is iOS app work.
- **4.5 Impact tracker:** `webchat-piko/lib/impact.js` — `appendImpact()`, `getImpactBlockForPrompt()`. `recordAdviceFollowed(source)` in metrics appends an impact entry; system prompt includes recent impact (last 14 days, up to 10 entries) when present. Data: `data/impact.json`.

---

## Phase 5 implementation (done)

- **5.1 One soft drive:** Planner outputs `soft_drive: 'coherence'` when `recentEpisodic` has entries. `formatPlanForPrompt` appends "when relevant maintain conversational coherence with the recent exchange". Single nudge; personality stays emergent.
- **5.2 Controlled divergence:** Optional. Set `PIKO_CONTROLLED_DIVERGENCE=1` to append a system-prompt line (default: "Occasionally offer a different angle or gently challenge an assumption when it fits; do not simply echo the user."). Override with `PIKO_DIVERGENCE_PROMPT`.
- **5.3 Docker / docker-compose:** `webchat-piko/Dockerfile` (Node 20, production deps, volume `/app/data`) and `webchat-piko/docker-compose.yml` (service `piko`, port 3000, volume `piko-data`, `OLLAMA_URL` default `http://host.docker.internal:11434`). See `webchat-piko/docs/DOCKER.md`.
- **5.4 Larger model:** No code change. Use a larger model (e.g. 34B+) by setting `OLLAMA_MODEL` and running that model in Ollama on your hardware; see deployment checklist and Ollama docs.
