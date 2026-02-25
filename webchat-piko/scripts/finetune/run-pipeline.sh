#!/bin/bash
# Full fine-tune pipeline: chunk → Grok Q&A → export chat → merge → train
# Run from webchat-piko root. Set GROK_API_KEY for source-to-qa.
# Training runs on this machine (requires 2× GPU with CUDA on Optimus).
set -e
cd "$(dirname "$0")/../.."
export PIKO_DATA_DIR="${PIKO_DATA_DIR:-$(pwd)/data}"

echo "[1/5] Chunking sources..."
node scripts/finetune/chunk-sources.js

echo "[2/5] Converting chunks to Q&A via Grok..."
node scripts/finetune/source-to-qa.js

echo "[3/5] Exporting chat history..."
node scripts/finetune/export-chat.js

echo "[4/5] Merging datasets..."
node scripts/finetune/merge-datasets.js

echo "[5/5] Training (LoRA/QLoRA)..."
python3 scripts/finetune/train.py

echo "[done] Adapter saved to data/finetune/outputs/final"
