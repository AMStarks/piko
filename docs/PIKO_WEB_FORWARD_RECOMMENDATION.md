# Piko — Web-based version: best path forward

**Purpose:** Recommendation for the web-based Piko experience after looking at OpenClaw interfaces and other self-hosted chat/control options.

---

## 1. Options considered

| Option | What it is | Pros | Cons |
|--------|------------|------|------|
| **OpenClaw (gateway + Control UI)** | Self-hosted gateway (WS `:18789`), Control UI (Vite + Lit) for chat, channel status, sessions, cron/skills, config, logs, exec approvals. | Multi-channel, first-class tools, sessions, one control plane. | Different stack (Go/gateway + separate UI), migration effort, Piko’s personality and learning/Moltbook/EA are in our server. |
| **LibreChat / LobeChat / NextChat** | Self-hosted chat UIs: multi-provider (OpenAI, Ollama, etc.), conversations, plugins. | Polished chat UX, plugins, OSS. | Chat-first; no Piko Control (Learning, Moltbook, EA, intents), no /task, /cursor, Wisdom Core, or our dashboard. Would be “generic chat in front of Ollama.” |
| **Improve Piko WebChat + Control** | Keep current stack: `server.js`, `/control`, WebChat, iOS app calling same APIs. | One codebase, Piko identity and features stay central; dashboard, Learning, EA, intents already wired. | UI is plainer; we own all polish. |

---

## 2. OpenClaw in a bit more detail

- **Interfaces:** Gateway exposes WS; Control UI (default port 18789) gives: chat, channel status, sessions, cron/skills, config, logs, exec approvals. It’s a full ops + chat surface.
- **Fit for Piko:** OpenClaw is strong for **multi-channel + tools + one control plane**. Piko’s differentiation is **one companion brain** (Wisdom Core, learning, Moltbook, EA, tensions, intents). That logic lives in our Node server and data, not in OpenClaw. Using OpenClaw as the **web front-end** would mean either (a) gateway proxying to our server (extra hop, two systems) or (b) reimplementing Piko’s behaviour inside OpenClaw (large effort, duplicate logic).

---

## 3. Other interfaces (LibreChat, LobeChat, NextChat, etc.)

- **Role:** They are **chat clients** — pretty UIs over LLM APIs, with conversation history and sometimes plugins.
- **Gap vs Piko:** They don’t provide Control (Learning, Moltbook, EA, intents, dashboard), our commands (/task, /cursor, /remind, etc.), or our personality/memory pipeline. Adopting one as “the” web app would either replace Piko’s web experience with generic chat or force a heavy integration that still leaves Piko’s value in our server and a separate “Piko Control” elsewhere.

---

## 4. Recommendation: improve Piko WebChat and Control; treat OpenClaw as optional future layer

**Best path forward for the web-based version:**

1. **Double down on Piko WebChat + Control**  
   - Keep a single Node server and one web surface.  
   - Flesh out **Dashboard** (API already expanded: `ea`, `rabbitHole`, `calendarTodayCount`, `remindersPendingCount`, `tensionsUpdatedDaysAgo`, `moltbookLast.createdAt`).  
   - Improve **Control** layout and clarity (sections for EA, Learning, Moltbook, Intents) and make rabbit-hole visible.  
   - Optionally add a **read-only or lightweight “Topics we’ve discussed”** flow that feeds into `topics.txt` or suggestions so the web user can influence learning.

2. **Use OpenClaw only if we need its layer**  
   - If the goal is **many channels (Slack, Discord, WhatsApp, etc.) and one gateway**, then OpenClaw (or similar) can sit **in front of** Piko: gateway receives from channels and forwards to our `POST /api/chat` (and future webhooks). The **web experience** stays our WebChat + Control; we don’t replace them with OpenClaw’s UI for the primary “talk to Piko” and “see what Piko is doing” use cases.

3. **Don’t adopt a generic chat UI as the main Piko web app**  
   - LibreChat/LobeChat/NextChat are great as generic chat. For Piko, they don’t replace Control, dashboard, or learning; they would add a second, non-Piko-specific surface. If we want a prettier chat UI later, we can improve our own WebChat or reuse components, keeping one product and one brain.

**One-sentence summary:** For the web-based version, **improve Piko’s own WebChat and Control** as the main path; consider **OpenClaw as a routing/gateway layer** only if we need multi-channel at gateway scale; **do not** replace the web experience with a generic chat UI.

---

## 5. Concrete next steps (web)

- Expose expanded dashboard fields in Control (and optionally in the iOS app).  
- Refine Control layout (EA, Learning, Moltbook, Intents) and rabbit-hole visibility.  
- Document “Things Piko suggests we add” (reminders/calendar) and keep Reminders/Calendar in the app as the Piko-layer control surface.  
- If we add more channels, prefer adapters calling our server; evaluate OpenClaw gateway only if we want a single WS/routing layer and are willing to run and maintain it.
