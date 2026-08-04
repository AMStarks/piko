#!/usr/bin/env bash
# Versioned release of webchat-piko to a tenant spine, with pre-snapshot and
# automatic rollback if the post-deploy health check fails.
#
# Usage: release.sh <tenant>            deploy repo webchat-piko/ to the tenant
#        release.sh <tenant> --dry-run  show what would happen
#
# Tenants are defined in tenants.conf next to this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/webchat-piko"
TENANT="${1:?usage: release.sh <tenant>}"
DRY_RUN="${2:-}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/tenants.conf"
tenant_load "$TENANT"   # sets T_HOST T_ROOT_HOST T_DIR T_SERVICE T_SERVICE_SCOPE T_HEALTH_URL T_PORT

VERSION="$(date +%Y%m%d-%H%M)-$(tar -cf - -C "$REPO_ROOT" --exclude='webchat-piko/node_modules' --exclude='webchat-piko/data' --exclude='webchat-piko/logs' --exclude='webchat-piko/.env*' webchat-piko 2>/dev/null | shasum | cut -c1-8)"
echo "== release $VERSION → $TENANT ($T_HOST:$T_DIR)"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "(dry run) would snapshot, rsync, npm install, restart $T_SERVICE, health-check $T_HEALTH_URL"
  exit 0
fi

RELEASES_DIR="/home/chief/releases/$TENANT"
PRE_TAR="$RELEASES_DIR/pre-$VERSION.tar.gz"

echo "-- pre-snapshot on $T_HOST"
ssh "$T_HOST" "mkdir -p '$RELEASES_DIR' && tar -czf '$PRE_TAR' -C '$(dirname "$T_DIR")' --exclude='*/node_modules' --exclude='*/data' --exclude='*/logs' '$(basename "$T_DIR")' && ls -la '$PRE_TAR'"

echo "-- rsync code"
rsync -az --delete \
  --exclude='.env' --exclude='.env.*' --exclude='data/' --exclude='logs/' \
  --exclude='node_modules/' --exclude='.venv/' \
  "$SRC/" "$T_HOST:$T_DIR/"

echo "-- deps + release stamp"
# P0.5: dependency install failures must abort the release (no || true).
ssh "$T_HOST" "cd '$T_DIR' && npm install --omit=dev --no-audit --no-fund --loglevel=error && printf '{\"version\":\"%s\",\"tenant\":\"%s\",\"released_at\":\"%s\"}\n' '$VERSION' '$TENANT' \"\$(date -Is)\" > '$T_DIR/RELEASE.json'"

restart_service() {
  if [[ "$T_SERVICE_SCOPE" == "user" ]]; then
    ssh "$T_HOST" "systemctl --user restart '$T_SERVICE'"
  else
    ssh "$T_ROOT_HOST" "systemctl restart '$T_SERVICE'"
  fi
}

echo "-- restart $T_SERVICE"
restart_service
sleep 4

echo "-- health check"
if ssh "$T_HOST" "curl -sf -m 20 '$T_HEALTH_URL' >/dev/null" && "$SCRIPT_DIR/eval-gate.sh" "$TENANT"; then
  echo "-- health + eval gate OK"
  HEALTH_OK=true
else
  echo "!! health/eval gate FAILED — rolling back to pre-snapshot"
  ssh "$T_HOST" "tar -xzf '$PRE_TAR' -C '$(dirname "$T_DIR")'"
  restart_service
  sleep 4
  ssh "$T_HOST" "curl -sf -m 20 '$T_HEALTH_URL' >/dev/null" \
    && echo "-- rollback OK, spine healthy on previous release" \
    || echo "!! ROLLBACK HEALTH ALSO FAILED — manual intervention required"
  HEALTH_OK=false
fi

echo "-- stamp registry"
"$SCRIPT_DIR/stamp-registry.sh" "$TENANT" "$VERSION" "$HEALTH_OK" || echo "(registry stamp failed, non-fatal)"

# Keep last 10 pre-snapshots
ssh "$T_HOST" "cd '$RELEASES_DIR' && ls -t pre-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f"

$HEALTH_OK && echo "== RELEASED $VERSION to $TENANT" || { echo "== RELEASE FAILED (rolled back)"; exit 1; }
