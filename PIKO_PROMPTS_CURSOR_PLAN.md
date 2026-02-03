# Piko Prompts Cursor — Plan

**Goal:** You use Cursor (and me) for coding. Sometimes you can’t get to the prompt. You want **Piko** to take over at times and **send prompts to Cursor** so that code continues and the project moves forward. Piko does **not** write code; Piko **generates the instruction** and **hands it to Cursor** (the agent). Cursor (me) does the coding.

You’ve installed Cursor on Optimus — so we’re part of the way there. Here’s how to wire it.

---

## 1. The flow (target)

```
You (unavailable)  →  Piko decides "continue project"  →  Piko generates next prompt (task)
                                                              ↓
                     Cursor (agent) receives prompt  ←  Piko sends prompt to Cursor
                              ↓
                     Cursor writes code / does task  →  Result (you see later or get notified)
```

- **Piko:** Chooses when to “take over,” generates the **next concrete task** (one sentence, e.g. “Add input validation to the login form in webchat-piko”), and **invokes** Cursor with that task.
- **Cursor (agent):** Receives that task as its prompt and does the coding. No change to how Cursor works; we just need to **feed it** a prompt that Piko generated.

So: **Piko prompts; Cursor codes.**

---

## 2. What you already have

- **/task** in WebChat and Telegram: you send `/task "refactor auth"` (or `/task Piko "add validation to login"`). The backend runs the **Cursor agent** with that string (today: SSH to MacBook, `agent -p --force "refactor auth"` in the project dir). So the “bridge” exists: **a string goes in → Cursor agent runs with it → code comes out.**
- **Cursor on Optimus:** You have Cursor installed on Optimus. Today, **/task** runs the agent on the **MacBook** (and falls back to Optimus only for **/cursor** CLI). So we need either: (a) keep using MacBook for **/task** (agent) and have Piko call that same path with a generated string, or (b) run the Cursor **agent** on Optimus too and have Piko call that.

---

## 3. What we need to add

### A. Piko generates the prompt (not you)

- **Input to Piko:** “Continue the project” or “Take over and prompt Cursor for Piko” (from you in Telegram/WebChat) or a **scheduled trigger** (e.g. heartbeat: “once a day, if user hasn’t sent a task, generate one and run it”).
- **What Piko does:** Uses Ollama + MEMORY (and optional GOALS.md or project context) to produce **one concrete task string**, e.g. “Add input validation to the login form in webchat-piko” or “Write a unit test for the heartbeat script.”
- **Output:** That string is the “prompt” we send to Cursor. No coding inside Piko; Piko only generates that one sentence.

### B. Piko invokes Cursor with that prompt

- Reuse the **same** mechanism as **/task**: something that runs the Cursor agent with a given task string.
  - **If agent runs on MacBook (current):** Piko (on Optimus) triggers the same SSH + `agent -p --force "task"` with the **generated** string. So we need a small “bridge” that Piko can call: e.g. **POST /api/task** with `{ "project": "Piko", "task": "generated string" }` or a script `run-task.js` that takes the string and runs the existing /task logic (SSH to MacBook, agent ...).
  - **If agent runs on Optimus:** Same idea, but the bridge runs the agent **on Optimus** (e.g. `agent -p --force "task"` in `/root/projects/Piko`). Then we need the Cursor **agent** CLI (and API key) on Optimus; Piko calls a local script instead of SSH.

So we need **one** of:

- **Bridge A:** An endpoint or script that: accepts `(project, task string)`, runs the existing /task execution (SSH to MacBook or Optimus agent), returns or logs the result. Piko (or a small “continue project” script) calls that with the **generated** task string.
- **Bridge B:** Reuse /task literally: a “continue project” flow that (1) asks Ollama for the next task string, (2) **sends that string to the same code path as /task** (so the Cursor agent runs with it). So either “Piko” (the chat) has a special command like **/task-auto** that means “generate one task and run it,” or a **separate script** (e.g. `continue-project.js`) that: reads MEMORY/GOALS, calls Ollama for one task, then calls the same exec logic as /task.

