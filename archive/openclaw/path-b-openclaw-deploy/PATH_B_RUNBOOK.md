# Path B OpenClaw Deploy — Runbook

Deploy Path B (32B Qwen, soul cleanse, openai-chat) on Optimus. Run as **root** on Optimus.

## Prerequisites

- OpenClaw already installed and configured (gateway, Telegram token, pairing).
- Ollama running (native or in Docker as `legion-ollama`).
- Node.js available for the config patch script.

## 1. Copy this directory to Optimus

From your Mac (or machine with the Piko repo):

```bash
scp -i ~/.ssh/id_optimus -r scripts/path-b-openclaw-deploy root@192.168.0.121:/root/
```

## 2. SSH to Optimus

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
```

## 3. If Ollama runs in Docker

If Ollama is in a container (e.g. `legion-ollama`), set:

```bash
export OLLAMA_PULL_CMD="docker exec legion-ollama ollama pull"
```

## 4. Run the deploy script

```bash
cd /root/path-b-openclaw-deploy
chmod +x deploy-on-optimus.sh
./deploy-on-optimus.sh
```

The script will:

1. Back up `/root/.openclaw/workspace` and `openclaw.json`.
2. Remove AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md from workspace.
3. Install new SOUL.md and IDENTITY.md (anti-meta, minimal identity).
4. Patch openclaw.json (primary model = Qwen 2.5 32B, openai-chat, bootstrapMaxChars 4000).
5. Pull `qwen2.5:32b-instruct-q4_K_M` (use `OLLAMA_PULL_CMD` if Docker).
6. Add `OLLAMA_NUM_GPU_LAYERS=40` to the gateway service if missing.
7. Restart the OpenClaw gateway and run health/models/agent test.

## 5. Validate

- **CLI:** `openclaw agent --message "Hello"` should return a short, natural greeting (no config/envelope summary).
- **Telegram:** Send "Hello" to your bot. You should get a conversational reply as Piko.

## 6. If Ollama runs in Docker

Set before running the script:

```bash
export OLLAMA_PULL_CMD="docker exec legion-ollama ollama pull"
```

Then run `./deploy-on-optimus.sh`. The script will use this to pull the 32B model. The pull can take a long time (~19GB); you can run it in the background or in a separate terminal.

## 7. If OpenClaw recreates workspace files

After a gateway restart, OpenClaw may recreate AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md. To keep the soul cleanse:

```bash
cd /root/.openclaw/workspace
rm -f AGENTS.md HEARTBEAT.md TOOLS.md USER.md
cp /root/path-b-openclaw-deploy/workspace/SOUL.md .
cp /root/path-b-openclaw-deploy/workspace/IDENTITY.md .
systemctl --user restart openclaw-gateway.service
```

## 8. If something fails

- **Model pull fails:** Run the pull manually: `ollama pull qwen2.5:32b-instruct-q4_K_M` or `docker exec legion-ollama ollama pull qwen2.5:32b-instruct-q4_K_M`, then re-run the script (or just steps 5–7).
- **Gateway won’t start:** `journalctl --user -u openclaw-gateway.service -n 50`
- **Restore backup:**  
  `cp -a /root/.openclaw/workspace.path-b-backup-* /root/.openclaw/workspace`  
  `cp -a /root/.openclaw/openclaw.json.path-b-backup-* /root/.openclaw/openclaw.json`  
  (Use the timestamped backup you want.)

## Files in this directory

| File | Purpose |
|------|--------|
| `deploy-on-optimus.sh` | Main deploy script (run on Optimus). |
| `update-openclaw-config.js` | Patches openclaw.json (32B, openai-chat, bootstrapMaxChars). |
| `workspace/SOUL.md` | Anti-meta instructions for the agent. |
| `workspace/IDENTITY.md` | Minimal Piko/ClawFriend identity. |
| `PATH_B_RUNBOOK.md` | This runbook. |
