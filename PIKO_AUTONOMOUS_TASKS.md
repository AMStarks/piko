# How Piko Works on a Cursor Project Without You Watching

**Goal:** You give Piko a task in Telegram; Piko runs Cursor Agent headless on your Mac (or Optimus when Mac is off) and reports when it’s done. You don’t have to watch.

---

## How it works

1. **You send a task** in Telegram, e.g.:
   ```
   /task Add unit tests for the auth module in Piko
   ```
   or
   ```
   /task Refactor sync-projects-to-optimus.sh to use a config file
   ```

2. **Piko runs Cursor Agent headless** on your Mac:
   - SSHs to your MacBook
   - Runs: `agent -p --force "your task"` in `/Users/starkers/Projects`
   - `-p` (--print) = non-interactive, output only
   - `--force` = agent can modify files without asking

3. **Piko waits** (up to ~10 minutes) for the agent to finish.

4. **Piko replies** in Telegram with the agent’s output (or “Task failed” if it times out or errors).

So you “set it and forget it”: one message, one reply when the task is done.

---

## What you need on your Mac

1. **Cursor Agent CLI**  
   You already have it at `~/.local/bin/agent`. Make sure it’s on your PATH when you use the terminal (add `~/.local/bin` to PATH in `.zshrc` if needed).

2. **Authentication for headless use**  
   When Piko runs `/task`, it SSHs to your Mac and runs `agent -p --force "..."`. The agent needs **`CURSOR_API_KEY`** in the environment. Piko passes it from **Optimus** (so you don’t store the key on the Mac).

   **Get a Cursor API key:**  
   - Go to **https://cursor.com/dashboard**, sign in, then **Integrations → User API Keys**.  
   - Create a key and copy it (you won’t see it again).  
   - Or on your Mac run `agent login` in a terminal and sign in; for headless over SSH, the API key method is more reliable.

   **Add the key on Optimus (so Piko can pass it when running /task):**  
   - SSH to Optimus: `ssh -i ~/.ssh/id_optimus root@192.168.0.121`  
   - Edit the bot service: `sudo nano /etc/systemd/system/clawfriend-bot.service`  
   - Under `[Service]`, add a line (use your real key):  
     `Environment="CURSOR_API_KEY=your_cursor_api_key_here"`  
   - Reload and restart:  
     `sudo systemctl daemon-reload && sudo systemctl restart clawfriend-bot.service`  

   If `CURSOR_API_KEY` is not set on Optimus, Piko will reply: “Task skipped: CURSOR_API_KEY not set on Optimus.”

3. **Mac on and reachable**  
   When your Mac is on and SSH works, Piko runs the task there. When the Mac is off, Piko falls back to Optimus (Cursor on Linux there may be limited; `/task` may time out or fail on Optimus).

---

## Commands in Telegram

| Command | What it does |
|--------|----------------|
| `/task Add tests for auth.js` | Runs Cursor Agent headless with that task in `~/Projects`; reply when done (up to ~10 min). |
| `/cursor -version` | Runs Cursor CLI version (quick). |
| `/cursor -help` | Cursor CLI help. |
| `/status` | Short status + reminder of /task and /cursor. |

Use **single hyphen** in Telegram for flags (e.g. `-version`, `-help`).

---

## Limitations

- **Timeout:** Task runs at most ~10 minutes. Long tasks may be cut off; you can ask for a smaller subtask or we can increase the timeout later.
- **Project directory:** Task runs in **`/Users/starkers/Projects`** (root of all projects). Say the project or file in the task, e.g. “In Piko project, add unit tests for auth.”
- **Mac off:** Piko tries Optimus; Cursor Agent on Linux there may not work the same. Best experience: Mac on for `/task`.
- **First run:** The bot passes `CURSOR_API_KEY` from Optimus through SSH; you don’t need to sign in on the Mac if the key is set on Optimus.

---

## Summary

- **Set a task:** Send `/task "your task"` in Telegram.
- **Piko runs it:** Cursor Agent runs headless on your Mac (or Optimus if Mac is off), no need to watch.
- **Get the result:** Piko replies when the task finishes (or when it fails/times out).
- **Setup:** Cursor Agent CLI on Mac, auth (e.g. `CURSOR_API_KEY` or one-time sign-in), Mac on for best results.
