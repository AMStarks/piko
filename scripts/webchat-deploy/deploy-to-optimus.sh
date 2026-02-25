#!/usr/bin/env bash
# Deploy webchat-piko from this repo to Optimus (/root/webchat-piko/).
# Run from repo root: scripts/webchat-deploy/deploy-to-optimus.sh
set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
DEST="/root/webchat-piko"

cd "$REPO_ROOT"
if [[ ! -d webchat-piko ]]; then
  echo "Missing webchat-piko/ in repo root. Abort."
  exit 1
fi

echo "Deploying webchat-piko to $OPTIMUS:$DEST"
rsync -az --delete \
  --exclude='.env' --exclude='.env.moltbook' --exclude='data/' --exclude='logs/' --exclude='node_modules/' \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  webchat-piko/ "$OPTIMUS:$DEST/"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "mkdir -p $DEST/logs $DEST/data"
echo "Done. On Optimus: cd $DEST && npm install && node server.js"
echo "Moltbook cron: use ./scripts/run-moltbook-poster.sh (sources .env); ensure $DEST/.env has MOLTBOOK_API_KEY on Optimus."
echo "Checklist: webchat-piko/docs/DEPLOYMENT_CHECKLIST.md  |  Runbook: scripts/webchat-deploy/PHASE2_RUNBOOK.md"
