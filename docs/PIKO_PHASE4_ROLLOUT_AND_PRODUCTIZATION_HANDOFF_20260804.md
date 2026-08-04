# Piko Platform Hardening — Phase 4 handoff (rollout + productization)

Handoff date: 2026-08-04. Execute after Phase 3 (implemented in tree, NOT yet
deployed — see `docs/PIKO_PHASE3_SAAS_FOUNDATIONS_ENACTED_20260804.md`).

## Context

You are working in /Users/starkers/Projects/Piko. The main application is
`webchat-piko/` (Node.js, no framework, raw http server). Read IN FULL before
writing any code:

    docs/PIKO_PLATFORM_CODE_REVIEW_20260804.md          (review — items 1–24 all landed)
    docs/PIKO_PHASE2_HARDENING_ENACTED_20260804.md
    docs/PIKO_PHASE3_SAAS_FOUNDATIONS_HANDOFF_20260804.md
    docs/PIKO_PHASE3_SAAS_FOUNDATIONS_ENACTED_20260804.md
    docs/PIKO_PHASE3_STAGING_AND_DRAIN_NOTES_20260804.md

Phases 0–3 are DONE in tree through commit `1db64ec` (752 tests green). Do NOT
redo that work. The review's numbered roadmap (items 1–24) is exhausted; Phase 4
is the residuals Phase 3 explicitly deferred, plus live rollout, plus the one
high-tier review finding no phase closed.

You inherit from Phase 3: route modules under `routes/`, `lib/chatPipeline.js`
(createHandleApiChat factory), `lib/scheduler.js` (tenant-gated registry),
standalone worker (`scripts/agent-worker.js`, SIGUSR1/`.drain`), strict-default
`PIKO_API_AUTH`, session ownership (`lib/sessionOwner.js`), privilege planes
(`lib/privilegePlanes.js`), `lib/promptBoundary.js`, `lib/secretsStore.js`,
`lib/jsonlBounded.js`, `lib/ontologyPack.js` (threads/aliases only),
staging tenant config (:3022) + culture golden probes in `eval-gate.sh`.

## Environment

| Tenant | Host | Path | Port | Service |
|---|---|---|---|---|
| staging (to provision) | `optimus-wan` | `/home/chief/webchat-piko-staging` | 3022 | user-scope `piko-webchat-staging.service` |
| customer-03 (EI/culture) | `optimus-wan` | `/home/chief/webchat-piko-customer-03` | 3021 | user-scope `piko-webchat-customer-03.service` |
| customer-01 (AusMaker) | `rodimus-wan` | `/home/chief/webchat-piko` | 3000 | system `piko-webchat.service` |

Worker units (templates in `scripts/webchat-deploy/`): `piko-worker-staging.service`,
`piko-worker-customer-03.service`, `piko-worker.service`.
Deploy: `scripts/webchat-deploy/release.sh <tenant>` (now drains the worker first).
Everything local/self-hosted. No cloud dependencies.

## Hard constraints (unchanged)

1. NO REGEX in production code (`scripts/check-no-regex.js --zero`); empty-catch
   ratchet baseline 199 must not grow — lower it when you clean an area.
2. Unit tests for every change; `npm test` (752 passing) green after every item;
   `routeParity` stays green through any further decomposition.
3. Additive migrations only; `.bak` originals; never lose sessions/jobs/state.
4. Deploy staging → customer-03 → customer-01; gate failure ⇒ read remote
   journal before retrying. New env keys go in `lib/config.js` SCHEMA +
   `npm run env:example`.
5. Decisions already locked — do not re-litigate: file-based secrets (no KMS);
   drain-then-restart (no blue/green); encryption at rest stays a host concern.

## Phase 4 work items (execute in order)

P4.0  Live rollout of Phase 3 (FIRST — everything else builds on a deployed base):
      a. Provision staging on Optimus: copy `piko-webchat-staging.service` +
         `piko-worker-staging.service` to `~/.config/systemd/user/`, create
         `/home/chief/webchat-piko-staging` + PIKO_DATA_DIR, seed corpus snapshot
         from customer-03 (read-only copy of egyptian-insights data), strict env,
         distinct API/YOLO/health keys.
      b. Pre-deploy env audit on ALL tenants (do this BEFORE first release):
         `PIKO_API_AUTH` — default flipped to strict; confirm each tenant either
         presents keys everywhere or explicitly sets `lan`. Verify adapters,
         monitors, eval-gate, iOS app, and cross-host pollers still authenticate.
         Set `PIKO_WORKER_STANDALONE=1` in chat `.env`; enable worker units.
      c. Deploy staging → verify → customer-03 → verify → customer-01.
         Live probes (record transcripts in the enactment doc):
         unauth `/api/agents/jobs` → 401; foreign sessionId history → 403;
         Osireion opinion grounded; pause/resume; `/api/ops/metrics`;
         kill worker mid-job → reaper closes it, chat unaffected;
         deploy during a running job → drain honoured, no `orphaned_by_restart`.
      d. 24h soak: journalctl clean of new warnings; `/api/ops/metrics`
         before/after; scheduler_run lines present; `plane_denied`/`session_forbidden`
         counts reviewed (false positives here = broken clients — fix fast).

