# Piko vs OpenClaw — Parity Assessment & What’s Next

**Purpose:** Disseminate the post–Phase 4 assessment: what Piko now has that matches OpenClaw, what OpenClaw still has that we don’t, updated closeness rating (**~8.5/10**), and where to focus next. This doc reflects external feedback plus internal opinion.

---

## 1. What OpenClaw has that Piko now also has

Piko has equivalents for a large part of OpenClaw’s “wow” features:

| OpenClaw | Piko |
|----------|------|
| **Multi-session / profiles** — per-session agents, routing | `data/sessions.json` + `/profile` (`main` vs `work`); work = /task, /queue, /read, /ls only |
| **Command queue / intent orders** — queue, scheduled, reminders | `/queue`, `/remind`, `/schedule` + `data/intents.json` + `scripts/intent-poller.js` |
| **Core tools** — calc, time, file, search, news, weather, email | `/calc`, `/time`, `/read`, `/ls`, `/search`, `/news`, `/weather`, `/gmail unread` |
| **Health & control** — doctor, gateway dashboard | `/doctor`, GET `/api/health`, `/api/control`, `/control` dashboard |
| **Streaming** — streaming tokens | `POST /api/chat` with `stream: true` → SSE |
| **Charts / canvas-lite** — Canvas (A2UI) | `/chart` + GET `/api/chart` SVG |
| **Channels** — WebChat, Telegram, Slack, Discord, WhatsApp, iMessage | WebChat, Telegram, + adapters: Slack, Discord, WhatsApp, BlueBubbles/iMessage |
| **CLI** — openclaw agent, doctor, etc. | `node scripts/piko-cli.js` (or `npm run piko --`) `chat`, `doctor`, `intents` |

---

## 2. What OpenClaw still has that Piko does not

### Channels and surfaces

- **Extra channels:** Signal, Microsoft Teams, Matrix, Zalo, Google Chat (we have WebChat, Telegram, Discord, Slack, WhatsApp, BlueBubbles).
- **Native apps:** macOS menu bar (voice wake, PTT overlay), full iOS/Android node apps (Canvas, camera, screen recording). We have Web-only + adapters; no native apps.

### Gateway / multi-agent engine

- **Rich multi-agent:** Per-session *models*, tools, thinking levels, verbosity, activation modes; cross-session tools (`sessions_list`, `sessions_send`, `sessions_history`).
- **Context:** Automatic context compaction, summary-based long-term threading, retry and usage tracking per session.

We have a **lightweight subset** (profiles, sessions.json) but not the full per-session configuration matrix or agent-to-agent tools.

### Tools, nodes, and system integration

- **Browser:** Managed Chrome/Chromium via CDP (snapshots, DOM actions, uploads). We have /task (Cursor can use browser); no first-class CDP in server.
- **Nodes:** `system.run`, `system.notify`, camera snapshot, screen recording, `location.get` on macOS/iOS/Android. We don’t have nodes.
- **Voice:** Always-on Voice Wake/Talk Mode across devices, audio streaming, TTS. We have Web Speech API (Voice button in WebChat) only.
- **Skills ecosystem:** ClawHub registry, auto-discovery, SKILL.md conventions, template agents. We have local `skills/` loader (private, no registry).

### Security and ops

- **Security:** DM pairing (pairing codes, allowlists), per-session sandbox vs elevated, Docker for non-main, Tailscale Serve/Funnel.
- **Ops:** Gateway daemon with full health/troubleshooting, richer logging, metrics, dashboards.

We have: optional Docker sandbox for `/task`, health endpoints, small control UI, systemd on Optimus. Simpler than OpenClaw’s gateway+ops stack.

### Automation and integrations

- **Automation:** Gmail Pub/Sub (push), webhooks framework, cron+wakeups in gateway. We have cron-based intent processing; no push Gmail, no generic webhooks.
- **Integrations:** Spotify, Hue, Notion, Obsidian as skills with auth/permissions. We have a path (skills/) but no built-in integrations.

---

## 3. Updated closeness rating: ~8.5/10

