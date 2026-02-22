#!/bin/bash
# Merge LoRA, convert to GGUF, quantize, and create Ollama model.
# Run on Optimus: cd /root/webchat-piko && bash scripts/finetune/export-to-ollama.sh
# Stop Ollama first to free GPU: docker stop $(docker ps -q -f name=ollama) 2>/dev/null
set -e

# Free GPUs for merge step
docker stop $(docker ps -q -f name=ollama) 2>/dev/null || true

cd "$(dirname "$0")/../.."
ROOT=$(pwd)
DATA_DIR="${PIKO_DATA_DIR:-$ROOT/data}"
FINETUNE="$DATA_DIR/finetune"
OUTPUTS="$FINETUNE/outputs"
MERGED="$OUTPUTS/merged"
LLAMA_CPP="${LLAMA_CPP_DIR:-/root/llama.cpp}"
PYTHON="${PYTHON:-.venv-finetune/bin/python}"
[ -x "$PYTHON" ] || PYTHON=python3

echo "[1/5] Merging LoRA into base..."
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
"$PYTHON" scripts/finetune/merge-lora.py

if [ ! -d "$MERGED" ]; then
  echo "[export] Merge failed or no merged model"
  exit 1
fi

echo "[2/5] Setting up llama.cpp..."
if [ ! -f "$LLAMA_CPP/convert_hf_to_gguf.py" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP"
  cd "$LLAMA_CPP"
  pip install -e . 2>/dev/null || pip3 install -e . 2>/dev/null || true
  cd "$ROOT"
fi

echo "[3/5] Converting to GGUF..."
GGUF_F16="$OUTPUTS/piko-f16.gguf"
"$PYTHON" "$LLAMA_CPP/convert_hf_to_gguf.py" "$MERGED" --outfile "$GGUF_F16" --outtype f16

echo "[4/5] Quantizing to Q4_K_M..."
GGUF_Q4="$OUTPUTS/piko-Q4_K_M.gguf"
if [ -f "$LLAMA_CPP/llama-quantize" ]; then
  "$LLAMA_CPP/llama-quantize" "$GGUF_F16" "$GGUF_Q4" Q4_K_M
elif [ -f "$LLAMA_CPP/build/bin/llama-quantize" ]; then
  "$LLAMA_CPP/build/bin/llama-quantize" "$GGUF_F16" "$GGUF_Q4" Q4_K_M
else
  cd "$LLAMA_CPP"
  cmake -B build -DGGUF_NATIVE=ON
  cmake --build build
  "$LLAMA_CPP/build/bin/llama-quantize" "$GGUF_F16" "$GGUF_Q4" Q4_K_M
  cd "$ROOT"
fi

echo "[5/5] Creating Ollama model..."
MODELFILE="$OUTPUTS/Modelfile"
cat > "$MODELFILE" << 'MODELFILE'
FROM ./piko-Q4_K_M.gguf
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
"""
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
MODELFILE

cd "$OUTPUTS"
ollama create piko:finetune -f Modelfile

echo "[done] Model piko:finetune is ready. Run: ollama run piko:finetune"
