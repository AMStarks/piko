# Piko — Holistic review and improvement plan

**Purpose:** A single, thorough review of all code and direction, integrated with OpenClaw’s ecosystem, to clarify how to improve and strengthen Piko without losing what makes it distinct.

**Sources:** PIKO_FORWARD_RECOMMENDATION, PIKO_PROJECT_STATUS, PIKO_OPENCLAW_ROADMAP, PIKO_VS_OPENCLAW_OPERATION, PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS, STABILITY_AND_INTEGRATION_RECOMMENDATION, MEMORY_ONTOLOGY_AND_BELIEF_LOOP, RESPONSE_PLANNER_AND_CONTROL_SURFACES_RECOMMENDATION, and the live codebase (webchat-piko, adapters, iOS, scripts).

---

## 1. Executive summary

**What Piko is today:** A philosophy-first, single-primary-human AI companion with a **temporal self** (corpus, truth engine, wisdom distillation, learning repo, sticky ideas, tensions), **layered memory and belief loop** (interaction → episodic → user beliefs → pending → consolidation + identity gate), a **response planner** (beliefs and goals/tensions → verbosity, tone, follow-ups, challenge), and **multi-surface access** (WebChat, iOS app, Telegram, optional Discord/Slack/WhatsApp/Blue Bubbles adapters). It runs on your own infra (Optimus), uses a private LLM (Ollama + LiteLLM fallbacks), and is explicitly **not** a generic chatbot: identity (SOUL, corpus), epistemic care (truth engine, corrections), and companion depth (memory, planner) are core.

**Grade (repeated from forward recommendation):**

| Lens | Grade | Why |
|------|--------|-----|
| Generic Node/SaaS app | C+ / B− | Large server.js, little typing, no automated tests, some tech debt. |
| Personal companion (single human, 24/7, philosophy-first) | **A−** | Wisdom Core, memory ontology, planner, productionization (SQLite, pino, rate limit, config), iOS + channels. Few systems have this stack. |

**Verdict:** Piko is strong on **vision and cognitive architecture** and adequate on **ops for a single-user deployment**. The main ways to **strengthen** it are: (1) **close the behaviour → belief loop** (observability + validation), (2) **adopt a few high-value OpenClaw-style capabilities** (intent poller in cron, optional CLI/doctor), (3) **harden ops and product** (tests, advice-followed, tap-to-talk), and (4) **resist expansion** until the current loop is proven (no new cognition layers for 2–4 weeks).

---

## 2. Strengths (what to preserve and build on)

### 2.1 Philosophy and identity

- **Corpus as bedrock** — Four docs (worldview, loyalty, reality, life navigation) plus cached summary; no prompt drift from a single “identity” blob. Honesty protocol and epistemic care are explicit.
- **Truth engine** — Claims, corrections, wisdom cache, nightly distillation; correction detection in chat. Piko can update what it “holds true” without you editing prompts by hand.
- **SOUL / IDENTITY** — Clear persona and constraints; ethical boundary in SOUL; identity gate in the belief loop so new beliefs can’t contradict the core self.
- **Single primary human** — Design is for one relationship; no multi-tenant ambiguity. This is a feature, not a limitation.

### 2.2 Cognitive architecture (already built)

- **Memory ontology** — Layers 1–5 + pending: interaction (with salience_score), episodic (reinforcement), user beliefs (confidence, counter_evidence), reflective (private), pending queue. IDs, write-decision logging, confidence cap 0.95.
- **Belief loop** — Ingest (summarise + salience) → candidate beliefs → consolidation (confidence up/down, counter-evidence) → identity gate → promote or drop. Daily 3 AM consolidation; ingestion after each chat.
- **Response planner** — Pure function; beliefs (e.g. depth/structure ≥ 0.7) → verbosity; goals + tensions → follow-ups, challenge. One-line plan in system prompt. No LLM in the planner; deterministic and testable.
- **Wisdom Core** — Corpus block + truth block + top wisdom in prompt; affirmation path (e.g. “w001 is spot on”); metrics and control UI.

This is the “sentience-ready” scaffolding: memory, belief drift, and behaviour arbitration are in place. The next step is **proving the loop** (observability + behaviour validation), not adding more layers.

