# Piko scripts

## heartbeat.js

Runs on a schedule (e.g. cron) to:

1. **MEMORY suggestion:** Reads yesterday's history dump (`history/YYYY-MM-DD.txt`), asks Ollama for one short line the user could add to MEMORY.md (durable fact or preference). Writes the suggestion to `memory/suggestions/YYYY-MM-DD.txt` for you to review and paste into MEMORY.md.
2. **Proactive Telegram nudge:** If `TELEGRAM_CHAT_ID` and `TELEGRAM_BOT_TOKEN` are set, sends a short nudge to you (Ollama-generated or fallback: "Piko here—anything you want to pick up today?").

### Env (optional)

- `PIKO_PROMPTS_DIR` — prompts folder (default: `../prompts`).
- `PIKO_HISTORY_DIR` — history dumps folder (default: `../history`).
- `PIKO_SUGGESTIONS_DIR` — where to write MEMORY suggestions (default: `../memory/suggestions`).
- `OLLAMA_URL` — Ollama API (default: `http://localhost:11434`).
- `OLLAMA_MODEL` — model for suggestions/nudge (default: `llama3.1:latest`).
- `TELEGRAM_BOT_TOKEN` (or `TELEGRAM_TOKEN`) — bot token for nudge.
- `TELEGRAM_CHAT_ID` — your Telegram chat ID (so the bot can send you the nudge).

### Run

From this directory or from `webchat-piko/`:

```bash
node scripts/heartbeat.js
```

---

## proactive-patterns.js

**Proactive Telegram nudges from learning repo.** Run hourly. If `data/learning/tensions.md` has at least 2 tensions and the file hasn’t been modified for 7+ days, sends a nudge: “Still thinking about …? Want to talk it through?”

### Env

- `TELEGRAM_BOT_TOKEN` (or `TELEGRAM_TOKEN`) and `TELEGRAM_CHAT_ID` — required to send.
- `PIKO_DATA_DIR` — optional (default: `../data`).
- `PIKO_TENSION_STALE_DAYS` — days of inactivity before nudge (default 7). Requires at least 2 tensions in the file. Moltbook nudge uses last 3 posts from `data/moltbook-state.json` when avg upvotes &lt; 1.

### Run

From `webchat-piko/`:

```bash
node scripts/proactive-patterns.js
```

When run, **context-synthesis.js** is also invoked: if calendar snapshot has ≥3 events today and there is at least one tension, sends a Telegram line like "Busy day (N events). Tension #1: … needs ~30min. Free: 2:00–2:30PM."

### Cron (hourly)

```bash
0 * * * * cd /root/webchat-piko && /usr/bin/node scripts/proactive-patterns.js >> /root/webchat-piko/logs/proactive-patterns.log 2>&1
```

---

## files-patterns.js

**Files pattern detection (Slice 5).** Run daily. Scans `data/learning/notes-capture.md` for sections from the last 7 days: if ≥3 PDF mentions → Telegram "Weekly research pattern: N PDFs this week" and suggests "Weekly deep dives" sticky; if ≥5 agent/coordination mentions → Telegram theme nudge and appends suggested topics to `data/learning/topics.txt`.

### Env

- `TELEGRAM_BOT_TOKEN` (or `TELEGRAM_TOKEN`) and `TELEGRAM_CHAT_ID` — to send.
- `PIKO_DATA_DIR` — optional (default `../data`).
- `PIKO_FILES_MIN_PDFS_WEEKLY` — default 3.
- `PIKO_FILES_MIN_AGENT_MENTIONS` — default 5.

### Run

```bash
node scripts/files-patterns.js
```

### Cron (daily)

```bash
0 8 * * * cd /root/webchat-piko && /usr/bin/node scripts/files-patterns.js >> /root/webchat-piko/logs/files-patterns.log 2>&1
```

---

## context-synthesis.js

