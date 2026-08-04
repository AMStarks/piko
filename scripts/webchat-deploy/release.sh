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
  local svc="${1:-$T_SERVICE}"
  if [[ "$T_SERVICE_SCOPE" == "user" ]]; then
    ssh "$T_HOST" "systemctl --user restart '$svc'"
  else
    ssh "$T_ROOT_HOST" "systemctl restart '$svc'"
  fi
}

signal_service() {
  local svc="$1"
  local sig="$2"
  if [[ "$T_SERVICE_SCOPE" == "user" ]]; then
    ssh "$T_HOST" "systemctl --user kill -s '$sig' '$svc' 2>/dev/null || true"
  else
    ssh "$T_ROOT_HOST" "systemctl kill -s '$sig' '$svc' 2>/dev/null || true"
  fi
}

# P3.2d: drain standalone worker before restart (stop claiming; wait for running jobs).
drain_worker() {
  local worker="${T_WORKER_SERVICE:-}"
  [[ -n "$worker" ]] || return 0
  echo "-- drain worker $worker (up to 90s)"
  # Prefer SIGUSR1; also touch drain file so in-process / orphaned workers honour it.
  signal_service "$worker" SIGUSR1
  ssh "$T_HOST" "mkdir -p '$T_DIR/data/agent-jobs' && : > '$T_DIR/data/agent-jobs/.drain' || true"
  # If PIKO_DATA_DIR differs from $T_DIR/data, also touch under env (best-effort; parse, don't source).
  ssh "$T_HOST" "cd '$T_DIR' && python3 - <<'PY'
import pathlib, os
env = {}
p = pathlib.Path('.env')
if p.exists():
    for line in p.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith('#') and '=' in s:
            k, _, v = s.partition('=')
            env[k.strip()] = v.strip().strip('\"').strip(\"'\")
d = env.get('PIKO_DATA_DIR') or '$T_DIR/data'
os.makedirs(os.path.join(d, 'agent-jobs'), exist_ok=True)
pathlib.Path(d, 'agent-jobs', '.drain').write_text('')
print(d)
PY" >/dev/null 2>&1 || true
  local waited=0
  while (( waited < 90 )); do
    local running
    running="$(ssh "$T_HOST" "cd '$T_DIR' && python3 - <<'PY'
import pathlib
env = {}
p = pathlib.Path('.env')
if p.exists():
    for line in p.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith('#') and '=' in s:
            k, _, v = s.partition('=')
            env[k.strip()] = v.strip().strip('\"').strip(\"'\")
d = env.get('PIKO_DATA_DIR') or '$T_DIR/data'
print(sum(1 for _ in pathlib.Path(d, 'agent-jobs', 'running').glob('*.json')) if pathlib.Path(d, 'agent-jobs', 'running').exists() else 0)
PY" 2>/dev/null || echo 0)"
    running="$(echo "$running" | tr -d '[:space:]')"
    [[ "${running:-0}" == "0" ]] && { echo "-- drain idle after ${waited}s"; return 0; }
    sleep 3
    waited=$((waited + 3))
  done
  echo "-- drain wait timed out with running jobs still present (reaper will clean orphans)"
}

echo "-- pre-restart drain"
drain_worker || true

echo "-- restart worker + $T_SERVICE"
if [[ -n "${T_WORKER_SERVICE:-}" ]]; then
  restart_service "$T_WORKER_SERVICE" || echo "(worker restart skipped — unit may not be installed yet)"
fi
restart_service "$T_SERVICE"
# Settle: agent-worker reap + first campaign tick + Ollama warm can exceed 4s.
sleep 12

# On-box health probe: honour PIKO_HEALTH_API_KEY when set (handler requires it).
# Parse .env with Python (never `source`) so unquoted spaces in values cannot break the shell,
# and the key never crosses the ssh argv.
health_curl() {
  ssh "$T_HOST" "cd '$T_DIR' && python3 - <<'PY'
import pathlib, urllib.request, sys
env = {}
p = pathlib.Path('.env')
if p.exists():
    for line in p.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith('#') or '=' not in s:
            continue
        k, _, v = s.partition('=')
        env[k.strip()] = v.strip().strip('\"').strip(\"'\")
url = '$T_HEALTH_URL'
req = urllib.request.Request(url)
hk = env.get('PIKO_HEALTH_API_KEY') or ''
if hk:
    req.add_header('Authorization', 'Bearer ' + hk)
try:
    urllib.request.urlopen(req, timeout=20).read()
except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)
PY"
}

echo "-- health check"
if health_curl && "$SCRIPT_DIR/eval-gate.sh" "$TENANT"; then
  echo "-- health + eval gate OK"
  HEALTH_OK=true
else
  echo "!! health/eval gate FAILED — rolling back to pre-snapshot"
  ssh "$T_HOST" "tar -xzf '$PRE_TAR' -C '$(dirname "$T_DIR")'"
  restart_service
  sleep 4
  health_curl \
    && echo "-- rollback OK, spine healthy on previous release" \
    || echo "!! ROLLBACK HEALTH ALSO FAILED — manual intervention required"
  HEALTH_OK=false
fi

echo "-- stamp registry"
"$SCRIPT_DIR/stamp-registry.sh" "$TENANT" "$VERSION" "$HEALTH_OK" || echo "(registry stamp failed, non-fatal)"

# Keep last 10 pre-snapshots
ssh "$T_HOST" "cd '$RELEASES_DIR' && ls -t pre-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f"

$HEALTH_OK && echo "== RELEASED $VERSION to $TENANT" || { echo "== RELEASE FAILED (rolled back)"; exit 1; }
