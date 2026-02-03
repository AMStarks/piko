#!/bin/bash
# Sync all projects from Mac ~/Projects to Optimus.
# Whatever you work on in Cursor (local) gets pushed to Optimus.
# Uses GNU rsync from Homebrew to avoid macOS openrsync mmap timeouts (see RSYNC_MMAP_TIMEOUT_WHY.md).
set -e
SSH_KEY="${HOME}/.ssh/id_optimus"
OPTIMUS="root@192.168.0.121"
EXCLUDE="--exclude .git --exclude node_modules --exclude .cursor --exclude __pycache__ --exclude .venv --exclude venv --exclude LASKO --exclude Zeroa"
# Dataless (offloaded) files in LASKO/Zeroa time out when read; exclude them (see RSYNC_MMAP_TIMEOUT_WHY.md).
# Prefer GNU rsync from Homebrew for the rest
if [ -x /opt/homebrew/bin/rsync ]; then
  RSYNC=/opt/homebrew/bin/rsync
elif [ -x /usr/local/bin/rsync ]; then
  RSYNC=/usr/local/bin/rsync
else
  RSYNC=rsync
fi

"$RSYNC" -az $EXCLUDE -e "ssh -i $SSH_KEY -o ConnectTimeout=10" \
  "${HOME}/Projects/" "$OPTIMUS:/root/projects/"
