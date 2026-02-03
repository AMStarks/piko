# Path B Deploy Report

**Date:** 2026-02-02  
**Status:** Deployed and tested on Optimus. Agent responds; natural replies require the 32B model once pulled.

---

## What Was Done

1. **Deployed** Path B to Optimus (scp + run `deploy-on-optimus.sh`).
2. **Config:** Fixed invalid `api: "openai-chat"` → OpenClaw rejects it; reverted to `openai-completions`. Patched primary model to Qwen 2.5 32B, bootstrapMaxChars 4000.
3. **Workspace:** Soul cleanse applied (AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md removed; SOUL.md and IDENTITY.md installed).
4. **Gateway:** OLLAMA_NUM_GPU_LAYERS=40 added to the systemd service; gateway restarted.
5. **Model pull:** `ollama pull qwen2.5:32b-instruct-q4_K_M` was not available (Ollama runs in Docker). Started `docker exec legion-ollama ollama pull qwen2.5:32b-instruct-q4_K_M` but it timed out (~19GB download). **32B is not yet in Ollama** on Optimus.
6. **Primary model:** Set back to `mistral:latest` so the agent can respond while 32B is not available.
7. **OpenClaw recreated workspace files:** After the first gateway restart, OpenClaw recreated AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md. These were removed again; workspace now has only SOUL.md and IDENTITY.md.

---

## Internal Test Results

| Test | Result |
|------|--------|
| Config valid | Yes (after reverting api to openai-completions). |
| Gateway health | OK (Telegram: fetch failed in test env; agents/session OK). |
| Models list | Shows ollama/qwen2.5:32b as default but model not in Ollama yet → 404 when calling agent with 32B. |
| Agent with mistral | **Responds** but with **meta-response**: summarizes "the document" (system/workspace context) instead of replying "Hi! How can I help?" — expected for Mistral 7B with dense prompt. |
| Agent with clean workspace (SOUL+IDENTITY only) | Same: Mistral 7B still summarizes the injected context instead of answering "Hello" naturally. |

**Conclusion:** Path B deploy is in place and the agent runs. With **Mistral 7B**, replies stay meta (summarize context). Once **Qwen 2.5 32B** is pulled and set as primary, re-test; the 32B model should follow SOUL/IDENTITY and reply naturally.

---

## What You Should Do Next

### 1. Pull the 32B model (run in background on Optimus)

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
docker exec legion-ollama ollama pull qwen2.5:32b-instruct-q4_K_M
```

This will take a while (~19GB). When it finishes, proceed to step 2.

### 2. Switch primary model to 32B and restart

On Optimus:

```bash
node /root/path-b-openclaw-deploy/update-openclaw-config.js /root/.openclaw/openclaw.json
systemctl --user restart openclaw-gateway.service
```

Then test:

```bash
export HOME=/root
openclaw agent --agent main --message "Hello"
```

You should get a short, natural greeting (no config/envelope summary). Then test on Telegram.

### 3. If OpenClaw recreates workspace clutter

If after a gateway restart you see AGENTS.md, HEARTBEAT.md, TOOLS.md, or USER.md again, remove them and reinstall SOUL/IDENTITY:

```bash
cd /root/.openclaw/workspace
rm -f AGENTS.md HEARTBEAT.md TOOLS.md USER.md
cp /root/path-b-openclaw-deploy/workspace/SOUL.md .
cp /root/path-b-openclaw-deploy/workspace/IDENTITY.md .
systemctl --user restart openclaw-gateway.service
```

---

## Summary

- **Deployed:** Yes. Config fixed, soul cleanse applied, gateway running.
- **Agent responds:** Yes (with mistral).
- **Natural replies:** Not yet with 7B; expect them once 32B is pulled and set as primary.
- **Next:** Pull `qwen2.5:32b-instruct-q4_K_M` in Docker on Optimus, then run the config updater and restart the gateway.