P4.1  Admin gate fail-closed (review security high-tier, still open):
      a. Today no `PIKO_ADMIN_PASSWORD` ⇒ `adminAuth.isEnabled()` false ⇒ every
         protected-path check silently passes. On tenant spines this must fail
         closed: if `PIKO_ENV_STRICT=1` and no admin password/user store is
         configured, protected paths return 503 `admin_auth_unconfigured` (and
         boot logs one ERROR). Dev machines (strict off) keep current behaviour.
      b. Declare any new env in SCHEMA. Add tests for both modes.

P4.2  Finish server.js decomposition (target <1,500 lines):
      a. Remaining inline groups → modules: static/HTML serving, integrations
         (gmail/slack/notion oauth+linked), yolo/hitl/ios-hub, exports, misc.
         Same tryHandle*/register* pattern; parity fixture updated deliberately;
         one commit per group.
      b. After extraction, `server.js` = boot/validate, shared ctx, dispatch
         chain, listen. Delete dead code found on the way (empty-catch baseline
         down accordingly).

P4.3  Ontology pack completion (P3.7 deferrals — the "EI as config" promise):
      a. Extend the pack schema: agent roster (culture entries in
         `agentRegistry`), EI-specific understand() few-shots, opinion prompt
         preamble, capability card text. Hardcoded values remain the fallback;
         pack overrides when present. Do not half-wire: each of the four areas
         ships with its own test proving pack-override + fallback.
      b. Synthetic second-culture smoke on staging: a pack with different
         threads/roster routes matching, aliases, and agent selection from its
         own pack (this was P3.7b, deferred).

P4.4  Money plane enforcement end-to-end (P3.4 defined it; wiring is partial):
      a. Inventory every route/chat-lane that can move money or mutate ERP state
         (PO draft/submit, yolo-tool mutating actions, hitl approve). Each goes
         through `assertPlaneAllowed('money', …)` with the dual-confirm flow
         (reuse configMutatePending pattern). GET/read stays chat plane.
      b. Structured `plane_denied` lines verified in live logs; eval-gate gets a
         probe: money action without confirm → 403 `money_confirm_required`.

P4.5  Tenant onboarding automation (make the second customer real):
      a. One script: `scripts/provision-tenant.sh <tenant-id> <profile> <port>`
         → site manifest, knowledge dir, `.env` from `.env.example` with fresh
         distinct keys (secretsStore-seeded), ontology pack copy, systemd units
         (webchat + worker), tenants.conf entry, registry row. Idempotent;
         `--dry-run` prints the plan.
      b. Runbook section in the enactment doc: provision → seed → release.sh →
         gate → handover checklist. Use existing
         `docs/STAGE4_CUSTOMER_ONBOARDING.md` as input, supersede it.

P4.6  Observability floor for SaaS:
      a. `/api/ops/metrics` gains: scheduler run failures by id, worker queue
         depth + oldest-pending age, drain state, plane_denied count,
         session_forbidden count, secretsStore rotation age.
      b. A simple threshold alarm loop (scheduler-registered, tenant-gated):
         queue stuck >30min, job failure streak, chat p95 breach → notification
         feed + Telegram. No external SaaS; reuse notifyAdmin.

## Verification (required)

1. `npm test` green after every item; parity green; regex zero; ratchet ≤199.
2. New tests: admin fail-closed both modes; each ontology area override+fallback;
   money dual-confirm per route; provision script dry-run output; metrics fields.
3. Rollout evidence in the enactment doc: probe transcripts (P4.0c), soak
   metrics before/after, gate PASS output for all three tenants.
4. Write `docs/PIKO_PHASE4_ROLLOUT_ENACTED_<date>.md` when done: what changed,
   file list, test count, live evidence, deferred items.

## Explicitly out of scope (do not do)

- Blue/green / zero-downtime deploys (drain-then-restart is the accepted bar).
- Cloud KMS, SaaS log sinks, encryption at rest.
- Billing/metering — Phase 5 candidate, requires product decisions.
- Rewriting the chat pipeline internals (understand→legate→triage→persona
  ordering is frozen; chatPipeline.js is a mechanical extraction, keep it so).

## First actions for the executing agent

1. Read the five context docs listed at the top IN FULL.
2. `cd webchat-piko && npm test` — confirm 752 green before touching anything.
3. Start P4.0a/b: staging provisioning + env audit. Everything else waits until
   the Phase 3 code is live and soaked.
