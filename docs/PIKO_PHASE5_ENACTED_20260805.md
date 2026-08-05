# Piko Phase 5 — Enacted (strict auth + scale proof)

Enactment date: 2026-08-05. Handoff:
`docs/PIKO_PHASE5_STRICT_AUTH_AND_SCALE_HANDOFF_20260805.md`.
Phases 0–4 unchanged (`e62e427` baseline). Local verification at close of this
session: **789** tests green, regex zero, empty-catch baseline **190**.

## What changed

### P5.0 Soak closeout — DEFERRED
Due after **2026-08-05T12:00Z** (T+24h from final Phase 4 deploys). Session
started ~2026-08-04T23:38Z; closeout not yet due. Capture metrics/journal/drain
when past that cutoff and append a “P5.0 closeout” section here.

Interim live snapshot (2026-08-05T00:34Z):

| Tenant | Auth | denials | worker |
|---|---|---|---|
| staging | strict | plane_denied=6 | idle |
| customer-03 | **strict** (flipped this phase) | plane_denied=2 | idle |
| customer-04 | strict (new demo) | plane_denied=10 | idle |
| customer-01 | **lan** (24h watch after C03) | plane_denied=2 | idle |

### P5.1 Strict auth everywhere
**a. Client inventory** — `docs/PIKO_PHASE5_CLIENT_INVENTORY_20260805.md`.

**Code/env fixes before flip:**
- `piko_telegram_listener.py` → `_piko_api_headers()` / `X-Piko-Key`
- `telegram-bot/bot.js` → `pikoApiHeaders()`
- `webchat-piko/lib/chatClient.js`, `scripts/api-ping-site.js`,
  `scripts/legion-schedule-handler.js` → send key when set
- `Piko-iOS/Piko/PikoAPI.swift` → `applyOpsAuth` on chat + all ios-hub calls
- Live: synced listener to `/home/chief/piko-os` on Rodimus; unit already loads
  spine `.env` (`PIKO_API_KEY` present)

**b. Auth flip**
- staging: already strict (canary)
- **customer-03: `lan` → `strict`** at ~2026-08-04T23:55Z — probes: observe/chat
  401 without key, 200 with key. Journal 401 count since flip: **0** (no missed
  clients observed yet). Rollback: set `PIKO_API_AUTH=lan`.
- **customer-01: still `lan`** — flip after ≥24h clean C03 soak (handoff order).

**c. Named API keys / principals**
- `secretsStore.matchNamedApiKey` + `listApiKeySecretNames`
- `apiAuth.matchApiKey` → principal `api_key:<name>` (`shared` for `api-key.json`)
- Live staging: seeded `api-key-client-a/b.json`; assertSessionAccess B→A session
  → **403 `session_forbidden`**; A→A allowed.

**d. Monitor bypass**
- Under `strict`, loopback alone no longer bypasses admin gate; API key required.
- `lan`/`off` keep loopback for migration. Comment + test in `namedApiKeys.test.js`.

### P5.2 server.js thin-down
- Extracted boot scheduler registrations → `lib/bootJobs.js` (27 job ids;
  snapshot test).
- **Final `server.js` line count: 2938** (was ~3343). Target &lt;1500 not reached:
  remaining mass is request wiring, helpers (mobile/Telegram/URL), and chat/boot
  side-effects — further extracts are safe follow-ups, not blocking strict auth.

### P5.3 Onboarding dress rehearsal (customer-04)
- Ran `scripts/provision-tenant.sh customer-04 culture 3023` (real).
- Seeded **synthetic-culture** ontology (`moonbase→lunar-base`; Osireion absent).
- Brought spine up on Optimus `:3023` via `optimus-wan` (LAN deploy script timed
  out to `192.168.0.190` — rough edge noted).
- **Eval-gate PASS** with synthetic probes:
  - `osireion opinion: SKIP (synthetic-culture)`
  - `thread-alias: OK (moonbase→lunar-base; osireion absent — pack isolation)`
- **Operator decision: leave as permanent demo tenant** (`registry` status=`demo`).
- Rough edges fixed in tooling:
  - provision env now includes `PIKO_LEGATE_MODEL` / `PIKO_UNDERSTAND_MODEL` /
    Ollama defaults (strict boot was failing without them)
  - culture profile seeds `synthetic-culture.json`
  - eval-gate recognizes `customer-04` + synthetic pack; loads `.env` for
    `PIKO_DATA_DIR` before ontology probes

### P5.4 Alarm verification
- Forced thresholds via `evaluateAndNotify`:
  - staging: `chat_p95` → notification-feed logged (no Telegram token on staging)
  - customer-01: `queue_stuck`, `job_failure_streak`, `chat_p95` → feed +
    **Telegram `sent`** (2026-08-05T00:25Z)
- Eval-gate soft probe: `/api/ops/metrics` must expose `denials`, `worker`,
  `scheduler` — green on staging/c03/c01.

## Releases live (this phase)

| Tenant | Release stamp | Auth |
|---|---|---|
| staging | `20260805-1020-86d8a6d9` | strict |
| customer-03 | `20260805-1028-86d8a6d9` | **strict** |
| customer-04 | `20260805-1000-86d8a6d9` | strict (demo) |
| customer-01 | `20260805-1032-86d8a6d9` | lan (pending flip) |

## Key files

- `docs/PIKO_PHASE5_CLIENT_INVENTORY_20260805.md`
- `webchat-piko/lib/secretsStore.js`, `apiAuth.js`, `sessionOwner.js`, `adminAuth.js`
- `webchat-piko/lib/bootJobs.js`, `tests/bootJobs.test.js`, `tests/namedApiKeys.test.js`
- `webchat-piko/lib/chatClient.js`, `scripts/api-ping-site.js`, `legion-schedule-handler.js`
- `piko_telegram_listener.py`, `telegram-bot/bot.js`, `Piko-iOS/Piko/PikoAPI.swift`
- `scripts/provision-tenant.sh`, `scripts/webchat-deploy/{tenants.conf,eval-gate.sh}`
- `sites/customer-04/` (env.template gitignored), `knowledge/customer-04/`

## Deferred / follow-ups

1. **P5.0 soak closeout** after 2026-08-05T12:00Z (metrics deltas, journal, mid-soak drain).
2. **customer-01 `lan` → `strict`** after ≥24h clean C03 (no 401 storms).
3. `server.js` further extracts toward &lt;1500 (mobile helpers, Telegram helpers).
4. Per-client named keys issued to live adapters/iOS (shared key remains fallback).
5. HQ registry `observe_key` rows for cross-host pollers under strict.
6. Browser public chat under strict still needs admin session or a keyed dashboard.

## Explicitly out of scope (honoured)

Billing/metering, blue/green, KMS, encryption-at-rest sinks, chat pipeline rewrite.
