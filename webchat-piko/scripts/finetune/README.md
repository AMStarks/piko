# Piko Fine-Tune Pipeline

## What's Done

- **PDFs converted** to .txt (in `/Users/starkers/Projects/Piko/Texts/`)
- **Sources copied** to `data/finetune/sources/theology/` (20 files)
- **Chunking complete** → 10,771 chunks in `data/finetune/chunks/`
- **Scripts**:
  - `chunk-sources.js` – splits sources into ~4k char chunks
  - `source-to-qa.js` – converts chunks to Q&A via Grok (or Ollama fallback)
  - `export-chat.js` – exports Piko conversations from DB
  - `merge-datasets.js` – merges chat + synthetic → train.jsonl, val.jsonl
  - `train.py` – LoRA/QLoRA training (run on Optimus with 2× GPU)

## To Run (Completion by 6am)

### Option A: With Grok (recommended)

1. Set `GROK_API_KEY` in `.env` (or export).
2. Run on Optimus (has 2× RTX 3080):

```bash
cd /root/webchat-piko
export FINETUNE_CHUNK_LIMIT=2000   # or 0 for all 10771 chunks (~6hr Grok)
./scripts/finetune/run-pipeline.sh
```

Or step by step:

```bash
node scripts/finetune/chunk-sources.js
FINETUNE_CHUNK_LIMIT=2000 node scripts/finetune/source-to-qa.js
node scripts/finetune/export-chat.js
node scripts/finetune/merge-datasets.js
pip install -r scripts/finetune/requirements.txt
python3 scripts/finetune/train.py
```

### Option B: With Ollama (local fallback)

- Ensure Ollama is running and `qwen2.5:14b` is pulled.
- Run `source-to-qa.js` as above (it will use Ollama if GROK_API_KEY is not set).

### Training

- `train.py` uses LoRA/QLoRA (fits 2× 3080). Adapter saved to `data/finetune/outputs/final`.
- **DDP (2× GPU, balanced)**: `PIKO_FINETUNE_DDP=1 PIKO_FINETUNE_GPTQ=1 ./scripts/finetune/run-on-optimus.sh` — GPTQ 7B + accelerate (validated on 2×10GB)
- **Smoke test**: `bash scripts/finetune/run-smoke-test-optimus.sh` (3B default). Use `SMOKE_TEST_7B=1 SMOKE_TEST_GPTQ=1` for 7B.
- To load in Ollama: merge adapter into base and create new model, or use `ollama create` with Modelfile pointing at the merged GGUF.

## Paths

| Path | Purpose |
|------|---------|
| `data/finetune/sources/theology/` | Your source .txt files |
| `data/finetune/chunks/` | Chunked JSON (generated) |
| `data/finetune/synthetic/` | Grok/Ollama Q&A output |
| `data/finetune/pending_review/` | Theology/Islam Q&A for review |
| `data/finetune/train.jsonl` | Final training set |
| `data/finetune/outputs/final/` | Trained adapter |
