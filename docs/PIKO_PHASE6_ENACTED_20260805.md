# Piko Phase 6 — Enacted (partial: P6.2–P6.5; time gates open later)

Enactment date: 2026-08-05. Handoff:
`docs/PIKO_PHASE6_STRICT_COMPLETION_AND_KEY_ROLLOUT_HANDOFF_20260805.md`.

Session clock at start: **2026-08-05T01:44Z** — both time gates closed
(P6.0 after 12:00Z; P6.1 after ~23:55Z C03 watch). Executed ungated items
P6.2–P6.5; return for P6.0/P6.1 when due.

Local verification: **797** tests green, regex zero, empty-catch **190**.
`server.js` **2789** lines (was 2938 after Phase 5).

## What changed

### P6.0 Soak closeout — DEFERRED
Due after **2026-08-05T12:00Z**. Do not invent deltas; capture then.

### P6.1 customer-01 strict flip — DEFERRED
Requires P6.0d (C03 24h 401 audit clean) ≈ after **2026-08-05T23:55Z**.
C01 remains `PIKO_API_AUTH=lan`. Pre-work done: telegram listener now uses
named `api-key-telegram` (verified `matches_telegram_named=true`).

### P6.2 Named keys to real clients
**a. Minted** on all four tenants under `$PIKO_DATA_DIR/secrets/`:
`api-key-telegram.json`, `api-key-ios.json`, `api-key-adapters.json`,
`api-key-monitor.json`, plus seeded `api-key.json` from env where missing.
Script: `scripts/mint-named-api-keys.js`.

**b. Wired off shared key (live):**
- C01 telegram: systemd drop-in
  `/etc/systemd/system/piko-telegram-listener.service.d/named-api-key.conf`
  → `EnvironmentFile=/home/chief/piko-client-env/telegram.env`
- C01 api-ping: same pattern with `monitor.env`
- Shared `api-key.json` / `PIKO_API_KEY` in spine `.env` retained as fallback
- Adapters not currently running on C01 — keys minted for when they return;
  iOS key minted (operator pastes into Settings)

**c. HQ observe keys (no secrets in git):**
- Registry rows for c01/c03/c04: `"observe_key_secret": "api-key-monitor"`
- `tenantRegistry.buildHqStatus` resolves via `secretsStore.getSecret`

**d. Cross-key IDOR on customer-03 (live):**
```
matchA { name: 'telegram' }
matchB { name: 'ios' }
B_access { ok: false, status: 403, error: 'session_forbidden' }
A_access { ok: true, owner: 'api_key:telegram' }
```

### P6.3 Browser chat under strict
- `public/index.html`: all chat fetches use `credentials: 'include'`; on 401
  show **Sign in to chat** → `/admin/login?next=…`
- Test: `tests/browserChatAuth.test.js`
- Live staging: `GET /` → 200; bare `POST /api/chat` → **401** (login required)

### P6.4 server.js thin-down
Extracts (with unit tests):
| Module | Role |
|---|---|
| `lib/telegramNotify.js` | admin/Telegram notify wrapper |
| `lib/mobileHelpers.js` | prefs, intent snapshot, LAN/public URLs |
| `lib/proactiveWebhook.js` | pending feed + webhook fanout |

**Final line count: 2789** (target &lt;1500 not reached). Remaining mass is
`handleRequest` dispatch, Ollama/chat helpers, allowlist/learning, boot side
effects — further extracts still safe follow-ups.

### P6.5 Demo tenant + deploy script
- customer-04 accepted as **spine-only demo** (no legion adapter); registry note set
- `_optimus_remote.sh` default host → **`optimus-wan`** + BatchMode (fixes
  off-LAN timeout to bare `optimus` / 192.168.0.190)

### Post-review fix (02:15Z): customer-04 LLM wedge
Review spot-check found c04 `/api/health` → `llm: unreachable` and `/api/chat`
hanging (journal: `decide_fail: This operation was aborted`, latency 150s).
Root cause: c04 `.env` had `OLLAMA_URL=http://127.0.0.1:11434` (CPU-only local
Ollama on Optimus) while staging/c03 use the GPU muscle rig at
`192.168.0.190:11434`. Fix applied live (`.env` backup
`.env.bak-ollamaurl-20260805`, service restart); verified `chat 200 "OK"` in
~5s and `health {ok:true}`. `scripts/provision-tenant.sh` template default
updated to the muscle rig URL so future tenants don't inherit the bad default.

## Releases live (this session)

| Tenant | Release | Auth |
|---|---|---|
| staging | `20260805-1150-3c2e84bc` | strict |
| customer-03 | `20260805-1157-3c2e84bc` | strict |
| customer-01 | `20260805-1200-3c2e84bc` | **lan** |
| customer-04 | `20260805-1202-3c2e84bc` | strict (demo) |

Note: first staging attempt `20260805-1148` rolled back (TDZ on
`mergeMobilePreferences` before require) — fixed before successful redeploy.
One c03 attempt rolled back on flaky grounded-status LLM probe; retry PASS.

## Key files
- `scripts/mint-named-api-keys.js`
- `webchat-piko/lib/{secretsStore,apiAuth,sessionOwner,tenantRegistry}.js` (P5+P6)
- `webchat-piko/lib/{telegramNotify,mobileHelpers,proactiveWebhook}.js`
- `webchat-piko/public/index.html`
- `webchat-piko/tests/{browserChatAuth,mobileHelpers,proactiveWebhook,telegramNotifyExtract}.test.js`
- `legion-tenants/registry.json` (`observe_key_secret` refs only)
- `scripts/webchat-deploy/_optimus_remote.sh`

## Deferred / next actions
1. **P6.0** after 12:00Z — metrics deltas, journal, mid-soak drain, C03 24h 401 audit
2. **P6.1** C01 `lan→strict` after P6.0d clean
3. Wire running adapters (when up) to `api-key-adapters` env drop-in
4. Operator: paste iOS named key into Settings before C01 flip
5. Continue `server.js` extracts toward &lt;1500
6. Do **not** delete shared api-key fallback this phase

## Explicitly out of scope (honoured)
Billing, blue/green, KMS, chat pipeline rewrite, deleting shared key fallback.
