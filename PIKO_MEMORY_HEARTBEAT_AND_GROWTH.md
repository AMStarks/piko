# Piko — Memory, Daily Logs, Heartbeat, Projects/Goals, Security & Growth

**Context:** You’re on Piko (WebChat + Telegram, one prompt folder `webchat-piko/prompts/`), not OpenClaw. The research you pasted is about OpenClaw’s workspace system; here we map those ideas onto Piko and add a path for the agent to “learn and grow” via context, not weight updates.

---

## 1. Review of the research (in light of Piko)

**What matches Piko today**

- **IDENTITY + SOUL + INTERESTS:** We already use a minimal set (persona, behavior, interests). The research’s “top-priority directives” and “negation for boundaries” are in SOUL (e.g. “Respond ONLY to user’s message content”).
- **Single prompt folder:** One source of truth; no AGENTS.md bootstrap—we just load IDENTITY, SOUL, INTERESTS at startup and inject into the system prompt.
- **Token efficiency:** Keeping prompts short (bullets, ~200–500 tokens) applies; we should do the same for any new files.

**What we don’t have (and the research suggests)**

- **MEMORY.md** — long-term curated facts, preferences, “lessons learned.”
- **Daily logs** — raw session notes (e.g. `memory/YYYY-MM-DD.md` or our existing nightly `history/YYYY-MM-DD.txt`).
- **HEARTBEAT** — periodic checks (cron + script) that can run tasks, summarize, or update memory.
- **PROJECTS.md / GOALS.md** — explicit goals/tasks the agent can refer to and you can edit.
- **SECURITY.md or RULES.md** — extra safety/boundary rules.

**“Learn and grow”**

- LLMs don’t update their weights at runtime. “Learning” here means: **better context over time** (memory, logs, goals) and **processes that update that context** (heartbeat distilling into MEMORY, you or the agent editing GOALS). The model doesn’t change; what we feed it does, so it *behaves* more informed and consistent.

---

## 2. How to implement each piece in Piko

### Memory (MEMORY.md)

**Idea:** Long-term, curated facts and preferences (not raw chat). Loaded into the system prompt so Piko “remembers” across sessions.

**Implementation**

- **File:** `webchat-piko/prompts/MEMORY.md`
- **Content (you edit):** Short bullets or 1–2 line items, e.g.:
  - User prefers X.
  - Lessons: always confirm before running destructive commands.
  - Projects: Piko, Zeroa; current focus: auth refactor.
- **Loading:** Server loads MEMORY.md at startup and appends it to the system prompt (after INTERESTS), same as other prompts. Keep it short (e.g. &lt; 300 words) to avoid token bloat.
- **Growth:** You edit MEMORY.md by hand when something important comes up; optionally a heartbeat script (see below) can *suggest* additions (e.g. “Consider adding to MEMORY: …”) or append a line after you approve.

**Format (minimal)**

```markdown
# Memory (long-term)

- User prefers: concise replies; Christian wisdom in advice.
- Lessons: confirm before /task on production; don't invent API keys.
- Current focus: Piko WebChat parity, then Zeroa integration.
```

---

### Daily logs

**Idea:** Raw record of what happened (by day). Good for continuity and for feeding a heartbeat that distills into MEMORY.

**Implementation**

- **Option A — Use existing nightly dumps:** We already write `history/YYYY-MM-DD.txt` each night (session history). Treat that as the “daily log” for chat. No new format; just keep it and optionally move it under e.g. `history/daily/` or leave as-is.
- **Option B — Separate daily log file:** Add a `memory/` (or `logs/`) dir and have the server or a cron job append a short “Daily log” line each time something notable happens (e.g. “2026-02-03: User asked about heartbeat; discussed MEMORY.md”). That requires defining “notable” (e.g. /task completed, or manual only). Simpler: use Option A and, if you want a shorter “log,” have a nightly script that summarizes `history/YYYY-MM-DD.txt` into `memory/YYYY-MM-DD.md` (e.g. 3–5 bullet summary via Ollama or by hand).
- **Recommendation:** Start with Option A (existing history dumps = daily logs). Add a one-line “today” summary in MEMORY.md or a small `memory/today.md` that you or a script update if you want “what happened today” in the prompt.