### 2.3 Productionization (done)

- **SQLite conversations** — History survives restarts; sessionStore with MAX_HISTORY.
- **Structured logging** — Pino + request ID (logger.js).
- **Rate limiting** — 60/min per IP on POST /api/chat.
- **Config validation** — Startup check (lib/config.js).
- **Control / corpus lock** — Optional IP or header for /control and corpus edit.
- **SSRF protection** — URL validation in skills (public http/https only).
- **Ollama retry** — One retry with delay before fallback models.

### 2.4 Product surface

- **WebChat** — Chat UI, streaming, commands (/task, /cursor, /remind, /queue, /schedule, /read, /ls, /search, etc.), control panel (multiple sub-pages).
- **iOS app** — Chat, Reminders, Calendar, Mail, Share to Piko, dashboard (tensions, next reminder, Moltbook, context hint), Settings with base URL and integration toggles.
- **Channels** — Telegram (in repo); Discord, Slack, WhatsApp, Blue Bubbles in `adapters/`; same brain, allowlist.
- **Intents** — Reminders, queue, scheduled commands in `data/intents.json`; `/remind`, `/queue`, `/schedule` in server; `scripts/intent-poller.js` exists (processes due reminders and scheduled; **not in cron on Optimus** in the last check — add if you use reminders/queue).

### 2.5 OpenClaw comparison (where Piko already aligns)

- **Same LLM** — Ollama; same model, different operational path (Piko builds the request in server.js; no gateway/agent runtime).
- **Intent orders** — You have the data model and commands (/remind, /queue, /schedule); you have the poller script. Missing piece: **cron for intent-poller** on Optimus so reminders and scheduled tasks actually run.
- **Skills** — Local `skills/*.js` (no ClawHub); commands in server. Sufficient for “private LLM agent bot.”
- **Cron / heartbeat** — In-process 5 min heartbeat (tensions, Moltbook feedback, learning); standalone scripts for daily/weekly (nightly wisdom, meta-reflection, rabbit-hole, etc.).

---

## 3. Code and architecture (health and fragility)

### 3.1 server.js

- **Size** — Large (~3000+ lines); many concerns in one file: routing, chat, commands, control APIs, cron, health, widget, dashboard, learning, Moltbook, intents, skills. This matches “incremental extraction when you touch it”: no big-bang refactor, but when you add a new area (e.g. behaviour validation), consider extracting a `routes/` or `handlers/` module for that slice.
- **Chat path** — Clear flow: allowlist → commands (including /remind, /queue, /schedule) → correction/wisdom detection → load mind, corpus, truth, **memory block**, **planner** → build systemContent → Ollama (stream or not) → append history → updateMind + ingestRecentExperience in setImmediate. This is the right place to add behaviour validation (after ingest).
- **Dependencies** — Many `require()` at top; memory, planner, beliefLoop, mind, corpus, truth, intents, sessionStore, etc. Well factored into `lib/`; no circular dependency issues observed.

### 3.2 lib/ (core modules)

| Module | Role | Health |
|--------|------|--------|
| **llm.js** | ai(), aiStream(), primary + fallbacks, retry | Solid; used everywhere. |
| **memory.js** | Layers 1–5 + pending, IDs, getMemoryBlockForPrompt | Solid; schema and caps in place. |
| **memoryWrites.js** | logWriteDecision, attemptWrite, WRITE_LEVELS | Solid; audit trail. |
| **beliefLoop.js** | ingestRecentExperience, runBeliefConsolidation, identityGate, detectCounterEvidence | Solid; counter-evidence and identity gate in place. |
| **planner.js** | createResponsePlan, formatPlanForPrompt; rules only | Solid; no LLM; add observability (log when PIKO_PLANNER_DEBUG=1). |
| **mind.js** | loadMind, updateMind, classifyAndProposeUpdates | Solid; separate from memory-layer beliefs. |
| **corpus.js** | getCorpusBlockForPrompt, regenerateSummary | Solid. |
| **truth.js** | getTruthBlockForPrompt, appendCorrection, wisdom cache | Solid. |
| **sessionStore.js** | SQLite getHistory, append, clear | Solid. |
| **intents.js** | loadIntents, saveIntents, createIntent, parseDuration | Solid; shared by server and intent-poller. |
| **config.js** | validate at startup | Solid. |
| **logger.js** | Pino + requestId | Solid. |
| **rateLimit.js** | 60/min per IP | Solid. |
| **webhookVerify.js** | Exists; wire when adding webhooks | Ready. |

