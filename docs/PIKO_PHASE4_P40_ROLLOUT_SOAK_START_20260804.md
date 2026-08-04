# Phase 4 — P4.0 rollout soak start

Date: 2026-08-04. Soak clock starts **2026-08-04T08:46:00Z**.

## Deployed releases

| Tenant | Host | Release | Gate | Auth mode | Worker |
|---|---|---|---|---|---|
| staging | optimus-wan :3022 | `20260804-1838-cfa96b47` (+ later code via subsequent pushes) | PASS | `strict` | standalone unit active |
| customer-03 | optimus-wan :3021 | `20260804-1843-af2a2772` | PASS | `lan` (explicit) | standalone unit active |
| customer-01 | rodimus-wan :3000 | `20260804-1837-cfa96b47` | PASS | `lan` (explicit) | standalone unit active |

## P4.0a staging provision

- Path `/home/chief/webchat-piko-staging`, data `/home/chief/data/staging`
- Distinct API / YOLO / health / webhook / admin keys
- Shares C03 Legion adapter `:8010` and corpus at `/home/chief/data/egyptian-insights` (read)
- Units: `piko-webchat-staging.service`, `piko-worker-staging.service` (user scope)

## P4.0b env audit decisions

- Default code auth is `strict`; **live C03/C01 kept on `PIKO_API_AUTH=lan`** until adapters/iOS present keys everywhere.
- Staging runs **`strict`** as the canary.
- `PIKO_WORKER_STANDALONE=1` set on all three chat `.env`s; worker units installed/enabled.
- Quoted `PIKO_LEGION_BUSINESS_UNIT_DEFAULT` on C01 (unquoted space broke `source .env`).

## Live probes (staging)

| Probe | Result |
|---|---|
| unauth `GET /api/agents/jobs` | **401** `unauthorized` |
| auth `GET /api/agents/jobs` (API key) | **200** |
| unauth chat history | **401** |
| pause/resume campaign (API key) | **200** after cultures fix |
| `/api/ops/metrics` (API key) | **200** |
| kill worker; chat health | webchat stayed up; worker restarted |
| Osireion / grounded status | gate PASS |

## Fixes landed during rollout

1. Deploy health probes honour `PIKO_HEALTH_API_KEY` (`5aff6e3`)
2. API key satisfies admin-protected API paths (`526bcdf`)
3. Cultures campaign `adminAuth` ReferenceError + API key for operator actions (`67ced38`)
4. Safe `.env` parse (no shell source) in release/eval-gate (`1cd5ac5`)

## Metrics baseline (soak T0)

**staging** — chat p95 ~16.5s (cold), jobs idle, ollama errors 0  
**customer-03** — chat p95 ~13.8s, jobs done=300 historical, ollama errors 0  
**customer-01** — chat samples 0 at T0, ollama errors 0, worker+webchat active  

## Soak checklist (T+24h)

- [ ] `journalctl` clean of new recurring errors on all three
- [ ] `/api/ops/metrics` before/after comparison
- [ ] `scheduler_run` lines present
- [ ] `plane_denied` / `session_forbidden` counts reviewed
- [ ] No `orphaned_by_restart` spike after a mid-soak `release.sh`

## Notes

- Concurrent staging+C03 release overloaded Ollama once → C03 gate `parse_fail` → rollback; solo redeploy PASS.
- C01 `/api/agents` returns 404 `agent orchestration not enabled` — expected on this spine; gate SKIP is correct.
- Session IDOR 403 across principals needs a follow-up probe (shared `api_key:shared` principal masks key-vs-key cases).
