# OpenClaw Tools — Integration Plan for Piko

**Goal:** Review OpenClaw-style tools and how we can integrate many of them into our stack (WebChat server + Telegram via same API). Each tool becomes either **already covered**, **covered by /task**, or **we add it** as a command and/or Ollama tool.

---

## 1. Full mapping: OpenClaw tool → Piko integration

| OpenClaw-style tool | In Piko today? | How to integrate into our stack |
|---------------------|----------------|----------------------------------|
| **cursor-agent** | ✅ Yes | `/task` — Cursor Agent runs on Optimus. No change. |
| **cursor CLI** | ✅ Yes | `/cursor` — Cursor CLI via wrapper. No change. |
| **git** | Via /task | `/task Piko "run git pull"` etc. Optional: add `/git <subcmd>` that runs allowlisted `git` commands in sandbox dir. |
| **coding-agent / factory-ai / agentlens** | Via /task | Cursor agent does shells, edit, navigate. No new tool. |
| **interactive-shell** | Via /task | Optional: `/run "cmd"` with allowlist (e.g. `ls`, `pwd`, `git status`) in sandbox. |
| **cron** | ✅ Yes | Cron on server runs `heartbeat.js`; can run any script. No change. |
| **nodes (workflows)** | No | Defer: multi-step workflow engine or chain /task calls. |
| **message** | ✅ Yes | Telegram + heartbeat send messages. No change. |
| **task-queue** | No | Add: JSON file or DB of pending tasks; command `/queue add/list/next` + cron to process. Phase 2. |
| **reminders** | No | Add: store reminders (file or DB); cron checks and sends via Telegram. Phase 2. |
| **secure-gmail** | No | Add: Gmail API (read-only) tool; OAuth or API key. Phase 2. |
| **Telegram** | ✅ Yes | `telegram-bot/bot.js` + WebChat API. No change. |
| **Slack** | No | Add: Slack adapter (Bot/App) that forwards messages to `POST /api/chat`; same brain. Phase 2. |
| **Discord** | No | Add: Discord bot that forwards to `POST /api/chat`. Phase 2. |
| **Twitter/X** | No | Add: Twitter API client for mentions/DMs → /api/chat. Phase 2+. |
| **mentions-filter** | No | Per-channel: Slack/Discord bots can filter @mentions and forward. Phase 2. |
| **browser** | Via /task | Cursor agent can use browser tools. Optional: add headless fetch for URL in server (read-only). Phase 2. |
| **web_search** | No | **Add:** `/search "query"` and/or `web_search` tool; Tavily/Serper/DuckDuckGo API. **Phase 1.** |
| **news-filter** | No | Add: cron + RSS or news API; or tool that fetches feed. Phase 2. |
| **spotify** | No | Add: Spotify API (play/pause/search) tool; OAuth. Phase 3+. |
| **hue** | No | Add: Philips Hue API tool. Phase 3+. |
| **obsidian** | No | Add: read/write Obsidian vault via path or API. Phase 3+. |
| **notion** | No | Add: Notion API (read/write pages). Phase 3+. |
| **1password** | No | Defer: security-sensitive; read-only vault only with caution. |
| **canvas (charts)** | No | Add: generate chart image from data (e.g. quick PNG); optional lib. Phase 2. |
| **file_manager** | No | **Add:** `read_file`, `list_dir` in sandbox dir. **Phase 1.** |
| **shell** | Via /task | Optional: `/run "cmd"` allowlist. Phase 1 optional. |
| **video-research/edit** | Via /task | Defer. |
| **crypto-trading** | No | Skip (risk). |
| **Moltbook** | Partial (/task register) | **Add:** Moltbook API (feed, post, comment) if `MOLTBOOK_API_KEY` set. **Phase 1 optional.** |
| **calculator** | No | **Add:** `/calc expr` and/or `calculate` tool. **Phase 1.** |
| **get_time** | No | **Add:** `/time` and/or `get_time` tool. **Phase 1.** |
| **get_weather** | No | Add: Open-Meteo (free) or other API. Phase 2. |

---

## 2. Where each integration lives in our stack

| Integration | Where it runs | What we add |
|-------------|---------------|-------------|
| **Commands** (/calc, /time, /read, /ls, /search, /moltbook, /run) | `webchat-piko/server.js` | New branches in `handleApiChat()` **before** "// —— Chat (Ollama) ——"; parse command, call handler, return `{ reply }`. Telegram gets them automatically (it calls POST /api/chat). |
| **Ollama tool-calling** (calculate, get_time, read_file, list_dir, web_search) | Same server | Agent loop: send `messages` + `tools` to Ollama; on `tool_calls`, run tool, append tool result, call Ollama again. Same API, so WebChat and Telegram both get it. |
| **New channels** (Slack, Discord) | New processes | Small Node (or other) app: receive message from platform → `POST /api/chat` with `message` + `sessionId` → send `reply` back. No change to server except optional auth. |
| **Cron jobs** (task-queue, reminders, news, heartbeat) | Server cron | Scripts in `webchat-piko/scripts/` or repo root; cron runs them. Heartbeat already exists; add e.g. `reminders.js`, `task-queue.js`. |
| **APIs** (Gmail, Spotify, Notion, etc.) | Server | New handlers in server.js (command or tool) that call external API with env-configured keys. |

