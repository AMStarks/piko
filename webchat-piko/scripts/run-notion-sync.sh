#!/bin/bash
cd "$(dirname "$0")/.."
set -a
[ -f .env ] && source .env
set +a
case "$1" in
  push) node scripts/notion-sync.js --push ;;
  pull) node scripts/notion-sync.js --pull ;;
  *)   echo "Usage: $0 push|pull"; exit 1 ;;
esac
