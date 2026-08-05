# Piko Platform Hardening — Phase 6 handoff (strict completion + named-key rollout)

Handoff date: 2026-08-05. Execute after Phase 5 (implemented AND deployed — see
`docs/PIKO_PHASE5_ENACTED_20260805.md`).

## Context

You are working in /Users/starkers/Projects/Piko. Main app: `webchat-piko/`
(Node.js, no framework, raw http server). Read IN FULL before writing code:

    docs/PIKO_PHASE4_ROLLOUT_ENACTED_20260804.md
    docs/PIKO_PHASE4_P40_ROLLOUT_SOAK_START_20260804.md
    docs/PIKO_PHASE5_STRICT_AUTH_AND_SCALE_HANDOFF_20260805.md
    docs/PIKO_PHASE5_ENACTED_20260805.md
    docs/PIKO_PHASE5_CLIENT_INVENTORY_20260805.md

Phases 0–5 are DONE and LIVE on all four tenants. Local baseline at Phase 5
close: **789 tests green**, regex zero, empty-catch ratchet **190**. Do NOT
redo that work.

Phase 6 = closing the two time-gated Phase 5 items (soak closeout, customer-01
strict flip) plus finishing what strict-everywhere started: every live client
on its own named key, HQ observe pollers keyed, and the browser chat story
under strict. One demo tenant (customer-04, synthetic-culture) now exists —
keep it healthy; it is the onboarding reference.

## Environment (all live and healthy at handoff)

| Tenant | Host | Port | Release | Auth |
|---|---|---|---|---|
| staging | optimus-wan | 3022 | 20260805-1020 | strict |
| customer-03 (EI) | optimus-wan | 3021 | 20260805-1028 | **strict** (flipped ~2026-08-04T23:55Z) |
| customer-04 (demo) | optimus-wan | 3023 | 20260805-1000 | strict, synthetic-culture pack |
| customer-01 (AusMaker) | rodimus-wan | 3000 | 20260805-1032 | **lan** — flip is P6.1 |

Deploy: `bash scripts/webchat-deploy/release.sh <tenant>` (drain → gate →
rollback on failure). Order: staging → customer-03 → customer-01 (customer-04
last, it is the demo). Workers standalone on all tenants. SSH via ~/.ssh/config
(`optimus-wan`, `rodimus-wan`, `rodimus-wan-root` for system units).

## Hard constraints (unchanged)

1. NO REGEX in production code (`scripts/check-no-regex.js --zero`); empty-catch
   ratchet baseline **190** must not grow — lower it when you clean an area.
2. Unit tests per change; `npm test` (789) green after every item; routeParity green.
3. Additive migrations only; never lose sessions/jobs/state.
4. Gate failure ⇒ read the remote journal before retrying. New env keys go in
   `lib/config.js` SCHEMA + `npm run env:example`.
5. Locked decisions — do not re-litigate: file secrets (no KMS);
   drain-then-restart (no blue/green); billing/metering stays OUT.
6. Never `source` a remote `.env` in scripts — parse it (python3/node), quoting
   bites (see Phase 4 lesson).

## Phase 6 work items (execute in order; respect the two time gates)

