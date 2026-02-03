# Piko — Grok as Neutral Resource & Autonomous Operation

Two topics: (1) Adding a Grok API so Piko can lean on a neutral third perspective when it has challenges. (2) Confirming that Piko can operate **autonomously** (without you prompting it).

---

## 1. Autonomy — Yes, Piko Can Run Without You Prompting It

**What “autonomous” means here:** Piko takes action **without** you sending a message at that moment. The trigger is **time** (schedule) or an **event**, not your keystroke.

**How we get there:**

- **Heartbeat (cron):** A script runs on a schedule (e.g. daily at 09:00). That script:
  1. Reads MEMORY / GOALS (and optionally yesterday’s history).
  2. Asks Ollama (and optionally Grok): “What is the next concrete coding task for project Piko?” 
  3. Takes the generated task string and **runs the Cursor agent** with it (same as /task).
  4. Sends you a summary (e.g. Telegram): “Piko prompted Cursor with: … Result: …”

So **no user prompt** is required at 09:00 — the cron job runs, Piko (via the script) generates the prompt and hands it to Cursor. That’s autonomous operation.

**What you already have:** The heartbeat script (`webchat-piko/scripts/heartbeat.js`) runs on a schedule and can send a Telegram nudge and suggest MEMORY lines. We add a **“continue project”** step to that same heartbeat (or a separate cron job that calls the same “generate task → run /task” bridge). When that runs, Piko is operating **without** you being at the keyboard.

**Summary:** Yes — once the “continue project” flow is wired (generate task → run Cursor with it) and triggered by **cron/heartbeat**, Piko will operate autonomously on that schedule. You can also keep **manual** triggers (“Take over and prompt Cursor”) when you want to prompt it yourself.

---

## 2. Grok API as a Neutral Resource for Piko

**Idea:** When Piko (Ollama) is uncertain or you want a second opinion, Piko can **consult Grok** (xAI’s API) as a neutral third perspective. Grok doesn’t replace Ollama; it’s an optional **advisory** input.

**Grok API (xAI):**  
- Endpoint: `https://api.x.ai/v1/chat/completions` (OpenAI-compatible).  
- Auth: `Authorization: Bearer <GROK_API_KEY>`.  
- You create an API key at [x.ai](https://x.ai) / API console.

**Ways to use it:**

### A. Task generation (second opinion)

When Piko generates the “next task” for Cursor (e.g. in /task-auto or heartbeat “continue project”):

1. Ask **Ollama**: “What is the next concrete coding task for project Piko? One sentence.”
2. Optionally ask **Grok** the same question (or a slight variant: “From a neutral perspective, what’s the next concrete coding task for this project?”).
3. Use Ollama’s answer as primary; use Grok’s as a **sanity check** or **tie-breaker** (e.g. if both agree, use it; if they differ, pick one or combine into one sentence). Or: always send **one** task to Cursor (e.g. Ollama’s), and only call Grok when Ollama’s response is short/vague/failed.

So Grok is a **neutral resource** during task generation — Piko “leans in” to Grok when we want a second perspective before sending a prompt to Cursor.

### B. Chat / hard questions (optional)

When the **user** asks something difficult and we want a second opinion:

1. Get Ollama’s reply as usual.
2. Optionally call **Grok** with the same user message (and maybe a short system prompt: “You are a neutral advisor. Give a concise second opinion.”).
3. Feed Grok’s reply back into the conversation (e.g. “Piko: [Ollama reply]. Grok’s take: [Grok reply].”) or use it only when Ollama’s reply is uncertain (e.g. “I’m not sure” — then we ask Grok and append).

This is more involved (when to trigger, how to merge). A simpler start is **A (task generation)** only.

### C. Implementation outline

- **Env:** `GROK_API_KEY` (and optionally `GROK_MODEL`, e.g. `grok-4-fast` or whatever xAI names it). Never commit the key; use env on Optimus.
- **Code:** A small `grokChat(messages)` (or `callGrok(prompt)`) that POSTs to `https://api.x.ai/v1/chat/completions` with the key in the header, same request shape as our Ollama chat (model, messages). Parse the reply and return the content string.
- **Where to call:**
  - In the **“generate next task”** path (e.g. in heartbeat “continue project” or /task-auto): after getting Ollama’s task string, optionally call Grok with the same “next task for project Piko” prompt; then pick or merge (e.g. use Ollama’s, or use Grok’s if Ollama failed).
  - Optionally in the **chat** path: e.g. a special command “/consult” or “get Grok’s take” that sends the last user message to Grok and returns the reply. Or we only call Grok when we detect “uncertainty” (harder to do reliably).

**Security:**  
- Store `GROK_API_KEY` only in env (e.g. systemd service or .env not in repo).  
- If you log responses, avoid logging full API keys.

---

## 3. Summary

| Question | Answer |
|----------|--------|
| **Will Piko operate without me prompting it?** | Yes. Once the “continue project” flow is triggered by **cron/heartbeat** (and not only by your message), Piko will generate a task and prompt Cursor on a schedule. That’s autonomous operation. |
| **Grok as neutral resource** | Add a Grok API client (env `GROK_API_KEY`, POST to `api.x.ai/v1/chat/completions`). Use it first in **task generation** as a second opinion before sending a prompt to Cursor; optionally later in chat for hard questions or “/consult”. |

**Next steps:**  
1. Implement the “generate task → run Cursor” bridge (/task-auto or heartbeat step).  
2. Add `grokChat()` and call it in that path (optional second opinion for the generated task).  
3. Set up cron for heartbeat (with “continue project” step) so Piko runs autonomously on a schedule.  
4. Keep your Grok API key in env only; never in repo.