**Gaps in lib/:** No `behaviourValidation.js` yet (recommended: heuristic signals → belief confidence/counter_evidence). No shared `chatClient.js` for adapters (optional; reduces duplication when you add/change adapters).

### 3.3 Tests and observability

- **Tests** — None in repo for server or lib. High ROI: a few integration tests for POST /api/chat (e.g. skill match, correction detection, planner affecting reply) and unit tests for truth/corpus/memory/planner. Prevents regressions when you change the loop or planner.
- **Planner observability** — Not yet implemented. When `PIKO_PLANNER_DEBUG=1`, log plan + beliefs_considered + reason (see STABILITY_AND_INTEGRATION_RECOMMENDATION).
- **Write decisions** — Already logged to `data/memory/write_decisions.json`; good for 2 AM forensics.

---

## 4. OpenClaw: what to adopt to strengthen Piko

OpenClaw is a **framework** (gateway, agent runtime, workspace bootstrap, many channels, ClawHub, first-class tools). Piko is a **thin stack** with the same LLM and a different operational path. You don’t need to become OpenClaw; you can **cherry-pick** capabilities that increase reliability and daily value without losing Piko’s philosophy and companion depth.

### 4.1 Adopt (high value, low conflict)

| OpenClaw capability | Piko action | Why |
|---------------------|-------------|-----|
| **Intent poller in cron** | Add on Optimus: `*/5 * * * * cd /root/webchat-piko && PIKO_WEBCHAT_URL=http://localhost:3000 node scripts/intent-poller.js >> logs/intent-poller.log 2>&1` | Reminders and scheduled commands only run if the poller runs. You already have the script and intents.json. |
| **Doctor / health CLI** | Optional: `scripts/piko-cli.js doctor` or `scripts/webchat-deploy/piko-doctor.sh` that checks Node, Ollama, env, data dirs, and optionally POST /api/health | Easier than SSH + manual checks; aligns with OpenClaw’s `openclaw doctor`. |
| **Streaming** | Already have `stream: true` for WebChat | No gap. |
| **Retry / failover** | Already have Ollama retry + LiteLLM fallbacks | No gap. |

### 4.2 Adopt with light adaptation

| OpenClaw capability | Piko action | Why |
|---------------------|-------------|-----|
| **Shared adapter HTTP client** | Extract `postChat(url, message, sessionId)` to e.g. `lib/chatClient.js`; adapters call it | Reduces duplication across Discord/Slack/WhatsApp/Blue Bubbles; same pattern OpenClaw uses for channel → backend. |
| **Webhook signature verification** | You have `lib/webhookVerify.js`; wire it in any webhook endpoint (e.g. Blue Bubbles) | Security best practice; OpenClaw does this. |

### 4.3 Defer or reject (keep Piko’s identity)

| OpenClaw capability | Recommendation | Why |
|---------------------|----------------|-----|
| **Gateway / multi-agent routing** | Defer | Piko is single-agent, single-primary-human; no need for gateway or session routing. |
| **ClawHub / public skills registry** | Reject | Piko’s skills are local and private; no marketplace. |
| **Workspace bootstrap (AGENTS.md, HEARTBEAT.md auto-generated)** | Reject | You use fixed corpus + prompts; no auto-generated workspace bloat. |
| **Many more channels (Signal, Teams, Matrix, etc.)** | Defer | Add when you have a concrete use case; current adapters cover the main ones. |
| **Browser CDP / canvas / camera nodes** | Defer | Phase 3+ if ever; not core to companion. |
| **Thinking levels / sub-agents** | Defer | Single agent is a design choice; keep it. |

**Summary:** Integrate OpenClaw’s *operational ideas* where they clearly strengthen Piko (intent poller cron, doctor script, shared chat client, webhook verification). Do **not** adopt the framework itself or the multi-agent/channel breadth; that would dilute Piko’s “one brain, one human, philosophy-first” stance.