### C. Trigger: when does Piko “take over”?

- **Manual:** You say to Piko in Telegram or WebChat: “Take over and prompt Cursor for Piko” or “Continue the project.” Piko (Ollama) generates the next task, then the bridge runs it; result is sent back to you (e.g. “I prompted Cursor with: … Result: …”).
- **Scheduled:** Heartbeat (or cron) runs e.g. once a day: “Generate one task for project Piko and run it.” Same flow: generate → bridge → Cursor runs. You get a summary (e.g. Telegram: “Piko prompted Cursor with: … Result: …”).

---

## 4. Concrete implementation options

### Option 1 — /task-auto in WebChat + Telegram

- **New command:** `/task-auto` or `/continue [project]`.
- **Behavior:** When you send that, the backend (1) calls Ollama with MEMORY + optional GOALS + “What is the next concrete coding task for project Piko? One sentence only.” (2) Takes the reply as the task string. (3) Runs the **same** /task execution (SSH to MacBook with `agent -p --force "task"` or Optimus agent if available). (4) Returns the result to you (e.g. “Prompted Cursor with: … Result: …”).
- **No new services.** You “take over” by sending one message; Piko generates the prompt and runs Cursor.

### Option 2 — Heartbeat “continue project” step

- **In heartbeat.js:** Add a step (e.g. when env `PIKO_CONTINUE_PROJECT=Piko` is set): (1) Read MEMORY + GOALS (or a small PROJECTS file). (2) Call Ollama: “Next concrete task for project Piko? One sentence.” (3) Call the same /task execution (e.g. HTTP to WebChat server’s internal “run task” endpoint, or a shared script that runs the agent). (4) Log or send to Telegram: “Piko prompted Cursor with: … Result: …”
- **Fully automatic:** You don’t have to be at the prompt; once a day (or on schedule) Piko sends one prompt to Cursor and the project moves.

### Option 3 — Optimus-only (Cursor agent on Optimus)

- **If** the Cursor **agent** CLI runs on Optimus (and you have the API key there): the bridge runs **on Optimus** only (no SSH to MacBook). Same flow: Piko (or heartbeat) generates task string → script runs `agent -p --force "task"` in `/root/projects/Piko` (or chosen project) → result logged or sent to you.
- **Benefit:** No dependency on MacBook; everything (Piko, Cursor, projects) on Optimus.

---

## 5. Recommended next steps

1. **Clarify where the Cursor agent runs today:** MacBook only (current /task) or also on Optimus? If Optimus has the agent CLI and API key, we can point the “Piko prompts Cursor” flow there.
2. **Add the “generate + run” bridge:** Either (a) `/task-auto` (or `/continue`) in WebChat + Telegram that: generate one task via Ollama → run same /task logic with that string, or (b) a script `continue-project.js` that does the same and is callable from heartbeat or cron.
3. **Add a GOALS.md or PROJECTS.md (optional):** So Piko has “current focus: Piko project; next: auth refactor” and the generated prompts stay on-target.
4. **Trigger:** Start with **manual** (“Take over and prompt Cursor” → /task-auto or equivalent). Then add **scheduled** (heartbeat “continue project” step) if you want Piko to run without you at the keyboard.

---

## 6. Summary

| Piece | Role |
|-------|------|
| **You** | Use Cursor when you can; when you can’t, tell Piko “take over” or rely on schedule. |
| **Piko** | Decides when to continue, **generates** the next prompt (one task string), **invokes** Cursor with it. Does not write code. |
| **Cursor (agent)** | Receives the prompt from Piko, **writes code** / does the task. Unchanged. |
| **Bridge** | “Run task with this string” — same as /task, but the string comes from Piko (Ollama) instead of from your message. |

**Next:** Decide MacBook vs Optimus for the agent, then add `/task-auto` (or a script) that: generate task → run /task with it. After that, we can add the heartbeat “continue project” step so Piko can prompt Cursor on a schedule.
