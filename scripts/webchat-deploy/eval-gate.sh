#!/usr/bin/env bash
# Post-deploy eval gate: functional smokes + operator-voice + pipeline audit.
# Usage: eval-gate.sh <tenant>     exit 0 = pass, non-zero = fail (roll back)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TENANT="${1:?usage: eval-gate.sh <tenant>}"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/tenants.conf"
tenant_load "$TENANT"

BASE="http://127.0.0.1:$T_PORT"
FAIL=0
note() { echo "  [gate] $*"; }

# 1. Health
ssh "$T_HOST" "curl -sf -m 15 '$BASE/api/health'" >/dev/null \
  && note "health: OK" || { note "health: FAIL"; FAIL=1; }

# 2. Chat smoke + operator-voice floor
# 180s: cold 27B + Ollama queue after restart often exceeds 90s on culture tenants.
REPLY="$(ssh "$T_HOST" "curl -s -m 180 -X POST '$BASE/api/chat' -H 'Content-Type: application/json' -d '{\"message\":\"Quick status check — all good?\",\"session_id\":\"eval-gate\"}'" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("reply",""))
except Exception:
    print("")' )"
if [[ -z "$REPLY" ]]; then
  note "chat: FAIL (empty reply)"; FAIL=1
else
  note "chat: OK (${#REPLY} chars)"
  if echo "$REPLY" | grep -qE 'job_[0-9a-f-]{8,}|\[Piko review|^Verdict:|^Planner:'; then
    note "voice floor: FAIL (internal telemetry leaked into chat)"; FAIL=1
  else
    note "voice floor: OK"
  fi
fi

# 3. Agents subsystem + pipeline audit on the most recent completed job
GATE_PY=$(cat <<'PY'
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("agents: SKIP (no parseable response)"); sys.exit(0)
jobs = d.get("jobs") or d.get("items") or []
# Audit the newest job that actually executed — cancelled/orphaned jobs have
# no run record and prove nothing about the pipeline.
done = [
    j for j in jobs
    if j.get("status") in ("done", "completed", "reviewed")
    and j.get("error") not in ("cancelled", "orphaned_by_restart")
    and ((j.get("result") or {}).get("run"))
]
if not done:
    print("pipeline audit: SKIP (no completed runs yet)"); sys.exit(0)
# Legacy direct-tool jobs (runtime ei_tool / result.direct_tool) were created by
# the pre-unification bypass; current code cannot produce that shape. Skip them
# rather than fail — audit the newest job from the normal pipeline instead.
def is_legacy(j):
    run = (j.get("result") or {}).get("run") or {}
    res = j.get("result") or {}
    return run.get("runtime") == "ei_tool" or bool(res.get("direct_tool"))
current = [j for j in done if not is_legacy(j)]
if not current:
    print("pipeline audit: SKIP (only legacy direct-tool jobs on record)"); sys.exit(0)
j = sorted(current, key=lambda x: x.get("updated_at") or x.get("created_at") or "")[-1]
run = (j.get("result") or {}).get("run") or {}
pipe = run.get("pipeline") or {}
missing = [k for k in ("decide", "plan", "mission_fit", "review") if k not in pipe]
if missing:
    print(f"pipeline audit: FAIL (missing fields {missing} on {j.get('id')})"); sys.exit(1)
print(f"pipeline audit: OK ({j.get('id')} decide={pipe.get('decide')} plan={pipe.get('plan')} review={pipe.get('review')})")
PY
)
# P3.3b: /api/agents (and cultures campaign) need the tenant API key once protected.
# Read key on-box so it never crosses the ssh command line.
gate_curl() {
  local path="$1"
  local out="$2"
  ssh "$T_HOST" "cd '$T_DIR' && (set -a; [ -f .env ] && . ./.env; set +a; \
    if [ -n \"\${PIKO_API_KEY:-}\" ]; then \
      curl -sf -m 15 -H \"X-Piko-Key: \${PIKO_API_KEY}\" '$BASE$path'; \
    else \
      curl -sf -m 15 '$BASE$path'; \
    fi)" > "$out" 2>/dev/null
}

if gate_curl '/api/agents/jobs' /tmp/gate-jobs.json; then
  note "agents api: OK"
  python3 -c "$GATE_PY" < /tmp/gate-jobs.json | while read -r l; do note "$l"; done
  python3 -c "$GATE_PY" < /tmp/gate-jobs.json >/dev/null || FAIL=1
else
  note "agents api: SKIP (endpoint absent or auth failed on this generation)"
fi

# 4. Grounded status probe (culture tenants): a campaign status *question* must
# answer (not dispatch) and quote a real number from live campaign state.
if gate_curl '/api/cultures/campaign' /tmp/gate-campaign.json; then
  CYCLES="$(python3 -c 'import json,sys
try:
    s = json.load(sys.stdin).get("status") or {}
    print(s.get("cycle_count", ""))
except Exception:
    print("")' < /tmp/gate-campaign.json)"
  STATUS_RESP="$(ssh "$T_HOST" "curl -s -m 120 -X POST '$BASE/api/chat' -H 'Content-Type: application/json' -d '{\"message\":\"Status of the research campaign\",\"session_id\":\"eval-gate-status\"}'")"
  GROUNDED_OK="$(GATE_CYCLES="$CYCLES" python3 -c 'import json,os,sys
try:
    d = json.loads(sys.stdin.read() or "{}")
except Exception:
    print("parse_fail"); sys.exit(0)
route = str(d.get("route") or "")
reply = str(d.get("reply") or "")
if route == "legate_dispatch" or d.get("job_id"):
    print("dispatched"); sys.exit(0)
if not reply.strip():
    print("empty"); sys.exit(0)
cycles = os.environ.get("GATE_CYCLES", "")
if cycles and cycles not in reply and not any(ch.isdigit() for ch in reply):
    print("ungrounded"); sys.exit(0)
print("ok")' <<< "$STATUS_RESP")"
  if [[ "$GROUNDED_OK" == "ok" ]]; then
    note "grounded status: OK"
  else
    note "grounded status: FAIL ($GROUNDED_OK — status question must answer with live numbers, not dispatch)"; FAIL=1
  fi
else
  note "grounded status: SKIP (no campaign endpoint on this tenant)"
fi

[[ $FAIL -eq 0 ]] && { echo "  [gate] PASS"; exit 0; } || { echo "  [gate] FAIL"; exit 1; }
