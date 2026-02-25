#!/usr/bin/env bash
# Set GROK_API_KEY in webchat-piko .env on Optimus for source-to-qa (chunk → Q&A conversion).
# Run from repo root: scripts/webchat-deploy/set-grok-key.sh
# Paste the key when prompted, or: echo "xai-xxx" | scripts/webchat-deploy/set-grok-key.sh
set -e
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
REMOTE_ENV="/root/webchat-piko/.env"

if [[ -t 0 ]]; then
  echo "Paste your Grok/XAI API key and press Enter (key won't echo):"
  read -rs GROK_KEY
  echo
else
  read -r GROK_KEY
fi
GROK_KEY=$(printf '%s' "$GROK_KEY" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [[ -z "$GROK_KEY" ]]; then
  echo "No key provided. Abort."
  exit 1
fi

echo "Setting GROK_API_KEY on $OPTIMUS..."
GROK_KEY_ESC=$(printf '%s' "$GROK_KEY" | sed "s/'/'\\\\''/g")
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "GROK_KEY='$GROK_KEY_ESC'
  touch $REMOTE_ENV
  if grep -q '^GROK_API_KEY=' $REMOTE_ENV; then
    grep -v '^GROK_API_KEY=' $REMOTE_ENV > $REMOTE_ENV.tmp && mv $REMOTE_ENV.tmp $REMOTE_ENV
  fi
  echo \"GROK_API_KEY=\$GROK_KEY\" >> $REMOTE_ENV
  echo 'Done. run-on-optimus.sh will use Grok for source-to-qa.'
"
echo "Done."
