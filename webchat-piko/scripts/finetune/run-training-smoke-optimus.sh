#!/bin/bash
# Short 7B DDP+GPTQ training smoke test on Optimus.
# Runs ~20 steps to confirm load + gradients + both GPUs, no OOM.
# Execute ON Optimus: cd /root/webchat-piko && bash scripts/finetune/run-training-smoke-optimus.sh
set -e
cd /root/webchat-piko
export $(grep -v '^#' .env | xargs) 2>/dev/null || true

echo "[1/4] Stopping services to free VRAM..."
sudo systemctl stop piko-webchat clawfriend-bot 2>/dev/null || true
docker stop $(docker ps -q --filter 'name=ollama') 2>/dev/null || true
sleep 2

echo "[2/4] GPU status:"
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv 2>/dev/null || true

echo "[3/4] Running 7B DDP+GPTQ training smoke (20 steps)..."
PYTHON=${PYTHON:-.venv-finetune/bin/python}
[ -x "$PYTHON" ] || PYTHON=python3
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0,1}
export PYTORCH_ALLOC_CONF=${PYTORCH_ALLOC_CONF:-expandable_segments:True,max_split_size_mb:128}
export PIKO_FINETUNE_DDP=1
export PIKO_FINETUNE_GPTQ=1
export FINETUNE_MAX_STEPS=20

"$PYTHON" -m accelerate.commands.launch \
  --config_file scripts/finetune/accelerate_config.yaml \
  scripts/finetune/train.py

echo "[4/4] Restarting services..."
docker start $(docker ps -aq --filter 'name=ollama') 2>/dev/null || true
sudo systemctl start clawfriend-bot piko-webchat 2>/dev/null || true

echo "[done] Training smoke test OK - 7B DDP+GPTQ ran without OOM"