P6.0  Phase 5 soak closeout (TIME GATE: after 2026-08-05T12:00Z):
      a. Capture `/api/ops/metrics` on all four tenants; diff against the
         interim snapshot in `docs/PIKO_PHASE5_ENACTED_20260805.md` (00:34Z)
         and the Phase 4 soak-start baselines.
      b. journalctl since the 2026-08-05 deploys: zero recurring errors, zero
         `orphaned_by_restart`, scheduler_run present on all tenants; explain
         every denial counter (staging plane_denied=6 and c04 plane_denied=10
         are eval-gate money probes — verify, don't assume).
      c. Mid-soak drain proof: enqueue a long job on staging, run
         `release.sh staging` while it runs, show drain honoured.
      d. C03 strict-watch audit: 401/unauthorized count in the C03 journal for
         the full 24h window since the flip (~2026-08-04T23:55Z). Zero or
         explained ⇒ proceed to P6.1. Any repeating 401 = a missed client: fix
         the client, do NOT roll back unless a customer-facing channel is down.
      e. Write the closeout section into the Phase 6 enactment doc.

P6.1  customer-01 strict flip (TIME GATE: after P6.0d passes, ~2026-08-05T23:55Z):
      a. Pre-flight: every C01 client sends a key — telegram listener (synced
         and keyed in Phase 5), adapters via `adapters/shared/pikoClient.js`
         (verify each running adapter unit/process actually has PIKO_API_KEY
         in its environment — inventory says several units do NOT), api-ping,
         intent-poller cron, AusMaker webhook (webhook secret, separate gate),
         iOS app (needs the ops key pasted in Settings — confirm with operator
         or accept that iOS chat breaks until they do; note the decision).
      b. Flip `PIKO_API_AUTH=lan → strict` in C01 spine `.env` (backup first),
         restart worker + webchat, probe: /api/chat 401 bare / 200 keyed,
         /api/observe/summary same. `lan` is the documented rollback.
      c. Watch the journal for 401s over the next hours; fix missed clients
         fast. Record the audit in the enactment doc.

P6.2  Named keys to real clients (finish P5.1c):
      a. Mint per-client keys on each tenant via secretsStore files
         (`api-key-telegram.json`, `api-key-ios.json`, `api-key-adapters.json`,
         `api-key-monitor.json`) — staging pattern from Phase 5 works.
      b. Move live clients off the shared key: telegram units, adapter env,
         api-ping/intent-poller env, HQ poller. Shared `api-key.json` stays as
         fallback — do not delete it this phase.
      c. HQ registry: add `observe_key` per tenant row so cross-host observe
         polling works under strict (inventory flagged rows lack it).
      d. Evidence: `/api/ops/metrics` or session meta showing distinct
         `api_key:<name>` principals per client; cross-key IDOR 403 re-probe
         on one customer tenant (staging proof exists; prove it on c03).

P6.3  Browser chat under strict:
      a. Public `index.html` chat sends no key — under strict it only works
         behind an admin session cookie. Decide + implement the minimal story:
         same-origin session-cookie chat after admin login (recommended — no
         new auth surface), and make the login flow obvious on the chat page
         when a 401 comes back. No new frameworks; keep it additive.
      b. Verify on staging and c03: logged-out chat → clear login prompt;
         logged-in chat → 200. Record transcript.

P6.4  server.js thin-down continuation (target <1,500; report honestly):
      a. Next extracts, one commit each, same snapshot-test discipline as
         bootJobs: Telegram/notify helpers, mobile URL + preferences helpers,
         intent/skill loading, webhook fanout. `handleRequest` dispatch and
         boot/validate stay.
      b. If <1,500 is not reached, say why with the remaining block sizes.

P6.5  Demo tenant upkeep (small):
      a. customer-04 has no legion adapter (checklist adapter=false) — either
         bring one up on :8011 via the compose pattern in
         `scripts/deploy-tenant-spine-optimus.sh` or record "spine-only demo"
         as the accepted state in the registry + enactment doc.
      b. Fix the LAN deploy script gap found in Phase 5:
         `deploy-tenant-spine-optimus.sh` times out from off-LAN (hardcoded
         192.168.0.190 path) — make it honour ~/.ssh/config (`optimus-wan`)
         like release.sh does.

## Verification (required)

1. `npm test` green after every item; regex zero; ratchet ≤190; parity green.
2. New tests: named-key principal per client name; browser 401→login-path
   behaviour (route-level test); each new lib module extracted from server.js
   gets a snapshot/unit test.
3. Live evidence in the enactment doc: P6.0 metrics deltas + drain transcript,
   C03 24h 401 audit, C01 flip probes + journal audit, named-key principal
   listing per tenant, browser chat transcript, final server.js line count.
4. Write `docs/PIKO_PHASE6_ENACTED_<date>.md`: what changed, file list, test
   count, live evidence, deferred items.

## Explicitly out of scope (do not do)

- Billing/metering (still needs operator product decisions).
- Blue/green deploys, KMS, encryption at rest, external log sinks.
- Rewriting chat pipeline internals (frozen).
- Deleting the shared api-key fallback (next phase, after named keys soak).
- New customer-facing features.

## First actions for the executing agent

1. Read the five context docs IN FULL.
2. `cd webchat-piko && npm test` — confirm 789 green before touching anything.
3. Check the clock: if past 2026-08-05T12:00Z do P6.0 first; if past
   ~2026-08-05T23:55Z and P6.0d is clean, proceed straight through P6.1.
   If neither gate is open yet, start P6.2a/P6.4 (no time gate) and return.
