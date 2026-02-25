# Piko — Deployment Plan: Persistent Intents + State API

**Scope:** Implement (1) **Persistent goals and intent queues** and (4) **State API (chat as view on state)**. Profiles, skills metadata, and cost/risk/approvals are in **PIKO_FUTURE_BUILDS.md**.

---

## Part 1: Persistent goals and intent queues

### 1.1 Goal

- Treat reminders, queue, and scheduled items as **intents** with a **lifecycle** (pending → in-progress → done → archived).
- Add **snooze** and **unified intent commands** so the user has one backlog to see and manage.

### 1.2 Data model

**Extend `data/intents.json`** (keep array; migrate existing entries on load):

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique id (e.g. `intent_<timestamp>_<rand>`). |
| `type` | string | `reminder` \| `task` \| `scheduled` \| `watch` (watch = metadata only for now). |
| `status` | string | `pending` \| `in-progress` \| `done` \| `archived`. |
| `createdAt`, `updatedAt` | ISO string | Timestamps. |
| `title` | string | Short label. |
| `description` | string | Optional longer text. |
| `dueAt` | ISO string | When to fire (reminder/task/scheduled). |
| `schedule` | string \| null | Optional cron-like later (e.g. `0 9 * * 1-5`). |
| `command` | string \| null | For scheduled: command to run (e.g. `/task ...`). |
| `source` | string | `webchat` \| `telegram` \| `discord` \| etc. |
| `sessionId` | string \| null | Who created it. |
| `snoozedUntil` | ISO string \| null | Don’t consider until this time. |
| `lastFiredAt` | ISO string \| null | Last time poller fired this intent. |
| `tags` | string[] | Optional. |

**Migration:** On first load after deploy, normalize existing array items:

- Current `type: 'reminder'` with `time` → set `dueAt = time`, `status = 'pending'`, add `createdAt`/`updatedAt` if missing.
- Current `type: 'queue'` → treat as `type: 'task'`, `status: 'pending'`, no `dueAt`; keep `task` as `title` or `description`.
- Current `type: 'scheduled'` with `run` → set `dueAt = run`, `status = 'pending'`, keep `command`; add timestamps.

Generate `id` for any intent that doesn’t have one (e.g. `intent_<Date.now()>_<index>`).

### 1.3 New/updated commands in `server.js`

- **`/intents list [status]`** — List intents; default status `pending`, or `all` to show all. Format: `id: [type/status] title`.
- **`/intents show <id>`** — Show full intent (type, status, title, description, dueAt, schedule, command, snoozedUntil, lastFiredAt).
- **`/intents done <id>`** — Set `status = 'done'`, update `updatedAt`.
- **`/intents snooze <id> <duration>`** — Parse duration (e.g. `30m`, `2h`, `1d`, `1w`), set `snoozedUntil = now + duration`, update `updatedAt`.
- **`/intents add task <title> [| description]`** — Create `type: 'task'`, `status: 'pending'`, optional description; set `source`/`sessionId` from request.

**Existing commands (keep, wire to new shape):**

- **`/remind <time> <text>`** — Create intent with `type: 'reminder'`, `dueAt` from parsed time, `title` or `description` = text.
- **`/queue add <text>`** — Create intent with `type: 'task'`, `title` = text; or append to existing queue representation (current behavior: add to array, run via `/queue next`). Prefer: create task intent; `/queue next` can “run next task intent” by id.
- **`/schedule <time> <command>`** — Create intent with `type: 'scheduled'`, `dueAt` from time, `command` = command.

Decide whether **`/queue list`** and **`/queue next`** stay as-is (queue-only) or become **“list task intents”** and **“run next task intent”**. Recommendation: keep `/queue list` and `/queue next` for backward compatibility; implement as “filter intents where type=task and status=pending, list or run first.”

### 1.4 Intent helpers

- **`loadIntents()`** — Read `data/intents.json`, run **migrateIntents(data)** if any item lacks `id`/`status`/timestamps, return array.
- **`saveIntents(intents)`** — Write array back to `data/intents.json`.
- **`migrateIntents(arr)`** — For each item: ensure `id`, `status` (default `pending`), `createdAt`/`updatedAt`; map old `time` → `dueAt`, `run` → `dueAt`, `task`/`message` → `title`/`description`. Save once after migration.
- **`createIntent({ type, title, description, dueAt, command, source, sessionId })`** — Append new intent with generated `id`, `createdAt`, `updatedAt`, `status: 'pending'`.
- **`updateIntent(id, patch)`** — Find by id, apply patch, set `updatedAt`; save.

### 1.5 Poller (`scripts/intent-poller.js`)