---

## 5. Gaps and risks

### 5.1 Ops and reliability

| Gap | Impact | Action |
|-----|--------|--------|
| **No automated tests** | Regressions in chat, planner, or belief loop are easy to miss. | Add a small test suite: one integration test for /api/chat (e.g. with mock Ollama), one for planner (belief → verbosity), one for memory append. |
| **Intent poller not in cron on Optimus** | Reminders and scheduled commands never run. | Add cron line for intent-poller (see §4.1). |
| **File I/O without fallbacks** | Missing prompt or learning file could crash the server. | On read, use sensible defaults (e.g. empty string or default prompt); document in backlog. |

### 5.2 Product and UX

| Gap | Impact | Action |
|-----|--------|--------|
| **“Advice followed” not wired** | Trust score and maturation dashboard stay at zero. | When iOS (or another client) acts on a suggestion (e.g. creates reminder), call POST /api/metrics/advice-followed. |
| **Tap-to-talk (iOS)** | Voice is the biggest UX win for “companion.” | Mic → STT → POST /api/chat → TTS; no wake word initially. |
| **Base URL on iOS** | Users must type Optimus IP; easy to get wrong. | Already fixed when you set 192.168.0.121:3000; optional: mDNS/Bonjour so “Optimus” or “piko.local” resolves. |

### 5.3 Companion depth (loop and cognition)

| Gap | Impact | Action |
|-----|--------|--------|
| **No planner observability** | Hard to debug why a turn was high verbosity or low challenge. | When PIKO_PLANNER_DEBUG=1, log beliefs_considered, plan, reason. |
| **No behaviour → belief validation** | Beliefs only move from content patterns; not from “did the user like this response?” | Lightweight heuristic: correction, “shorter”/“longer”, affirm → adjust belief confidence/counter_evidence (see STABILITY_AND_INTEGRATION_RECOMMENDATION). |
| **Stress-test not done** | Unknown whether verbosity/challenge creep or belief drift is a problem. | Run 2–4 weeks with no new cognition; inspect planner and belief state; then re-evaluate Tier 6. |
| **Option A vs B not formalised** | Risk of accidentally blending “constraint engine” with “direction engine.” | Document “planner as constraint engine” (current) and “direction engine” (future); choose A explicitly; evolve to B only when intentional. |

### 5.4 Security and exposure

| Gap | Impact | Action |
|-----|--------|--------|
| **Control/API auth** | If /control or sensitive APIs are ever exposed beyond LAN, anyone could change corpus or prompts. | You have PIKO_CONTROL_ALLOWED_IP / HEADER; extend to any new sensitive route; add API key for health if exposed. |
| **Webhook verification** | Unverified webhooks could be spoofed. | Wire lib/webhookVerify.js when you add or enable a webhook endpoint. |

---

## 6. Prioritized improvement plan (one list)

This merges “forward recommendation,” “stability and integration,” and “OpenClaw integration” into a single ordered list. Order is by impact and dependency; “strengthen” = harden current system; “adopt” = bring in from OpenClaw or backlog.

### Phase A — Close the loop and prove it (do first)

| # | Action | Type | Effort |
|---|--------|------|--------|
| A1 | **Planner observability** — When PIKO_PLANNER_DEBUG=1, log beliefs_considered, plan, reason. | Strengthen | ~30 min |
| A2 | **Behaviour → belief validation** — Heuristic signals (correction, shorter/longer, affirm) → adjust belief confidence and counter_evidence; call after ingest in chat path. | Strengthen | 1–2 h |
| A3 | **Intent poller in cron (Optimus)** — Add cron so reminders and scheduled commands run. | Adopt | ~5 min |
| A4 | **Stress-test 2–4 weeks** — No new memory/drives/identity/emotion; inspect write_decisions, user_beliefs, planner logs. | Strengthen | 0 (discipline) |

### Phase B — Ops and product polish