**Previous (pre–Phase 4):** ~7.5–7.8/10.  
**After Phase 4:** **~8.5/10** for your use case (single user, private, Optimus).

- **Daily user value vs OpenClaw:** **~85–90%**  
  Multiple surfaces, tools, intent orders, control panel, multi-session, CLI. Most of what makes OpenClaw “magical” for a solo user is there.

- **Architecture / ecosystem parity:** **~60–70%**  
  Missing: full gateway semantics, multi-agent routing, nodes, browser CDP, ClawHub, native apps, robust sandboxing/Tailscale, large community.

**Combined (for your use case):** **Piko vs OpenClaw overall ≈ 8.5/10.** Phase 4 added about a full point in practical parity.

---

## 4. Where to focus next (beyond 8.5/10)

The remaining work is mostly **polish, safety, and ergonomics**, not raw capability:

| Priority | What | Why |
|----------|------|-----|
| **1** | **DM pairing / allowlists** for adapters | Simple per-channel allowlist (e.g. JSON + `/allow`, `/block`) so only chosen users/chats can use WhatsApp, Slack, Discord, iMessage. |
| **2** | **Per-session configuration** (beyond main/work) | `sessions.json` entries: `{ model, toolsAllowed, sandbox, profileName }` per session so you can tune model/tools per chat. |
| **3** | **Better logging/metrics** | JSON logs + lightweight `/metrics` or log viewer in `/control` for debugging and usage. |
| **4** | **One-click deployment / “Piko doctor”** | Script that checks env, adapters, cron, skills and suggests fixes (extend `piko doctor` or add `piko onboard`). |
| **5** | **Showcase skills** in `skills/` | A few example skills: e.g. Notion, local “notes”, todo, “summarize URL” to demonstrate and reuse. |

**Verdict (from feedback):** Piko is already a **serious, OpenClaw-class personal assistant** for a single user. The remaining gap is **ecosystem depth and enterprise polish**, not fundamental capability.

---

## 5. Opinion: what else we’re missing

**Summary:** The feedback is right. We’re not missing a “killer feature” for daily use; we’re missing **polish and optional depth**.

- **Highest leverage, lowest effort**
  - **Allowlist/pairing** — One small allowlist (e.g. `data/allowlist.json` or env `PIKO_ALLOWED_CHAT_IDS`) and a check in each adapter (and optionally in server) so only you (or chosen IDs) can talk to Piko. Big safety win, small code change.
  - **Structured logs** — Replace or wrap `console.log` with a small logger that writes JSON lines (e.g. to `logs/piko.log`). Then `/control` or a separate page can tail or aggregate. Helps debugging and “feels” more production-ready.

- **Nice next steps**
  - **Per-session config** — Extend `sessions.json` to `{ profile, model?, toolsAllowed? }` and, when we have a second Ollama model or a different tool set, use it per session. No rush until you actually want multiple models.
  - **Webhooks** — Single `POST /api/webhook` that accepts a payload (e.g. `{ trigger: "gmail", data: {...} }`) and runs a configured action (e.g. “notify user” or “run /task”). Unlocks Gmail push and other event-driven flows without building Gmail Pub/Sub yourself.
  - **One “showcase” skill** — e.g. “summarize URL” (fetch URL, strip HTML, send to Ollama, return summary) in `skills/`. Proves the loader and gives a template for others.

- **Can defer**
  - **More channels** (Signal, Teams, Matrix, Zalo, Google Chat) — Add when you have a concrete need; each is an adapter similar to WhatsApp/BlueBubbles.
  - **Native apps, Voice Wake, nodes** — Defer until you want hands-free or device-level integration; Web + adapters already cover most use cases.
  - **ClawHub-style registry** — We deliberately stay private; local `skills/` is enough. A “private registry” (e.g. a second repo or a list of GitHub repos you trust) could come later.

**Bottom line:** You’re not missing a must-have for your current use case. Focus next on **allowlist**, **logging**, and optionally **one good skill** and **webhooks**; the rest is incremental polish.