---

## 3. Phased integration roadmap

### Phase 1 — Add to server (commands + optional tools)

**Goal:** Integrate a first batch of tools into our stack so Piko can do more without new infra. **Optional:** Add intent queue in Phase 1 (“build intent orders first”) — see PIKO_OPENCLAW_ROADMAP.md §3–4.

| # | Tool | Add as command | Add as Ollama tool | Env / API | Effort |
|---|------|-----------------|--------------------|-----------|--------|
| 1 | **Calculator** | `/calc 2+3*4` | `calculate(expression)` | None | Low |
| 2 | **Current time** | `/time` [TZ] | `get_time()` [tz] | Optional `PIKO_DEFAULT_TZ` | Low |
| 3 | **Read file** | `/read <path>` | `read_file(path)` | `PIKO_SANDBOX_DIR` (e.g. `/root/projects`); path must be under sandbox | Low |
| 4 | **List directory** | `/ls [path]` | `list_dir(path)` | Same sandbox | Low |
| 5 | **Web search** | `/search "query"` | `web_search(query)` | `TAVILY_API_KEY` or `SERPER_API_KEY` or DuckDuckGo (no key) | Medium |
| 6 | **Moltbook** (feed/post/comment) | `/moltbook feed`, `/moltbook post ...` | `moltbook_feed()`, `moltbook_post(...)` | `MOLTBOOK_API_KEY` | Medium |
| 7 | **Shell (allowlist)** | `/run ls -la` | — | Allowlist in code (e.g. `ls`, `pwd`, `git status`, `git pull`); sandbox dir only | Medium (careful) |
| 8 | **Intent queue** (optional Phase 1) | `/queue add/list/next` | — | `data/intents.json` or `intent-orders/queue.json`; cron + `scripts/intent-poller.js` or `intent-queue.js` | Medium |

**Safety:** **Calculator:** Do **not** use raw `eval()`. Allow only `^[\d\s+\-*/().]+$` and use `Function('"use strict"; return (' + expr + ')')()`. **Read/list:** Resolve path under `PIKO_SANDBOX_DIR`; reject if path contains `..` or `fullPath.startsWith(SANDBOX_DIR)` is false.

**Implementation order:** 1–4 first (no API keys), then 5–6 (API keys), then 7–8 if desired.

**Where in code:** All in `webchat-piko/server.js`: add `parseCalcCommand(message)`, `parseTimeCommand(message)`, `parseReadCommand(message)`, etc.; add handlers that return `{ reply }`; insert before the `/cursor` block (or after /status). For Ollama tool-calling: add `tools` array (JSON schemas), `executeTool(name, args)`, and a loop that calls Ollama until no `tool_calls`.

---

### Phase 2 — Task automation, intent orders, one extra channel, info tools

**Intent orders** (reminders, task queue, scheduled /task) are a first-class part of Phase 2. Full design — data model, `/remind` and `/queue` commands, cron jobs, optional natural-language capture — is in **PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md**. The full list of what OpenClaw does that we don’t yet is also in that doc.

| # | Integration | How |
|---|-------------|-----|
| 1 | **Intent orders: reminders** | Store in `intent-orders/reminders.json`; `/remind <time> <text>`, `/remind list`; cron every 5 min checks and sends via Telegram or WebChat. See PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md. |
| 2 | **Intent orders: task queue** | `intent-orders/queue.json`; `/queue add "task" [project]`, `/queue list`, `/queue next`; run next via /task, report. |
| 3 | **Intent orders: scheduled /task** | Config or stored intent; cron at e.g. 09:00 runs script that invokes /task and sends summary. |
| 4 | **Gmail (read)** | Gmail API read-only; OAuth or service account; tool or `/gmail unread` (or similar). Enables conditional intents (“when email from X, tell me”). |
| 5 | **One extra channel** | Slack **or** Discord: new small app that forwards to `POST /api/chat`; document in README. |
| 6 | **News filter** | Cron + RSS or news API; optional tool or `/news` command. |
| 7 | **Weather** | Open-Meteo (free) or similar; `get_weather(city)` tool. |
| 8 | **Canvas/charts** | Optional lib to generate PNG from data; tool or `/chart` command. |
| 9 | **Health / doctor** | GET /health (Ollama + disk); `/doctor` command or `piko doctor` script (system stats, Ollama reachable, sandbox status, cron health). See gap list in PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md. |
| 10 | **/schedule** | `/schedule <time> <command>` (e.g. `/schedule 09:00 /task Weekly report`); store in intents or config; cron at that time runs command. See PIKO_OPENCLAW_GAP_AND_INTENT_ORDERS.md §4.2. |

