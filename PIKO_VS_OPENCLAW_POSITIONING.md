# Piko vs OpenClaw — Positioning

**Summary:** Piko and [OpenClaw](https://github.com/openclaw/openclaw) are **extremely different in scope, maturity, and purpose**. This doc states how Piko positions itself so comparisons are accurate.

---

## Purpose and feature scope

| | **AMStarks/piko** | **openclaw/openclaw** |
|---|-------------------|------------------------|
| **What it is** | Minimal **private LLM agent**: WebChat + Telegram, Ollama (local), Cursor /task and /cursor. One backend, one brain, your infra. | Full **personal AI assistant platform**: multi-channel (WhatsApp, Telegram, Slack, Discord, iMessage, Teams, WebChat, etc.), voice, Canvas, browser tools, skills registry, native apps. |
| **Channels** | Two: WebChat (browser), Telegram. Documented in README and runbooks. | Many: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Teams, WebChat, Matrix, Zalo, etc. |
| **Skills/tools** | Commands in one Node server: /task, /cursor, /new, /status. No skills registry; we add capabilities in code. See PIKO_TOOLS_OPENCLAW_LIST_REVIEW.md. | Full skills system (ClawHub, SKILL.md), plugins, sandboxing, multi-agent routing. |
| **Deployment** | Runbooks in-repo: PHASE2_RUNBOOK.md, DEPLOY_TO_OPTIMUS.md. Deploy script, systemd unit, env for Cursor/Grok. | CLI-driven onboarding (`openclaw onboard`), gateway daemon, channel-specific setup, documented security model. |

---

## Maturity and ecosystem

| Metric | **AMStarks/piko** | **openclaw/openclaw** |
|--------|-------------------|------------------------|
| **Stars / forks / watchers** | Early-stage; minimal public footprint. | Large community (150k+ stars, many forks, active watchers). |
| **Releases** | 1 release (v0.1.0). | 30+ releases, regular updates. |
| **Contributors** | Single maintainer. | Hundreds of contributors. |
| **Docs** | In-repo: README, PIKO_PROJECT_AND_INTEGRATION.md, runbooks, tools review, operation comparison. | Extensive: getting started, platform guides, security, operations, Discord. |

Piko is **not** claiming parity with OpenClaw. It is a **tiny, early-stage** repo: minimal surface, private LLM, two channels, Cursor integration, and runbooks for deployment. OpenClaw is a **mature, full platform** with a large ecosystem.

---

## Technology stack

| | **Piko** | **OpenClaw** |
|---|----------|--------------|
| **Languages** | JavaScript, Shell, HTML (Node server, deploy scripts, WebChat UI). | TypeScript, Swift, Kotlin, plus Shell/CSS/JS; pnpm builds, native apps. |
| **Runtime** | Node (e.g. 16+), Ollama. No build step for the core server. | Node ≥ 22, pnpm/tsx, optional native (macOS/iOS/Android). |
| **Architecture** | Single WebChat server (HTTP + POST /api/chat), Telegram bot as client. Commands and chat in one process. | Gateway, agent runtime, provider abstraction, workspace bootstrap, channels as plugins. |

---

## When to use which

- **Use Piko** when you want a **minimal, private** agent: chat in the browser or on Telegram, run Cursor tasks and CLI, all on your own server with a small codebase you can read and extend. No ClawHub, no 20+ channels — just WebChat + Telegram + Ollama + Cursor.
- **Use OpenClaw** when you want a **full platform**: many channels, skills from a registry, voice, Canvas, native apps, sandboxing, and a large community with docs and support.

---

## Code and structure (Piko)

Piko **does** have a visible structure and docs in the repo:

- **README.md** — What Piko is, features, quick start, integration, Piko vs OpenClaw, docs list.
- **webchat-piko/** — `server.js` (HTTP server, POST /api/chat, /task, /cursor, Ollama), `public/index.html`, `prompts/`, `scripts/heartbeat.js`.
- **telegram-bot/** — `bot.js`, `auth.js`; calls WebChat or Ollama.
- **scripts/webchat-deploy/** — Deploy script, systemd unit, PHASE2/PHASE3 runbooks, key helpers.
- **PIKO_PROJECT_AND_INTEGRATION.md** — Full architecture, config, API, integration guide.
- **PIKO_VS_OPENCLAW_OPERATION.md** — How OpenClaw operated vs how Piko operates (same LLM, different path).
- **PIKO_TOOLS_OPENCLAW_LIST_REVIEW.md** — Mapping OpenClaw-style skills to what Piko has or can add.

Clone the repo and open these files for a direct, code-level view. The gap in **scope and maturity** vs OpenClaw is intentional: Piko is a minimal alternative, not a competitor.
