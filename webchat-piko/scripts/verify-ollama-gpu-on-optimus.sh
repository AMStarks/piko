#!/usr/bin/env bash
# Run ON Optimus to verify Ollama is using GPU (not CPU) for inference.
# Usage on Optimus: cd /root/webchat-piko && bash scripts/verify-ollama-gpu-on-optimus.sh
# Or from Mac: ssh root@192.168.0.121 'cd /root/webchat-piko && bash scripts/verify-ollama-gpu-on-optimus.sh'
set -e
echo "=== GPU status (run this ON Optimus) ==="
nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>/dev/null || { echo "nvidia-smi not found or failed."; exit 1; }
echo ""
echo "=== Ollama container (GPU access?) ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep -i ollama | grep -v init | head -1 || true)
if [[ -z "$CONTAINER" ]]; then
  echo "No Ollama container found. Is Ollama running in Docker?"
  exit 1
fi
echo "Container: $CONTAINER"
RUNTIME=$(docker inspect "$CONTAINER" --format '{{.HostConfig.Runtime}}' 2>/dev/null || echo "")
DEVICES=$(docker inspect "$CONTAINER" --format '{{json .HostConfig.DeviceRequests}}' 2>/dev/null || echo "[]")
if [[ "$RUNTIME" == "nvidia" ]]; then
  echo "Runtime: nvidia (GPU enabled)"
elif echo "$DEVICES" | grep -q '"Driver"'; then
  echo "GPU devices: requested"
else
  echo "WARNING: No nvidia runtime or GPU devices found. Ollama may be using CPU."
  echo "Fix: ensure container is run with --gpus all or runtime: nvidia (e.g. in Legion compose)."
fi
echo ""
echo "=== Quick inference test ==="
echo "Send a chat message from the app/Telegram, then run: nvidia-smi"
echo "You should see GPU memory.used and utilization.gpu increase during the reply."
