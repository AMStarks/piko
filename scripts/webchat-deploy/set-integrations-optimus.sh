#!/usr/bin/env bash
# One-time on Optimus: copy Telegram vars from clawfriend-bot into piko-webchat .env so EA alerts work.
# Run on Optimus: bash scripts/webchat-deploy/set-integrations-optimus.sh
# Or from Mac: ssh -i ~/.ssh/id_optimus root@192.168.0.121 'cd /root/webchat-piko && bash -s' < scripts/webchat-deploy/set-integrations-optimus.sh
set -e
ENV_FILE="/root/webchat-piko/.env"
mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# systemctl show gives Environment=KEY1=val1 KEY2=val2; pull TELEGRAM_TOKEN and TELEGRAM_CHAT_ID
BOT_ENV=$(systemctl show clawfriend-bot.service --property=Environment --no-pager 2>/dev/null | sed 's/^Environment=//' || true)
for pair in $BOT_ENV; do
  key="${pair%%=*}"
  val="${pair#*=}"
  if [[ "$key" == "TELEGRAM_TOKEN" || "$key" == "TELEGRAM_BOT_TOKEN" || "$key" == "TELEGRAM_CHAT_ID" ]]; then
    if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      echo "${key}=${val}" >> "$ENV_FILE"
    fi
  fi
done
# Server accepts TELEGRAM_BOT_TOKEN or TELEGRAM_TOKEN
if grep -q "^TELEGRAM_TOKEN=" "$ENV_FILE" 2>/dev/null && ! grep -q "^TELEGRAM_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null; then
  val=$(grep "^TELEGRAM_TOKEN=" "$ENV_FILE" | cut -d= -f2-)
  echo "TELEGRAM_BOT_TOKEN=$val" >> "$ENV_FILE"
fi
echo "Done. Restart: systemctl restart piko-webchat.service"
