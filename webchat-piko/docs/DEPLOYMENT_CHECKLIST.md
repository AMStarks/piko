# Piko WebChat — deployment checklist (Optimus)

Everything you need to deploy and run webchat-piko on Optimus. Use this as a to-do before and after each deploy.

**Track progress:** Use the **deployment todo list (d1–d8)** in your editor; mark each item complete as you go so it persists across sessions. The list matches the sections below.

---

## Pre-deploy (local / one-time)

- [ ] **Deploy script executable**  
  `chmod +x scripts/webchat-deploy/deploy-to-optimus.sh`

- [ ] **SSH access to Optimus**  
  Key: `~/.ssh/id_optimus` (or set `SSH_KEY`). Host: `root@192.168.0.121` (or set `OPTIMUS`).

- [ ] **Node on Optimus**  
  `node --version` ≥ 16. Install if needed: `apt install -y nodejs` or nvm.

- [ ] **Ollama on Optimus**  
  Running and model pulled (e.g. `llama3.1:latest`). WebChat calls `http://localhost:11434`.

---

## Deploy (from repo root)

- [ ] **Sync app to Optimus**  
  `./scripts/webchat-deploy/deploy-to-optimus.sh`  
  (rsync excludes `.env`, `data/`, `logs/`, `node_modules/`)

- [ ] **Install dependencies on Optimus**  
  `ssh … "cd /root/webchat-piko && npm install"`  
  (deploy script does not run npm; do after first deploy or when package.json changes)

---

## On Optimus — directories

- [ ] **Create dirs**  
  `mkdir -p /root/webchat-piko/logs /root/webchat-piko/data`  
  (deploy script runs `mkdir -p …/logs …/data`; verify.)

- [ ] **Learning dir**  
  `mkdir -p /root/webchat-piko/data/learning`

- [ ] **Learning seed (optional)**  
  Copy or create `data/learning/topics.txt` if you use rabbit-hole-daily / exploration.  
  `data/learning/sticky-ideas.md`, `tensions.md`, `rabbit-hole-notes.md` are created by Control or notion-sync.

---

## On Optimus — environment (.env)

Create `/root/webchat-piko/.env` (never commit). At minimum:

- [ ] **MOLTBOOK_API_KEY**  
  Required for Moltbook poster, "All posts", goals, journal, piko-memory.json.

Optional (as needed):

- [ ] **OLLAMA_URL**, **OLLAMA_MODEL**  
  Defaults: `http://localhost:11434/v1/chat/completions`, `llama3.1:latest`. To try Gemma 2 27B: see `docs/MODELS_AND_SWITCHING.md` (pull script + `/model` in chat).
- [ ] **NOTION_TOKEN** (or NOTION_API_KEY)  
  For notion-sync (learning repo ↔ Notion).
- [ ] **NOTION_DATABASE_ID_STICKY_IDEAS**, **NOTION_DATABASE_ID_TENSIONS**, **NOTION_DATABASE_ID_RABBIT_HOLE**  
  From Notion DB URLs; see `docs/NOTION_SYNC.md`.
- [ ] **GROK_API_KEY**  
  Optional; set via `systemctl edit piko-webchat.service` (see runbook).
- [ ] **TAVILY_API_KEY** / **SERPER_API_KEY**  
  If using rabbit-hole or search tools.
- [ ] **TELEGRAM_BOT_TOKEN**, **TELEGRAM_CHAT_ID**  
  For heartbeat nudge / notifications.
- [ ] **CURSOR_API_KEY**  
  For /task (Cursor agent).
- [ ] **PIKO_WEBCHAT_URL**  
  For intent-poller / scripts that call the API: `http://localhost:3000`.
- [ ] **Webhook verification (optional)**  
  For BlueBubbles adapter: `BLUEBUBBLES_WEBHOOK_SECRET` or `PIKO_WEBHOOK_SECRET`; signature header `x-webhook-signature` (or `BLUEBUBBLES_WEBHOOK_SIGNATURE_HEADER`). See `webchat-piko/.env.example`.