- Load intents (use shared helpers if factored into a small module, or duplicate load/save for now).
- For each intent:
  - Skip if `status !== 'pending'`.
  - Skip if `snoozedUntil` is set and `snoozedUntil > now`.
  - **Reminder:** If `dueAt <= now`, append to pending-notifications, set `lastFiredAt`, optionally set `status = 'done'`.
  - **Scheduled:** If `dueAt <= now` (and optionally “not yet fired” or “once” semantics), POST `/api/chat` with `command`, set `lastFiredAt`; optionally set `status = 'done'` or leave pending for recurring later.
  - **Task (queue):** If `PIKO_INTENT_POLLER_RUN_QUEUE === 'true'`, run next task intent (e.g. first `type=task` and `status=pending`), execute via POST `/api/chat` with `/queue next` or equivalent, then mark that intent in-progress/done.
- Save intents after changes.

### 1.6 Files to touch

- `webchat-piko/server.js`: migration in loadIntents; createIntent, updateIntent; new `/intents *` commands; keep `/remind`, `/queue`, `/schedule` but have them create/update intents in the new shape.
- `webchat-piko/scripts/intent-poller.js`: use new intent shape; respect status and snoozedUntil; set lastFiredAt and optionally status.
- Optional: `webchat-piko/lib/intents.js` or similar for load/save/migrate/create/update so poller can require it and stay in sync.

### 1.7 Acceptance

- Existing reminders/queue/scheduled still work after deploy (migration preserves behavior).
- `/intents list` shows pending intents; `/intents show <id>` shows full details; `/intents done <id>` and `/intents snooze <id> 2h` work.
- `/intents add task Ship v0.3` creates a task intent.
- Poller fires reminders and scheduled commands as today, and respects snooze and status.

---

## Part 2: State API (chat as view on state)

### 2.1 Goal

- Expose **read-only** internal state so any UI (WebChat, CLI, dashboard, your app) can show and reason about the same data.
- Chat commands remain the main way to *mutate* state; the State API is for **reading** only (for now).

### 2.2 Endpoints

Add under `webchat-piko/server.js` (same HTTP server):

- **`GET /api/state/intents`** — Return current intents array (after load/migration). Optional query: `?status=pending` to filter.
- **`GET /api/state/sessions`** — Return `data/sessions.json` (sessionId → profile + overrides).
- **`GET /api/state/allowlist`** — Return `data/allowlist.json` (sources → list of ids). Optionally redact or restrict to localhost.
- **`GET /api/state/skills`** — Return list of loaded skills: e.g. `[{ id, pattern or name }]` (minimal; no need for full metadata until Future Builds skills contract).

No auth in v1 beyond **restricting to localhost** (or same host): e.g. reject if `req.socket.remoteAddress` is not `127.0.0.1` or `::1`, or document that these are for trusted UIs only.

### 2.3 Response shape

- **intents:** `{ intents: [...] }` (array of intent objects).
- **sessions:** `{ sessions: { ... } }` (object keyed by session id).
- **allowlist:** `{ allowlist: { ... } }` (object keyed by source).
- **skills:** `{ skills: [ { id: "notes", pattern: "/notes" }, ... ] }` (minimal; id can be filename or index).

### 2.4 Files to touch

- `webchat-piko/server.js`: add GET routes for `/api/state/intents`, `/api/state/sessions`, `/api/state/allowlist`, `/api/state/skills`. Call existing loaders (loadIntents, loadSessionsConfig, loadAllowlist, loadedSkills). Optionally add a small `isLocal(req)` and return 403 for non-local if desired.
- `webchat-piko/.gitignore`: no new files; state is read from existing data dir.

### 2.5 Acceptance

- From localhost, `GET /api/state/intents` returns the intents array; `GET /api/state/sessions` returns sessions; same for allowlist and skills.
- Optional: from a different host, these return 403 if you added the localhost check.
- Control UI or a small script can build a “backlog view” or “session view” from these endpoints without parsing files.

---

## Deployment order

1. **State API first** (read-only, no schema change): add `/api/state/*` routes and localhost-only if desired. Deploy and verify. ✅
2. **Intent model and migration**: extend intent shape in code, add `migrateIntents()` in loadIntents, deploy with existing `intents.json` and confirm reminders/queue/schedule still work. ✅
3. **New intent commands**: add `/intents list|show|done|snooze|add task` and wire `/remind`/`/queue`/`/schedule` to new shape. Deploy and test. ✅
4. **Poller update**: change intent-poller to use new shape, status, snoozedUntil, lastFiredAt. Deploy and run poller once manually, then cron as usual. ✅

**Implemented:** `webchat-piko/lib/intents.js` (load, save, migrate, createIntent, updateIntent, parseDuration); State API in server.js; /intents commands; remind/queue/schedule use createIntent; intent-poller.js uses lib and new shape.

---

## Doc references

- **Future Builds (not in this plan):** Profiles as real agent configs, Skills as installable modules, Cost/risk and approvals — see **PIKO_FUTURE_BUILDS.md**.
- **Existing behavior:** Intent commands and poller — see **PIKO_PROJECT_AND_INTEGRATION.md** and **webchat-piko/server.js** (queue, remind, schedule).
