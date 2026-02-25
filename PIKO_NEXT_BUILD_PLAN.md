# Piko — Next Build Plan

**Purpose:** Consolidated plan to implement the five next-focus items plus “What’s Missing.” Build order is chosen for minimal dependencies and quick wins.

---

## 1. Five next-focus items

### 1.1 DM pairing / allowlists

**Goal:** Per-channel allowlist so only approved users/chats can use Piko via adapters.

**Design:**

- **Storage:** `webchat-piko/data/allowlist.json`. Shape: `{ "source": ["id1", "id2"], "default": ["*"] }`. Source = adapter identifier: `telegram`, `discord`, `slack`, `whatsapp`, `bluebubbles`, `webchat` (optional; if omitted, WebChat is always allowed).
- **Convention:** Adapters send `sessionId` like `discord-<channelId>` or `telegram-<chatId>`. Server can derive `source` from `sessionId` prefix (e.g. `sessionId.split('-')[0]`) or accept optional body field `source` + `externalId` for explicit pairing.
- **Check:** At start of `handleApiChat`, if `source` is not `webchat` and allowlist exists and `allowlist[source]` is not `["*"]`, require `externalId` (or id part of sessionId) to be in `allowlist[source]`; otherwise 403 with `{ "error": "Not allowed" }`.
- **Commands:** `/allow <source> <id>` and `/block <source> <id>` (e.g. `/allow discord 123456`). Only permitted when request is from an already-allowed session or from WebChat (no source / sessionId that looks like web). Minimal: persist to allowlist.json; no auth beyond “caller is already allowed or WebChat.”

**Files to touch:**

- `webchat-piko/server.js`: load/save allowlist; at top of handleApiChat, derive source from sessionId or body; check allowlist; add /allow, /block handlers.
- `webchat-piko/data/allowlist.json`: created on first /allow; .gitignore.
- Adapters: optional. They can send `sessionId: 'discord-' + channelId`; server derives source=discord, id=channelId. Or add optional `source` + `externalId` in POST body for clarity (server.js only needs sessionId convention for minimal version).

**Acceptance:** With allowlist.json containing `{"discord":["123"]}`, a request with sessionId `discord-456` is rejected; `discord-123` is allowed. `/allow discord 456` from an allowed session adds 456.

---

### 1.2 Per-session configuration

**Goal:** Beyond `main`/`work`, each session can have `profileName`, `model`, `toolsAllowed`, `sandbox` (for /task).

**Design:**

- **Storage:** Extend `data/sessions.json`. Current: `{ [key]: { profile, updatedAt } }`. New: `{ [key]: { profile, profileName?, model?, toolsAllowed?: string[], sandbox?: boolean, updatedAt } }`.
- **Semantics:**
  - `profile`: still `main` | `work` (behavior: work = commands only).
  - `profileName`: display name (optional).
  - `model`: override `OLLAMA_MODEL` for this session when calling Ollama.
  - `toolsAllowed`: array of command prefixes (e.g. `["/task", "/read", "/queue"]`). If present, only those commands (+ /new, /status, /profile) allowed for that session; otherwise current behavior (all commands).
  - `sandbox`: if true, force /task to run in Docker when `PIKO_TASK_DOCKER` is set (per-session override).
- **Commands:** `/profile` already sets profile. Extend: `/profile work` / `/profile main` unchanged. Add optional query for “set model/tools” later or keep config as file/edit only for now. Minimal: just persist and use in server (read model, toolsAllowed, sandbox from session config in handleApiChat and runTaskCommand).

**Files to touch:**

- `webchat-piko/server.js`: when building Ollama request, use `sessionsConfig[key].model || OLLAMA_MODEL`. Before dispatching to a command, if `sessionsConfig[key].toolsAllowed` is present and non-empty, check message matches one of the prefixes (or is /new, /status, /profile); else reject with “Command not allowed in this session.” For /task, if session has `sandbox: true` and TASK_DOCKER, use Docker path.
- `webchat-piko/README.md` or data schema doc: document sessions.json shape.

**Acceptance:** Session with `toolsAllowed: ["/task", "/queue"]` can use /task and /queue but not /read. Session with `model: "llama3.2:latest"` uses that model for Ollama.

---

### 1.3 Logging and metrics

**Goal:** JSON logs to a file and a simple `/api/metrics` (and optional log viewer in /control).

**Design:**

- **Logger:** Small helper in server.js: `log(level, msg, meta)`. Writes one JSON line to `data/piko.log` (or `PIKO_LOG_PATH`). Format: `{"ts":"ISO","level":"info","msg":"...", ...meta}`. Also `console.log` in dev or when `PIKO_LOG_CONSOLE=1`.
- **Counters:** In-memory: `metrics.requests`, `metrics.errors`, `metrics.chat`, `metrics.commands`. Increment in handleApiChat (and on 502/errors). Optional: `metrics.uptime` = Date.now() - startTime.
- **GET /api/metrics:** Return `{ requests, errors, chat, commands, uptimeMs }` (and optionally `uptime` human-readable).
- **Control UI:** Optional: add a “Logs” or “Metrics” section in control.html that fetches /api/metrics and displays last N log lines if we add GET /api/logs?tail=50 (tail implemented as read last 50 lines of piko.log). Minimal: just /api/metrics and JSON file logging; log viewer in control can be Phase 2.