---

## On Optimus — systemd service

- [ ] **Install unit file**  
  `scp -i ~/.ssh/id_optimus scripts/webchat-deploy/piko-webchat.service root@192.168.0.121:/etc/systemd/system/`

- [ ] **Enable and start**  
  `systemctl daemon-reload && systemctl enable piko-webchat.service && systemctl start piko-webchat.service`

- [ ] **Optional env overrides**  
  `systemctl edit piko-webchat.service` — add `Environment=GROK_API_KEY=…`, `PIKO_UNIFIED_SESSION_ID=main`, etc. Then `daemon-reload && restart`.

---

## On Optimus — cron jobs

- [ ] **Moltbook poster** (sources .env)  
  `*/6 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1`  
  Wrapper must be executable: `chmod +x /root/webchat-piko/scripts/run-moltbook-poster.sh`

- [ ] **Intent poller** (reminders, scheduled, queue)  
  `*/5 * * * * cd /root/webchat-piko && PIKO_WEBCHAT_URL=http://localhost:3000 /usr/bin/node scripts/intent-poller.js >> /root/webchat-piko/logs/intent-poller.log 2>&1`

- [ ] **Notion sync (optional)**  
  Push: `5 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh push >> /root/webchat-piko/logs/notion-sync.log 2>&1`  
  Pull: `10 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh pull >> /root/webchat-piko/logs/notion-sync.log 2>&1`  
  Requires `.env` with `NOTION_TOKEN` and the three `NOTION_DATABASE_ID_*`.  
  `chmod +x /root/webchat-piko/scripts/run-notion-sync.sh`

- [ ] **Heartbeat (optional)**  
  `0 9 * * * cd /root/webchat-piko && /usr/bin/node scripts/heartbeat.js >> /root/webchat-piko/logs/heartbeat.log 2>&1`  
  Set `TELEGRAM_*` in cron or in a wrapper that sources .env.

- [ ] **Proactive patterns (optional)** — tensions / learning nudges via Telegram  
  `0 * * * * cd /root/webchat-piko && /usr/bin/node scripts/proactive-patterns.js >> /root/webchat-piko/logs/proactive-patterns.log 2>&1`  
  Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in .env or cron.

- [ ] **Daily briefing (optional)** — 6 AM Telegram  
  `0 6 * * * cd /root/webchat-piko && /usr/bin/node scripts/daily-briefing.js >> /root/webchat-piko/logs/daily-briefing.log 2>&1`  
  Same Telegram env.

- [ ] **Rabbit-hole daily (optional)**  
  `0 9 * * * cd /root/webchat-piko && node scripts/rabbit-hole-daily.js >> logs/rabbit-hole-daily.log 2>&1`  
  Needs `data/learning/topics.txt` and optionally TAVILY/SERPER.

- [ ] **Meta-reflection weekly (optional)**  
  `0 10 * * 0 cd /root/webchat-piko && node scripts/meta-reflection-weekly.js >> logs/meta-reflection-weekly.log 2>&1`

- [ ] **Moltbook aim proposal (optional)**  
  `0 2 * * * cd /root/webchat-piko && node scripts/moltbook-aim-proposal.js >> logs/moltbook-aim-proposal.log 2>&1`

---

## Phase 1 & 2 — when you next deploy

After syncing the repo (Phase 1 + 2 code), do the following.

- [ ] **Install deps**  
  `cd /root/webchat-piko && npm install`

- [ ] **Run doctor**  
  `node scripts/doctor.js`  
  Optional: `PIKO_WEBCHAT_URL=http://localhost:3000` to also check GET /api/health.

- [ ] **Run tests**  
  `npm test` — planner, memory, beliefLoop tests (13 tests).

