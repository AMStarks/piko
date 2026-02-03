# Cursor on Optimus: Use Piko When Mac Is Off

**Goal:** When your MacBook is off, Piko can still run Cursor by using Cursor installed on Optimus and projects synced there.

**Infrastructure set up (Feb 2026):**
- Cursor AppImage on Optimus: `/root/cursor.AppImage` (x64, runs under Xvfb)
- Projects dir: `/root/projects` (Piko synced to `/root/projects/Piko`)
- Wrapper script: `/root/run-cursor-optimus.sh` (Xvfb + 90s timeout)
- Piko bot: tries Mac first; on failure runs Cursor on Optimus via wrapper

---

## 1. Install Cursor on Optimus (Linux) — done

On Optimus (Ubuntu 24.04):

```bash
# Option A: AppImage (common)
cd /root  # or preferred dir
wget https://cursor.com/download/linux -O cursor.AppImage
chmod +x cursor.AppImage
sudo apt install -y libfuse2   # required for AppImage
# CLI: /root/cursor.AppImage (or symlink: ln -s /root/cursor.AppImage /usr/local/bin/cursor)
```

```bash
# Option B: .deb if available
wget https://cursor.com/download/linux -O cursor.deb
sudo dpkg -i cursor.deb
# CLI often at: /usr/local/bin/cursor or via PATH from package
```

Verify:

```bash
/root/cursor.AppImage --version   # or: cursor -version
```

**Note:** Cursor on Linux may have fewer features than on macOS; CLI and agent-style usage should still work for Piko.

---

## 2. Put Projects on Optimus — done for Piko

Piko needs a copy of your projects on Optimus so Cursor can work on them when the Mac is off.

**Option A: Git clone (good for “continue when Mac off”)**

```bash
# On Optimus, e.g. under /root/projects or /home/chief/projects
mkdir -p /root/projects
cd /root/projects
git clone https://github.com/YOUR_USER/Piko.git   # or your repo URL
# Repeat for other repos you want Piko to work on
```

**Option B: Rsync from Mac when it’s on**

```bash
# From Mac (when on): sync Piko to Optimus
rsync -az --exclude .git /Users/starkers/Projects/Piko/ starkers@192.168.0.121:/root/projects/Piko/
```

Then on Optimus, Cursor runs in `/root/projects/Piko` (or whatever path you use).

---

## 3. Piko: Try Mac First, Fallback to Optimus — done

**/cursor:** The bot tries Mac first; if SSH fails, runs Cursor CLI on Optimus via `/root/run-cursor-optimus.sh` (Xvfb + 90s timeout) in `/root/projects`.

**/task:** Same idea: try Mac first (SSH + `agent -p --force "task"`). If Mac is unreachable, Piko runs the **Cursor agent** on Optimus in the project dir. For that you need:

1. **Cursor CLI (including agent) on Optimus:** e.g. `curl https://cursor.com/install-fsS | sudo -E bash` (installs to `/root/.local/bin`; ensure it’s in PATH or set `AGENT_CLI_OPTIMUS=/root/.local/bin/agent` in the WebChat/Telegram service).
2. **Project dir on Optimus:** Default is `PROJECTS_OPTIMUS/project` (e.g. `/root/projects/Legion`). If Legion lives at `/opt/legion`, set in the service:  
   `Environment=PIKO_OPTIMUS_PROJECT_PATHS=Legion:/opt/legion`  
   so `/task Legion ...` runs in `/opt/legion` when the Mac is off.

Piko sends the output, or "Mac unreachable; ran on Optimus" or "Optimus fallback: agent not installed or timed out."

So: **Mac on → Piko uses Cursor/agent on Mac. Mac off → Piko uses Cursor/agent on Optimus** (with a note in the reply).

---

## 4. Keeping Projects in Sync

- **Mac primary:** When you work on the Mac, push to git; on Optimus run `git pull` in `/root/projects/Piko` (or cron it) so the Optimus copy is up to date before you turn the Mac off.
- **Optimus primary (when Mac off):** Work via Piko on Optimus; when Mac is back on, pull from the same repo on the Mac or rsync from Optimus so the Mac copy is updated.

---

## 5. Summary

| Mac state   | Where Cursor runs | Where projects live        |
|------------|-------------------|----------------------------|
| Mac on     | MacBook (SSH)     | Mac: `/Users/starkers/Projects` |
| Mac off    | Optimus (local)   | Optimus: e.g. `/root/projects`  |

So yes: you can have Cursor on Optimus too, keep projects there (or synced), and have Piko use Cursor on Optimus when the Mac is off by adding the fallback above.
