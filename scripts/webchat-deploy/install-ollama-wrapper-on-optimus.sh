#!/usr/bin/env bash
# Install the Ollama wrapper on Optimus so "ollama" is in PATH for SSH (forwards to Docker).
# Run from repo root: scripts/webchat-deploy/install-ollama-wrapper-on-optimus.sh
# Auto-detects the Ollama container (name containing "ollama"); override with OLLAMA_CONTAINER=name.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
REMOTE_BIN="/usr/local/bin/ollama"
CONTAINER_FILE="/etc/optimus-ollama-container"

cd "$REPO_ROOT"
echo "Installing Ollama wrapper on $OPTIMUS at $REMOTE_BIN..."

# Detect Ollama container on Optimus (running, name contains ollama)
DETECTED=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "docker ps --format '{{.Names}}' | grep -i ollama | grep -v init | head -1" || true)
if [[ -n "$DETECTED" ]]; then
  CONTAINER="$DETECTED"
  echo "Detected Ollama container: $CONTAINER"
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "echo '$CONTAINER' | sudo tee $CONTAINER_FILE > /dev/null"
else
  CONTAINER="${OLLAMA_CONTAINER:-legion-ollama}"
  echo "Using container: $CONTAINER (set OLLAMA_CONTAINER to override)"
fi

scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SCRIPT_DIR/optimus-ollama-wrapper.sh" "$OPTIMUS:/tmp/ollama-wrapper.sh"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "sudo mv /tmp/ollama-wrapper.sh $REMOTE_BIN && sudo chmod +x $REMOTE_BIN"
echo "Verifying: ollama list"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "ollama list" || true
echo "Done. Use 'ollama pull <tag>' over SSH or run ./scripts/webchat-deploy/pull-gemma27b.sh."
