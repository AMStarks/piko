#!/usr/bin/env bash
# Rollback Piko WebChat to Llama 3.1 8B after a failed or unwanted Qwen switch.
# Run from repo root: ./scripts/webchat-deploy/rollback-to-llama.sh
# Or on Optimus (as root): bash -c 'sed -i "s/^Environment=OLLAMA_MODEL=.*/Environment=OLLAMA_MODEL=llama3.1:latest/" /etc/systemd/system/piko-webchat.service; systemctl daemon-reload; systemctl restart piko-webchat.service'
set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_optimus}"
OPTIMUS="${OPTIMUS:-root@192.168.0.121}"
SERVICE_PATH="/etc/systemd/system/piko-webchat.service"

echo "Rollback: restore OLLAMA_MODEL=llama3.1:latest and restart piko-webchat on Optimus."
if [[ "${ROLLBACK_YES:-}" != "1" ]]; then
  read -p "Proceed? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Option A: from local machine, SSH and fix the service file
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$OPTIMUS" "sudo sed -i 's/^Environment=OLLAMA_MODEL=.*/Environment=OLLAMA_MODEL=llama3.1:latest/' $SERVICE_PATH && sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service && sleep 2 && sudo systemctl is-active piko-webchat.service && curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health"
echo ""
echo "Rollback done. Piko is back on llama3.1:latest. Check app/Telegram."
