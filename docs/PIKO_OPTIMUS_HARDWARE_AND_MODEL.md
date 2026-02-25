# Optimus hardware, scaffolding, and model recommendation

## 1. Optimus hardware (checked via SSH)

| Resource | Value |
|----------|--------|
| **CPU** | AMD Ryzen 5 5600, 6 cores / 12 threads |
| **RAM** | 31 GB total, ~25 GB available |
| **GPU** | **2×** NVIDIA GeForce RTX 3080, **10 GB VRAM each** (20 GB total) |
| **GPU in use** | GPU 0: Ollama (e.g. ~3–6 GB); GPU 1: display or idle. Both visible to Ollama (`NVIDIA_VISIBLE_DEVICES=all`). |
| **Disk** | 1.8 TB, 7% used |
| **Ollama** | Running in Docker (Legion); API `http://localhost:11434` |

**Verdict:** With **2× 3080 (20 GB)** you can run **32B** models (e.g. Qwen2.5 32B Q4, ~19 GB) across both GPUs using `OLLAMA_SCHED_SPREAD=1` — no CPU offload, good for chat. Single-GPU 8B–14B remains ideal for lowest latency. See **PIKO_OPTIMUS_TWO_GPUS.md** for integration and opportunities.

---

## 2. Scaffolding and what we have

### Model configuration (webchat-piko)

| Env / code | Purpose |
|------------|--------|
| **OLLAMA_MODEL** | Default `llama3.1:latest`. Used for chat and health check. |
| **MODEL_PRIMARY** | `lib/llm.js`: same as OLLAMA_MODEL, normalized to `ollama/llama3.1:latest` for LiteLLM. |
| **OLLAMA_URL** | `http://localhost:11434/v1/chat/completions` (server.js uses this; llm.js derives base URL for LiteLLM). |
| **PIKO_OLLAMA_ONLY** | When `1` or `true`, no Claude/OpenAI fallback—Ollama only. Set on Optimus to avoid 502 leaking API key errors. |
| **Session model** | Per-session override in `data/sessions.json` (e.g. `profile.model`) possible; otherwise OLLAMA_MODEL. |

### Models currently on Optimus (from `/api/tags`)

| Model | Size (params) | Quantization | Notes |
|-------|----------------|--------------|--------|
| **llama3.1:latest** | 8B | Q4_K_M | **Current chat model.** ~5 GB VRAM. |
| **llama3.2:latest** | 3.2B | Q4_K_M | Smaller, faster; less capable. |
| **mistral:latest** | 7.2B | Q4_K_M | Alternative 7B. |
| **qwen2.5:32b-instruct-q4_K_M** | 32.8B | Q4_K_M | **Fits across 2× 3080** (~19 GB). Set `OLLAMA_SCHED_SPREAD=1` in Ollama container; then viable as default or `/model` option. |

### Other scaffolding (recap)

- **Planner:** Casual/greeting → no history sent; capability questions → one short line; “don’t assume debugging” in plan and system.
- **Post-filters:** “I’m here to help”, evasive “could you clarify”, “I’m Piko.” → short fallbacks.
- **SOUL / leading rule:** No support-bot phrases; capability Q = one short answer; answer the question asked.
- **LiteLLM:** `lib/llm.js` → `completion()` with Ollama base URL; streaming and non-streaming both use the same primary model.

---

## 3. Is there a better model we can use?

**Yes.** On 10GB VRAM, you can run **12–14B** models at Q4 with room for context. Several are stronger than Llama 3.1 8B at instruction-following and natural conversation, which should help with “don’t assume debugging” and greeting/capability behaviour.

### Recommended: one step up (fits 10GB, better than 8B)

| Model | Ollama tag | Params | VRAM (approx.) | Why consider |
|-------|------------|--------|------------------|--------------|
| **Qwen2.5 14B** | `qwen2.5:14b` | 14B | ~7–8 GB | Good instruction-following, multilingual; same family as your 32B. |
| **Gemma 3 12B** | `gemma3:12b` | 12B | ~6–7 GB | Strong generalist for “single GPU”; good for chat. |
| **Phi-4 14B** | `phi4:14b` | 14B | ~7–8 GB | Good reasoning and instruction-following. |
| **Qwen3 8B** | `qwen3:8b` | 8B | ~5 GB | Same size as now; newer than Llama 3.1, often better at following instructions. |
| **Mistral Nemo 12B** | `mistral-nemo:12b` | 12B | ~6–7 GB | 128k context; useful if you want long context without changing hardware. |

**Practical pick:** **Qwen2.5 14B** or **Gemma 3 12B** for a clear upgrade in quality while staying within 10GB. Use **Qwen3 8B** if you want to stay at 8B and only change behaviour/instruction-following.

### With 2× 3080 (20 GB)

- **Qwen2.5 32B** (already on disk): Fits across both GPUs with `OLLAMA_SCHED_SPREAD=1`. Good candidate for default or `/model qwen2.5:32b`.
- **Gemma 2 27B**: Fits on one 10 GB GPU; also works with both GPUs if you prefer.

### What *not* to use on this hardware

- **70B-class models:** Need 2× 24GB+ or similar; not viable on 2× 3080.

---

## 4. How to switch model on Optimus

1. **Pull the model (once)**  
   On Optimus (or wherever Ollama runs):
   ```bash
   ollama pull qwen2.5:14b
   ```
   or `gemma3:12b`, `phi4:14b`, `qwen3:8b`, etc.

2. **Point Piko at it**  
   Set in the piko-webchat environment (e.g. systemd unit or `.env` on Optimus):
   ```bash
   OLLAMA_MODEL=qwen2.5:14b
   ```
   (or `gemma3:12b`, etc.). No code change; server and LiteLLM already use `OLLAMA_MODEL` / `MODEL_PRIMARY`.

3. **Restart webchat**  
   ```bash
   systemctl restart piko-webchat.service
   ```

4. **Confirm**  
   `GET /api/health` should show `"model": "qwen2.5:14b"` (or whatever you set). Chat will use the new model with the same scaffolding (planner, post-filters, SOUL).

---

## 5. Summary

| Question | Answer |
|----------|--------|
| **Optimus hardware** | Ryzen 5 5600, 31 GB RAM, **2× RTX 3080 10GB (20 GB total)**. Good for 8B–32B at Q4. |
| **Current scaffolding** | OLLAMA_MODEL, MODEL_PRIMARY, PIKO_OLLAMA_ONLY; planner, post-filters, SOUL/leading rule; no history for casual turns. |
| **Current chat model** | **qwen2.5:14b** (14B). On disk: llama3.1, gemma2:27b, qwen2.5:32b. With 2 GPUs, 32B is viable (set `OLLAMA_SCHED_SPREAD=1`). |
| **Better model we can use** | **Yes.** Single GPU: **qwen2.5:14b**, **gemma2:27b**. Both GPUs: **qwen2.5:32b** as default or `/model` option. See **PIKO_OPTIMUS_TWO_GPUS.md**. |