**Files to touch:**

- `webchat-piko/server.js`: add log(), metrics object, increment in handleApiChat; GET /api/metrics; optionally GET /api/logs?tail=N that reads piko.log and returns last N lines (JSON array).
- `webchat-piko/public/control.html`: add Metrics card (fetch /api/metrics); optionally “Recent logs” (fetch /api/logs?tail=20).
- `webchat-piko/.gitignore`: add `data/piko.log`.

**Acceptance:** After a few requests, GET /api/metrics returns counts. data/piko.log has one JSON line per log call.

---

### 1.4 One-click “Piko doctor” script

**Goal:** A single script that checks env, adapters, cron, and skills and prints suggestions (no auto-fix required for v1).

**Design:**

- **Option A:** Extend `scripts/piko-cli.js` with a richer `doctor` that, in addition to GET /api/health and /api/control, checks locally: OLLAMA_URL env, optional CURSOR_API_KEY, existence of webchat-piko/data, webchat-piko/skills, and prints “Set PIKO_WEBCHAT_URL and run intent-poller every 5 min (cron).”
- **Option B:** New script `scripts/piko-doctor.sh` (or `scripts/webchat-deploy/piko-doctor.sh`) that: (1) runs `node scripts/piko-cli.js doctor` (so server must be up for full check), (2) checks env vars (OLLAMA_URL, PORT, optional CURSOR_API_KEY, PIKO_WEBCHAT_URL), (3) checks presence of webchat-piko/data, webchat-piko/skills, (4) suggests cron: `*/5 * * * * cd /path/to/webchat-piko && node scripts/intent-poller.js`.

**Choice:** Option A — extend piko-cli.js doctor. When PIKO_WEBCHAT_URL is set, doctor already calls /api/health and /api/control. Add a “local” mode: when run from repo root, also check process.env for OLLAMA_URL, PORT, CURSOR_API_KEY; check fs.existsSync for webchat-piko/data, webchat-piko/skills; print “Intent poller: add cron */5 * * * * …”. If server is unreachable, still print local checks.

**Files to touch:**

- `scripts/piko-cli.js`: in cmdDoctor(), after fetching /api/health and /api/control, run local checks (env, data dir, skills dir, suggest cron). Use path from __dirname to find webchat-piko.
- `scripts/README.md`: document “piko doctor” as the one-click check.

**Acceptance:** Running `npm run piko -- doctor` (or node scripts/piko-cli.js doctor) prints health + control + local checks and cron suggestion.

---

### 1.5 Showcase skills in `skills/`

**Goal:** A few example skills so the loader is proven and others can copy: notes, todo, summarize URL.

**Design:**

- **Notes:** Command `/notes add <text>` appends to `data/notes.json` (array of { id, text, at }). `/notes list` returns last 20. Simple file read/write in skill handler; need to pass `fs`/path or use a shared data dir (skill can require path and read/write data/notes.json next to server).
- **Todo:** Same idea: `data/todo.json` array of { id, text, done, at }. `/todo add <text>`, `/todo list`, optionally `/todo done <id>`.
- **Summarize URL:** `/summarize <url>`. Fetch URL (server-side), strip HTML, take first ~2000 chars, return as “Summary (first 2000 chars): …”. No LLM call for minimal version; or one line: “Use /summarize in chat and ask Piko to summarize” (skill just returns the snippet). Prefer: skill fetches URL, strips tags, truncates, returns that text so user can say “summarize this” in next message, or we add a one-shot Ollama call for “summarize in 3 sentences” for true batteries-included.

**Implementation:** Skills run in server context, so they can use `require('fs')`, `path.join(__dirname, '..', 'data', 'notes.json')`. Add to `webchat-piko/skills/index.js` three skills: notes (add/list), todo (add/list/done), summarize (fetch + strip + truncate). For summarize we need http/https in skill; pass them or use global. Skill handler signature: `(message) => Promise<string>|string`. Skills receive only message; for notes/todo we need to resolve data path. In index.js we have __dirname = skills dir, so path.join(__dirname, '..', 'data', 'notes.json').

**Files to touch:**

- `webchat-piko/skills/index.js`: add skills array with pattern + handler for /notes, /todo, /summarize. Implement handlers that read/write data/notes.json, data/todo.json, and fetch URL and strip HTML.
- `webchat-piko/data/notes.json`, `data/todo.json`: created on first add; .gitignore.
- `webchat-piko/skills/README.md`: document the three showcase skills and the contract (pattern, handler, return string or { reply }).

**Acceptance:** `/notes add hello` then `/notes list` shows hello. `/todo add fix bug` then `/todo list` shows it. `/summarize https://example.com` returns truncated text from the page.

---

## 2. What’s Missing

### 2.1 Quickstart (QUICKSTART.md)