---

### Heartbeat

**Idea:** A periodic process (e.g. cron on Optimus) that runs on a schedule and can: check things, summarize logs, suggest MEMORY updates, or send a proactive Telegram message.

**Implementation**

- **Script:** e.g. `webchat-piko/scripts/heartbeat.js` (or a shell script that calls Node). Runs via cron (e.g. daily at 09:00 or every 6 hours).
- **What it can do (pick what you need):**
  1. **Summarize yesterday’s history:** Read `history/YYYY-MM-DD.txt`, call Ollama with “Summarize this conversation in 3–5 bullets,” write to `memory/daily/YYYY-MM-DD-summary.md` or append one block to MEMORY.md.
  2. **Suggest MEMORY updates:** Same summarization step; output “Suggested MEMORY additions: …” to a file; you review and paste into MEMORY.md (or script appends after approval).
  3. **Proactive nudge:** Call Ollama with MEMORY + GOALS + “What’s one short nudge for the user today?” and send that via Telegram (using the bot token and your chat ID).
  4. **Goals check:** Read GOALS.md and, if you’ve defined “remind me if …”, send a reminder (or add to the nudge).
- **No OpenClaw:** We don’t have HEARTBEAT.md; the “heartbeat” is just “cron + script.” You can add a small `prompts/HEARTBEAT.md` that the *script* reads (e.g. “Check: sync status, pending goals”) so the script knows what to do, but the agent doesn’t need it in-chat unless you inject a summary into MEMORY or the system prompt.

---

### Projects / Goals

**Idea:** A single place (GOALS.md or PROJECTS.md) where you list current goals, projects, or tasks. The agent reads it and can refer to it in chat; heartbeat can use it for reminders.

**Implementation**

- **File:** `webchat-piko/prompts/GOALS.md` (or PROJECTS.md).
- **Content (you edit):** Short list, e.g.:
  - Goals: Complete auth refactor in Piko; add heartbeat script; integrate Zeroa.
  - Projects: Piko (primary), Zeroa (next).
- **Loading:** Server loads GOALS.md at startup and appends to the system prompt (e.g. after MEMORY). Keep it short.
- **Format**

```markdown
# Goals

- Complete WebChat/Telegram parity and deploy.
- Add heartbeat (daily summary + optional proactive nudge).
- Later: Zeroa integration.
```

- **Growth:** You update GOALS.md as priorities change. Optionally, the agent could be instructed: “When the user says a goal is done, suggest they remove it from GOALS.md” (no auto-edit unless you add a tool for that).

---

### Security and rules (RULES.md or SECURITY.md)

**Idea:** Explicit safety and boundary rules so Piko (and any tools) stay within guardrails.

**Implementation**

- **File:** `webchat-piko/prompts/RULES.md` (or SECURITY.md).
- **Content:** Short, high-priority bullets. Research favours “negation” and “top of file” for strict rules. Examples:
  - NEVER exfiltrate data; DON’T run destructive commands without explicit user confirmation.
  - For /task: only in allowed projects (list them); no `rm -rf`, no production DB writes without confirmation.
  - Don’t invent API keys, env vars, or credentials; don’t pretend to have sent email or SMS unless a tool actually did.
- **Loading:** Load RULES.md at startup and prepend or place right after SOUL (so they’re early in the prompt). Keep under ~150 words.
- **Format**

```markdown
# Rules (security and boundaries)

- NEVER exfiltrate data or run destructive commands without explicit user confirmation.
- /task: only in allowed projects; no production DB or rm -rf without confirmation.
- Don't invent API keys, credentials, or claim to have sent messages unless a tool did.
- If unsure, ask the user.
```

---

## 3. Loading order and token budget

**Suggested order in system prompt (top → bottom)**

1. **RULES.md** (if present) — boundaries first.
2. **IDENTITY.md** — who Piko is.
3. **SOUL.md** — how Piko behaves.
4. **MEMORY.md** (if present) — long-term memory.
5. **GOALS.md** (if present) — current goals/projects.
6. **INTERESTS.md** — your interests for suggestions.