---

### Phase 3+ — More channels, smart home, productivity APIs

| # | Integration | How |
|---|-------------|-----|
| 1 | **More channels** | Twitter, iMessage (Mac only), etc.: one adapter per platform → POST /api/chat. |
| 2 | **Spotify / Hue / Notion / Obsidian** | Each: API client in server, env for keys, command or tool. |

---

## 4. Implementation guide: Phase 1 commands (server.js)

**Pattern for each new command:**

1. **Parse:** e.g. `if (message.startsWith('/calc ')) { const expr = message.slice(6).trim(); ... }`
2. **Validate:** sandbox path, allowlist, length limits.
3. **Execute:** call a small async function that does the work.
4. **Return:** `return send(res, 200, JSON.stringify({ reply: result }));`

**Insertion point:** In `handleApiChat()`, after `/status` and before `/task`, add:

```js
  // —— /calc ——
  if (message.startsWith('/calc ')) {
    const expr = message.slice(6).trim();
    // Safe eval: only numbers and + - * / ( ) . and spaces
    if (/^[\d\s+\-*/().]+$/.test(expr)) {
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        return send(res, 200, JSON.stringify({ reply: String(result) }));
      } catch (e) {
        return send(res, 200, JSON.stringify({ reply: 'Invalid expression.' }));
      }
    }
    return send(res, 200, JSON.stringify({ reply: 'Only numbers and + - * / ( ) allowed.' }));
  }
  // —— /time ——
  if (message === '/time' || message.startsWith('/time ')) {
    const tz = message === '/time' ? process.env.PIKO_DEFAULT_TZ || 'UTC' : message.slice(6).trim();
    try {
      const now = new Date().toLocaleString('en-GB', { timeZone: tz });
      return send(res, 200, JSON.stringify({ reply: `${tz}: ${now}` }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid timezone.' }));
    }
  }
```

**Sandbox for read_file / list_dir:**

- Set `const SANDBOX_DIR = process.env.PIKO_SANDBOX_DIR || path.join(PROJECTS_OPTIMUS || '/root/projects');`
- Resolve user path: `const fullPath = path.resolve(SANDBOX_DIR, userPath);`
- Ensure `fullPath.startsWith(SANDBOX_DIR)` and no `..` in userPath; then `fs.readFileSync(fullPath, 'utf8')` or `fs.readdirSync(fullPath)`.

**Web search:**

- Pick one provider (e.g. Tavily: `https://api.tavily.com/search`, or Serper, or DuckDuckGo HTML scrape).
- Env: `TAVILY_API_KEY` or `SERPER_API_KEY`.
- HTTP request in server; return first N snippets as reply.

**Moltbook:**

- Use existing Moltbook API docs (skill.md); `GET/POST https://www.moltbook.com/api/v1/...` with `Authorization: Bearer MOLTBOOK_API_KEY`.
- Commands: `/moltbook feed`, `/moltbook post <submolt> <title> | <content>`.

---

## 5. Summary: what we integrate and how

| Category | OpenClaw-style tools | How we integrate into our stack |
|----------|----------------------|----------------------------------|
| **Dev/coding** | cursor-agent, git, shell, browser | Already: /task, /cursor. Optional: /git, /run (allowlist). |
| **Productivity** | cron, message, task-queue, reminders, Gmail | Already: cron, Telegram, heartbeat. Add: queue + reminders in Phase 2; Gmail Phase 2. |
| **Channels** | Telegram, Slack, Discord, etc. | Already: WebChat + Telegram. Add: one adapter per channel (Slack or Discord in Phase 2). |
| **Web/info** | web_search, news, browser | Add: /search + web_search tool Phase 1; news Phase 2; browser via /task or fetch Phase 2. |
| **Files** | file_manager | Add: /read, /ls + read_file, list_dir in sandbox Phase 1. |
| **Utilities** | calculator, time, weather | Add: /calc, /time Phase 1; weather Phase 2. |
| **Social** | Moltbook | Add: /moltbook feed|post Phase 1 optional. |
| **Smart home / apps** | Spotify, Hue, Notion, Obsidian | Phase 3+ per API. |

**Next step:** Implement Phase 1 commands in `server.js` (calc, time, read, ls, then search, then moltbook if you have the key). Then optionally add the Ollama tool-calling loop so Piko can choose to use these tools from natural language. If you want, I can add the Phase 1 command handlers (calc, time, read, ls) directly in `server.js` in the next change.
