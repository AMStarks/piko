# Piko Fine-Tune: Optimus Runbook

Run the full pipeline on Optimus (2× RTX 3080). SSH first:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
```

## One-time setup on Optimus

```bash
cd /root/webchat-piko
pip3 install --user torch transformers peft datasets accelerate bitsandbytes
```

## Quick: single script

```bash
cd /root/webchat-piko
bash scripts/finetune/run-on-optimus.sh
```

Uses `FINETUNE_CHUNK_LIMIT=200` and `FINETUNE_MAX_STEPS=500` by default. Override:

```bash
FINETUNE_CHUNK_LIMIT=500 FINETUNE_MAX_STEPS=1000 bash scripts/finetune/run-on-optimus.sh
```

### 14B model (8-bit + CPU offload)

Stop Ollama first. Then:

```bash
# Stop Piko, ClawFriend, and Ollama to free GPUs
sudo systemctl stop piko-webchat clawfriend-bot
docker stop $(docker ps -q --filter 'name=ollama')

# Run with 14B
PIKO_FINETUNE_14B=1 bash scripts/finetune/run-on-optimus.sh

# When done, restart services
docker start $(docker ps -aq --filter 'name=ollama')
sudo systemctl start clawfriend-bot piko-webchat
```

See `docs/PIKO_FINETUNE_14B_ARCHITECTURE.md` for the architectural fix (8-bit + CPU offload).

## Manual steps

```bash
cd /root/webchat-piko
export $(grep -v '^#' .env | xargs)

node scripts/finetune/chunk-sources.js
FINETUNE_CHUNK_LIMIT=200 node scripts/finetune/source-to-qa.js
node scripts/finetune/export-chat.js
node scripts/finetune/merge-datasets.js
FINETUNE_MAX_STEPS=500 python3 scripts/finetune/train.py
```

## Output

- Adapter: `data/finetune/outputs/final/`
- To use: merge into base model, export GGUF, then `ollama create` with a Modelfile

## Merge → GGUF → Ollama (post-training)

Scripts: `scripts/finetune/merge-lora.py` and `scripts/finetune/export-to-ollama.sh`

**Before running:** Free all GPUs. Stop everything that uses CUDA:

```bash
docker stop $(docker ps -q -f name=ollama) 2>/dev/null
sudo systemctl stop piko-webchat clawfriend-bot 2>/dev/null
# Kill any orphan Python processes holding GPU
pkill -f "python.*finetune" 2>/dev/null
sleep 5
nvidia-smi  # verify both GPUs are free
```

Then:

```bash
cd /root/webchat-piko
bash scripts/finetune/export-to-ollama.sh
```

This merges LoRA into base (8-bit), converts to GGUF, quantizes to Q4_K_M, and creates `piko:finetune` in Ollama. If OOM persists, run on a machine with more VRAM or use LLaMA Factory for merge+export.
