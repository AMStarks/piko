# Why /task Legion Was Failing on Optimus — Full View

## What you saw

- **Telegram:** You send `/task Legion Check on the status of the project`
- **Reply:** `Optimus task failed: Command failed: cd /opt/legion && /root/.local/bin/agent --api-key '...' --model auto -p --force 'Check on the status of the project'`
- No actual agent output; same error repeatedly.

---

## Root cause (what was going wrong)

### 1. Agent works when run in a real shell

When we run on Optimus in a normal shell:

```bash
cd /opt/legion && HOME=/root /root/.local/bin/agent --api-key '...' --model auto -p --force 'Check on the status of the project'
```

the agent **succeeds in ~25–30 seconds** and prints the full Legion status to stdout.

So: the agent binary, API key, and project path are fine. The failure is **only** when the same command is run from the Node bot/server.

### 2. When Node runs the command, stdout/stderr are empty

When the bot (or WebChat server) runs the **exact same** command via Node’s `child_process.exec()`:

- The agent process runs (we see it in `ps`).
- After it exits (or hits the timeout), Node’s callback receives:
  - **stdout length: 0**
  - **stderr length: 0**
  - **err** set (so the command is reported as “failed”).

So Node never sees any output. The only thing we can show in the reply is `err.message`, which is the generic “Command failed: cd /opt/legion && …”. That’s why you only saw that string and not the real error or the agent’s answer.

### 3. Why stdout/stderr were empty under Node

The Cursor agent behaves differently depending on where its stdout is connected:

- **Terminal (TTY) or pipe that behaves like one:** it flushes output as it goes (line-buffered). We see the status in a normal SSH shell.
- **Non-TTY pipe (e.g. from Node’s `exec()`):** stdout is fully buffered. The agent writes into a buffer; the buffer is only flushed when the process exits normally or the buffer fills. If the process is killed by our timeout, or exits in a way that doesn’t flush, Node never receives that buffered data, so we get empty stdout/stderr.

So under Node we weren’t getting a “wrong” result from the agent; we simply weren’t getting its output at all, and then the process was treated as failed (timeout or non-zero exit).

### 4. Duplicate bot (separate issue)

A second process was also calling Telegram’s `getUpdates` with the same bot token:

- **OpenClaw gateway** (`openclaw-gateway.service`, user systemd) was configured with the same Telegram bot token as Piko.
- Only one process may use `getUpdates` per token, so we saw `Conflict: terminated by other getUpdates request`.

**Fix applied:** Telegram disabled in OpenClaw config; OpenClaw user service stopped, disabled, and masked so it doesn’t respawn and compete with Piko.

---

## Fix applied in code

We run the agent under a **pseudo-TTY** so it thinks it’s attached to a terminal and flushes stdout line-by-line. Then Node’s `exec()` receives the output.

- **Mechanism:** wrap the agent command in `script -q -c "..." /dev/null`.
  - `script` is standard on Linux; it runs the given command in a PTY.
  - `-q` keeps `script` itself quiet; we only see the agent’s output.
- **In the bot and WebChat server:** the command we execute is now:

  `script -q -c 'cd /opt/legion && /root/.local/bin/agent ...' /dev/null`

  instead of running the inner command directly. The inner command is passed via `JSON.stringify(...)` so quoting is safe.

With this change:

- The agent still runs the same way (same `cd`, same `agent` and args).
- Its stdout is connected to a PTY, so it flushes and Node gets the output.
- We verified on Optimus: running this via Node’s `exec()` returns the full Legion status (e.g. 2500+ bytes of stdout) and exit code 0.

---

## Summary table

| What | Status |
|------|--------|
| Agent binary on Optimus | OK |
| Cursor API key | OK |
| `/opt/legion` and project | OK |
| Agent run in SSH shell | Succeeds, output in ~25–30 s |
| Agent run from Node without PTY | Process runs but Node gets empty stdout/stderr → “Command failed” |
| Cause | Agent stdout fully buffered when not a TTY; Node never sees output |
| Fix | Run agent under `script -q -c "..." /dev/null` so it has a PTY and flushes |
| Duplicate getUpdates | OpenClaw using same token; fixed by disabling Telegram and masking its service |

---

## After deploy

Once the updated bot and WebChat server are deployed and restarted:

- `/task Legion Check on the status of the project` should return the real Legion status (the same text you see when running the command in an SSH shell), instead of “Optimus task failed: Command failed: …”.
- If something else fails (e.g. agent not found, timeout, API error), we now have proper stdout/stderr capture and the reply can show the real error.
