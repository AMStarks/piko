# Optimus: second RTX 3080 — integration and opportunities

**Purpose:** How the second 3080 is integrated into Piko’s infrastructure and what it enables for Piko development.

---

## 1. Current state (verified)

- **GPUs:** 2× NVIDIA GeForce RTX 3080 (10 GB VRAM each → **20 GB total**).
- **Ollama:** Runs in Docker (Legion stack, `legion-ollama`). Container already has `NVIDIA_VISIBLE_DEVICES=all`, so **both GPUs are visible** to Ollama after reboot.
- **Piko:** No code or env changes required for “integration” — the server talks to `OLLAMA_URL` (localhost:11434); Ollama decides which GPU(s) to use.

So the second 3080 is **already in the loop**: Ollama can use it. What’s optional is telling Ollama to **spread a single model across both GPUs** for larger models (e.g. 32B).

---

## 2. Integration: making Ollama use both GPUs for one model

By default Ollama may put one model on one GPU. To **split a large model across both 3080s** (e.g. Qwen 32B ~19 GB):

1. **Add `OLLAMA_SCHED_SPREAD=1`** to the Ollama container environment so Ollama spreads layers across visible GPUs.
2. **Restart the Ollama container.**

**If Ollama is run by Legion’s Docker Compose** (e.g. `/opt/legion/docker-compose.yml`):

- Edit the `ollama` service and add under `environment:`:
  - `- OLLAMA_SCHED_SPREAD=1`
- Restart:
  - `cd /opt/legion && docker compose up -d ollama`

**If you run Ollama some other way** (systemd, bare metal): set `OLLAMA_SCHED_SPREAD=1` in that process’s environment and restart.

**Check:** After loading a 32B model, `nvidia-smi` should show memory use on both GPUs when the model is in use.

**Piko:** No changes. Keep `OLLAMA_MODEL` (or `/model`) pointing at the model you want; Ollama handles GPU placement.

---

## 3. Opportunities the second 3080 opens

### 3.1 Bigger default model (32B)

- **Before (1× 3080):** 32B needed CPU offload → slower chat.
- **After (2× 3080, with `OLLAMA_SCHED_SPREAD=1`):** 32B can sit on the two GPUs (~19 GB total), no CPU offload, better latency and quality.
- **Action:** Consider setting `OLLAMA_MODEL=qwen2.5:32b-instruct-q4_K_M` (or your preferred 32B tag) in `piko-webchat.service` or `.env` on Optimus, and use `/model default` to revert if needed. See **docs/PIKO_OPTIMUS_HARDWARE_AND_MODEL.md** for other 32B options.

### 3.2 /model 32B without slowing the whole machine

- With 20 GB combined, **Gemma 2 27B** and **Qwen 32B** are both viable. Users can `/model qwen2.5:32b` (or `gemma2:27b`) for deeper or more nuanced chat when they want it, and `/model default` for snappier 14B.

### 3.3 Background LLM work without blocking chat

- **Idea:** Use one GPU for interactive chat (e.g. 14B) and the other for background jobs (rabbit-hole daily, daily memory summarisation, EA synthesis, learning-topic suggestions).  
- **Catch:** Ollama today is one process; it schedules one model at a time. So “chat on GPU 0, background on GPU 1” would require either:
  - **Two Ollama instances** (e.g. one container on `CUDA_VISIBLE_DEVICES=0`, one on `CUDA_VISIBLE_DEVICES=1`, different ports), and Piko/scripts calling different `OLLAMA_URL` by workload, or  
  - **Serial use:** same Ollama, same GPUs; background jobs run when chat is idle (current behaviour).  
- **Recommendation:** Start with **one Ollama, both GPUs, 32B when you want it**. If you later need guaranteed parallelism (chat never waits on rabbit-hole), add a second Ollama instance and a small “background OLLAMA_URL” in config/scripts.

### 3.4 Heavier batch and scripts

- Rabbit-hole daily, daily memory, EA LLM synthesis, and learning-topic suggestions all call the same `lib/llm.js` / `OLLAMA_URL`. With 20 GB you can:
  - Use a **larger model for these scripts** (e.g. 32B) without affecting interactive chat if you stick to one Ollama and one model at a time, or  
  - Run a **second Ollama on the other GPU** and point scripts at it (e.g. `OLLAMA_URL_BACKGROUND=http://localhost:11435`) so batch uses 32B while chat uses 14B on the first instance.

### 3.5 Future: multi-GPU as standard

- As we add more LLM-backed features (reflection, summarisation, multi-turn planning), having 20 GB gives headroom for **larger context** and **better instruction-following** (e.g. 32B) as the default without sacrificing speed, and keeps the door open for a dedicated background instance later.

---

## 4. Summary

| Item | Status / action |
|------|------------------|
| **Second 3080 visible** | Yes (nvidia-smi shows GPU 0 and 1). |
| **Ollama sees both** | Yes (`NVIDIA_VISIBLE_DEVICES=all` in container). |
| **Spread one model across both** | Optional: set `OLLAMA_SCHED_SPREAD=1` in Ollama env and restart. |
| **Piko code/config** | No change required; optional: set `OLLAMA_MODEL` to a 32B tag on Optimus. |
| **Opportunities** | 32B as default or `/model` option; room for dedicated background Ollama later; heavier batch/scripts. |

**Next steps:** (1) Add `OLLAMA_SCHED_SPREAD=1` to the Ollama service in Legion’s compose (or your Ollama env) and restart. (2) Optionally set `OLLAMA_MODEL=qwen2.5:32b-instruct-q4_K_M` (or preferred 32B) for Piko on Optimus and restart piko-webchat. (3) Use `/model` in chat to try 32B vs 14B. (4) Later, if you want chat and background fully parallel, consider a second Ollama instance on the other GPU and a background `OLLAMA_URL` in scripts.

---

## 5. Verify GPU usage (run on Optimus)

All of this runs **on Optimus**; Piko WebChat and Ollama should both be there so the model uses GPU, not your Mac.

**On Optimus** (after deploy, the script is in webchat-piko), run:

```bash
cd /root/webchat-piko && bash scripts/verify-ollama-gpu-on-optimus.sh
```

That script prints GPU status and whether the Ollama container has GPU access. Then, while you send a chat message (from Telegram or the app), on Optimus run:

```bash
nvidia-smi
```

If Ollama is using the GPU, you’ll see **memory use** and **GPU-Util** for the Ollama process during the reply. If GPU memory stays 0, Ollama is on CPU — fix the Ollama container (e.g. `--gpus all` or `runtime: nvidia` in Legion’s compose) and restart it.
