#!/usr/bin/env bash
# Run rabbit-hole daily learning with env from .env.
# Cron (11pm daily): 0 23 * * * cd /root/webchat-piko && ./scripts/run-rabbit-hole-daily.sh >> logs/rabbit-hole-daily.log 2>&1
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
exec node scripts/rabbit-hole-daily.js "$@"
