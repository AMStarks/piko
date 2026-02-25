# Models and /model switch

Piko uses one Ollama model per request. The default is `OLLAMA_MODEL` (e.g. `qwen2.5:14b`). You can switch **without restart** using `/model <tag>` in chat. The override is stored in `data/current_model.txt` and used until you run `/model default`.

## Quick test: Gemma 2 27B

Gemma 2 27B (Q4_K_M) is recommended for better conversational feel on a single 10 GB GPU: concise, witty, low helper-bot drift. Use the `/model` facility to try it while keeping your current default (e.g. Qwen 14B) for day-to-day.

### 1. One-time: Ollama in SSH PATH (Optimus)

If Ollama runs in Docker on Optimus, install the wrapper so `ollama` works over SSH:

```bash
./scripts/webchat-deploy/install-ollama-wrapper-on-optimus.sh
```

This puts `/usr/local/bin/ollama` on Optimus (forwards to the Ollama Docker container). The install script auto-detects the container (name containing `ollama`); override with `OLLAMA_CONTAINER=name` if needed. The chosen name is stored in `/etc/optimus-ollama-container` on Optimus.

### 2. Pull the model on Optimus

From your machine (repo root):

```bash
./scripts/webchat-deploy/pull-gemma27b.sh
```

Takes ~15–25 min. Requires the wrapper above (or Ollama on host PATH).

### 3. In Piko chat

- **Switch to Gemma 2 27B:**  
  `/model gemma2:27b`
- **Switch back to default:**  
  `/model default`
- **See current model:**  
  `/model`

No service restart. Next message uses the chosen model.

### 4. Optional: set Gemma as default

To make Gemma the default (e.g. after you’re happy with it):

- Edit `OLLAMA_MODEL` in `/root/webchat-piko/.env` or in the systemd unit to `gemma2:27b-it-q4_K_M`.
- Restart: `systemctl restart piko-webchat`.
- Then `/model default` will use Gemma until you change the env again.

## Suggested tags (Optimus: 2× 3080 / 20 GB total)

| Use case              | Ollama tag                          | Note                                          |
|-----------------------|-------------------------------------|-----------------------------------------------|
| Default / fast        | `qwen2.5:14b` (or your current)     | Snappy, good baseline; one GPU                |
| Best chat feel (test) | `gemma2:27b`                        | Concise, witty; one GPU                       |
| Warmer, deeper        | `qwen2.5:32b-instruct-q4_K_M`       | **Fits across both GPUs** with `OLLAMA_SCHED_SPREAD=1` |

## VRAM and context (2× 3080 on Optimus)

- **Gemma 2 27B Q4:** ~7.5–8.5 GB. Fits on one GPU.
- **Qwen 32B Q4:** ~19 GB. Use both GPUs: set `OLLAMA_SCHED_SPREAD=1` in the Ollama container (e.g. Legion compose) and restart. See **docs/PIKO_OPTIMUS_TWO_GPUS.md**.

## Gemma vs Qwen: learning inject

**Gemma 2 27B** can sometimes echo or append a line from the injected “recent learning” (rabbit-hole) block—e.g. “Their ingenuity and urban planning were quite advanced for their time”—as if it were Piko’s own reply. The server now (1) instructs the model not to quote the learning block verbatim and (2) strips that specific stray-echo pattern when present. If you still see off-context lines with Gemma, use **Qwen** (`/model qwen2.5:14b` or `qwen2.5:32b`) as default, or set **`PIKO_LEARNING_CHAT_INJECT=0`** in the server env to disable learning injection for that session/host.

Control Panel and server use `SLICE_HISTORY` / context limits; if you OOM after switching to a larger model, reduce context in config or env.

## Files

- **Default model:** `OLLAMA_MODEL` in `.env` or systemd.
- **Override (no restart):** `data/current_model.txt` — one line, the Ollama tag. Removed when you run `/model default`.
- **Per-session override:** `data/sessions.json` can store a `model` per session key; the `/model` command writes the global override file.