**Goal:** Single “Piko in 5 minutes” doc at repo root.

**Content:**

- Clone repo, Node 18+.
- `cd webchat-piko && npm install && PORT=3000 node server.js` (OLLAMA_URL default localhost:11434).
- Open http://localhost:3000, send a message.
- Optional: Telegram (set TELEGRAM_TOKEN, PIKO_WEBCHAT_URL, run telegram-bot/bot.js). Optional: Deploy to Optimus (run deploy-to-optimus.sh, then systemd).

**File:** `QUICKSTART.md` at repo root.

---

### 2.2 Recovery / troubleshooting (RECOVERY.md)

**Goal:** What to do when Ollama is down, /task fails, or an adapter doesn’t respond.

**Content:**

- Ollama down: check OLLAMA_URL, `curl -X POST $OLLAMA_URL/...`, restart Ollama, restart piko-webchat.
- /task fails: CURSOR_API_KEY, AGENT_CLI_OPTIMUS, project path; run agent by hand on Optimus.
- Adapter not responding: check PIKO_WEBCHAT_URL, firewall, server logs; restart adapter.
- Intent poller not running: cron */5 * * * *; check data/intents.json and pending-notifications.

**File:** `RECOVERY.md` at repo root (or under docs/).

---

### 2.3 Intent visibility (“what’s due next”)

**Goal:** In /control (or /api/control), show next due reminder and next scheduled run.

**Design:**

- Extend GET /api/control: compute `nextReminderAt` (min of reminder times > now), `nextScheduledRun` (min of scheduled run times > now), and optionally `nextReminderText`, `nextScheduledCommand` (first one).
- control.html: add two lines in Intent orders card: “Next reminder: …”, “Next scheduled: …”.

**Files to touch:**

- `webchat-piko/server.js`: in /api/control block, compute nextReminderAt, nextScheduledRun from intents; add to payload.
- `webchat-piko/public/control.html`: display them.

---

### 2.4 One batteries-included skill (documented)

**Goal:** One skill that is fully documented end-to-end so the contract is clear.

**Design:** The “summarize URL” skill doubles as the batteries-included example: it’s a single command, uses fetch + strip HTML, and we document it in skills/README.md with pattern, handler signature, and return shape. Notes and todo are also documented. So 2.4 is satisfied by 1.5 + skills/README.md update.

---

## 3. Build order

| Step | Item | Deps |
|------|------|-----|
| 1 | QUICKSTART.md, RECOVERY.md | None |
| 2 | Intent visibility (next due in /api/control + control.html) | None |
| 3 | Logging + metrics (log(), /api/metrics, .gitignore) | None |
| 4 | Control UI: metrics card + optional logs | Step 3 |
| 5 | Allowlists (allowlist.json, check, /allow, /block) | None |
| 6 | Per-session config (sessions.json extend, use model/toolsAllowed/sandbox) | None |
| 7 | Doctor script (extend piko-cli.js doctor) | None |
| 8 | Showcase skills (notes, todo, summarize) + skills/README | None |

We can implement 1–8 in that order; 4 depends on 3, rest are independent.

---

## 4. Completion criteria

- All five next-focus items implemented and tested locally. ✅
- QUICKSTART.md and RECOVERY.md in repo root. ✅
- Intent visibility in /control; /api/metrics and JSON logging in place. ✅
- One-click doctor (piko doctor) runs and prints health + local checks + cron suggestion. ✅
- Three showcase skills work; skills/README.md documents the contract and examples. ✅

**Status:** Implemented. See PIKO_PROJECT_AND_INTEGRATION.md Summary Table for current state.

---

## 5. Things to complete next: LiteLLM integration

**Goal:** Replace all direct Ollama calls with LiteLLM so Piko has automatic fallback (e.g. Claude when Ollama is down). ~30min.

**Full checklist and file-by-file steps:** [docs/PIKO_LITELLM_INTEGRATION_TODO.md](docs/PIKO_LITELLM_INTEGRATION_TODO.md)

**Summary:**

1. **Install:** `cd webchat-piko && npm install litellm`
2. **.env:** Add `MODEL_PRIMARY`, `ANTHROPIC_API_KEY`, optional `OPENAI_API_KEY`, `LITELLM_LOG`
3. **Shared helper:** Add `webchat-piko/lib/llm.js` with `ai(prompt, options)` using LiteLLM `completion()` and fallback_models
4. **Replace Ollama everywhere:** server.js (ollamaChat, ollamaChatStream, health pings) + scripts: moltbook-poster.js, moltbook-comment-run.js, learning-inquiry.js, meta-reflection-weekly.js, learning-topic-suggestions.js, rabbit-hole-daily.js, moltbook-aim-proposal.js, heartbeat.js
5. **Endpoint:** Add `GET /api/models` returning `{ primary, available }`
6. **Test:** Ollama OFF → Messages→Reminders (file_capture) still works via Claude fallback
7. **Deploy:** pm2/docker unchanged; ensure .env on server has API keys

**Result:** Piko unbreakable — 100% uptime on LLM features with local primary + cloud fallback.