- [ ] **Intent poller**  
  The server now runs the intent poller every 5 min via node-cron (no separate crontab required). You can remove the standalone intent-poller cron line if you had one, or keep it as backup.

- [ ] **Optional: planner debug**  
  For stress-test, set `PIKO_PLANNER_DEBUG=1` in .env or systemd override to log plan/beliefs each turn.

- [ ] **Restart service**  
  `systemctl restart piko-webchat.service`

---

## Post-deploy verification

- [ ] **Health**  
  `curl -s http://192.168.0.121:3000/api/health` → JSON with `ollama`, `model`.

- [ ] **Chat**  
  Open http://192.168.0.121:3000, send "Hello".

- [ ] **Control dashboard**  
  http://192.168.0.121:3000/control — Health, Learning velocity, Moltbook, Goals, etc.

- [ ] **Learning / Control Learning**  
  http://192.168.0.121:3000/control-learning — Sticky ideas, Tensions, Rabbit-hole tabs load; edit and save works.

- [ ] **Moltbook**  
  If cron runs: "All posts" and Goals card show data; `data/piko-memory.json` and `data/moltbook-state.json` exist after a poster run.

- [ ] **Notion sync (if enabled)**  
  Run by hand: `cd /root/webchat-piko && ./scripts/run-notion-sync.sh pull` — no errors; `data/learning/*.md` updated if DBs are connected.

---

## Reference

| Item | Location |
|------|----------|
| Runbook | `scripts/webchat-deploy/PHASE2_RUNBOOK.md` |
| Notion setup | `webchat-piko/docs/NOTION_SYNC.md` |
| Scripts (cron, env) | `webchat-piko/scripts/README.md` |
| App root on Optimus | `/root/webchat-piko/` |
| WebChat URL (LAN) | http://192.168.0.121:3000 |

---

## Quick deploy (already configured once)

```bash
./scripts/webchat-deploy/deploy-to-optimus.sh
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "cd /root/webchat-piko && npm install && systemctl restart piko-webchat.service"
```

Then verify: Control, Learning, chat.

---

## Limitations / can't do yet — to-do for future

These are **not** deployment blockers; they are tracked so we don't assume they work until we've built the workaround or chosen an approach.

- [ ] **Messages (iMessage / SMS)**  
  No API. **To-do:** Rely on **Share to Piko** only (user copies/pastes or shares into Piko). Optional: forward-to-Piko number/email for SMS. Document in iOS app that "Messages" = share/paste only.

- [ ] **Notes**  
  No read/write API. **To-do:** Share to Piko from Notes → learning repo. Optional: Shortcuts "append to note" with text from Piko. Do not promise "Piko reads Notes".

- [ ] **Calendar**  
  Server has no direct access to iOS Calendar. **To-do:** Choose one: (A) Google Calendar on server (OAuth, server creates events; add skill/cron); or (B) iOS app EventKit + device→server sync (app uploads "my day" so pattern detector can run). Add to runbook when decided.

- [ ] **Health / Location**  
  Only the iOS app can read HealthKit/Location. **To-do:** Add HealthKit + Location entitlements to iOS app; app sends summaries to `POST /api/ios-hub` or a context endpoint. Server uses that for proactive nudges ("workout streak", "at coffee shop"). Privacy: opt-in, minimal data.

- [ ] **Context aggregator**  
  Server can only aggregate: learning repo, Moltbook, Notion, (optional) Google Calendar, and **whatever the iOS app sends** (calendar snapshot, health summary, location). **To-do:** Implement context-upload from iOS when Health/Location/Calendar sync is built; document "aggregate what we're allowed to have".

- [ ] **Files "recent"**  
  Server cannot scan device Files. **To-do:** Only what user shares to Piko (Share Extension + document picker). No "Piko sees your recent files".

**Reference:** `docs/PIKO_JARVIS_ROADMAP_REVIEW.md`, `docs/PIKO_IOS_INTEGRATIONS_INVESTIGATION.md`.
