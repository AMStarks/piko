# Path B Implementation Report

**Status:** Implementation complete in repo. Deployment and live testing must be run **on Optimus** (this environment cannot SSH to your server or run Ollama/OpenClaw).

---

## What Was Implemented

### 1. Workspace files (soul cleanse)

- **`scripts/path-b-openclaw-deploy/workspace/SOUL.md`**  
  Anti-meta instructions: ignore metadata, no meta-commentary, direct response only.

- **`scripts/path-b-openclaw-deploy/workspace/IDENTITY.md`**  
  Minimal Piko/ClawFriend identity (witty, Bro/Co-pilot, no corporate speak).

### 2. Config updater

- **`scripts/path-b-openclaw-deploy/update-openclaw-config.js`**  
  Node script that patches `/root/.openclaw/openclaw.json`:
  - `agents.defaults.model.primary` → `ollama/qwen2.5:32b-instruct-q4_K_M`
  - `agents.defaults.bootstrapMaxChars` → `4000`
  - `models.providers.ollama.api` → `openai-chat`
  - Adds `qwen2.5:32b-instruct-q4_K_M` to `models.providers.ollama.models` (contextWindow 32000, maxTokens 4096).

  **Validated:** Run against a sample config; output is valid JSON and correct structure.

### 3. Deploy script

- **`scripts/path-b-openclaw-deploy/deploy-on-optimus.sh`**  
  Single script to run **as root on Optimus**:
  1. Back up workspace and config (timestamped).
  2. Soul cleanse: remove AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md; install SOUL.md and IDENTITY.md.
  3. Patch openclaw.json via `update-openclaw-config.js`.
  4. Pull model: `ollama pull qwen2.5:32b-instruct-q4_K_M` (or `OLLAMA_PULL_CMD` if Ollama is in Docker).
  5. Add `OLLAMA_NUM_GPU_LAYERS=40` to the gateway systemd service if missing.
  6. Restart OpenClaw gateway.
  7. Run `openclaw health`, `openclaw models list`, and `openclaw agent --message "Hello"`.

  **Validated:** Dry-run (backup + workspace + config patch) in a temp dir; logic runs without error.

### 4. Runbook

- **`scripts/path-b-openclaw-deploy/PATH_B_RUNBOOK.md`**  
  Step-by-step: copy dir to Optimus, SSH, set `OLLAMA_PULL_CMD` if Docker, run script, validate, restore if needed.

---

## What You Need to Do on Optimus

1. **Copy the Path B deploy directory to Optimus:**
   ```bash
   scp -i ~/.ssh/id_optimus -r scripts/path-b-openclaw-deploy root@192.168.0.121:/root/
   ```

2. **SSH to Optimus:**
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   ```

3. **If Ollama runs in Docker (e.g. `legion-ollama`):**
   ```bash
   export OLLAMA_PULL_CMD="docker exec legion-ollama ollama pull"
   ```

4. **Run the deploy script:**
   ```bash
   cd /root/path-b-openclaw-deploy
   chmod +x deploy-on-optimus.sh
   ./deploy-on-optimus.sh
   ```

5. **Verify:**
   - CLI: `openclaw agent --message "Hello"` → short natural greeting (no config/envelope summary).
   - Telegram: send "Hello" to your bot → conversational reply as Piko.

---

## Internal Tests Performed (in this environment)

| Test | Result |
|------|--------|
| `update-openclaw-config.js` on sample config | OK — valid JSON, primary model and api set correctly, Qwen 32B entry added. |
| Dry-run: backup + workspace copy + config patch in temp dir | OK — script logic runs; SOUL.md and IDENTITY.md installed; config patched. |

**Not possible here:** SSH to Optimus, `ollama pull`, `systemctl --user restart openclaw-gateway`, or `openclaw agent --message "Hello"`. Those steps must be run on your server.

---

## Summary

Path B is **implemented and validated** in the repo. Once you run the deploy script on Optimus and the 32B model is pulled and the gateway restarted, the agent should reply naturally (CLI and Telegram). If anything fails on Optimus, use `PATH_B_RUNBOOK.md` for restore and troubleshooting.
