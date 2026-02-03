#!/usr/bin/env bash
# Deploy webchat-piko from this repo to Moltbook.
# Run from repo root. Set Moltbook host, user, and optional SSH key and dest.
#
# Usage:
#   MOLTBOOK_HOST=192.168.0.XXX MOLTBOOK_USER=youruser ./scripts/webchat-deploy/deploy-to-moltbook.sh
#   MOLTBOOK_HOST=moltbook.local MOLTBOOK_USER=starkers MOLTBOOK_SSH_KEY=~/.ssh/id_moltbook ./scripts/webchat-deploy/deploy-to-moltbook.sh
#
# Env:
#   MOLTBOOK_HOST   — hostname or IP (required)
#   MOLTBOOK_USER   — SSH user (required)
#   MOLTBOOK_SSH_KEY — SSH key path (default: $HOME/.ssh/id_ed25519, then $HOME/.ssh/id_rsa)
#   MOLTBOOK_DEST   — remote path (default: ~/webchat-piko, i.e. $HOME/webchat-piko on Moltbook)
set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOLTBOOK_HOST="${MOLTBOOK_HOST:?Set MOLTBOOK_HOST (e.g. 192.168.0.xxx or moltbook.local)}"
MOLTBOOK_USER="${MOLTBOOK_USER:?Set MOLTBOOK_USER}"
MOLTBOOK_SSH_KEY="${MOLTBOOK_SSH_KEY:-}"
MOLTBOOK_DEST="${MOLTBOOK_DEST:-}"
REMOTE="${MOLTBOOK_USER}@${MOLTBOOK_HOST}"

if [[ -z "$MOLTBOOK_SSH_KEY" ]]; then
  for k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
    if [[ -f "$k" ]]; then
      MOLTBOOK_SSH_KEY="$k"
      break
    fi
  done
fi
if [[ -z "$MOLTBOOK_SSH_KEY" ]] || [[ ! -f "$MOLTBOOK_SSH_KEY" ]]; then
  echo "No SSH key found. Set MOLTBOOK_SSH_KEY (e.g. ~/.ssh/id_moltbook)."
  exit 1
fi

if [[ -z "$MOLTBOOK_DEST" ]]; then
  MOLTBOOK_DEST="webchat-piko"
fi
# If path is relative, it's under remote user's home
if [[ "$MOLTBOOK_DEST" != /* ]]; then
  DEST="$REMOTE:$MOLTBOOK_DEST"
else
  DEST="$REMOTE:$MOLTBOOK_DEST"
fi

cd "$REPO_ROOT"
if [[ ! -d webchat-piko ]]; then
  echo "Missing webchat-piko/ in repo root. Abort."
  exit 1
fi

echo "Deploying webchat-piko to $DEST (key: $MOLTBOOK_SSH_KEY)"
rsync -az --delete \
  -e "ssh -i $MOLTBOOK_SSH_KEY -o StrictHostKeyChecking=no" \
  webchat-piko/ "$DEST/"

echo "Done. On Moltbook: cd $MOLTBOOK_DEST && node server.js"
echo "See scripts/webchat-deploy/MOLTBOOK_RUNBOOK.md for Node, Ollama, and how to run (macOS vs Linux)."
