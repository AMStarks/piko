# Piko — Phased completion plan

Single roadmap from the forward recommendation (Tiers 1–6). Work in order; each phase is shippable.

---

## Phase 1 — Foundation (reliability + debug)

**Goal:** Conversations survive restarts; you can debug by request ID; abuse is limited; config is validated at startup.

| # | Deliverable | Done |
|---|--------------|------|
| 1.1 | **Persist conversations (SQLite)** — Replace in-memory `sessions` Map with SQLite. Table: `conversation(session_id, role, content, created_at)`. Load last N per session; append on each message; support clear (e.g. `/new`). | ☑ |
| 1.2 | **Structured logging + request ID** — Pino logger; one request ID per HTTP request (set at entry, pass to log). Log as JSON (level, msg, requestId, ...). | ☑ |
| 1.3 | **Rate limiting** — Per-IP or per-session limit on `POST /api/chat` (e.g. 60/min). Return 429 when exceeded. In-memory with expiry is fine for single-user. | ☑ |
| 1.4 | **Config schema at startup** — Validate required env (e.g. no typo in `MODEL_PRIMARY`). Use convict or zod; fail fast with clear message. | ☑ |

**Outcome:** Restart-safe history; debuggable logs; basic protection; fewer “wrong env” runs.

---

## Phase 2 — Security (before wider exposure)

**Goal:** Webhooks and control/API are safe if ever exposed beyond localhost.

| # | Deliverable | Done |
|---|--------------|------|
| 2.1 | **Webhook signature verification** — For any endpoint that receives webhooks (e.g. Blue Bubbles), verify provider signature when configured. Helper: `lib/webhookVerify.js` (verifyHmac). Wire when webhook endpoint is added. | ☑ |
| 2.2 | **Control / sensitive API protection** — If `/control` or `/api/corpus` etc. are reachable beyond localhost, require API key or IP allowlist (extend existing corpus-edit pattern). | ☑ |

**Outcome:** Safe to expose behind tunnel or small trusted network.

---

## Phase 3 — Product & polish

**Goal:** Metrics reflect use; status doc is accurate; weekly retro runs; voice path is clear.

| # | Deliverable | Done |
|---|--------------|------|
| 3.1 | **Wire “advice followed”** — When user acts on a suggestion (e.g. iOS creates reminder from Piko), call `POST /api/metrics/advice-followed`. At least one path wired. | ☐ |
| 3.2 | **Weekly retro automation** — Cron (e.g. Sunday 8 AM) calls `weeklyRetro()`; send to Telegram or write to `data/learning/`. | ☑ |
| 3.3 | **Update PIKO_PROJECT_STATUS.md** — Include Wisdom Core, metrics, channels, skills, corpus lock, so doc matches the build. | ☑ |
| 3.4 | **Tap-to-talk (iOS)** — Mic → STT → POST /api/chat → TTS in Piko-iOS. Documented as optional; implement when ready. | ☐ |

**Outcome:** Dashboard and status doc are current; optional voice path defined.

---

## Phase 4 — Later (when you touch that code)

**Goal:** Maintainability and companion depth; no hard deadline.

| # | Deliverable | Done |
|---|--------------|------|
| 4.1 | **TypeScript (gradual)** — New or refactored modules in TypeScript (e.g. `lib/` or adapters). No big-bang rewrite. | ☐ |
| 4.2 | **Tests** — Integration tests for `/api/chat` (e.g. skill match, correction detection) and for critical libs (truth, corpus). | ☐ |
| 4.3 | **Companion depth (Tier 6)** — Private scratch self, memory importance/expiry, identity revisable but bounded, one intrinsic drive. Implement one or more when Phase 1–3 are done. | ☐ |

**Outcome:** Easier refactors; regression safety; Piko feels more self-updating over time.

---

## Implementation order

1. **Phase 1** — Implement 1.1 → 1.2 → 1.3 → 1.4; wire server to use all four.
2. **Phase 2** — Implement 2.1, 2.2 when you plan to expose beyond localhost.
3. **Phase 3** — Implement 3.1, 3.2, 3.3; 3.4 when you want voice.
4. **Phase 4** — Pick items as you touch those areas.

This doc is the single checklist; tick boxes as each deliverable is done.
