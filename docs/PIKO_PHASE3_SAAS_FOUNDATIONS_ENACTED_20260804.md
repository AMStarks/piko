# Piko Platform Hardening — Phase 3 enacted (SaaS foundations)

Enacted: 2026-08-04. Follows `docs/PIKO_PHASE3_SAAS_FOUNDATIONS_HANDOFF_20260804.md`.
Phases 0–2 remain as previously enacted.

## Verdict

Phase 3 work items **P3.1–P3.7** are implemented in tree and covered by unit tests.
**Live deploy** (staging → customer-03 → customer-01) and 24h soak probes are **not** done in this session — operators must run `release.sh` after installing worker units and setting `PIKO_WORKER_STANDALONE=1` + confirming `PIKO_API_AUTH` (default is now `strict`).

## Test count

**752** tests passing (`webchat-piko` `npm test`) at enactment.

## What changed (by work item)

### P3.1 — server.js decomposition
- Route parity fixture + `tests/routeParity.test.js`
- Extracted routes: `webhooks`, `admin`, `ops`, `agents`, `cultures`, `chat`, `mobile`, `control`
- `lib/chatPipeline.js` — `createHandleApiChat(deps)` holds the former `handleApiChat` body
- `lib/scheduler.js` — boot crons/intervals registered with `tenantGate` + `scheduler_run` logs
- `server.js` ≈ **4,890** lines (was ~12,782 at handoff; target &lt;1,500 deferred — remaining bulk is boot helpers + static/misc handlers)

### P3.2 — standalone worker
- `scripts/agent-worker.js` + `startStandaloneWorker`; drain via SIGUSR1 / `.drain` file
- `PIKO_WORKER_STANDALONE=1` → chat process reaper-only
- Systemd templates: `piko-worker.service`, `piko-worker-customer-03.service`
- `release.sh` pre-restart drain (up to 90s)
- Bounded JSONL: `lib/jsonlBounded.js` on activity / campaign cycles / scorecard / HQ audit
- Belief/memory/weekly-retro crons enqueue jobs for the worker

### P3.3 — tenant isolation
- `PIKO_API_AUTH` default **`strict`**
- `/api/agents` on `isProtectedApiPath`; eval-gate authenticates with tenant API key
- Session owner meta + IDOR 403; shared `main` / automation / eval-gate sessions
- `conversations.db` additive `tenant_id` + `session_meta`
- `culturesDataRoot` / legateTools prefer `PIKO_DATA_DIR/egyptian-insights` (legacy WARN)

### P3.4 — privilege planes + prompt boundary
- `lib/privilegePlanes.js` — chat/work/config/money; `plane_denied` logs; money needs confirm
- Work-plane gate on mutating `/api/agents/*`
- `lib/promptBoundary.js` — quoted-material delimiters on RAG, opinion material, corpus notes

### P3.5 — staging + gate goldens
- `staging` tenant in `tenants.conf` (:3022) + systemd templates
- Culture eval-gate: Osireion opinion (hard), thread-alias (soft), campaign status (hard)
- Notes: `docs/PIKO_PHASE3_STAGING_AND_DRAIN_NOTES_20260804.md`

### P3.6 — secrets + data lifecycle
- `lib/secretsStore.js` under `PIKO_DATA_DIR/secrets/` (0600, current/previous)
- API key + webhook verification try store then env
- `scripts/tenant-data.js` export | quarantine-delete
- Encryption at rest: deferred (host disk encryption)

### P3.7 — ontology pack (threads/aliases)
- `lib/ontologyPack.js` + `config/ontology/culture.json`
- Wired through `eiThreadDossiers` with hardcoded fallback
- Deferred to Phase 4: agent roster, EI few-shots, opinion preamble, capability cards

## Key commits (Phase 3 chain)

| Commit | Item |
|--------|------|
| `1014b48`…`bb0c28b` | P3.1a/b/d routes + scheduler |
| `3568b44` / `18cafd6` | mobile / control routes |
| `794cacc` | P3.1c chatPipeline |
| `4998fc6` | P3.2 worker + drain + JSONL |
| `8cd865c` | P3.3 isolation |
| `5da6afa` | P3.4 planes + boundary |
| `09e801b` | P3.5 staging + goldens |
| `479f2ab` | P3.6 secrets + tenant-data |
| `9a51061` | P3.7 ontology threads |

## Deploy checklist (operator)

1. Install worker units; set `PIKO_WORKER_STANDALONE=1` on chat `.env` (SCHEMA-declared).
2. If a tenant still needs private-IP trust without keys, set `PIKO_API_AUTH=lan` explicitly.
3. Confirm distinct `PIKO_API_KEY` / `PIKO_YOLO_API_KEY` / `PIKO_HEALTH_API_KEY` / webhook secrets per tenant (P3.3f).
4. Optional: migrate secrets into `PIKO_DATA_DIR/secrets/{api-key,webhook}.json`.
5. Deploy order: `release.sh staging` → `customer-03` → `customer-01`.
6. Live probes: unauth `/api/agents/jobs` → 401; foreign session history → 403; Osireion + pause/resume + `/api/ops/metrics`.

## Deferred / residual

- Thin `server.js` fully to &lt;1,500 lines (more route/static extraction).
- Ontology: prompts/agents/few-shots (Phase 4).
- Encryption at rest; blue/green zero-downtime (drain-then-restart is the bar).
- Live staging provision + 24h soak metrics report.
