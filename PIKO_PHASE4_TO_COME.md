# Phase 4 to Come — What We Don’t Have Yet

**Purpose:** OpenClaw “exploded” by solving the “always-on personal AI” problem with concepts that felt like magic. This doc lists **what Piko still doesn’t have** from that playbook and marks it as **Phase 4 to come** (after Phases 1–3 are done). Incorporates the **definitive gap analysis**, **closeness rating (7.8/10)**, and **one-week path to 90%**.

---

## Closeness Rating: 7.8/10 (78%)

```
OpenClaw: 100% (full ecosystem)
Piko:     78%  (core value captured)
Gap:      22%  (mostly "nice-to-haves")
```

**Why 78%?**

- **Daily value:** ~90% of what users actually use daily (chat, tools, intents, weather, news, email) is done.
- **Critical mass:** 4 channels (WebChat, Telegram, Discord, Slack) vs OpenClaw’s 12 — enough for most use cases.
- **Production-ready:** Deployed to Optimus, systemd service, full docs.
- **Polish gap (~22%):** Voice, global CLI, multi-agent, skills marketplace, extra channels, advanced tools.

**Verdict:** Piko is already **“good enough” for private use** and beats OpenClaw on: **Privacy** (no ClawHub phoning home), **Simplicity** (server.js vs TypeScript monorepo), **Control** (you own every line), **Deployed** (Optimus production vs npm install). *Ship fast, capture value, ignore bloat.*

---

## Complete Gap Analysis: Done vs Missing

### ✅ DONE (Major wins — Phases 1–3)

| Feature | OpenClaw | Piko status |
|---------|----------|-------------|
| **Core tools** | calc, time, read, ls, search, moltbook | ✅ `/calc`, `/time`, `/read`, `/ls`, `/search`, `/moltbook` |
| **Intent orders** | command queue, reminders, scheduled | ✅ `/queue`, `/remind`, `/schedule` + cron poller |
| **Productivity** | weather, news, email | ✅ `/weather`, `/news`, `/gmail unread` |
| **Control** | health, doctor | ✅ `/doctor`, GET `/api/control`, `/control` dashboard |
| **Charts** | canvas | ✅ `/chart`, GET `/api/chart` SVG |
| **Streaming** | agent streaming | ✅ `POST /api/chat` with `stream: true` → SSE |
| **Channels** | WebChat, Discord, Slack | ✅ WebChat + Telegram + Discord + Slack adapters |

### ❌ MISSING: OpenClaw features Piko still lacks (after Phase 4 Priorities 1–3)

| Category | OpenClaw commands/features | Piko gap |
|----------|----------------------------|----------|
| **Channels** | WhatsApp, Signal, iMessage, Teams, Matrix, Zalo, BlueBubbles, Google Chat | ✅ WhatsApp + BlueBubbles adapters done; Signal, Teams, Matrix, Zalo, Google Chat still missing |
| **CLI surface** | `openclaw onboard`, `openclaw doctor`, `openclaw agent`, `openclaw message send`, `openclaw pairing` | ✅ `piko chat`, `piko doctor`, `piko intents` (scripts/piko-cli.js) done; no `piko onboard` or pairing |
| **Voice/media** | Voice Wake, camera snap, screen record, location.get, audio transcription | ✅ Web Speech API (Voice button) in WebChat done; Voice Wake, camera, location still missing |
| **Multi-agent** | per-session models/tools, sessions_list/send | ✅ Multi-session profiles (/profile work\|main) done; per-session *models* still missing |
| **Advanced tools** | browser (CDP), canvas (A2UI), nodes (system.run) | No browser CDP in server; /chart SVG done |
| **Skills/marketplace** | ClawHub auto-discovery/install | ✅ Local skills/ dir (loadable index.js) done; no public marketplace |
| **Security** | DM pairing codes, Docker sandbox, Tailscale | ✅ Optional Docker sandbox for /task done; pairing, Tailscale still missing |
| **Daemon/ops** | `openclaw doctor` auto-fix | `piko doctor` CLI done; no auto-fix wizard |
| **Apps** | macOS menu bar, iOS/Android nodes | Web-only |
| **Automation** | Gmail PubSub (push), webhooks | Cron polling only |

---

## One-Week Path to 90% (Phase 4 priority list)