| # | Action | Type | Effort |
|---|--------|------|--------|
| B1 | **Tests** — At least: one integration test for /api/chat (or key path), one for planner (belief → verbosity), one for memory. | Strengthen | 4–8 h |
| B2 | **Wire “advice followed”** — One path (e.g. iOS creates reminder after Piko suggestion) → POST /api/metrics/advice-followed. | Strengthen | 1–2 h |
| B3 | **Doctor script** — Optional CLI or script that checks Node, Ollama, env, data dirs, health endpoint. | Adopt | ~1 h |
| B4 | **File I/O fallbacks** — Sensible defaults for missing prompt/learning files so server doesn’t crash. | Strengthen | ~30 min |

### Phase C — Optional OpenClaw-style and UX

| # | Action | Type | Effort |
|---|--------|------|--------|
| C1 | **Shared adapter lib** — Extract postChat to lib/chatClient.js; use in adapters. | Adopt | ~1 h |
| C2 | **Webhook verification** — Wire webhookVerify in any webhook endpoint. | Adopt | ~30 min per endpoint |
| C3 | **Tap-to-talk (iOS)** — Mic → STT → POST /api/chat → TTS. | Strengthen | 4–6 h |

### Phase D — Later (after loop is proven)

| # | Action | Type | Effort |
|---|--------|------|--------|
| D1 | **Episodic pruning / belief conflict** — When data/memory grows, add decay or conflict detection. | Strengthen | Later |
| D2 | **One soft drive** — e.g. “maintain conversational coherence” as a planner rule; only after A1–A4. | Strengthen | Later |
| D3 | **Fork doc** — Document “mirror” vs “continuity”; decide before emotion or dependency modelling. | Strengthen | ~1 h |
| D4 | **Impact tracker** — Only when you have one clear signal (e.g. wisdom confirmed, reminder created); then data/impact.json + getImpactBlockForPrompt(). | Adopt | When signal exists |

### Do not do (until re-evaluation)

- Do **not** add intrinsic drives, auto-calibration, identity rewrite, or emotional modelling before A1–A4 and stress-test.
- Do **not** add scratch self or memory importance until behaviour validation has run and you’ve seen belief movement.
- Do **not** blend Option A (constraint engine) and Option B (direction engine) without deciding.

---

## 7. How this strengthens Piko

1. **Beliefs that match behaviour** — Observability (A1) and behaviour validation (A2) close the loop: planner decisions are validated by user signals, and beliefs move from both content and outcome. That strengthens “learning about you” without adding new cognition layers.
2. **Reliability** — Intent poller in cron (A3), tests (B1), doctor (B3), and file fallbacks (B4) reduce “why didn’t it work?” and make debugging at 2 AM possible.
3. **Product credibility** — Advice-followed (B2) and tap-to-talk (C3) make the companion feel real and the metrics meaningful.
4. **OpenClaw integration without identity loss** — You adopt operational habits (cron for intents, doctor, shared client, webhook verification) and reject framework and multi-agent/channel sprawl. Piko stays “one brain, one human, philosophy-first.”
5. **Restraint** — Phase A and “do not do” keep you from expanding cognition until the current loop is proven. That *is* strengthening: a stable, inspectable loop beats a fragile, feature-heavy one.

---

## 8. Conclusion

**Piko is already strong** on vision (corpus, truth, wisdom, memory, planner) and adequate on ops for single-user deployment. The holistic way to **improve and strengthen** it is:

- **First:** Close the behaviour → belief loop (observability + validation), ensure intent poller runs (cron), and stress-test 2–4 weeks without new cognition.
- **Second:** Harden ops and product (tests, advice-followed, doctor, file fallbacks).
- **Third:** Optionally adopt a few OpenClaw-style operational pieces (shared chat client, webhook verification) and tap-to-talk.
- **Fourth:** After the loop is proven, consider episodic pruning, one soft drive, and the fork (mirror vs continuity); keep impact tracker and auto-calibration gated and human-approved.

OpenClaw’s value here is **operational** (intent execution, health/doctor, channel pattern) and **checklist** (what a “full” assistant platform might have), not a target architecture. Piko’s differentiator is **philosophy-first companion with a temporal self and belief-aware behaviour**. Strengthening that means making the existing loop auditable and outcome-sensitive, then polishing ops and product—not adding more channels or agents.

Use this doc alongside **docs/PIKO_FORWARD_RECOMMENDATION.md** and **docs/STABILITY_AND_INTEGRATION_RECOMMENDATION.md** when choosing the next slice of work.
