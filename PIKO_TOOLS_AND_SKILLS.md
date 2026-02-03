# Piko — Skills and Tools We Can Add

**Current state:** WebChat and Telegram share one Piko brain (same SOUL/IDENTITY, sessions). **Telegram** has command-style “tools”: `/cursor`, `/task`, `/new`, `/status`. **WebChat** is chat-only (no tools). Below: what “tools” means, what we can add, and how.

---

## 1. Two ways to give Piko “skills”

### A. Command-based (what you have now in Telegram)

**User says a command** → backend runs it and returns the result. No LLM choice.

| Command   | What it does |
|----------|---------------|
| `/cursor` | Run Cursor CLI on MacBook (or Optimus fallback). e.g. `/cursor -version`. |
| `/task`   | Run Cursor agent on MacBook. e.g. `/task "refactor auth"`. |
| `/new`    | Start a new chat session. |
| `/status` | Short help. |

**We could add more commands** (same idea): e.g. `/search "query"`, `/run "command"` (restricted shell on Optimus), `/read path`, etc. WebChat could get the same commands: if the user types `/cursor -version` in the browser, the backend runs it and returns output instead of sending to the LLM.

**Pros:** Simple, explicit, easy to secure (allowlist commands).  
**Cons:** User must know the command; the model can’t decide “I need to search” and call a tool itself.

---

### B. Tool-calling (LLM chooses when to use a tool)

**User says anything** → we send the message to Ollama **with a list of tools** (each tool has a name, description, and parameters). The **model** can respond with “I want to call tool X with args Y”. We run the tool, append the result to the conversation, and call the model again until it replies with plain text (no more tool calls). That’s the standard “agent loop” with tools.

**Ollama supports this:** [Tool calling](https://docs.ollama.com/capabilities/tool-calling) — you pass `tools` in the chat API; the model returns `tool_calls`; you execute, add a `tool`-role message with the result, and call again. Works with streaming too. Models that support it well include Llama 3.1 and others (Ollama docs often use `qwen3` in examples).

**Pros:** Natural (“What’s the weather in Tokyo?” → model calls `get_weather(city: "Tokyo")`). One interface for WebChat and Telegram.  
**Cons:** More code (agent loop, tool schemas, execution); need to secure and sandbox tools (e.g. no arbitrary shell by default).

---

## 2. Example tools we can implement

All of these can be added either as **commands** (A) or as **tools** (B). For (B), we’d define a JSON schema per tool and run it in the agent loop.

| Skill / tool       | Description | Command-style | Tool-calling | Notes |
|--------------------|-------------|---------------|-------------|--------|
| **Cursor CLI**     | Run Cursor on MacBook (or Optimus). | ✅ Already (`/cursor`) | Optional `run_cursor` | SSH + timeout; already in Telegram. |
| **Autonomous task**| Run Cursor agent on MacBook. | ✅ Already (`/task`) | Optional `run_task` | Needs CURSOR_API_KEY; already in Telegram. |
| **Web search**     | Search the web, return snippets. | e.g. `/search "query"` | `web_search(query)` | Needs an API (e.g. Tavily, Serper, or Ollama’s web-search if available). |
| **Read file**      | Read a file from a sandbox dir (e.g. project on Optimus). | e.g. `/read path` | `read_file(path)` | Restrict to a whitelisted base path; no `../`. |
| **Write file**     | Write or append to a file in sandbox. | e.g. `/write path content` | `write_file(path, content)` | Same path rules; dangerous if too broad. |
| **Run shell**      | Run a single command on Optimus (allowlist or restricted). | e.g. `/run "ls -la"` | `run_shell(command)` | High risk; allowlist commands or use a sandbox. |
| **Calculator**     | Evaluate a math expression. | Optional | `calculate(expression)` | Safe; no external call. |
| **Get weather**    | Current weather for a city. | Optional | `get_weather(city)` | Needs a free API (e.g. Open-Meteo). |
| **Current time**   | Server or user timezone. | Optional | `get_time()` | Trivial. |
| **List directory**  | List files in a sandbox dir. | e.g. `/ls path` | `list_dir(path)` | Restrict to whitelisted base. |

**Already have (Telegram only):** Cursor + task. **Easiest to add next:** calculator, current time, then read_file/list_dir in a sandbox. **Higher value, more setup:** web search (API key), weather (API). **Risky without strict limits:** run_shell, write_file.

---

## 3. Where tools run

- **Backend:** All tools run on the **Linux server (Optimus)** in the process that serves WebChat (and that Telegram calls via `PIKO_WEBCHAT_URL`). So one place to implement and secure.
- **Cursor / task:** Those run on the **MacBook** via SSH from Optimus (already); we’re just deciding whether to expose them as commands only (current) or also as tools the LLM can call.
- **APIs (search, weather):** Called from Optimus (Node) using env vars for API keys (no keys in repo).

---

## 4. Implementation options

### Option 1 — Add commands to WebChat (no tool-calling yet)

- In `webchat-piko` server: before calling Ollama, if the message is `/cursor ...` or `/task ...`, run the same logic as the Telegram bot (SSH to MacBook, etc.) and return the command output as the “reply”.
- **Result:** WebChat gets the same Cursor/task abilities as Telegram; no agent loop, no new tools.

### Option 2 — Add a few safe tools (tool-calling)

- In the WebChat server (and optionally used by Telegram via the same API):
  - Define 2–3 tools with JSON schemas (e.g. `calculate`, `get_time`, maybe `read_file` with a fixed sandbox).
  - On each user message: call Ollama with `messages` + `tools`; if the response has `tool_calls`, execute each tool, append `role: "tool"` messages, and call Ollama again (agent loop) until the model returns no tool_calls.
- **Result:** Piko can “do math” or “tell the time” or “read a file” when the user asks in natural language; same behavior in WebChat and Telegram.

### Option 3 — Richer tool set + commands

- Implement more tools (web search, weather, list_dir, optional run_cursor/run_task as tools).
- Keep `/cursor` and `/task` as commands in Telegram for power users; optionally mirror them in WebChat as commands or as tools.
- **Result:** Piko feels like an agent with multiple skills; still one backend, one place to maintain.

---

## 5. Summary

| What you want | Approach |
|---------------|----------|
| **Same Cursor/task in WebChat as in Telegram** | Option 1: add command handling in WebChat server for `/cursor` and `/task`. |
| **“Piko can do math / tell time / read a file when I ask”** | Option 2: add tool-calling in the backend with a few safe tools (e.g. `calculate`, `get_time`, `read_file` in sandbox). |
| **“Piko can search the web / check weather”** | Option 3: add `web_search` and/or `get_weather` tools (need API keys); same agent loop. |
| **“Piko can run shell commands”** | Possible but risky; only with strict allowlist or sandbox and preferably as an explicit command, not an open-ended tool. |

Ollama already supports tool-calling (including with Llama 3.1); we’d add the agent loop and tool execution in the same Node server that serves WebChat and Telegram. If you say which you want first (e.g. “Option 1” or “Option 2 with calculate + get_time”), the next step is a concrete implementation plan in this repo.