Concrete ordering to close the gap from **78% → 90%**. **All implemented.**

| Priority | Timeline | Phase 4 items | Status |
|----------|----------|----------------|--------|
| **Priority 1** | ~2 days | **WhatsApp adapter** (Baileys) → POST /api/chat; **Multi-session** — `data/sessions.json`, `/profile work`\|`main` | ✅ Done |
| **Priority 2** | ~1 week | **Global CLI** — `node scripts/piko-cli.js chat\|doctor\|intents`; **Docker sandbox** for /task (`PIKO_TASK_DOCKER`, `PIKO_TASK_DOCKER_IMAGE`) | ✅ Done |
| **Priority 3** | Nice-to-have | **Voice** — 🎤 in WebChat (Web Speech API); **iMessage** — adapters/bluebubbles; **Local skills/** — webchat-piko/skills/index.js | ✅ Done |

Remaining gap (beyond this list): WS gateway, multi-agent per-session models, Voice Wake (“Hey Piko”), `piko onboard` wizard, pairing/sandbox polish — see full Phase 4 backlog below.

---

## Why OpenClaw Felt Like Magic

- **Gateway abstraction** — Single WS endpoint as “AI OS kernel”; one install → many channels.
- **Multi-agent routing** — Per-session models/tools/context; work vs personal isolation.
- **First-class tools** — Browser CDP, canvas A2UI, nodes (camera/location), agent-to-agent.
- **Always-on voice** — Voice Wake (“Hey Claw”), Push-to-Talk overlay.
- **ClawHub skills** — Auto-discover/install skills (SKILL.md) → app-store flywheel.
- **Perfect onboarding** — `openclaw onboard --install-daemon` (90 sec → production), `openclaw doctor`.

---

## What Piko Already Has (Phases 1–3)

| OpenClaw concept | Piko today |
|------------------|------------|
| **Gateway** | HTTP POST /api/chat as control plane; WebChat + Telegram + Discord + Slack adapters. |
| **First-class tools** | /task, /cursor, /calc, /time, /read, /ls, /search, /moltbook, /weather, /news, /gmail unread, /chart; cron + intent-poller. |
| **Intent orders** | /queue, /remind, /schedule; data/intents.json; intent-poller.js. |
| **Channels** | WebChat, Telegram, Discord adapter, Slack adapter (all → POST /api/chat). |
| **Health/doctor** | /doctor command, GET /api/health, GET /api/control. |
| **Control UI** | /control dashboard, GET /api/control. |
| **Streaming** | POST /api/chat with `stream: true` → SSE. |

---

## Phase 4 to Come — What We Don’t Have Yet

### 1. **Gateway abstraction (WS control plane)**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Single WS endpoint | `ws://127.0.0.1:18789` — every channel/tools/app connects to one port | We use HTTP POST /api/chat; adapters are separate processes | **Phase 4:** Optional single WebSocket gateway that all channels/tools connect to (or document that HTTP + adapters is our equivalent). |
| One-command onboarding | `openclaw onboard --install-daemon` | Runbooks + systemd; no wizard | **Phase 4:** Optional `piko onboard` (or similar) wizard: auth, channels, daemon install. |

### 2. **Multi-agent / multi-session routing**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Per-session model/tools | Session “main” vs “work” vs “@alice”; different models and tool sets | Single Ollama model; one session map keyed by sessionId; no per-session config | **Phase 4:** Per-session (or per-route) model + tools: e.g. session “work” → /task + sandbox only; “main” → full chat + tools. |
| Group isolation | Slack #team → separate agent/context | Same backend for all; sessionId can differ per channel but no isolation config | **Phase 4:** Optional “agent profiles” (work vs personal) and route by channel or keyword. |
| Context reset | `/new` or `/compact` | We have /new (clear history); no semantic compaction | **Phase 4:** Optional `/compact` (summarize history and replace with summary). |

### 3. **First-class tools (advanced)**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Browser CDP | CDP-controlled Chrome (snapshots/actions/uploads) | /task can use browser via Cursor; no first-class browser tool in server | **Phase 4:** Optional headless browser or CDP tool in server (read-only or controlled). |
| Canvas / A2UI | Live workspace (agent draws UIs) | We have /chart (SVG bar chart) and GET /api/chart | **Phase 4:** Richer canvas (e.g. multi-series charts, simple UI surfaces) or defer. |
| Nodes (camera/location)** | camera/location/system.run on macOS/iOS/Android | None | **Phase 4:** Optional camera/location/system nodes (e.g. mobile or desktop nodes that report in). |
| Agent-to-agent (sessions_*)** | Agent-to-agent messaging | None | **Phase 4:** Optional “sub-agent” or session-to-session messaging (e.g. work agent asks main agent). |

### 4. **Always-on voice**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Voice Wake | “Hey Claw” on macOS | None | **Phase 4:** Voice Wake (e.g. “Hey Piko”) + trigger → POST /api/chat or dedicated endpoint. |
| Push-to-Talk overlay | macOS menu bar PTT | None | **Phase 4:** PTT overlay (desktop or web) that streams or sends audio → STT → /api/chat. |
| Voice on mobile | iOS/Android canvas + voice | None | **Phase 4:** Voice input/output on mobile (PWA or native). |

### 5. **Skills flywheel (private)**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| ClawHub / SKILL.md | Auto-discover and install skills from hub | Skills are code in server.js + adapters; no registry or loadable SKILL.md | **Phase 4:** Local **skills/** dir (or private registry): loadable SKILL.md or skill modules; “I need Gmail” → load gmail skill without redeploy. **Private:** no phoning home. |

### 6. **Onboarding and CLI**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Wizard onboarding | `openclaw onboard --install-daemon` (90 sec) | Runbooks (PHASE2_RUNBOOK, etc.); manual systemd | **Phase 4:** Optional `piko onboard` (or `npm run onboard`): prompts for URL, tokens, installs daemon. |
| CLI doctor | `openclaw doctor` | /doctor in chat + GET /api/health | **Phase 4:** Optional `piko doctor` CLI script (Node or shell) that checks Node, Ollama, env, sandbox, cron. |
| Zero-config channels | One wizard → WhatsApp + Slack + Discord | We have adapters; each needs its own token/config | **Phase 4:** Optional wizard that configures multiple channels (tokens, PIKO_WEBCHAT_URL) in one flow. |

### 7. **Security and isolation**

| Gap | OpenClaw | Piko | Phase 4 |
|-----|----------|------|--------|
| Sandboxing | Docker for non-main sessions; elevated bash toggle | No sandbox; /task runs on host | **Phase 4:** Optional sandbox for /run or untrusted skills (e.g. run in container or restricted env). |
| Pairing / allowlist | DM pairing, allowlists | Anyone with URL/token can send | **Phase 4:** Optional allowlist (e.g. Telegram chatId, API key) or pairing flow. |

---

## Summary: Phase 4 to Come

| # | Area | Phase 4 to come |
|---|------|-----------------|
| 1 | **Gateway** | Optional single WS gateway; optional `piko onboard` wizard. |
| 2 | **Multi-agent** | Per-session model/tools; agent profiles (work vs personal); optional `/compact`. |
| 3 | **Tools (advanced)** | Browser CDP (or headless); richer canvas; nodes (camera/location); agent-to-agent. |
| 4 | **Voice** | Voice Wake (“Hey Piko”); PTT overlay; voice on mobile. |
| 5 | **Skills** | Local skills/ dir or private registry; loadable SKILL.md without redeploy. |
| 6 | **Onboarding** | `piko onboard` wizard; `piko doctor` CLI; zero-config multi-channel wizard. |
| 7 | **Security** | Optional sandbox; pairing/allowlist. |

---

## Why Piko Can Get There

- **Already solved:** WebChat + Telegram + Discord + Slack → gateway-like; /task as first-class tool; cron + intent orders; server.js as control plane; Control UI, streaming.
- **Phase 4** adds the “magic” that’s still missing: WS gateway (or equivalent), multi-session routing, voice, skills flywheel (private), one-command onboarding.
- **Piko wins by being:** Private (no ClawHub phoning home), lean (server.js vs large monorepo), yours (no rename/surprise deprecations).

Phases 1–3 give daily value with low complexity; **Phase 4** is the “to come” list. Use the **one-week path to 90%** (Priority 1 → 2 → 3) above for the fastest gain; the rest of this doc is the full Phase 4 backlog (gateway, multi-agent, voice, skills, onboarding, security) for when you want the full OpenClaw-style experience on your terms.
