# LiteLLM Integration — Things to Complete Next

**Goal:** Replace all direct Ollama calls with LiteLLM so Piko has automatic fallback (e.g. Claude when Ollama is down). ~30min.

---

## 1. Install LiteLLM (not done)

```bash
cd webchat-piko
npm install litellm
```

**Note:** LiteLLM’s Node SDK may be `litellm` or `@litellm/core`; confirm package name and use `completion` (or equivalent) from the installed package.

---

## 2. Add API keys to `.env` (not done)

Add to `webchat-piko/.env`:

```env
# Existing Ollama (primary – stays local/free)
OLLAMA_API_BASE=http://host.docker.internal:11434
MODEL_PRIMARY=ollama/llama3.2

# Fallback: Claude (free tier at console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-...

# Fallback: OpenAI (optional, cheap GPT-4o-mini)
OPENAI_API_KEY=sk-...

# LiteLLM logging
LITELLM_LOG=info
```

Keep existing `OLLAMA_URL` / `OLLAMA_MODEL` for now; migration will switch to `MODEL_PRIMARY` where LiteLLM is used.

---

## 3. Add shared LLM helper (not done)

**New file:** `webchat-piko/lib/llm.js`

- Export a single function, e.g. `ai(prompt, options)`:
  - Calls LiteLLM `completion()` with:
    - `model`: `process.env.MODEL_PRIMARY || "ollama/llama3.2"`
    - `messages`: `[{ role: "user", content: prompt }]`
    - `temperature`: `options.temperature ?? 0.7`
    - `max_tokens`: `options.max_tokens ?? 1000`
    - `fallback_models`: e.g. `["anthropic/claude-3.5-sonnet-20240620", "openai/gpt-4o-mini"]`
  - Returns the **text** of the assistant message (same shape as current `ollamaChat` usage: string).
- Use LiteLLM’s Node API (e.g. `import { completion } from 'litellm'` or whatever the installed package exports).

**Usage everywhere:** Replace `ollamaChat([{ role: 'user', content: prompt }])` with `ai(prompt, { temperature, max_tokens })` and use the returned string.

---

## 4. Replace all Ollama calls (not done)

Replace every direct Ollama `fetch` / `ollamaChat` with the shared `lib/llm.js` helper (or equivalent LiteLLM call) in these files:

| File | What to replace |
|------|------------------|
| **server.js** | `ollamaChat`, `ollamaChatStream`, and all `fetch(OLLAMA_URL)` / `httpRequest` to Ollama (conversation summary, discern, chat stream, chat non-stream, health ping, control ping). Preserve streaming behavior: use LiteLLM streaming if available, or keep one streaming path to Ollama and use LiteLLM only for non-stream. |
| **scripts/moltbook-poster.js** | Local `ollamaChat(messages)`; replace with `ai(prompt, opts)` (or multi-turn helper if needed). |
| **scripts/moltbook-comment-run.js** | Local `ollamaChat(messages)` (2 call sites). |
| **scripts/learning-inquiry.js** | Local `ollamaChat(messages)` (1 call site). |
| **scripts/meta-reflection-weekly.js** | Local `ollamaChat(messages)` (4 call sites). |
| **scripts/learning-topic-suggestions.js** | Local `ollamaChat(messages)` (1 call site). |
| **scripts/rabbit-hole-daily.js** | Local `ollamaChat(messages)` (2 call sites). |
| **scripts/moltbook-aim-proposal.js** | Local `ollamaChat(messages)` (1 call site). |
| **scripts/heartbeat.js** | Local `ollamaChat(messages)` (2 call sites). |

**Scripts that do not call Ollama** (no change needed): `proactive-patterns.js`, `daily-briefing.js`, `files-patterns.js`, `context-synthesis.js`.

**Server.js locations to update (grep reference):**

- Conversation summary (file_capture): `ollamaChat([{ role: 'user', content: prompt }])` → `ai(prompt)`.
- Discern intent: `ollamaChat([...])` → `ai(...)`.
- Chat stream: keep stream API; either use LiteLLM stream or retain direct Ollama for streaming only.
- Chat non-stream: `ollamaChat(messages)` → use `ai(messages[messages.length-1].content)` or multi-turn `completion({ messages })` and return `.choices[0].message.content`.
- `/api/health`: either call LiteLLM with primary model or keep a small Ollama ping; document which is “primary” in response.
- Control dashboard health check: same as above.

**Response shape:** Current code expects a **string** (e.g. `summaryReply` from Ollama). LiteLLM returns something like `response.choices[0].message.content`; normalize to string in `lib/llm.js` so callers stay unchanged.

---

## 5. Add `GET /api/models` (not done)

In `server.js`, add:

```js
// GET /api/models – primary + available for LiteLLM
if (req.method === 'GET' && pathname === '/api/models') {
  return send(res, 200, JSON.stringify({
    primary: process.env.MODEL_PRIMARY || process.env.OLLAMA_MODEL || 'ollama/llama3.2',
    available: [
      'ollama/llama3.2',
      'anthropic/claude-3.5-sonnet-20240620',
      'openai/gpt-4o-mini'
    ]
  }));
}
```

---

## 6. Test (not done)

- Stop Ollama: `docker stop ollama` (or kill local Ollama).
- Test Messages → Reminders flow: share a conversation to Piko; expect summary + actions from fallback (e.g. Claude).
- `curl -X POST "http://localhost:3000/api/ios-hub" -H "Content-Type: application/json" -d '{"action":"file_capture","text":"Client needs report Friday. Follow up Tuesday."}'`
- Expect `ok: true`, `type: "conversation"`, `summary`, `actions`.
- `GET /api/models` returns `primary` and `available`.

---

## 7. Deploy (not done)

- `pm2 restart piko` or `docker-compose up -d` (no change to deploy flow).
- Ensure `.env` with `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`) is present on the server.

---

## Verification checklist

- [ ] `npm install litellm` (or correct package) in `webchat-piko`
- [ ] `.env` has `MODEL_PRIMARY`, `ANTHROPIC_API_KEY`, optional `OPENAI_API_KEY`, `LITELLM_LOG`
- [ ] `webchat-piko/lib/llm.js` exists and exports `ai(prompt, options)` using LiteLLM
- [ ] All Ollama call sites in the table above replaced (server.js + 8 scripts)
- [ ] Messages → Reminders (file_capture conversation) works with Ollama OFF
- [ ] `GET /api/models` returns 3 models
- [ ] Daily briefing and other cron scripts that use LLM work with fallback when Ollama is down

---

## Result

- **Before:** Ollama down → Piko chat and summaries fail.
- **After:** LiteLLM uses primary model (Ollama); on failure, fallback to Claude (or OpenAI) for 100% uptime on LLM features.
- **Optional:** Set `MODEL_PRIMARY=anthropic/claude-3.5-sonnet-20240620` for stronger summaries, with Ollama as fallback for privacy-sensitive paths.