**Token budget**

- Research suggests ~200–500 tokens per file for local models. Keep each new file to a few dozen lines of short bullets so total prompt stays manageable and we avoid summarization/meta-behaviour.

---

## 4. Making the agent “learn and grow”

**Constraint:** The base LLM doesn’t learn at runtime. Growth = **richer, updated context** + **processes that maintain it**.

**Concrete mechanisms**

1. **You curate MEMORY.md**  
   When something important happens (preference, lesson, project change), add a line to MEMORY.md. Restart WebChat (or add a “reload prompts” endpoint later) so the next session sees it. That’s “learning” from your perspective.

2. **Daily logs → heartbeat → MEMORY**  
   - Nightly: we already have `history/YYYY-MM-DD.txt`.  
   - Heartbeat (e.g. once per day): script reads yesterday’s history, asks Ollama for “3–5 bullet summary; if anything is a lasting preference or lesson, output one line for MEMORY.”  
   - Script writes “Suggested MEMORY line: …” to a file; you paste into MEMORY.md (or approve and script appends). Over time MEMORY grows with distilled lessons.

3. **GOALS.md as “growth”**  
   You update goals as you complete them; the agent always sees current goals and can nudge, remind, or suggest next steps. That’s “growth” in terms of behaviour aligned with your current priorities.

4. **Optional: reflection prompt**  
   In SOUL (or a dedicated REFLECT.md loaded only when you want): “At the end of long conversations, you may suggest one short line the user could add to MEMORY.md (e.g. a lesson or preference). Don’t edit files; just suggest.” So the agent participates in curating memory; you still approve.

5. **No fine-tuning required**  
   All of this is context and process. If you later want the model itself to change, that’s fine-tuning (separate, heavier); for “learn and create new growth patterns” and “consistently understanding,” context + memory + goals + heartbeat is enough.

---

## 5. Implementation order (recommended)

1. **RULES.md** — add file, load at startup (after SOUL or first). No new code paths; just one more file in `loadSystemPrompt()` (or a dedicated `loadRules()` that prepends).
2. **MEMORY.md** — add file, load at startup; you edit by hand.
3. **GOALS.md** — add file, load at startup; you edit by hand.
4. **Daily logs** — treat existing `history/YYYY-MM-DD.txt` as the daily log; optionally add a `memory/` dir and a nightly script that writes a short summary into `memory/YYYY-MM-DD-summary.md` for later use by heartbeat.
5. **Heartbeat script** — add `scripts/heartbeat.js` (or .sh) that: reads yesterday’s history (and GOALS, MEMORY); optionally calls Ollama for summary or “suggested MEMORY line”; writes suggestions to a file; optionally sends a proactive Telegram nudge. Run via cron.
6. **Reflection (optional)** — add one line to SOUL: “You may suggest one short MEMORY line at the end of long chats; don’t edit files.”

---

## 6. Summary table

| Piece        | File(s) / location              | Who updates              | Loaded into prompt? |
|-------------|----------------------------------|--------------------------|---------------------|
| Memory      | `prompts/MEMORY.md`             | You (+ optional heartbeat suggestions) | Yes                 |
| Daily logs  | `history/YYYY-MM-DD.txt` (+ optional `memory/YYYY-MM-DD-summary.md`) | Server (history); script or you (summary) | No (heartbeat reads them) |
| Heartbeat   | Cron + `scripts/heartbeat.js`   | Script runs on schedule  | N/A (script uses prompts + history) |
| Goals       | `prompts/GOALS.md`              | You                      | Yes                 |
| Security    | `prompts/RULES.md`              | You                      | Yes (early in prompt) |
| Growth      | MEMORY + GOALS + heartbeat + optional reflection in SOUL | You + optional script + agent suggestions | Via MEMORY/GOALS and SOUL |

If you want, next step can be: add RULES.md, MEMORY.md, and GOALS.md under `webchat-piko/prompts/`, extend the server’s `loadSystemPrompt()` to load them in the order above, and add a minimal `scripts/heartbeat.js` stub plus one line in SOUL for reflection.
