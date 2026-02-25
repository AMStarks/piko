#!/usr/bin/env bash
# Wrapper so "ollama" works in SSH sessions on Optimus when Ollama runs in Docker.
# Install to /usr/local/bin/ollama on Optimus; then "ollama pull", "ollama list", etc. work over SSH.
# Container: from /etc/optimus-ollama-container, or env OLLAMA_CONTAINER, or default legion-ollama.
if [[ -f /etc/optimus-ollama-container ]]; then
  CONTAINER="$(cat /etc/optimus-ollama-container)"
else
  CONTAINER="${OLLAMA_CONTAINER:-legion-ollama}"
fi
exec docker exec "$CONTAINER" ollama "$@"
