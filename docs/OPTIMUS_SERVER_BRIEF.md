# Optimus server — concise brief for another agent

**Host:** `192.168.0.121`  
**SSH:** `ssh -i ~/.ssh/id_optimus root@192.168.0.121` (or `SSH_KEY` / `OPTIMUS` env overrides)

---

## What runs there

- **Piko WebChat** — Node app in `/root/webchat-piko`, served by systemd **`piko-webchat.service`**.
- **Port:** 3000 (HTTP). Control UI: `http://192.168.0.121:3000/control`.
- **Ollama:** Expected at `http://localhost:11434` (chat model, e.g. `llama3.1:latest`).

---

## Deploy & restart (from repo root on dev machine)

```bash
./scripts/webchat-deploy/deploy-to-optimus.sh
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "systemctl restart piko-webchat.service && systemctl is-active piko-webchat.service"
```

- Deploy syncs **`webchat-piko/`** → **`root@192.168.0.121:/root/webchat-piko/`** (rsync; excludes `.env`, `data/`, `logs/`, `node_modules/`).
- Env/secrets (e.g. `MOLTBOOK_API_KEY`, `GROK_API_KEY`) are **not** in repo; set on Optimus (systemd override or `.env` in app dir) if needed.

---

## Key paths on Optimus

| Path | Purpose |
|------|--------|
| `/root/webchat-piko/` | App root (server.js, public/, prompts/, scripts/). |
| `/root/webchat-piko/data/` | Runtime data: `moltbook-state.json`, `moltbook-journal.md`, `moltbook-pending-proposal.txt`, `moltbook-last-post.txt`, `intents.json`, etc. Not deployed (excluded by rsync). |
| `/root/webchat-piko/logs/` | Optional log files (e.g. moltbook-poster.log). |
| `/etc/systemd/system/piko-webchat.service` | systemd unit; WorkingDirectory=`/root/webchat-piko`, ExecStart=`/usr/bin/node server.js`, PORT=3000. |

---

## Moltbook “All posts” / learning

- **Control** merges Moltbook API result with **`data/moltbook-state.json`** (post list). If that file is missing or has only one post, Control shows one post. **Goals** and **`/goals`** read **`data/piko-memory.json`** (created by the poster when it runs with `MOLTBOOK_API_KEY`).
- **Poster** must run **from `/root/webchat-piko`** with **env loaded** (cron does not load `.env`). Use the wrapper so the poster sees `MOLTBOOK_API_KEY`: ensure **`/root/webchat-piko/.env`** exists with `MOLTBOOK_API_KEY=...` (create by hand; not in repo). Cron: `*/30 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1`. Wrapper `scripts/run-moltbook-poster.sh` sources `.env` then runs the poster; without it, the poster exits with "MOLTBOOK_API_KEY not set; skip." and never creates `piko-memory.json`.
- **Nightly proposal** (optional): `scripts/moltbook-aim-proposal.js` at e.g. 02:00; writes `data/moltbook-pending-proposal.txt`; user approves via Control or `/aim approve` in chat.
- **Invariant:** Web server and poster must use the **same** app dir so they share **`data/`**.

---

## Useful commands (on Optimus)

```bash
systemctl status piko-webchat.service
systemctl restart piko-webchat.service
journalctl -u piko-webchat.service -f
crontab -l
# Moltbook: ensure cron uses run-moltbook-poster.sh and .env exists with MOLTBOOK_API_KEY
cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh
tail -30 /root/webchat-piko/logs/moltbook-poster.log
cat /root/webchat-piko/data/moltbook-state.json | head -30
cat /root/webchat-piko/data/piko-memory.json | head -40
tail -50 /root/webchat-piko/data/moltbook-journal.md
```

---

## Docs in repo

- **scripts/webchat-deploy/PHASE2_RUNBOOK.md** — Full deploy, systemd, env, Moltbook invariants.
- **webchat-piko/docs/MOLTBOOK_ALL_POSTS_DIAGNOSIS.md** — Why “All posts” might show one post and step-by-step fix.
- **webchat-piko/docs/MOLTBOOK_LEARNING_STATUS.md** — Learning loop (observe → reflect → act, journal, nightly refinements).
