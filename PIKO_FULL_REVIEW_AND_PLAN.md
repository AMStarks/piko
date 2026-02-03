# Piko — Full Review, Parity, Proactive Plan & OpenClaw Synthesis

**Compiled for morning read.** Covers: what’s connected in Telegram vs WebChat, what’s been done to sync them, proactive personality plan, Cmd+Enter, and how the OpenClaw review maps onto Piko.

---

## 1. Holistic review: Telegram vs WebChat (before vs after)

| Feature | Telegram (before) | WebChat (before) | After (both synced) |
|--------|--------------------|------------------|----------------------|
| **Chat** | WebChat API (or Ollama fallback) | Ollama only | Same: both use WebChat backend → Ollama. Telegram calls `POST /api/chat`; WebChat is the server. |
| **/cursor** | ✅ Runs Cursor CLI on MacBook (or Optimus fallback) | ❌ Not implemented (LLM replied as text) | ✅ **WebChat now runs /cursor** same as Telegram (SSH + exec). |
| **/task** | ✅ Runs Cursor agent on MacBook | ❌ Not implemented | ✅ **WebChat now runs /task** same as Telegram (SSH + CURSOR_API_KEY). |
| **/new** | ✅ New session (rotates sessionId) | ✅ New chat (rotates sessionId in UI) | ✅ Both: WebChat API clears session for key on `/new`. |
| **/status** | ✅ Short help text | ❌ Not implemented | ✅ **WebChat now returns /status** same text. |
| **Fallback if one goes down** | If WebChat down → Telegram uses Ollama direct (single-turn) | If Telegram down → use WebChat in browser | Same: two independent entry points; if one service is down, use the other. |

**Summary:** Telegram and WebChat are now **in sync**. Same commands (/cursor, /task, /new, /status), same chat backend (WebChat server + Ollama). If the WebChat server is down, Telegram falls back to Ollama direct. If Telegram is down, you use WebChat. Both run on Optimus (Linux).

---

## 2. What was implemented in this pass

- **WebChat server (`webchat-piko/server.js`):** Added /cursor, /task, /new, /status handling **before** calling Ollama. Same env vars and SSH logic as the Telegram bot (MACBOOK_USER, MACBOOK_IP, SSH_KEY, CURSOR_WORKDIR, DEFAULT_PROJECT, CURSOR_CLI, AGENT_CLI, CURSOR_OPTIMUS_SCRIPT, PROJECTS_OPTIMUS, CURSOR_API_KEY for /task). Commands return a single `{ reply }` like chat.
- **WebChat UI:** **Cmd+Enter** (Mac) or **Ctrl+Enter** (Windows/Linux) in the message box now sends the message (Enter alone still adds a new line).
- **Deploy:** Redeploy `webchat-piko/` to Optimus and restart `piko-webchat.service`. If you use /task from WebChat, set `CURSOR_API_KEY` (or `CURSOR_API_KEY_BOT`) in the WebChat systemd service so /task can run.

---

## 3. Proactive personality: how Piko can “reach out” and shape what it suggests

You want Piko to **prompt you** with things you care about and to **guide its personality** so it reaches out with relevant suggestions. Two layers:

### A. Prompt layer (no new infra)

- **IDENTITY.md / SOUL.md:** Add short guidance so that when the user returns or asks “what’s up?”, Piko can suggest follow-ups **based only on what the user has already shared** in the conversation (e.g. “You mentioned X last time—want to pick that up?”). No made-up reminders; no “message at 10:30pm” unless we add a scheduler.
- **Optional “interests” file:** e.g. `prompts/INTERESTS.md` (or a section in IDENTITY): a few bullet points you edit (e.g. “Projects: Piko, Zeroa. Care about: autonomy, monitoring, Cursor workflow.”). Load that into the system prompt so Piko’s suggestions and tone align with what you care about. Piko still doesn’t invent facts; it uses this to shape **what** it suggests and **how** it asks.

Example addition to SOUL (conceptual):

- “When the user returns after a while or asks what you can do, you may briefly suggest follow-ups or topics they’ve shown interest in (from this conversation or from INTERESTS). Don’t invent data; only use what the user or INTERESTS have shared.”

Example INTERESTS.md (optional):

- “User interests: Piko/ClawFriend development, Cursor automation, project sync, proactive reminders, Zeroa integration. Prefer concise, actionable suggestions.”

### B. Proactive “reach out” (needs a bit of infra)

- **Telegram:** The only channel that can truly “push” today is Telegram (bot can send a message to your chatId without you sending first). To have Piko “reach out” (e.g. daily or on a schedule):
  - **Cron on Optimus:** e.g. once a day, a script runs that (1) reads a small “memory” or prompt file (e.g. “Anything you want to prompt the user about today? Interests: …”), (2) calls Ollama (or a dedicated “proactive” endpoint on the WebChat server) to get one short message, (3) sends that message via the Telegram Bot API to your chat ID. So “Piko messages you at 9am” is doable without OpenClaw.
- **WebChat:** Browsers don’t get push unless we add it. Options: (1) **Polling:** on load or every N minutes, call an endpoint like `GET /api/pending-prompts` that returns any “pending” proactive note (stored when cron ran); show as a small banner or first message. (2) **WebSocket later:** server pushes when a proactive message is ready. For “match and sync” with Telegram, (1) is enough: same cron that sends to Telegram also writes a “pending prompt” for WebChat; when you open the app you see it.

