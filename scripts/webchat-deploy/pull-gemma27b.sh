#!/usr/bin/env bash
# Pull Gemma 2 27B (Q4_K_M) on Optimus for use with Piko /model switch.
# Run from repo root: scripts/webchat-deploy/pull-gemma27b.sh
# One-time: run scripts/webchat-deploy/install-ollama-wrapper-on-optimus.sh so "ollama" is in PATH over SSH (Docker).
set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
# Standard Ollama tag (gemma2:27b-it-q4_K_M not in registry; use gemma2:27b)
GEMMA_TAG="${GEMMA_TAG:-gemma2:27b}"

cd "$REPO_ROOT"
echo "Pulling $GEMMA_TAG on $OPTIMUS (this may take 15–25 min)..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "ollama pull $GEMMA_TAG"
echo "Done. In Piko chat use: /model $GEMMA_TAG  then /model default to switch back."
