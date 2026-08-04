# Piko Platform Hardening — Phase 5 handoff (strict auth everywhere + scale proof)

Handoff date: 2026-08-05. Execute after Phase 4 (implemented AND deployed —
see `docs/PIKO_PHASE4_ROLLOUT_ENACTED_20260804.md`).

## Context

You are working in /Users/starkers/Projects/Piko. Main app: `webchat-piko/`
(Node.js, no framework, raw http server). Read IN FULL before writing code:

    docs/PIKO_PLATFORM_CODE_REVIEW_20260804.md
    docs/PIKO_PHASE3_SAAS_FOUNDATIONS_ENACTED_20260804.md
    docs/PIKO_PHASE4_ROLLOUT_AND_PRODUCTIZATION_HANDOFF_20260804.md
    docs/PIKO_PHASE4_ROLLOUT_ENACTED_20260804.md
    docs/PIKO_PHASE4_P40_ROLLOUT_SOAK_START_20260804.md

Phases 0–4 are DONE through commit `e62e427` (783 tests green) and LIVE on all
three tenants (releases `20260804-21xx-0dc6d49a`). Do NOT redo that work.

Phase 5 = the Phase 4 residuals plus closing the last deliberate security gap:
customer tenants still run `PIKO_API_AUTH=lan` (private-IP trust). A SaaS
platform cannot ship a second customer while unauthenticated LAN callers are
trusted, sessions share one `api_key:shared` principal, and onboarding has
never been exercised end-to-end.

## Environment (all live and healthy at handoff)

| Tenant | Host | Port | Release | Auth |
|---|---|---|---|---|
| staging | optimus-wan | 3022 | 20260804-2148 | **strict** |
| customer-03 (EI) | optimus-wan | 3021 | 20260804-2152 | lan (explicit) |
| customer-01 (AusMaker) | rodimus-wan | 3000 | 20260804-2157 | lan (explicit) |

Deploy: `bash scripts/webchat-deploy/release.sh <tenant>` (drains worker,
gates, rolls back on failure). Order: staging → customer-03 → customer-01.
Workers: standalone units on all tenants (`PIKO_WORKER_STANDALONE=1`).

## Hard constraints (unchanged)

1. NO REGEX in production code (`scripts/check-no-regex.js --zero`); empty-catch
   ratchet baseline **191** must not grow — lower it when you clean an area.
2. Unit tests per change; `npm test` (783) green after every item; routeParity green.
3. Additive migrations only; never lose sessions/jobs/state.
4. Gate failure ⇒ read the remote journal before retrying. New env keys go in
   `lib/config.js` SCHEMA + `npm run env:example`.
5. Locked decisions — do not re-litigate: file secrets (no KMS);
   drain-then-restart (no blue/green); encryption at rest is a host concern;
   billing/metering stays OUT until the operator makes product decisions.

## Phase 5 work items (execute in order)

P5.0  Soak closeout (due after 2026-08-05T12:00Z — T+24h from final deploys):
      a. Capture `/api/ops/metrics` on all three tenants; diff against
         `docs/PIKO_PHASE4_P40_ROLLOUT_SOAK_START_20260804.md` baselines.
      b. journalctl since deploy: zero recurring errors; zero
         `orphaned_by_restart`; scheduler_run present; denial counters
         explained (C01 plane_denied=2 is the eval-gate money probes — expected).
      c. Mid-soak drain proof: enqueue a long job on staging, run
         `release.sh staging` while it runs, show drain honoured.
      d. Write the closeout section into the Phase 5 enactment doc.

P5.1  Strict auth everywhere (the point of this phase):
      a. Client inventory per tenant: every process that calls the spine —
         adapters (bluebubbles/discord/slack/whatsapp via
         `adapters/shared/pikoClient.js`), telegram listeners, legion-watch,
         intent-poller, api-ping, context-refresh, doctor, smoke scripts,
         iOS app (`Piko-iOS`), HQ registry poller, AusMaker docker services.
         For each: confirm it sends `X-Piko-Key` (or Bearer) from env; fix the
         ones that don't. `pikoClient.js` already supports it — verify wired env.
      b. Stage the flip: staging already strict (canary since 08-04). Flip
         customer-03 `PIKO_API_AUTH=lan → strict`; watch 24h (401s in journal
         = missed client; fix fast; `lan` is the documented rollback).
         Then customer-01 the same way.
      c. Per-client keys (P4 residual "session IDOR cross-principal"):
         `secretsStore` gains named api keys (`api-key-<client>.json`);
         `apiAuth.keyMatches` returns the matched key name; `sessionOwner`
         principal becomes `api_key:<name>` instead of `api_key:shared`.
         Live probe: key A cannot read key B's session history (403
         `session_forbidden`). Keep the shared key as `api-key.json` fallback
         during migration.
      d. Remove `isMonitorBypass` loopback holes that strict now covers, or
         justify each in a comment + test.

P5.2  server.js <1,500 (P4 residual — helpers, not routes):
      a. Extract from server.js into lib/: boot-time scheduler registrations
         (~500 lines of bootScheduler.register blocks → lib/bootJobs.js),
         Telegram/notify helpers, mobile URL helpers, intent/skill loading,
         webhook fanout helpers. Same test discipline; one commit per module.
      b. Target: server.js = boot/validate, ctx wiring, dispatch, listen.
         Report final line count honestly if <1,500 is not reached and say why.

P5.3  Onboarding dress rehearsal (proves P4.5 + P4.3b live):
      a. Use `scripts/provision-tenant.sh customer-04 culture 3023` (real run,
         not dry-run) and bring the spine up on Optimus with the
         synthetic-culture ontology pack (`config/ontology/synthetic-culture.json`).
      b. Deploy via `release.sh customer-04`; eval-gate must PASS with the
         synthetic pack (different threads/aliases/roster than EI proves
         ontology isolation live).
      c. Then tear down or leave as the permanent demo tenant — operator's
         call; record the decision. Fix every rough edge the rehearsal exposes
         in provision-tenant.sh itself (that is the deliverable).

P5.4  Alarm verification (P4.6 was shipped but never fired live):
      a. On staging, force each threshold (temporarily set
         PIKO_ALARM_CHAT_P95_MS=1 etc.), confirm notification feed + Telegram
         delivery, restore values. Record transcripts.
      b. Add an eval-gate soft probe: `/api/ops/metrics` has `denials`,
         `worker`, `scheduler` keys (schema guard against silent regression).

## Verification (required)

1. `npm test` green after every item; regex zero; ratchet ≤191; parity green.
2. New tests: named-key principal isolation (key A vs key B 403); bootJobs
   module registers same job ids as before (snapshot test); provision rehearsal
   assertions where scriptable.
3. Live evidence in the enactment doc: soak closeout deltas, strict-flip 401
   audit per tenant, cross-key IDOR probe transcript, customer-04 gate PASS,
   alarm delivery transcript.
4. Write `docs/PIKO_PHASE5_ENACTED_<date>.md`: what changed, file list, test
   count, live evidence, deferred items.

## Explicitly out of scope (do not do)

- Billing/metering — needs operator product decisions first (flag, don't build).
- Blue/green deploys, KMS, encryption at rest, external log sinks.
- Rewriting chat pipeline internals (frozen).
- New customer-facing features.

## First actions for the executing agent

1. Read the five context docs IN FULL.
2. `cd webchat-piko && npm test` — confirm 783 green before touching anything.
3. If past 2026-08-05T12:00Z, do P5.0 soak closeout first; otherwise start the
   P5.1a client inventory (read-only) and return for closeout when due.
