#!/usr/bin/env bash
# 9pm: tell the user what Piko will learn overnight; prompt for suggestions.
# Cron: 0 21 * * * cd /root/webchat-piko && ./scripts/run-tonight-learning-preview.sh >> logs/tonight-learning-preview.log 2>&1
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
exec node scripts/tonight-learning-preview.js "$@"
