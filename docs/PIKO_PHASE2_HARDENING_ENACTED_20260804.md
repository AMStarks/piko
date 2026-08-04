# Phase 2 platform hardening — enacted 2026-08-04

Status: **ENACTED** on customer-03 (EI) and customer-01 (AusMaker).
Source plan: `docs/PIKO_PLATFORM_CODE_REVIEW_20260804.md` (Recommended sequencing Phase 2 / items 13–18).
Prior: `docs/PIKO_PHASE0_1_HARDENING_ENACTED_20260804.md`.

## What changed

### P2.1 — Atomic durable state
| ID | Change |
|---|---|
| P2.1a | `lib/atomicJson.js` — `atomicWriteJson` (tmp+fsync+rename), `readJsonSafe`, `atomicAppendJsonl` |
| P2.1b | Hot-path writers switched: intents, mind, agentJobs, campaign `saveState`, `configManager`, notification feed |
| P2.1c | `writeJob` is write-dest-then-unlink-old (no job-loss window) |
| P2.1d | `notificationFeed` append-only JSONL + async compaction (no whole-file RMW) |

### P2.2 — Config schema
| ID | Change |
|---|---|
| P2.2a | Declarative `SCHEMA` in `lib/config.js` (~76 keys: ports, models, auth, queue/tenant, EI dirs, common prod pins) |
| P2.2b | Boot validate; `PIKO_ENV_STRICT=1` warns on unknown `PIKO_*` and requires critical pins |
| P2.2c | `scripts/generate-env-example.js` → `.env.example` |
| P2.2d | **`PIKO_ENV_STRICT=1` enabled on customer-03** after schema expand removed false typo flood |

### P2.3 — Classified-but-unhandled intents
| ID | Change |
|---|---|
| P2.3a | Authoritative `campaign_control` → `runCampaignControlAction` directly (decide remains for work orders) |
| P2.3b | `schedule_request` / `config_change` / `agent_command` → safe explicit replies (never persona / never work-order) |
| P2.3c | Structured `chat_route` / `chat_turn` lines |
| hotfix | When Legate is on, Flag-rules interceptor only runs on explicit flag-policy language (was stealing “pause the research campaign”) |

### P2.4 — Observability floor
| ID | Change |
|---|---|
| P2.4a | Real pino logger → `logs/piko.jsonl` (stdout under tests); chat/job/opinion structured lines |
| P2.4b | `GET /api/ops/metrics` (admin-gated via `/api/ops` prefix) |
| P2.4c | `unhandledRejection` / `uncaughtException` handlers; counters in metrics |
| P2.4d | `scripts/check-empty-catch.js` ratchet (baseline 204) wired into `npm test` |

### P2.5 — Job runtime honesty
| ID | Change |
|---|---|
| P2.5a | Timeout path already stamped `cancel_requested` (verified) |
| P2.5b | Stale reaper stamps `cancel_requested` (+ hard-closes foreign/unowned) |
| P2.5c | `lib/jobDeadline.js` + `runSteps` caps seek/tool timeouts from remaining budget (−60s reserve) |
| P2.5d | `claim_owner` (`host:pid`) on pending→running; owning worker soft-cancels, reaper handles the rest |

### P2.6 — Grounded identity / feedback
| ID | Change |
|---|---|
| P2.6a | `identity_capability` → static capability card (tenant name + research/corpus/campaigns/status) |
| P2.6b | `feedback` → append `feedback.jsonl` + honest ack |
| P2.6c | Expert-opinion success emits structured `expert_opinion` line |

## Commits

| Hash | Summary |
|---|---|
| `eb41adb` | P2.1/P2.5 atomic state + job honesty |
| `5f84808` | P2.2 config schema + `.env.example` |
| `c88f14f` | P2.3/P2.4/P2.6 handlers, metrics, identity |
| `be9b644` | Flag-rules must not steal campaign_control |
| `6451c74` | Expand schema for usable strict mode |

## Tests

```
npm test  →  685 pass / 0 fail
  (includes no-regex ratchet + empty-catch ratchet + phase2Hardening.test.js)
```

## Live probes (customer-03)

### A — Campaign pause / resume (operator session)
Ask: *pause the research campaign* → `route=legate_control`, campaign `paused=True`.  
Ask: *resume the campaign* → `route=legate_control`, campaign `paused=False`.

### B — Identity
Ask: *who are you and what can you do?* → grounded capability card (Egyptian Insights); no persona filler.

### C — `/api/ops/metrics` (admin cookie)
Sample after probes:
```json
{
  "ok": true,
  "chat": { "turns": 4, "p50_ms": 5387, "p95_ms": 22511 },
  "ollama": { "queue": { "enabled": true, "user": 0, "background": 0 } },
  "jobs": { "counts": { "pending": 0, "running": 1, "done": 300 } },
  "process": { "unhandled_rejections": 0, "uncaught_exceptions": 0 }
}
```

### D — Osireion regression
Ask: *Have you come to any conclusions on the Osireion and its possible origins?*  
→ `legate_answer`, cites Petrie / Abydos; not “insufficient corpus” / not Giza-empty.

## Deploy stamps

| Tenant | Host | Stamp | Notes |
|---|---|---|---|
| customer-03 | optimus-wan `:3021` | `20260804-1510-b414da2e` | gate PASS; `PIKO_ENV_STRICT=1` |
| customer-01 | rodimus-wan `:3000` | `20260804-1508-a267e0e2` | gate PASS; strict **not** enabled |

## Deferred (Phase 3 / later)

- `server.js` route/module decomposition; move crons out of process
- Real tenant isolation / secrets manager / privilege planes / staging tenant
- Full SQLite migration of jobs/campaign (atomic JSON sufficient this phase)
- Mass `console.*` → pino replacement
- Eval-gate still cannot hit `/api/cultures/campaign` without admin cookie (401) — cosmetic SKIP
- Remaining undeclared `PIKO_*` keys can be added to SCHEMA as discovered under strict WARN
