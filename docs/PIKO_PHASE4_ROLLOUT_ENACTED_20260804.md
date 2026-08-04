# Piko Platform Hardening — Phase 4 enacted

Date: 2026-08-04. Handoff: `docs/PIKO_PHASE4_ROLLOUT_AND_PRODUCTIZATION_HANDOFF_20260804.md`.

**Verdict:** P4.0–P4.6 implemented in tree and redeployed to staging → customer-03 → customer-01. **783 tests green.** Empty-catch baseline **191**. Regex zero. Soak clock still open (T0 08:46Z; full 24h closeout deferred to operator).

## Live releases (redeploy after full Phase 4)

| Tenant | Release | Gate |
|---|---|---|
| staging | `20260804-2148-0dc6d49a` | PASS |
| customer-03 | `20260804-2152-0dc6d49a` | PASS |
| customer-01 | `20260804-2157-0dc6d49a` | PASS (money dual-confirm OK) |

Workers + webchat **active** on all three. Deployed trees include P4.1 `denyIfUnconfigured`, `routes/yolo.js`, ontology P4.3, money plane, ops P4.6 fields.

Auth posture: staging **`strict`**; C03/C01 **`lan`** (explicit) + `PIKO_WORKER_STANDALONE=1`.

## Item outcomes

### P4.0 — Live rollout
- Staging provisioned (:3022), distinct keys, shared adapter :8010 + corpus.
- Worker units installed on all tenants; drain path exercised by `release.sh`.
- Probes: unauth agents → 401; pause/resume; ops/metrics; Osireion gate goldens.
- Soak start: `docs/PIKO_PHASE4_P40_ROLLOUT_SOAK_START_20260804.md` (T0 08:46Z).
- **Deferred:** formal T+24h metrics delta / journal soak closeout.

### P4.1 — Admin fail-closed
- `adminAuth.mustFailClosed` / `denyIfUnconfigured` → 503 `admin_auth_unconfigured` under `PIKO_ENV_STRICT` when no password and no dashboard users.
- Boot ERROR once; tests in `tests/adminFailClosed.test.js`.
- Commit: `69e9a06`.

### P4.2 — server.js decomposition
- Extracted: static, state, notifications, ausmaker, hq, mind, dashboard, misc, iosHub, yolo (+ prior Phase 3 routes).
- **`server.js` ≈ 3343 lines** (was ~4890 at Phase 3 end / ~4773 mid-P4). Target &lt;1500 **not met** — remaining mass is non-route boot/helpers/Telegram/chat wiring, not API fall-throughs.
- Empty-catch lowered to **191**.
- Commits: `7adae20` … `ec4a2e3`.

### P4.3 — Ontology pack completion
- Pack overrides: agent roster, understand few-shots, opinion preamble, capability card (+ threads/aliases from P3.7).
- `config/ontology/synthetic-culture.json` + P4.3a/b tests.
- Commit: `7133bf6`.

### P4.4 — Money plane end-to-end
- Dual-confirm on yolo-tool, hitl approve, ios-hub yolo_tool, PO chat lanes (`moneyMutatePending` / `moneyPlaneGate`).
- Eval-gate probe; C01 proves 403 `money_confirm_required`.
- Commits: `fdaad7d`, `79c6ef2` (gate auth fix: API key + YOLO bearer).

### P4.5 — Tenant onboarding
- `scripts/provision-tenant.sh <id> <profile> <port> [--dry-run]`
- Site/knowledge/ontology seed, env.template + secrets-seed, unit templates, tenants.conf + registry.
- Commit: `0bf326b`.

### P4.6 — Observability floor
- `/api/ops/metrics`: scheduler failures_by_id, worker pending/oldest/drain, denials, secrets ages.
- `opsThresholdAlarms` scheduler job → `notifyAdmin` (queue stuck / job streak / chat p95).
- Commit: `0bf326b`.

## Key files

- `webchat-piko/routes/{static,state,notifications,ausmaker,hq,mind,dashboard,misc,iosHub,yolo}.js`
- `webchat-piko/lib/{adminAuth,ontologyPack,moneyPlaneGate,moneyMutatePending,opsMetrics,opsThresholdAlarms}.js`
- `scripts/provision-tenant.sh`
- `scripts/webchat-deploy/{release,eval-gate,rollback}.sh`, `tenants.conf`
- `webchat-piko/config/ontology/{culture,synthetic-culture}.json`

## Fixes during rollout (not in original handoff)

1. Health probes honour `PIKO_HEALTH_API_KEY` (`5aff6e3`)
2. API key satisfies admin-protected API paths (`526bcdf`)
3. Cultures campaign `adminAuth` ReferenceError (`67ced38`)
4. Safe `.env` parse in release/eval-gate (`1cd5ac5`)
5. Money eval-gate dual headers (`79c6ef2`)

## Deferred / residual

1. **24h soak closeout** — capture T+24h metrics vs soak-start baselines; review `plane_denied` / `session_forbidden` / orphans.
2. **`server.js` &lt;1500** — needs helper/boot extraction beyond routes.
3. **Session IDOR cross-principal 403** — shared `api_key:shared` masks key-vs-key cases; probe with admin vs key.
4. Flip C03/C01 to `PIKO_API_AUTH=strict` only after every adapter/iOS client presents keys.
5. Money culture probes soft-skip (expected); keep C01 as the hard money gate.

## Verification

```text
npm test → 783 pass
check-no-regex --zero → OK
check-empty-catch → 191 <= 191
release.sh staging|customer-03|customer-01 → PASS
```
