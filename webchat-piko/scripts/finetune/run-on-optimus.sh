#!/bin/bash
# Run full fine-tune pipeline on Optimus. Execute ON Optimus:
#   cd /root/webchat-piko && bash scripts/finetune/run-on-optimus.sh
set -e
cd /root/webchat-piko
export $(grep -v '^#' .env | xargs) 2>/dev/null || true

CHUNK_LIMIT=${FINETUNE_CHUNK_LIMIT:-1000}
MAX_STEPS=${FINETUNE_MAX_STEPS:-500}

echo "[1/5] Chunking..."
node scripts/finetune/chunk-sources.js

echo "[2/5] Converting to Q&A (limit=$CHUNK_LIMIT)..."
FINETUNE_CHUNK_LIMIT=$CHUNK_LIMIT node scripts/finetune/source-to-qa.js

echo "[3/5] Exporting chat..."
node scripts/finetune/export-chat.js

echo "[3b/5] Generating casual small-talk dataset..."
node scripts/finetune/generate-casual-smalltalk.js

echo "[4/5] Merging datasets..."
node scripts/finetune/merge-datasets.js

PYTHON=${PYTHON:-.venv-finetune/bin/python}
[ -x "$PYTHON" ] || PYTHON=python3
PIKO_FINETUNE_DDP=${PIKO_FINETUNE_DDP:-0}
PIKO_FINETUNE_GPTQ=${PIKO_FINETUNE_GPTQ:-1}
PIKO_FINETUNE_14B=${PIKO_FINETUNE_14B:-0}
echo "[5/5] Training (max_steps=$MAX_STEPS, DDP=$PIKO_FINETUNE_DDP, GPTQ=$PIKO_FINETUNE_GPTQ, 14B=$PIKO_FINETUNE_14B)..."

export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0,1}
export PYTORCH_ALLOC_CONF=${PYTORCH_ALLOC_CONF:-expandable_segments:True,max_split_size_mb:128}
export FINETUNE_MAX_STEPS=$MAX_STEPS
export PIKO_FINETUNE_GPTQ=$PIKO_FINETUNE_GPTQ
export PIKO_FINETUNE_14B=$PIKO_FINETUNE_14B
export PIKO_FINETUNE_DDP=$PIKO_FINETUNE_DDP

if [ "$PIKO_FINETUNE_DDP" = "1" ]; then
  "$PYTHON" -m accelerate.commands.launch --config_file scripts/finetune/accelerate_config.yaml scripts/finetune/train.py
else
  "$PYTHON" scripts/finetune/train.py
fi

echo "[done] Adapter: data/finetune/outputs/final/"
