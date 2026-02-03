# Piko Tools — Review of “OpenClaw” Skills List & What We Can Build

**Context:** The list you have is a **Comprehensive List of Good Tools and Skills for OpenClaw**. Piko was set up to **be** OpenClaw in spirit — same vision (agent with skills, channels, autonomy, private LLM) — but implemented as our own stack so the LLM stays **private** (Ollama on Optimus). We don’t run the OpenClaw binary or `openclaw skills install` / ClawHub; we add “skills” **our way** (commands and tools in the WebChat server). So we **map** each OpenClaw skill to what we already have or what we add in Piko. This doc reviews the list, says what’s buildable, and proposes a phased plan. **Can we build and test everything in one go?** No — we can build and test a **first batch** in one pass; the rest go on a roadmap.

---

## 1. Piko = OpenClaw with a private LLM (implementation detail)

**In spirit:** Piko **is** OpenClaw — one agent, multiple channels (WebChat + Telegram), skills/tools, heartbeats, memory, Cursor integration — but with a **private** LLM (Ollama, Llama 3.1) instead of whatever OpenClaw used by default.

**In code:** We don’t run the OpenClaw framework or ClawHub. We built a thin stack (Node WebChat server + Telegram bot + Ollama + Cursor /task, /cursor) so we own the pipeline and keep the model local. “Skills” are added as **commands** (/task, /cursor, /new, /status, and future /search, /read, etc.) or as **Ollama tool-calling** (same server, same API).

| | OpenClaw (reference) | Piko (our implementation) |
|---|------------------------|----------------------------|
| **LLM** | Their default (e.g. cloud or config) | **Private:** Ollama (Llama 3.1 8B) on Optimus |
| **Channels** | Telegram, Web, etc. | WebChat + Telegram; same backend |
| **Skills/tools** | `openclaw skills install`, ClawHub, SKILL.md | **We add them** in server.js: commands + optional tool-calling |
| **Adding a “skill”** | Install from registry/repo | Implement in WebChat server (command or tool); Telegram gets it via same API |

So: every OpenClaw skill in your list is either **already covered** by Piko, **covered by /task**, or **we add it** as a Piko command/tool. The vision is the same; the plumbing is ours.

---

## 2. Category-by-Category Mapping

### 2.1 Development and Coding Tools

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **cursor-agent** | ✅ **Already** — `/task` runs Cursor Agent on Optimus | N/A | /task | Yes (already works) |
| **git** | Via **/task** — e.g. `/task Piko "run git pull in this repo"` | N/A | /task | Yes |
| **coding-agent / factory-ai / agentlens** | Via **/task** — Cursor agent can run shells, edit files, navigate code | N/A | /task | Yes |
| **interactive-shell** | Via **/task** for one-off commands; full TUI would need a separate design | Partial | /task or dedicated /run (allowlist) | Defer |

**Summary:** Development/coding is already covered by **/task** and **/cursor**. No new Piko “skill” required for these; we could add a **/run** command (allowlisted shell on Optimus) later if you want explicit “run this command” without going through the agent.

---

### 2.2 Productivity and Task Automation

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **cron** | ✅ **Already** — cron on Optimus runs heartbeat.js; can run any script | N/A | cron + scripts | Yes |
| **nodes** (workflows) | Not directly — we have one agent (/task) | Possible later | Multi-step /task or workflow engine | Defer |
| **message** | ✅ **Already** — Telegram sends messages; heartbeat can send nudges | N/A | Telegram + heartbeat | Yes |
| **task-queue** | Not yet | Yes | New: JSON task queue + cron or command to “process next” | Phase 2 |
| **reminders** | Not yet | Yes | New: reminder store + cron check + Telegram alert | Phase 2 |
| **secure-gmail** | Not yet | Yes (with API) | New: Gmail API read-only tool; needs OAuth/API key | Phase 2 |

**Summary:** Cron + message (Telegram/heartbeat) we have. **Task-queue** and **reminders** are buildable; **Gmail** is buildable with API setup. Good candidates for a second batch, not necessarily “one go.”

---

### 2.3 Communication and Monitoring

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **mentions-filter / slack / discord / twitter** | Not in Piko | Yes, each | New: adapter per platform (Slack bot, Discord bot, etc.) that forwards to POST /api/chat or triggers alerts | Phase 2+ |
| **imessage** | Not (Apple-only, complex) | Possible on Mac only | Defer | Defer |
| **Telegram** | ✅ **Already** — Telegram bot is the main channel | N/A | clawfriend-bot | Yes |

**Summary:** Telegram is done. Other channels (Slack, Discord, Twitter) are “add an adapter that calls Piko’s API” — each is a separate integration. We can do **one** (e.g. Slack or Discord) in a focused pass, not all in one go.

---

### 2.4 Web and Information

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **browser** | Via **/task** — Cursor agent can use browser tools if available | N/A | /task | Yes |
| **web_search** | Not yet | Yes | New: tool or /search using Tavily/Serper/DuckDuckGo API | **Phase 1** |
| **news-filter** | Not yet | Yes | New: cron + feed fetch + filter; or tool that calls news API | Phase 2 |

**Summary:** **web_search** is high value and buildable as a **tool** or **/search** command; fits in a first batch. News is Phase 2.

---

### 2.5 Smart Home and Personal

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **spotify / hue / obsidian / notion** | Not yet | Yes, each | New: each needs its API/OAuth; add as tools or commands | Phase 2+ |
| **1password** | Not yet | Possible (caution) | Read-only vault access; security-sensitive | Defer |

**Summary:** All buildable with API keys/OAuth. Lower priority for “coding companion” Piko; Phase 2+.

---

