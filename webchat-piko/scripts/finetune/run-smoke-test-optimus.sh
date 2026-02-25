#!/bin/bash
# Smoke test DDP QLoRA on Optimus. Stops services to free VRAM, runs test, restarts.
# Execute ON Optimus: cd /root/webchat-piko && bash scripts/finetune/run-smoke-test-optimus.sh
set -e
cd /root/webchat-piko

echo "[1/4] Stopping services to free VRAM..."
sudo systemctl stop piko-webchat clawfriend-bot 2>/dev/null || true
docker stop $(docker ps -q --filter 'name=ollama') 2>/dev/null || true
sleep 2

echo "[2/4] GPU status (expect <1 GiB used per GPU):"
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv 2>/dev/null || true

echo "[3/4] Running smoke test (7B=${SMOKE_TEST_7B:-0}, GPTQ=${SMOKE_TEST_GPTQ:-0})..."
PYTHON=${PYTHON:-.venv-finetune/bin/python}
[ -x "$PYTHON" ] || PYTHON=python3
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0,1}
export PYTORCH_ALLOC_CONF=${PYTORCH_ALLOC_CONF:-expandable_segments:True,max_split_size_mb:128}
export SMOKE_TEST_7B=${SMOKE_TEST_7B:-0}
export SMOKE_TEST_GPTQ=${SMOKE_TEST_GPTQ:-0}

"$PYTHON" -m accelerate.commands.launch \
  --config_file scripts/finetune/accelerate_config.yaml \
  scripts/finetune/smoke_test_ddp.py

echo "[4/4] Restarting services..."
docker start $(docker ps -aq --filter 'name=ollama') 2>/dev/null || true
sudo systemctl start clawfriend-bot piko-webchat 2>/dev/null || true

echo "[done] Smoke test OK"