**Context synthesis (Slice 6).** Run standalone or as part of **proactive-patterns.js**. Reads `data/calendar-snapshot.json` and `data/learning/tensions.md`; if today has ≥3 events and ≥1 tension, sends one Telegram: "Busy day (N events). Tension #1: … needs ~30min. Free: 2:00–2:30PM." Optional env: `PIKO_CONTEXT_BUSY_THRESHOLD` (default 3).

```bash
node scripts/context-synthesis.js
```

---

## daily-briefing.js

**6 AM Telegram briefing.** Run at 6:00 (cron). Sends one message: "Good morning. Here's your day: [Calendar: N events today. Free: 2:00–2:30PM.] Learning (tension or sticky), Moltbook last post, next reminder. [Reply in chat…]"

Uses `data/learning/tensions.md`, `sticky-ideas.md`, `data/intents.json`, `data/moltbook-state.json`, and when present `data/calendar-snapshot.json` (adds event count and first free 30min slot). Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

```bash
node scripts/daily-briefing.js
```

Cron example: `0 6 * * * cd /root/webchat-piko && /usr/bin/node scripts/daily-briefing.js >> /root/webchat-piko/logs/daily-briefing.log 2>&1`

---

## heartbeat.js (continued)

### Cron (on Optimus)

Example: run daily at 09:00:

```bash
0 9 * * * cd /root/webchat-piko && /usr/bin/node scripts/heartbeat.js >> /root/webchat-piko/logs/heartbeat.log 2>&1
```

Create the log dir first: `mkdir -p /root/webchat-piko/logs`. Set env in cron (e.g. `TELEGRAM_CHAT_ID=... TELEGRAM_BOT_TOKEN=...`) or in a small wrapper script that sources env and runs the heartbeat.

---

## intent-poller.js

Runs on a schedule (e.g. every 5 min) to process **intent orders**:

1. **Due reminders** — Removes from `data/intents.json` and appends to `data/pending-notifications.txt`. Clients can fetch `GET /api/pending` to show and clear them.
2. **Due scheduled** — POSTs the stored command to `PIKO_WEBCHAT_URL/api/chat` (e.g. `/task Weekly report`), then removes from intents.
3. **Optional queue run** — If `PIKO_INTENT_POLLER_RUN_QUEUE=true`, calls `/api/chat` with `/queue next` once per run.

### Env

- `PIKO_WEBCHAT_URL` — WebChat base URL (e.g. `http://localhost:3000`). Required for scheduled and queue.

### Run

From `webchat-piko/`:

```bash
node scripts/intent-poller.js
```

### Cron (every 5 min)

```bash
*/5 * * * * cd /root/webchat-piko && /usr/bin/node scripts/intent-poller.js >> /root/webchat-piko/logs/intent-poller.log 2>&1
```

---

## moltbook-poster.js

**Autonomous Moltbook posting + learning (v1.1).** Run every 30 min. Fetches engagement and new posts; journal + guardrails; aim + refinements. Reads `prompts/MOLTBOOK_AIM.md` (the “aim” for what Piko should post), asks Ollama for one short post, and POSTs to Moltbook. Respects rate limit (1 post per 30 min) via `data/moltbook-last-post.txt`.

See **PIKO_MOLTBOOK_AUTONOMOUS.md** (repo root) for full setup and how to set Piko’s posting aim.

### Env

- `MOLTBOOK_API_KEY` (or `MOLTBOOK_KEY`) — required for posting.
- `OLLAMA_URL`, `OLLAMA_MODEL` — optional (default localhost, llama3.1:latest).
- `PIKO_MOLTBOOK_AIM_PATH` — optional path to aim file (default `prompts/MOLTBOOK_AIM.md`).
- `PIKO_MOLTBOOK_POSTS_PER_30MIN` — max posts in 30-min window (default 5).
- `PIKO_MOLTBOOK_MIN_INTERVAL_MINUTES` — min minutes between posts (default 6 when POSTS_PER_30MIN>1, else 30).

### Run

From `webchat-piko/`:

```bash
node scripts/moltbook-poster.js
```

### Cron — use wrapper so .env is loaded

For **5 posts per half hour** (one every ~6 min), run every 6 min:

```bash
# On Optimus: ensure /root/webchat-piko/.env exists with MOLTBOOK_API_KEY=...
*/6 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1
```

For 1 post per 30 min: set `PIKO_MOLTBOOK_POSTS_PER_30MIN=1` and use `*/30 * * * *`.

Or run the wrapper by hand: `cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh` (optionally `PIKO_MOLTBOOK_FETCH_ONLY=1 ./scripts/run-moltbook-poster.sh` to only refresh state and memory).

---

## notion-sync.js

**Notion ↔ learning repo.** Push `data/learning/sticky-ideas.md`, `tensions.md`, `rabbit-hole-notes.md` to three Notion databases; pull edits from Notion back into those files. Push replaces existing rows (archives then creates) so cron doesn’t duplicate.

See **docs/NOTION_SYNC.md** for full setup: Notion API token, creating the three DBs (with **Name** + **Content**), sharing each DB with the integration, and cron.

### Env

- `NOTION_TOKEN` (or `NOTION_API_KEY`) — required.
- `NOTION_DATABASE_ID_STICKY_IDEAS`, `NOTION_DATABASE_ID_TENSIONS`, `NOTION_DATABASE_ID_RABBIT_HOLE` — one per DB (from Notion URL).
- Optional: `NOTION_PROP_TITLE`, `NOTION_PROP_CONTENT` (default `Name`, `Content`).

### Run

From `webchat-piko/` (with `.env` containing `NOTION_*`):

```bash
node scripts/notion-sync.js --push   # files → Notion
node scripts/notion-sync.js --pull   # Notion → files
```

### Cron (use wrapper so .env is loaded)

```bash
5 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh push >> /root/webchat-piko/logs/notion-sync.log 2>&1
10 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh pull >> /root/webchat-piko/logs/notion-sync.log 2>&1
```

---

## moltbook-aim-proposal.js

**Nightly Moltbook aim refinement proposal.** Run once per night (e.g. 02:00). Reads aim + refinements + journal + state; asks Ollama for 2–4 tactical refinements; writes to `data/moltbook-pending-proposal.txt` and appends to pending notifications; optionally Telegram. You approve with `/aim approve` or reject with `/aim reject` in chat; on approve, refinements are appended to `prompts/MOLTBOOK_REFINEMENTS.md`. Cron example: `0 2 * * * cd /root/webchat-piko && node scripts/moltbook-aim-proposal.js >> logs/moltbook-aim-proposal.log 2>&1`

## continuity-eval.js

**Conversation quality gate for multi-turn naturalness.**

- Scenario file: `scripts/continuity-scenarios.json` (12 scenarios, including sign-off + re-engage).
- Supports scenario-level metadata: `name`, `tags`, `criteria`, and root `scoring_schema` weights/thresholds.
- Sends each scenario as one session to `/api/chat`.
- Runs multiple seeds (`PIKO_CONTINUITY_RUNS`, default `3`).
- Scores each turn on a 0-5 rubric: continuity, naturalness, noBleed, noReset, modeFit.
- Writes timestamped telemetry to `data/conversation-eval-logs/continuity-eval-*.json`.
- Includes diagnostics per turn: `guessed_route`, `reset_trigger`, `bleed_trigger`, `stilted_trigger`, `likely_template_fallback`.

Run:

```bash
PIKO_API_URL=http://localhost:3000/api/chat PIKO_CONTINUITY_RUNS=3 node scripts/continuity-eval.js
```

Quick smoke (first N scenarios only):

```bash
PIKO_CONTINUITY_SCENARIO_LIMIT=2 node scripts/continuity-eval.js
```

## continuity-eval-report.js

Summarise the latest continuity eval log (or a specific file) into:

- pass rate
- criterion averages
- diagnostics counts
- lowest-performing scenarios

Run:

```bash
node scripts/continuity-eval-report.js
```

Specific log:

```bash
PIKO_CONTINUITY_REPORT_FILE=data/conversation-eval-logs/continuity-eval-<timestamp>.json node scripts/continuity-eval-report.js
```