**Plan in steps:**

1. **Now:** Add optional INTERESTS (or a section in IDENTITY) and 1–2 lines in SOUL so Piko suggests follow-ups and interests-based topics when the user asks; no new services.
2. **Next:** Add a small script on Optimus (e.g. `proactive-piko.js`): reads INTERESTS + optional MEMORY, calls Ollama for one “proactive” message, sends to Telegram (chatId in env), and optionally writes the same to a file or DB for WebChat.
3. **Then:** Cron (e.g. `0 9 * * *` for 9am) runs that script. Optionally add `GET /api/pending-prompts` and a small “Piko left you a note” in the WebChat UI when the list is non-empty.

---

## 4. OpenClaw review — what applies to Piko (without re‑installing OpenClaw)

You’re on **Piko (WebChat + Telegram + Llama 3.1 on Optimus)** and have archived OpenClaw. The OpenClaw review is still useful as a **feature map**: what it had that we’ve already replaced, and what we can steal as ideas.

### Replaced by Piko today

| OpenClaw concept | Piko equivalent |
|------------------|------------------|
| Conversational AI with one model | WebChat + Telegram → same Ollama (Llama 3.1 8B), same SOUL/IDENTITY. |
| Multiple channels (Telegram, etc.) | Telegram + WebChat; same backend. |
| Commands (/new, /status, etc.) | /new, /status in both; /cursor and /task in both (after this pass). |
| Session memory (conversation) | In-memory sessions in WebChat server; keyed by sessionId (and tg-<chatId> for Telegram). |
| “One backend, many channels” | Single WebChat server; Telegram is a client of it (when PIKO_WEBCHAT_URL is set). |

### Ideas we can adopt (without OpenClaw)

- **Heartbeats / proactive checks:** OpenClaw used HEARTBEAT.md and cron to run periodic checks. We can do the same: cron + script that (1) checks something (e.g. “pending tasks”, “sync status”), (2) optionally asks Ollama for a one-line summary or suggestion, (3) sends to Telegram and/or writes a “pending prompt” for WebChat. That’s the “proactive personality” path above.
- **Memory file:** OpenClaw used MEMORY.md / daily logs. We could add a simple MEMORY.md (or a JSON file) that the proactive script and/or the system prompt read so Piko “remembers” themes (e.g. “User cares about X, Y”). No need for full OpenClaw; just a file and a line in the prompt.
- **Skills/tools as modules:** OpenClaw had skills (cursor-agent, Gmail, etc.). We already have “tools” as commands (/cursor, /task). We can add more as needed (e.g. web search, read_file) in the WebChat server and optionally expose them via Ollama tool-calling later (see PIKO_TOOLS_AND_SKILLS.md).
- **Autonomy (scheduled tasks):** OpenClaw used cron + agents. We have /task for on-demand Cursor agent runs. For “run a task every 10 min” (e.g. sync), we keep using cron + your existing sync script; we don’t need OpenClaw for that.
- **Cursor as “project manager”:** The OpenClaw plan (cursor-agent skill, SSH to Optimus, goal setting via Telegram) is conceptually the same as what we have: you send “/task Refactor auth” from Telegram or WebChat → same backend runs the Cursor agent on the MacBook (or Optimus fallback). We’ve built the same flow; we don’t need to install OpenClaw’s cursor-agent skill.

### What we’re not doing (by choice)

- **Re-installing OpenClaw** or Clawd. Piko is the main stack; OpenClaw is archived.
- **70B model** for now (your hardware: 31GB RAM, 10GB VRAM). Llama 3.1 8B is the default; we can revisit larger models later if you upgrade hardware.
- **Gmail/email, Discord, Slack, etc.** until you ask; the doc’s “multi-channel” and “monitoring” ideas can be added later as separate adapters or skills.

---

## 5. Summary and next steps

- **Parity:** Telegram and WebChat now match: /cursor, /task, /new, /status and chat all go through the same logic. If one goes down, use the other; Telegram falls back to Ollama direct if WebChat is down.
- **Cmd+Enter:** Implemented in WebChat; Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) sends the message.
- **Proactive personality:** (1) Prompt layer: INTERESTS + SOUL tweaks so Piko suggests follow-ups and interest-based topics. (2) Optional: cron + script to send a proactive message via Telegram and/or a “pending prompt” for WebChat.
- **OpenClaw:** Used as a feature map only; we don’t re-install it. We’ve replicated the important parts (one backend, two channels, commands, Cursor/task) and can add heartbeats, memory file, and extra tools incrementally.

**Already done in this pass:** `webchat-piko/prompts/INTERESTS.md` added (edit to your interests); SOUL updated so Piko may suggest follow-ups from conversation or INTERESTS; server loads INTERESTS into the system prompt at startup.

**Suggested next steps (in order):**

1. Deploy updated `webchat-piko/` to Optimus and restart `piko-webchat.service`; set `CURSOR_API_KEY` on the WebChat service if you want /task from the browser.
2. Edit `webchat-piko/prompts/INTERESTS.md` to your taste; restart WebChat so the new prompt is loaded; test in chat.
3. If you want “Piko reaches out”: add the proactive script + cron (Telegram first), then optional `GET /api/pending-prompts` + WebChat banner.
4. Add more tools (e.g. calculator, read_file, web search) when you need them (see PIKO_TOOLS_AND_SKILLS.md).

You can read this in the morning and pick up from step 1 or 2.
