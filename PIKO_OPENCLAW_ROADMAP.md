# Piko vs OpenClaw — Consolidated Roadmap

**Purpose:** One-page view of OpenClaw’s production ecosystem, a complete gap analysis vs Piko, a prioritized integration roadmap (with intent orders as a first-class feature), and immediate next steps. This doc incorporates the detailed gap list and intent-order spec in **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md** and the tools mapping in **PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md**.

---

## 1. OpenClaw Deep Dive

OpenClaw is a **local-first, multi-channel AI assistant platform**. Core pillars ([GitHub](https://github.com/openclaw/openclaw)):

| Pillar | OpenClaw |
|--------|----------|
| **Gateway (control plane)** | Single WS endpoint (`ws://127.0.0.1:18789`) managing sessions, channels, tools, cron, webhooks, auth rotation, model failover, Control UI/Canvas host. |
| **Multi-agent routing** | Sessions (`main`, groups, workspaces) with per-session models, context, tools, thinking levels, sandboxing (Docker for non-main). |
| **Channels** | WhatsApp (Baileys), Telegram (grammY), Slack (Bolt), Discord (discord.js), Signal (signal-cli), iMessage, Teams, Matrix, WebChat + voice/media pipeline. |
| **Tools ecosystem** | First-class tools (browser CDP, canvas A2UI, nodes for camera/location, cron, sessions_* for agent-to-agent, Discord/Slack actions) + ClawHub skills registry + slash commands. |
| **Apps/nodes** | macOS menu bar (Voice Wake/PTT), iOS/Android nodes (canvas/camera), WSL2/Linux support. |
| **Security** | DM pairing (codes/allowlists), sandboxing, Tailscale Serve/Funnel, elevated bash toggle. |

Piko lacks this full production ecosystem but has a solid foundation: WebChat + Telegram, /task, /cursor, cron, and server.js command handling—suited to a lean **Private LLM Agent Bot**.

---

## 2. Piko vs OpenClaw: Complete Gap Analysis

| Category | OpenClaw Capabilities | Piko (Current) | Gap Size | Priority |
|----------|----------------------|---------------|----------|----------|
| **Channels** | 12+ (WhatsApp, Slack, Discord, Signal, iMessage, Teams, Matrix, Zalo, WebChat) | WebChat + Telegram | **High** (missing 10 channels) | Phase 2 |
| **CLI** | `onboard`, `doctor`, `agent`, `message send`, `pairing`, `sessions_*` | Basic server.js + scripts | **Medium** | Phase 2 |
| **Core Engine** | Multi-agent sessions, streaming, context compaction, model failover, typing indicators | Single Ollama session per chat | **High** | Phase 3 |
| **Tools** | 20+ first-class (browser, canvas, camera, cron, sessions, Discord actions) + ClawHub | /task, /cursor, basic cron | **High** | Phase 1 |
| **Intent Orders** | Command queue, scheduled tasks, conditional triggers, sub-agents | None | **High** | Phase 1 |
| **Security** | DM pairing, Docker sandbox, allowlists, Tailscale | Basic (no sandbox) | **Medium** | Phase 2 |
| **Web/UI** | Control UI, Dashboard, Canvas (A2UI) | WebChat only | **Medium** | Phase 3 |
| **Platforms** | macOS/iOS/Android apps, Docker, Nix | Web/Node only | **Low** | Phase 3+ |
| **Automation** | Gmail PubSub, webhooks, cron with wakeups | Basic cron | **Medium** | Phase 2 |

Full item-level gap list: **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md** (channels, CLI, concepts, tools, nodes/media, automation, gateway, web, platforms, workspace, approvals).

---

## 3. OpenClaw Tools → Piko Integration Plan

### Phase 1 (Week 1) — Core productivity tools + intent queue

**Goal:** Commands in `server.js` + optional intent queue so Piko delivers most daily value without new infra. **Intent orders are the killer feature—build queue/reminders in Phase 1 if you want “80% of OpenClaw’s daily value” first.**

| OpenClaw Tool | Piko Implementation | Where | Notes |
|---------------|---------------------|-------|--------|
| **Calculator** | `/calc 2+2` | `server.js` `handleApiChat()` | **Safe eval only:** allow `^[\d\s+\-*/().]+$`, use `Function('"use strict"; return (' + expr + ')')()` — do **not** use raw `eval()`. |
| **Time** | `/time` [TZ] | `server.js` | `new Date().toLocaleString('en-GB', { timeZone: tz })`; default `PIKO_DEFAULT_TZ` or `en-AU` if preferred. |
| **Read file** | `/read sandbox/summary.md` | `server.js` | Resolve under `PIKO_SANDBOX_DIR`; block `..`; require `fullPath.startsWith(SANDBOX_DIR)`; then `fs.readFileSync()`. |
| **List dir** | `/ls [path]` | `server.js` | Same sandbox rules as read; `fs.readdirSync()`. |
| **Web search** | `/search "query"` | `server.js` | Tavily/Serper API or DuckDuckGo; env `TAVILY_API_KEY` or `SERPER_API_KEY`. |
| **Moltbook** | `/moltbook feed`, `/moltbook post ...` | `server.js` | Existing Moltbook API; `MOLTBOOK_API_KEY`. |
| **Intent queue** | `/queue add "ship piko v0.2"`, `/queue list`, `/queue next` | `server.js` + `scripts/intent-poller.js` (or `intent-queue.js`) + cron | Store in `data/intents.json` (single file) or `intent-orders/queue.json`; cron every 5 min or on-demand. |

**Insertion point in `server.js`:** In `handleApiChat()`, after `/status`, before `/task`. See **PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md** §4 for full code patterns (safe calc, path validation).

### Phase 2 (Week 2–3) — Channels + automation + full intent orders

- **Slack/Discord adapters:** Small app → `POST /api/chat` to Piko server.
- **Gmail:** `gmail.js` or cron script polling INBOX; enables conditional intents (“when email from X, tell me”).
- **Health/doctor:** `/doctor` command or GET /health → system stats, Ollama reachable, sandbox status, cron health.
- **Intent orders (full):** `/remind 5pm Ship piko`, `/remind list`; `/schedule 09:00 /task "daily"`; cron at 09:00 for scheduled /task; optional single `data/intents.json` + `scripts/intent-poller.js` that processes reminders + queue + scheduled. See **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md** Part 2–4.

### Phase 3 (Month 2+) — Advanced

- Multi-agent routing, Control UI, Canvas, native apps, more channels, voice.
- **Done:** Control UI (/control, GET /api/control), /chart + GET /api/chart, Slack adapter, streaming (POST stream: true → SSE).

### Phase 4 to come — What we don’t have yet

**Closeness: 7.8/10 (78%).** OpenClaw 100%; Piko 78% (core value); gap 22% (mostly polish). Full gap analysis and one-week path to 90%: **PIKO_PHASE4_TO_COME.md**.

**One-week path to ~90%:**

| Priority | Timeline | Phase 4 |
|----------|----------|---------|
| **1** | ~2 days | WhatsApp adapter; multi-session (`data/sessions.json` or per-user context). |
| **2** | ~1 week | Global CLI (`piko chat`, `piko doctor`, `piko intents`); optional Docker sandbox for /task. |
| **3** | Nice-to-have | Voice (Web Speech API); iMessage (macOS); local `skills/` dir (ClawHub replacement, private). |

**Full Phase 4 backlog** (when you want the rest):

| Area | Phase 4 to come |
|------|-----------------|
| **Gateway** | Optional single WS gateway; optional `piko onboard` wizard. |
| **Multi-agent** | Per-session model/tools; agent profiles (work vs personal); optional `/compact`. |
| **Tools (advanced)** | Browser CDP; richer canvas; nodes (camera/location); agent-to-agent. |
| **Voice** | Voice Wake (“Hey Piko”); PTT overlay; voice on mobile. |
| **Skills** | Local skills/ dir or private registry; loadable SKILL.md without redeploy. |
| **Onboarding** | `piko onboard` wizard; `piko doctor` CLI; zero-config multi-channel wizard. |
| **Security** | Optional sandbox; pairing/allowlist. |

---

## 4. Intent Orders Implementation (Phase 1 Priority)

**Data model** — Two options:

**Option A — Single file** (simpler for “build first”):

- `data/intents.json`:
```json
[
  {"id":1, "type":"reminder", "time":"2026-02-03T17:00:00+11:00", "message":"Ship piko", "channel":"telegram"},
  {"id":2, "type":"queue", "task":"/task Daily summary", "priority":1},
  {"id":3, "type":"scheduled", "run":"2026-02-04T09:00:00+11:00", "command":"/task Weekly report"}
]
```

**Option B — Separate files** (matches PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md):

- `intent-orders/reminders.json`, `intent-orders/queue.json`, optional `intent-orders/config.json` for scheduled /task.

**Commands:**

- `/remind 5pm Ship piko` → parse time → store → cron checks every 5 min, sends via Telegram/WebChat.
- `/queue add Daily summary` → store → `/queue next` runs first (or cron).
- `/schedule 09:00 /task Weekly` → store or config; cron at 09:00 runs command.

**Cron script** (`scripts/intent-poller.js` or `scripts/reminders.js` + `scripts/task-queue.js`):

- Every 5 min: read intents (single file or reminders + queue), execute due items (reminders → send message; queue → run /task and report), remove or mark done.

Full spec (data model, commands, cron jobs, optional natural-language capture): **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md** Part 2 and Part 4.

---

## 5. Immediate Next Steps (This Week)

1. **Add Phase 1 commands** to `webchat-piko/server.js` (after `/status`, before `/task`): `/calc`, `/time`, `/read`, `/ls`, then `/search`, `/moltbook`. Use **safe calc** (regex + `Function`), **sandbox path checks** for read/ls. See PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md §4.
2. **Sandbox dir:** `mkdir -p sandbox` (or use existing projects dir); set `PIKO_SANDBOX_DIR` in env (e.g. `./sandbox` or `/root/projects` on Optimus).
3. **Intent queue:** `mkdir -p data scripts`; create `data/intents.json` (or `intent-orders/queue.json`) and `scripts/intent-poller.js` (or `scripts/intent-queue.js`) that reads queue, runs next via POST /api/chat with `/task ...`, removes item.
4. **Cron:** `*/5 * * * * cd /path/to/piko && node scripts/intent-poller.js` (or separate crons for reminders vs queue).
5. **Test:** `/calc 2+2`, `/time`, `/read sandbox/test.md`, `/queue add test`, `/queue next`.

This gets Piko most of OpenClaw’s daily value in Phase 1 while staying lean. Phase 2 adds channels and full intent orders (reminders, `/schedule`, Gmail). Full gap list and intent-order design: **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md**. Tools mapping and code locations: **PIKO_OPENCLAW_TOOLS_INTEGRATION_PLAN.md**. Main project and API: **PIKO_PROJECT_AND_INTEGRATION.md**.
