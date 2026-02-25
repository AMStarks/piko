# OpenClaw: Everything They Do That We Don’t — Plus Intent Orders

**Purpose:** (1) A comprehensive list of what OpenClaw does that Piko does not yet. (2) **Intent orders** — capturing user intents and turning them into executable orders (reminders, task queue, scheduled /task, conditional “when X do Y”). (3) How both tie into the wider integration plan.

Sources: [OpenClaw docs](https://docs.openclaw.ai/) (CLI, concepts, channels, tools, gateway, automation, platforms), our existing integration plan, and RECOMMENDED_PATH_FORWARD (intent/keywords routing).

---

## Part 1 — Everything OpenClaw Does That We Don’t

### 1.1 Channels (messaging surfaces)

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| WhatsApp | No | Phase 2+: adapter → POST /api/chat. |
| Telegram | Yes | Done. |
| Slack | No | Phase 2: adapter → POST /api/chat. |
| Discord | No | Phase 2: adapter → POST /api/chat. |
| Google Chat | No | Phase 2+: adapter. |
| Mattermost | No | Phase 2+: adapter. |
| Signal | No | Phase 2+: adapter. |
| iMessage | No | Phase 2+ (Mac-only). |
| Microsoft Teams | No | Phase 2+ (plugin in OpenClaw). |
| LINE | No | Phase 3+. |
| Matrix | No | Phase 3+. |
| Zalo / Zalo Personal | No | Phase 3+. |
| WebChat | Yes | Done. |
| Broadcast Groups | No | Phase 3+: multi-recipient. |
| Channel location parsing | No | Phase 3+ if we add location tools. |
| grammY (Telegram framework) | We use raw HTTPS | Optional: could adopt for richer Telegram features. |

---

### 1.2 CLI and onboarding

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| `openclaw onboard` | No | We use runbooks (PHASE2, DEPLOY_TO_OPTIMUS). Optional: small `piko setup` script. |
| `openclaw configure` | No | We use env + systemd. Optional: config file. |
| `openclaw doctor` | No | Phase 2: script that checks Node, Ollama, Cursor, env. |
| `openclaw agent` / `openclaw message send` | No | We have POST /api/chat; optional CLI wrapper. |
| `openclaw agents` / `openclaw status` / `openclaw health` | No | Phase 2: health endpoint or CLI. |
| `openclaw sessions` | No | We have in-memory sessions; optional `/sessions` or debug endpoint. |
| `openclaw channels` | No | We have WebChat + Telegram fixed; optional list. |
| `openclaw skills` / `openclaw plugins` | No | We add skills in server.js; no plugin registry. |
| `openclaw memory` / `openclaw models` | No | Memory = prompts + history; models = Ollama only. Optional: `memory` CLI for MEMORY.md. |
| `openclaw cron` / `openclaw hooks` | No | We use system cron + scripts; optional `piko cron list`. |
| `openclaw pairing` | No | We have no pairing; anyone with URL/token can send. Phase 2: optional allowlist. |
| `openclaw security` / `openclaw gateway` | No | Phase 2: auth, rate limits, gateway lock. |
| `openclaw dashboard` / `openclaw browser` | No | We have WebChat only; optional Control UI later. |
| `openclaw tui` | No | Phase 3+: terminal UI. |
| `openclaw voicecall` | No | Phase 3+: voice plugin. |
| `openclaw dns` / `openclaw update` | No | Defer. |
| Sandbox CLI | No | We have no sandbox; Phase 2 if we add sandboxed exec. |

---

### 1.3 Core concepts (runtime behaviour)

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Command Queue** | No | OpenClaw serializes inbound runs per session; we handle one request at a time per session. Phase 2: optional in-process queue (debounce, cap) if we see collisions. |
| **Multi-Agent Routing** | No | Single agent (Ollama). Phase 3+: route by intent to different “agents” (e.g. chat vs work). |
| **Session Management / Session pruning** | Partial | We have in-memory sessions; no pruning/compaction. Phase 2: persist or prune old history. |
| **Presence** | No | OpenClaw tracks “who’s online”. Defer. |
| **Channel Routing** | No | We have one backend; channels are just clients. Defer unless we add per-channel behaviour. |
| **Streaming and Chunking** | No | We use `stream: false`. Phase 2: optional SSE/streaming for WebChat. |
| **Markdown Formatting** | Partial | We return plain text; clients can render markdown. |
| **Groups / Group Messages** | No | We don’t model groups. Defer. |
| **Typing Indicators** | No | Telegram has sendChatAction; WebChat could add “typing” via SSE. Phase 2. |
| **Retry Policy** | No | We don’t retry failed Ollama calls. Phase 2: retry with backoff. |
| **Model Failover** | No | Single Ollama; Phase 2: optional fallback model or provider. |
| **Usage Tracking** | No | Phase 2: optional token/call metrics. |
| **Timezones** | Partial | We can add /time with TZ; no global timezone config. |
| **Context / Compaction** | Partial | We slice history; no semantic compaction. Phase 2: optional summarization. |

---

### 1.4 Tools and skills

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Skills (ClawHub, SKILL.md)** | No | We add capabilities in server (commands + optional Ollama tools). No registry. |
| **Plugins (extensions)** | No | No plugin system; we add code in repo. Phase 3+: optional loadable “skills” dir. |
| **Exec Tool** | Via /task | Optional /run with allowlist. Phase 1 optional. |
| **Web Tools** | No | Phase 2: fetch URL (read-only) in server. |
| **apply_patch Tool** | Via /task | Cursor agent can patch; we don’t expose patch as a tool. Defer. |
| **Browser (OpenClaw-managed)** | Via /task | Optional headless fetch. Phase 2. |
| **LLM Task** | Similar to /task | We have /task; no separate “LLM task” abstraction. |
| **Lobster** | No | OpenClaw-specific. N/A. |
| **Slash Commands** | Partial | We have /task, /cursor, /new, /status; add /calc, /time, /read, /ls, /search, etc. |
| **Thinking Levels** | No | Defer. |
| **Agent Send / Sub-Agents** | No | Single agent. Phase 3+ if we add sub-agents. |
| **Reactions** | No | Defer. |
| **Background Exec / Process Tool** | No | We have cron + scripts. Phase 2: optional background job queue. |
| **Elevated Mode** | No | We don’t have sandbox vs elevated. Defer. |
| **Voice Call Plugin** | No | Phase 3+. |
| **Memory (Core / LanceDB)** | Partial | We have MEMORY.md + in-memory history; no vector search. Phase 2: optional memory search. |

---

### 1.5 Nodes and media

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Camera Capture** | No | Phase 3+. |
| **Image and Media Support** | No | We don’t handle images in chat. Phase 2: optional image-in, image-out (e.g. chart). |
| **Audio and Voice Notes** | No | Phase 3+. |
| **Location Command** | No | Phase 3+. |
| **Voice Wake** | No | Phase 3+. |
| **Talk Mode** | No | Phase 3+. |

---

### 1.6 Automation and hooks

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Cron Jobs** | Yes | We use system cron + heartbeat.js. |
| **Heartbeat** | Yes | `webchat-piko/scripts/heartbeat.js`. |
| **Cron vs Heartbeat** | Documented | We use both; heartbeat = scheduled “brain” check. |
| **Gmail PubSub** | No | Phase 2: Gmail read + optional push. |
| **Webhooks** | No | Phase 2: inbound webhook → trigger /task or send to chat. |
| **Hooks** (HOOK.md + handler) | No | Phase 2: event-driven hooks (e.g. on_message, on_schedule). |
| **Auth Monitoring** | No | Phase 2: optional. |
| **Polls** | No | Defer. |
| **SOUL Evil Hook** | No | Defer. |

---

### 1.7 Gateway and ops

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Gateway daemon** | We have Node server | Same idea; we’re thinner. |
| **Gateway Protocol / Bridge Protocol** | No | We have HTTP only. Defer. |
| **Gateway-Owned Pairing** | No | No pairing. Phase 2: optional allowlist. |
| **Gateway Lock** | No | Single process; optional lock file for deploy. |
| **Health Checks** | No | Phase 2: GET /health (Ollama + disk). |
| **Doctor** | No | Phase 2: `piko doctor` or script. |
| **Sandboxing** | No | We have no sandbox; Phase 2 if we add exec tool. |
| **Tailscale / Remote / Discovery** | No | We use SSH + rsync; optional Tailscale later. |
| **OpenAI Chat Completions API** | We call Ollama | Same shape; we’re client. |
| **Tools Invoke API** | No | Phase 2: optional POST /api/tools/invoke for external callers. |
| **Logging** | Partial | console.log; Phase 2: structured logs. |
| **Security / Formal Verification** | No | Phase 2: auth, rate limits. |
| **Environment Variables** | Yes | We use env; document in runbooks. |
| **Multiple Gateways** | No | Single server. Defer. |

---

### 1.8 Web and interfaces

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **WebChat** | Yes | Done. |
| **Control UI** | No | Phase 3+: admin UI for config, queue, reminders. |
| **Dashboard** | No | Phase 3+. |
| **TUI** | No | Phase 3+. |

---

### 1.9 Platforms and native apps

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **macOS App** (menu bar, Canvas, Voice Overlay) | No | Phase 3+ or use PWA. |
| **iOS App** | No | Phase 3+ or PWA. |
| **Android App** | No | Phase 3+ or PWA. |
| **Windows (WSL2)** | No | Our stack runs on Linux; WSL is possible. |
| **Linux App** | No | We run headless; optional desktop app. |
| **Fly.io / Render / Northflank** | No | We deploy to Optimus; optional cloud runbook. |
| **Hetzner / GCP** | No | Same as Optimus pattern. |
| **Docker** | No | We don’t ship Dockerfile; Phase 2: optional. |
| **Nix / Ansible** | No | Defer. |

---

### 1.10 Workspace and templates

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **AGENTS / BOOT / BOOTSTRAP** | No | We have prompts (IDENTITY, SOUL, MEMORY, INTERESTS); no bootstrap file. |
| **HEARTBEAT** (template) | Partial | We have heartbeat.js; no HEARTBEAT.md template. Optional: prompts/HEARTBEAT.md. |
| **TOOLS / USER** | No | We don’t inject TOOLS.md or USER.md. Optional: USER.md for “who the user is”. |
| **Workspace auto-recreate** | No | We don’t overwrite prompts; good. |

---

### 1.11 Approvals and security

| OpenClaw | Piko | Integrate? |
|----------|------|------------|
| **Approvals** (e.g. confirm before run) | No | Phase 2: optional “confirm /task” for dangerous tasks. |
| **Pairing** (authorized users) | No | Phase 2: allowlist by Telegram chatId or API key. |
| **OAuth** (for providers) | No | We use env API keys. Phase 2: optional OAuth for Gmail etc. |
| **Security model** (sandbox vs elevated) | No | Phase 2 if we add exec/sandbox. |

---

## Part 2 — Intent orders (what to build)

**Intent orders** = user expresses an **intent** that should be fulfilled **later** (not immediately). We capture it, store it, and execute it when the trigger fires.

### 2.1 Types of intent orders

| Type | Example | Trigger | What we add |
|------|---------|---------|-------------|
| **Reminder** | “Remind me to call John at 5pm” | Time (cron every N min) | Store: `{ at: "17:00", tz: "Australia/Sydney", text: "Call John" }`. Cron checks, sends Telegram (or pending prompt for WebChat). |
| **Task-queue item** | “Add ‘refactor auth’ to my list” / “Do this when you can” | On-demand (`/queue next`) or cron | Store: `{ task: "refactor auth", project: "Piko", addedAt: ... }`. `/queue next` or cron runs /task with next item, reports back. |
| **Scheduled /task** | “Every day at 9am run a task for Piko” | Cron at 09:00 | Cron runs script: generate one task (or use fixed “continue project”), call /task, send summary to Telegram. |
| **Conditional** | “When you get an email from X, tell me” | Event (e.g. Gmail PubSub or poll) | When event fires, call Ollama or fixed template, send to user. Phase 2 after Gmail. |
| **Intent routing** (optional) | “This is a work task” vs “just chat” | User says or we classify | Route to “work” agent (e.g. /task) vs “chat” (Ollama). RECOMMENDED_PATH_FORWARD mentioned “route by intent/keywords”. |

### 2.2 Where intent orders live in our stack

| Component | Role |
|-----------|------|
| **Storage** | JSON file(s) or SQLite: e.g. `intent-orders/reminders.json`, `intent-orders/queue.json`. Or single `intent-orders.json` with `{ reminders: [], queue: [], scheduledTasks: [] }`. |
| **Capture** | User says “remind me to X at Y” or “add to my task list: Z”. We need to **parse** (regex or Ollama) and **store**. Options: (1) Command only: `/remind 5pm Call John`, `/queue add refactor auth`. (2) Natural language: Ollama extracts intent → we create order. |
| **Execution** | **Reminders:** cron (e.g. every 5 min) reads reminders, if `at <= now` (in user TZ), send Telegram (and/or append to pending prompts for WebChat), remove or mark done. **Queue:** `/queue next` or cron runs one item via /task, then marks done. **Scheduled /task:** cron at configured time runs script that invokes /task. |
| **APIs** | Optional: `POST /api/intent-orders` (add reminder/queue item), `GET /api/intent-orders` (list). Or keep everything behind commands and cron. |

### 2.3 Implementation order for intent orders

1. **Phase 2a — Reminders**
   - **Store:** `intent-orders/reminders.json` (array of `{ id, at, tz, text, chatId? }`).
   - **Capture:** `/remind <time> <text>` (e.g. `/remind 17:00 Call John`). Parse time (and optional TZ); push to reminders.
   - **Cron:** Every 5 min, script reads reminders, checks `at <= now` for user TZ, sends Telegram (or writes to pending-prompts), removes item.
   - **Optional:** “Remind me to X at 5pm” in natural language → Ollama extracts time + text → same store.

2. **Phase 2b — Task queue**
   - **Store:** `intent-orders/queue.json` (array of `{ id, task, project?, addedAt }`).
   - **Commands:** `/queue add <task> [project]`, `/queue list`, `/queue next` (run one via /task, report, remove).
   - **Optional cron:** Every N hours run “next” automatically and notify.

3. **Phase 2c — Scheduled /task**
   - **Config:** e.g. `PIKO_SCHEDULED_TASK_CRON="0 9 * * *"`, `PIKO_SCHEDULED_PROJECT=Piko`. Cron at that time runs script: optionally ask Ollama for one “continue project” task, then call POST /api/chat with message “/task Piko <generated task>”, or fixed task.
   - **Intent order:** “Run a task for Piko every day at 9am” → store as scheduled job config; cron reads and runs.

4. **Phase 2d — Conditional**
   - After Gmail (or other event source): “When you see an email from X, tell me.” Store: `{ type: "when_email_from", from: "X", action: "notify" }`. When Gmail hook or poll sees new mail from X, send message to user. Depends on Gmail integration.

5. **Optional — Intent routing**
   - User message → classify (e.g. “work” vs “chat”) via keyword or Ollama. If “work”, route to /task or work agent; if “chat”, Ollama. RECOMMENDED_PATH_FORWARD: “Route Telegram messages based on intent/keywords.”

---

## Part 3 — Integration into the wider plan

### 3.1 Where this doc sits

- **PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md** — Tools mapping, Phase 1–3, where in code.
- **This doc** — Full **gap list** (everything OpenClaw does that we don’t) + **intent orders** (design and phases).
- **PIKO_TOOLS_OPENCLAW_LIST_REVIEW.md** — High-level “can we build it” and Phase 1 batch.

### 3.2 Phases (updated to include intent orders)

| Phase | Scope |
|-------|--------|
| **Phase 1** | Commands/tools: /calc, /time, /read, /ls, /search, /moltbook, optional /run. **Optional Phase 1:** intent queue (/queue add/list/next) + `scripts/intent-poller.js` or `intent-queue.js` + cron — “build intent orders first” for 80% daily value. See PIKO_OPENCLAW_ROADMAP.md. |
| **Phase 2** | Task queue (if not in Phase 1), **reminders**, **scheduled /task** (/schedule), Gmail (read), one extra channel (Slack or Discord), news, weather, **intent-order storage and cron**. Optional: health, **/doctor**, pairing, streaming. |
| **Phase 2 (intent orders)** | Reminders (store + cron), queue (add/list/next), scheduled /task cron (/schedule). Optional: natural-language capture via Ollama. |
| **Phase 3+** | More channels, Control UI, multi-agent routing, voice, native apps, plugins, sandboxing, approvals. |

### 3.3 Summary table: OpenClaw gap → our integration

| Gap category | Examples | Our integration |
|--------------|----------|-----------------|
| **Channels** | WhatsApp, Slack, Discord, Signal, iMessage, Teams, etc. | One adapter per channel → POST /api/chat. Phase 2: one of Slack/Discord. |
| **CLI** | onboard, doctor, status, sessions, channels, skills, cron, pairing | Phase 2: doctor script, health endpoint; optional pairing/allowlist. |
| **Concepts** | Command queue, multi-agent, session pruning, streaming, typing | Phase 2: optional queue/debounce; optional streaming. Phase 3: multi-agent. |
| **Tools** | Exec, web, browser, apply_patch, slash commands, memory search | Phase 1: /run (allowlist), /search, /read, /ls. Phase 2: fetch URL, optional memory search. |
| **Nodes/media** | Camera, audio, voice, location | Phase 3+. |
| **Automation** | Cron, heartbeat, Gmail PubSub, webhooks, hooks | We have cron + heartbeat. Phase 2: Gmail, webhooks, **intent orders (reminders, queue, scheduled task)**. |
| **Gateway** | Health, doctor, sandbox, Tailscale, lock | Phase 2: health, doctor. |
| **Web** | Control UI, Dashboard | Phase 3+. |
| **Platforms** | macOS/iOS/Android apps | Phase 3+ or PWA. |
| **Intent orders** | Reminders, task queue, scheduled runs, conditional “when X do Y” | **Phase 2:** reminders + queue + scheduled /task; conditional after Gmail/events. |

---

## Part 4 — Intent orders: spec for implementation

So that “intent orders” are buildable from this doc:

### 4.1 Data model (minimal)

**Preferred (separate files):**

```text
intent-orders/
  reminders.json   → [ { id, at (ISO or "17:00"), tz, text, chatId?, createdAt } ]
  queue.json       → [ { id, task, project?, addedAt, status? } ]
  config.json      → (optional) { scheduledTask: { cron: "0 9 * * *", project: "Piko" } }
```

**Alternative (single file, “build first”):** Use one file `data/intents.json` with mixed types: `[ { id, type: "reminder"|"queue"|"scheduled", time?, run?, message?, task?, command?, channel?, priority? }, ... ]`. One cron script (`scripts/intent-poller.js`) reads the file, executes due items (reminders → send message; queue → run /task; scheduled → run command at `run` time), and removes or marks done. See **PIKO_OPENCLAW_ROADMAP.md** §4.

### 4.2 Commands (to add in server.js or separate service)

| Command | Purpose |
|---------|---------|
| `/remind <time> <text>` | Add reminder (e.g. `/remind 17:00 Call John`). |
| `/remind list` | List upcoming reminders. |
| `/queue add <task> [project]` | Add to task queue. |
| `/queue list` | List queue. |
| `/queue next` | Run next item via /task, report, remove. |
| `/schedule <time> <command>` | Add scheduled run (e.g. `/schedule 09:00 /task Weekly report`). Cron at that time runs the command and sends summary. |

### 4.3 Cron jobs

| Job | Schedule | Action |
|-----|----------|--------|
| **Reminders** (or **intent-poller**) | Every 5 min | Read reminders (or `data/intents.json`), if at <= now (in TZ), send Telegram (and/or push to WebChat pending), delete. |
| **Queue (optional)** | e.g. daily or every 5 min | Run `/queue next` once, notify user. With single-file model, same script can process queue items. |
| **Scheduled /task** | From config or stored intents (e.g. 09:00) | At `run` time, execute stored `command` (e.g. `/task Weekly report`) or generate task (Ollama or fixed), call /task, send summary. |

### 4.4 Natural-language capture (optional)

- User: “Remind me to call John at 5pm.”
- We send to Ollama with a tool or prompt: “Extract reminder: time (HH:MM or descriptive), timezone (optional), text. Return JSON.”
- We create reminder from JSON and confirm: “Reminder set for 5pm: Call John.”

This can be Phase 2b after we have `/remind` working.

---

**Next steps:** Implement Phase 1 (commands) as in PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md; then add intent-order storage, `/remind` and `/queue` commands, and cron for reminders and optional queue/scheduled task. This doc is the single place for the full OpenClaw gap list and intent-orders design.
