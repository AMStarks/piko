#!/usr/bin/env bash
# Roll a tenant spine back to a pre-release snapshot made by release.sh.
# Usage: rollback.sh <tenant> [snapshot.tar.gz]   (default: newest snapshot)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TENANT="${1:?usage: rollback.sh <tenant> [snapshot]}"
SNAP="${2:-}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/tenants.conf"
tenant_load "$TENANT"

RELEASES_DIR="/home/chief/releases/$TENANT"
if [[ -z "$SNAP" ]]; then
  SNAP="$(ssh "$T_HOST" "ls -t '$RELEASES_DIR'/pre-*.tar.gz 2>/dev/null | head -1")"
  [[ -n "$SNAP" ]] || { echo "no snapshots found in $RELEASES_DIR"; exit 1; }
fi
echo "== rolling back $TENANT to $SNAP"
ssh "$T_HOST" "tar -xzf '$SNAP' -C '$(dirname "$T_DIR")'"

if [[ "$T_SERVICE_SCOPE" == "user" ]]; then
  ssh "$T_HOST" "systemctl --user restart '$T_SERVICE'"
else
  ssh "$T_ROOT_HOST" "systemctl restart '$T_SERVICE'"
fi
sleep 4
ssh "$T_HOST" "cd '$T_DIR' && (set -a; [ -f .env ] && . ./.env; set +a; \
  if [ -n \"\${PIKO_HEALTH_API_KEY:-}\" ]; then \
    curl -sf -m 20 -H \"Authorization: Bearer \${PIKO_HEALTH_API_KEY}\" '$T_HEALTH_URL'; \
  else \
    curl -sf -m 20 '$T_HEALTH_URL'; \
  fi) >/dev/null" \
  && echo "== rollback OK, healthy" || { echo "!! still unhealthy after rollback"; exit 1; }
