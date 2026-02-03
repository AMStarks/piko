#!/usr/bin/env bash
# Set CURSOR_API_KEY on Optimus (piko-webchat.service) without committing the key.
# Run from repo root: scripts/webchat-deploy/set-cursor-key.sh
# You can paste the key when prompted, or: echo "your-key" | scripts/webchat-deploy/set-cursor-key.sh
set -e
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
OVERRIDE_DIR="/etc/systemd/system/piko-webchat.service.d"
OVERRIDE_FILE="$OVERRIDE_DIR/50-cursor.conf"

if [[ -t 0 ]]; then
  echo "Paste your Cursor API key and press Enter (key won't echo):"
  read -rs CURSOR_KEY
  echo
else
  read -r CURSOR_KEY
fi
CURSOR_KEY=$(printf '%s' "$CURSOR_KEY" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [[ -z "$CURSOR_KEY" ]]; then
  echo "No key provided. Abort."
  exit 1
fi

echo "Setting CURSOR_API_KEY on $OPTIMUS and restarting piko-webchat..."
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
printf '%s\n' '[Service]' "Environment=CURSOR_API_KEY=$CURSOR_KEY" > "$TMP"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "mkdir -p $OVERRIDE_DIR"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$TMP" "$OPTIMUS:$OVERRIDE_FILE"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "systemctl daemon-reload && systemctl restart piko-webchat.service && systemctl status piko-webchat.service --no-pager"
echo "Done. Cursor API key is set for Piko WebChat on Optimus."
