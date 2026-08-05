# P5.1a — Spine client inventory (strict-auth readiness)

Date: 2026-08-05. Source: tree audit + live unit/env patterns (no secrets).

Under `PIKO_API_AUTH=strict`, `/api/*` (except health/ping/admin login) requires
admin cookie, `X-Piko-Key`, Bearer, or `?piko_key=`. Loopback IP trust is gone.

| Client | Tenant | Sends key? | Env likely set? | Strict risk |
|---|---|---|---|---|
| adapters/* via pikoClient.js | C01 | if `PIKO_API_KEY` | unlikely in units | BROKEN until env |
| telegram-bot/bot.js | C01 | **no** | — | BROKEN (code) |
| piko_telegram_listener.py | C01/C03 | **no** | spine .env unused | BROKEN (code) |
| lib/chatClient → intent-poller | per-host | **no** | — | BROKEN (code) |
| legion-schedule-handler.js | per-host | **no** | — | BROKEN (code) |
| api-ping (observe) | C01 | **no** | — | BROKEN (code) |
| legion-watch (health only) | C01 | n/a | — | OK |
| doctor (health) | optional | n/a | — | OK |
| eval-gate.sh | target | yes from .env | yes | OK |
| ei-topic-smoke.sh | C03 | yes | if set | OK |
| HQ observe poller | C01/C03 | if `observe_key` | registry lacks it | BROKEN |
| Piko-iOS chat/ios-hub | user URL | **ops only** | Settings empty | BROKEN (code) |
| Browser index.html chat | same-origin | no | — | needs session/key |
| AusMaker inventory webhook | C01 | webhook secret | separate gate | N/A for API auth |
| proactive/smoke scripts | local | mostly no | — | BROKEN (ops tools) |

**Fix order before flip:** telegram (node+py), chatClient, legion-schedule-handler,
api-ping, iOS chat/hub auth, adapter env keys, HQ observe_key, then C03 → C01 flip.

## Fixes applied (tree)

| Client | Change |
|---|---|
| piko_telegram_listener.py | `_piko_api_headers()` → X-Piko-Key |
| telegram-bot/bot.js | `pikoApiHeaders()` on /api/chat + inject |
| lib/chatClient.js | authHeaders() |
| legion-schedule-handler.js | X-Piko-Key on ios-hub POST |
| api-ping-site.js | X-Piko-Key on GETs |
| Piko-iOS PikoAPI.swift | applyOpsAuth on chat + all ios-hub |
| secretsStore / apiAuth / sessionOwner | named keys → `api_key:<name>` |
| adminAuth isMonitorBypass | strict requires key; lan keeps loopback |

Live note (2026-08-04T23:43Z): staging already strict (observe 401 without key,
200 with key). C01 telegram unit EnvironmentFile loads spine `.env` (key present);
must sync listener.py to `/home/chief/piko-os` before C01 flip.
