# Piko scripts

## piko-cli.js — Global CLI (Phase 4)

Run from repo root:

```bash
node scripts/piko-cli.js chat "your message"   # POST to /api/chat, print reply
node scripts/piko-cli.js doctor                # GET /api/health and /api/control, print status
node scripts/piko-cli.js intents               # GET /api/intents, list intent orders
```

**Env:** `PIKO_WEBCHAT_URL` (default `http://localhost:3000`). On Optimus or remote, set to your WebChat URL.

**Convenience:** From repo root you can use npm:

```bash
npm run piko -- chat "hello"
npm run piko -- doctor
npm run piko -- intents
```

Or add a shell alias so you can run `piko chat "hello"` anywhere:

```bash
alias piko='node /path/to/Piko/scripts/piko-cli.js'
```

## webchat-deploy/

Deploy WebChat to Optimus, systemd, runbooks. See **webchat-deploy/PHASE2_RUNBOOK.md**.

## webchat-piko/scripts/

- **heartbeat.js** — MEMORY suggestions, optional Telegram nudge. See webchat-piko/scripts/README.md.
- **intent-poller.js** — Process reminders and scheduled intents every 5 min. See webchat-piko/scripts/README.md.
