# Phase 3 — Staging tenant and deploy drain notes

Date: 2026-08-04. Scope: P3.5 (staging spine + eval-gate golden probes).

## Staging tenant (Optimus)

| Field | Value |
|---|---|
| Tenant id | `staging` |
| Host | `optimus-wan` |
| Code path | `/home/chief/webchat-piko-staging` |
| Data path | `/home/chief/data/staging` (via `PIKO_DATA_DIR` in `.env`) |
| Port | `3022` |
| Webchat unit | `piko-webchat-staging.service` (user scope) |
| Worker unit | `piko-worker-staging.service` (user scope) |

Unit templates live in `scripts/webchat-deploy/piko-webchat-staging.service` and
`piko-worker-staging.service`. Install on Optimus:

```bash
cp scripts/webchat-deploy/piko-webchat-staging.service ~/.config/systemd/user/
cp scripts/webchat-deploy/piko-worker-staging.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now piko-webchat-staging.service piko-worker-staging.service
```

Bootstrap the spine (one-time, operator):

```bash
./scripts/deploy-tenant-spine-optimus.sh staging 3022 8011
# Then pin strict env + model pins to match customer-03; seed corpus snapshot from customer-03 data.
bash scripts/webchat-deploy/release.sh staging
```

Deploy order after P3.5: **staging → customer-03 → customer-01**.

## Eval gate — culture golden probes

For `staging`, `customer-03`, and `ei`, `scripts/webchat-deploy/eval-gate.sh` runs:

1. **Osireion opinion** (hard): authenticated `POST /api/chat` with the standard
   Osireion conclusions question. Fails if reply is empty or contains
   `insufficient corpus` (case-insensitive).
2. **Thread alias** (soft, non-blocking): on-box `resolveThreadAlias('osireion')`
   must be `abydos`; invented ids must stay unknown. Logs WARN only.
3. **Campaign status** (hard): existing grounded-status probe — status question
   must answer with live cycle numbers, not dispatch a job.

Gate failure triggers rollback via `release.sh`, unchanged.

## Residual gap — zero-downtime NOT required

This phase accepts **drain-then-restart** as the deploy bar (P3.2d):

- `release.sh` signals the standalone worker (`SIGUSR1` + `.drain` file), waits up
  to 90s for running jobs to finish a step, then restarts worker + webchat.
- Brief unavailability during restart is expected and acceptable.
- **Not in scope:** blue/green, socket handoff, or rolling multi-instance deploys.
- `orphaned_by_restart` should become rare; the boot reaper remains as backstop.

Document deferred to Phase 4+ if a second production customer or external SLA requires
continuous availability during code pushes.