### 2.6 Other Versatile

| OpenClaw skill | Piko today | Buildable in Piko? | How | Test in one go? |
|----------------|------------|---------------------|-----|------------------|
| **canvas** (charts) | Not yet | Yes | New: generate chart (e.g. quick PNG) from data; optional lib | Phase 2 |
| **file_manager** | Not yet | Yes | New: **read_file** / **list_dir** in sandbox dir (e.g. project on Optimus) | **Phase 1** |
| **shell** | Via **/task** — agent runs shell | Optional **/run** with allowlist | /task or /run | Phase 1 optional |
| **video-research/edit** | Via **/task** or future tool | Partial | /task for now | Defer |
| **crypto-trading** | Not recommended (risk) | Skip | — | No |

**Summary:** **file_manager** → **read_file** + **list_dir** in a sandbox is high value and safe; fits Phase 1. **shell** as explicit **/run** (allowlist) is optional in Phase 1. Skip crypto.

---

## 3. Moltbook (from your current use)

| Capability | Piko today | Buildable? | How | Test in one go? |
|------------|------------|------------|-----|------------------|
| **Register** | Via /task (you used it) | Yes | Keep /task or add /moltbook register | Done via /task |
| **Post / comment / feed** | Not yet | Yes | New: Moltbook API tool or commands (need MOLTBOOK_API_KEY) | **Phase 1** (after claim) |

**Summary:** Moltbook “use” (post, feed, comment) is buildable as a tool or /moltbook commands once you have the API key; can be part of Phase 1 if you want.

---

## 4. What’s Buildable and What “One Go” Means

- **All of the above that are “Buildable: Yes” are technically buildable** over time. None of them require OpenClaw.
- **“Test their success in one go”** — we **cannot** build and fully test 20+ integrations in a single pass. We can:
  - **Phase 1 (one go):** Implement and test a **small set** in one pass: e.g. **calculator**, **get_time**, **read_file** (sandbox), **list_dir** (sandbox), and optionally **web_search** (with one API) and/or **Moltbook** (post/feed). That’s 4–6 items, all buildable and testable together.
  - **Phase 2:** Task queue, reminders, one comms channel (Slack or Discord), news filter.
  - **Phase 3+:** Spotify, Notion, Obsidian, Hue, etc., as needed.

---

## 5. Recommended Phase 1 (Build and Test in One Go)

These are **all buildable** and can be implemented and tested in **one pass** (one PR or one batch of work):

| # | Tool / command | Type | Description | Effort |
|---|----------------|------|-------------|--------|
| 1 | **Calculator** | Tool or command | Evaluate math expression (e.g. `2+3*4`). Safe, no API. | Low |
| 2 | **get_time** | Tool or command | Current time (server or configurable TZ). | Low |
| 3 | **read_file** | Tool or command | Read file from sandbox (e.g. `PIKO_SANDBOX_DIR=/root/projects`). Path must be under sandbox; no `../`. | Low |
| 4 | **list_dir** | Tool or command | List directory in sandbox. Same path rules. | Low |
| 5 | **web_search** | Tool or command | Search the web; return snippets. Requires one API (e.g. Tavily, Serper, or DuckDuckGo). | Medium (API key + HTTP) |
| 6 | **Moltbook** (post/feed) | Tool or command | If you have MOLTBOOK_API_KEY: get feed, create post, add comment. Optional in Phase 1. | Medium (API already documented) |

**Implementation options:**

- **Option A — Commands only:** Add `/calc ...`, `/time`, `/read <path>`, `/ls <path>`, `/search "query"`, `/moltbook feed` (etc.) in the WebChat server and mirror in Telegram (or Telegram already uses WebChat API, so once in server, Telegram gets them). No Ollama tool-calling.
- **Option B — Tool-calling:** Add an agent loop in the server: send user message + list of tools (calculator, get_time, read_file, list_dir, web_search, moltbook_feed) to Ollama; on `tool_calls`, run the tool and call Ollama again. Same behavior in WebChat and Telegram. More code, better UX (“What’s 2+3?” → model calls calculator).

We can do **Option A** first (faster to ship and test), then add **Option B** so Piko can choose when to use them in natural language.

---

## 6. Summary Table (Buildable vs One Go)

| Category | Buildable in Piko? | Prefer in Phase 1? | Notes |
|----------|--------------------|--------------------|-------|
| Development/coding | ✅ Already (/task, /cursor) | — | No new install |
| Productivity (cron, message) | ✅ Already | — | Heartbeat + Telegram |
| Task-queue, reminders, Gmail | Yes | Phase 2 | Buildable, not one go |
| Comms (Slack, Discord, etc.) | Yes | Phase 2 (one channel) | One adapter per platform |
| Web search | Yes | **Phase 1** | One API |
| News filter | Yes | Phase 2 | — |
| Smart home / Spotify / Notion | Yes | Phase 3+ | Per-API |
| file_manager (read/list) | Yes | **Phase 1** | Sandbox only |
| shell (allowlisted /run) | Yes | Phase 1 optional | Risky if too open |
| Moltbook (use API) | Yes | **Phase 1** (optional) | After claim |
| Calculator, get_time | Yes | **Phase 1** | Trivial |

**Can we build them all?** Yes, over time. **Can we test their success in one go?** Only a **subset** (Phase 1 above). Recommendation: implement Phase 1 (calculator, get_time, read_file, list_dir, web_search, optional Moltbook) in one pass and test; put the rest on the roadmap with priorities.

If you say which you want first (e.g. “Phase 1 with Option A” or “Phase 1 with Option B and no Moltbook yet”), the next step is a concrete implementation plan (where in server.js, env vars, and how to test each tool).
