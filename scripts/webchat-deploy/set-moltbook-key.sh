#!/usr/bin/env bash
# Set MOLTBOOK_API_KEY on Optimus (piko-webchat.service) so Piko can post/feed.
# Run from repo root: scripts/webchat-deploy/set-moltbook-key.sh
# Paste the key when prompted, or: echo "moltbook_xxx" | scripts/webchat-deploy/set-moltbook-key.sh
set -e
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
OVERRIDE_DIR="/etc/systemd/system/piko-webchat.service.d"
OVERRIDE_FILE="$OVERRIDE_DIR/override.conf"

if [[ -t 0 ]]; then
  echo "Paste your Moltbook API key (e.g. moltbook_xxx) and press Enter (key won't echo):"
  read -rs MOLT_KEY
  echo
else
  read -r MOLT_KEY
fi
MOLT_KEY=$(printf '%s' "$MOLT_KEY" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [[ -z "$MOLT_KEY" ]]; then
  echo "No key provided. Abort."
  exit 1
fi

echo "Setting MOLTBOOK_API_KEY on $OPTIMUS and restarting piko-webchat..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "mkdir -p $OVERRIDE_DIR"
# Append or add MOLTBOOK_API_KEY; preserve existing [Service] and other Environment lines
# Pass key via env so remote shell sees it (avoid exposing in process list)
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "export MOLTBOOK_KEY='$MOLT_KEY'
  if [[ -f $OVERRIDE_FILE ]]; then
    if grep -q 'MOLTBOOK_API_KEY=' $OVERRIDE_FILE; then
      sed -i \"s/^Environment=MOLTBOOK_API_KEY=.*/Environment=MOLTBOOK_API_KEY=\$MOLTBOOK_KEY/\" $OVERRIDE_FILE
    else
      echo \"Environment=MOLTBOOK_API_KEY=\$MOLTBOOK_KEY\" >> $OVERRIDE_FILE
    fi
  else
    printf '%s\n' '[Service]' \"Environment=MOLTBOOK_API_KEY=\$MOLTBOOK_KEY\" > $OVERRIDE_FILE
  fi
  systemctl daemon-reload && systemctl restart piko-webchat.service && systemctl status piko-webchat.service --no-pager
"
echo "Done. Piko can use /moltbook feed and /moltbook post on Optimus."
