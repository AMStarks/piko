#!/usr/bin/env bash
# Run the Moltbook poster with env from .env (so cron gets MOLTBOOK_API_KEY etc.).
# Usage: from app root, ./scripts/run-moltbook-poster.sh [args]
# Cron:  */30 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
exec node scripts/moltbook-poster.js "$@"
