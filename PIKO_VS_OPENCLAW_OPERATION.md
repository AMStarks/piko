# How OpenClaw Operates vs How Piko Operates

**Short answer:** The **LLM** (Ollama) is the same. The **operational path** — who builds the request, how context is injected, and how channels/tools plug in — is different. OpenClaw is a **framework** (gateway, agent runtime, workspace bootstrap, provider abstraction). Piko is a **thin stack** (one Node server, direct Ollama calls, our own prompt loading and command handling).

---

## 1. Same model, different path

| | OpenClaw (when it was running) | Piko (what we run now) |
|---|-------------------------------|-------------------------|
| **LLM** | Ollama (e.g. Llama 3.1, Mistral, Qwen 32B) | Same: Ollama (Llama 3.1 8B default) |
| **API to Ollama** | Via OpenClaw **provider** config: `api: "openai-completions"` or `openai-chat`, `baseUrl`, model list | **Direct:** we POST to `OLLAMA_URL` (e.g. `http://localhost:11434/v1/chat/completions`) with `model`, `messages`, `stream: false` |
| **Who builds the request?** | OpenClaw **agent runtime** builds the request: chooses model, injects workspace (bootstrap), builds messages | **We** build the request in server.js: load IDENTITY/SOUL/MEMORY/INTERESTS once at startup, append session history + user message, POST to Ollama |

So the **model** (the actual neural net in Ollama) does not operate differently. What differs is **who** calls it and **how** the prompt/context is built.

---

## 2. Operational differences (in more detail)

### 2.1 Entry point and routing

| OpenClaw | Piko |
|----------|------|
| **Gateway** process receives from channels (e.g. Telegram plugin). Message may include **envelope** (metadata). Gateway routes to the **agent**. | **WebChat server** or **Telegram bot** receives. Bot can strip envelope and call `POST /api/chat` with raw text. We handle **commands** (/task, /cursor, /new, /status) **before** the LLM; only chat goes to Ollama. |
| **Pairing:** OpenClaw had `openclaw pairing approve telegram <CODE>` so only approved users could talk. | We don’t have pairing; anyone with the bot or WebChat URL can send. (Auth can be added later.) |

### 2.2 Context injection (system prompt / “bootstrap”)

| OpenClaw | Piko |
|----------|------|
| **Workspace** dir (e.g. `/root/.openclaw/workspace`) with files like AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md, SOUL.md, IDENTITY.md. OpenClaw **injects** these into context at request time, capped by **bootstrapMaxChars**. | **Single prompts dir** (`webchat-piko/prompts/`): IDENTITY.md, SOUL.md, MEMORY.md, INTERESTS.md. We **load them once at startup** in `loadSystemPrompt()` and use that string as the system message. No bootstrap at request time; no auto-created workspace files. |
| OpenClaw could **recreate** AGENTS.md, HEARTBEAT.md, etc. on gateway restart (which caused bloat until we stubbed them). | We never overwrite prompt files; we only read what we’ve put there. |

### 2.3 Session and history

| OpenClaw | Piko |
|----------|------|
| Framework managed session per channel/conversation (details in OpenClaw’s code). | We keep a **Map**: `sessionId` (or key from Telegram chatId / unified id) → array of `{ role, content }`. We append user/assistant, slice to last N messages, send to Ollama. |

### 2.4 Tools / skills

| OpenClaw | Piko |
|----------|------|
| **Skill system:** `openclaw skills install`, ClawHub, SKILL.md. Skills plug into the framework; the agent might call tools via the framework. | **Commands** in server.js: /task, /cursor, /new, /status. We run these **before** calling the LLM. Optional: add **Ollama tool-calling** (we’d implement the agent loop and tool execution ourselves). |

### 2.5 API shape to the LLM

| OpenClaw | Piko |
|----------|------|
| Provider abstraction: config specifies `api: "openai-completions"` or `openai-chat"`, baseUrl, model id. OpenClaw translates that into the HTTP call to Ollama. | We always call **chat completions**: `POST .../v1/chat/completions` with `{ model, messages, stream: false }`. Same API Ollama exposes; we don’t go through a provider layer. |

---

## 3. Summary

- **Does an “OpenClaw model” operate differently?**  
  The **model** (Ollama) is the same. The **way the system operates** is different:
  - **OpenClaw:** Framework (gateway → agent runtime → provider → workspace bootstrap) builds the request and calls Ollama; skills and channels plug into the framework.
  - **Piko:** Our code builds the request (prompts + history), calls Ollama directly, and handles commands ourselves. Same LLM, simpler path, full control.

So: **same model, different operation.** Piko is “OpenClaw in spirit” (one agent, skills, channels, private LLM) but with our own, thinner operational path and no OpenClaw binary or workspace bootstrap.
