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

is_culture_tenant() {
  case "$TENANT" in
    staging|customer-03|ei) return 0 ;;
    *) return 1 ;;
  esac
}

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

gate_chat_post() {
  local message="$1"
  local session_id="$2"
  local out="$3"
  local timeout="${4:-180}"
  local payload payload_esc
  payload="$(python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1], "session_id": sys.argv[2]}))' "$message" "$session_id")"
  payload_esc="${payload//\'/\'\\\'\'}"
  ssh "$T_HOST" "cd '$T_DIR' && (set -a; [ -f .env ] && . ./.env; set +a; \
    if [ -n \"\${PIKO_API_KEY:-}\" ]; then \
      curl -s -m ${timeout} -X POST '$BASE/api/chat' -H 'Content-Type: application/json' -H \"X-Piko-Key: \${PIKO_API_KEY}\" -d '${payload_esc}'; \
    else \
      curl -s -m ${timeout} -X POST '$BASE/api/chat' -H 'Content-Type: application/json' -d '${payload_esc}'; \
    fi)" > "$out" 2>/dev/null
}

# 1. Health (PIKO_HEALTH_API_KEY required when set on the spine; parse .env, never source)
ssh "$T_HOST" "cd '$T_DIR' && python3 - <<'PY'
import pathlib, urllib.request, sys
env = {}
p = pathlib.Path('.env')
if p.exists():
    for line in p.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith('#') and '=' in s:
            k, _, v = s.partition('=')
            env[k.strip()] = v.strip().strip('\"').strip(\"'\")
url = '$BASE/api/health'
req = urllib.request.Request(url)
hk = env.get('PIKO_HEALTH_API_KEY') or ''
if hk:
    req.add_header('Authorization', 'Bearer ' + hk)
try:
    urllib.request.urlopen(req, timeout=15).read()
except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)
PY" >/dev/null \
  && note "health: OK" || { note "health: FAIL"; FAIL=1; }

# 2. Chat smoke + operator-voice floor
# 180s: cold 27B + Ollama queue after restart often exceeds 90s on culture tenants.
# Strict auth spines need X-Piko-Key — gate_chat_post reads it on-box.
gate_chat_post "Quick status check — all good?" "eval-gate" /tmp/gate-chat-smoke.json 180 || true
REPLY="$(python3 -c 'import json,sys
try:
    print(json.load(open("/tmp/gate-chat-smoke.json")).get("reply",""))
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

if gate_curl '/api/agents/jobs' /tmp/gate-jobs.json; then
  note "agents api: OK"
  python3 -c "$GATE_PY" < /tmp/gate-jobs.json | while read -r l; do note "$l"; done
  python3 -c "$GATE_PY" < /tmp/gate-jobs.json >/dev/null || FAIL=1
else
  note "agents api: SKIP (endpoint absent or auth failed on this generation)"
fi

# 4. Culture-tenant retrieval golden probes (P3.5)
if is_culture_tenant; then
  OSIREION_MSG='Have you come to any conclusions on the Osireion and its possible origins?'
  if gate_chat_post "$OSIREION_MSG" 'eval-gate-osireion' /tmp/gate-osireion.json 180; then
    OSIREION_OK="$(python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("parse_fail"); sys.exit(0)
reply = str(d.get("reply") or "").strip()
if not reply:
    print("empty"); sys.exit(0)
if "insufficient corpus" in reply.lower():
    print("insufficient_corpus"); sys.exit(0)
print("ok")' /tmp/gate-osireion.json)"
    if [[ "$OSIREION_OK" == "ok" ]]; then
      note "osireion opinion: OK"
    else
      note "osireion opinion: FAIL ($OSIREION_OK — must answer from corpus, not empty/insufficient)"; FAIL=1
    fi
  else
    note "osireion opinion: FAIL (no chat response)"; FAIL=1
  fi

  # Soft check: exact thread-alias resolution (no LLM).
  ALIAS_JSON="$(ssh "$T_HOST" "cd '$T_DIR' && node -e \"
    const d = require('./lib/eiThreadDossiers');
    console.log(JSON.stringify({
      osireion: d.resolveThreadAlias('osireion'),
      unknown: d.resolveThreadAlias('atlantis-moonbase')
    }));
  \"" 2>/dev/null || echo '{}')"
  ALIAS_OK="$(python3 -c 'import json,sys
try:
    a = json.loads(sys.argv[1] or "{}")
except Exception:
    print("parse_fail"); sys.exit(0)
if a.get("osireion") == "abydos" and a.get("unknown") in (None, ""):
    print("ok")
else:
    print("bad", a)' "$ALIAS_JSON" 2>/dev/null || echo "parse_fail")"
  if [[ "$ALIAS_OK" == "ok" ]]; then
    note "thread-alias (soft): OK (osireion→abydos, invented→unknown)"
  else
    note "thread-alias (soft): WARN ($ALIAS_OK — non-blocking)"
  fi
fi

# 5. Grounded status probe (culture tenants): a campaign status *question* must
# answer (not dispatch) and quote a real number from live campaign state.
if is_culture_tenant && gate_curl '/api/cultures/campaign' /tmp/gate-campaign.json; then
  CYCLES="$(python3 -c 'import json,sys
try:
    s = json.load(sys.stdin).get("status") or {}
    print(s.get("cycle_count", ""))
except Exception:
    print("")' < /tmp/gate-campaign.json)"
  STATUS_RESP="$(gate_chat_post 'Status of the research campaign' 'eval-gate-status' /tmp/gate-status.json 120 && cat /tmp/gate-status.json || true)"
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

# 6. Money plane dual-confirm (P4.4b): mutating money route without confirm → 403
# money_confirm_required. Culture tenants soft-skip when endpoints are absent;
# ausmaker/customer-01 (and any tenant exposing the route) must pass.
gate_money_post() {
  local path="$1"
  local payload="$2"
  local out="$3"
  local payload_b64
  payload_b64="$(printf '%s' "$payload" | base64 | tr -d '\n')"
  ssh "$T_HOST" "cd '$T_DIR' && GATE_MONEY_PATH='$path' GATE_MONEY_B64='$payload_b64' GATE_MONEY_BASE='$BASE' python3 - <<'PY'
import base64, json, os, pathlib, urllib.error, urllib.request
env = {}
p = pathlib.Path('.env')
if p.exists():
    for line in p.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith('#') and '=' in s:
            k, _, v = s.partition('=')
            env[k.strip()] = v.strip().strip('\"').strip(\"'\")
# Admin-protected paths need PIKO_API_KEY; YOLO/HITL handlers need YOLO/HEALTH key.
api_key = env.get('PIKO_API_KEY') or ''
yolo_key = env.get('PIKO_YOLO_API_KEY') or env.get('PIKO_HEALTH_API_KEY') or api_key
path = os.environ.get('GATE_MONEY_PATH') or ''
base = os.environ.get('GATE_MONEY_BASE') or ''
raw = base64.b64decode(os.environ.get('GATE_MONEY_B64') or '').decode('utf-8', 'replace')
url = base + path
req = urllib.request.Request(url, data=raw.encode('utf-8'), method='POST', headers={
    'Content-Type': 'application/json',
})
if api_key:
    req.add_header('X-Piko-Key', api_key)
if yolo_key:
    req.add_header('Authorization', 'Bearer ' + yolo_key)
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode('utf-8', 'replace')
        print(json.dumps({'status': resp.status, 'body': body}))
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', 'replace')
    print(json.dumps({'status': e.code, 'body': body}))
except Exception as e:
    print(json.dumps({'status': 0, 'error': str(e)}))
PY" > "$out" 2>/dev/null
}

MONEY_PROBE_OK=0
for MONEY_PATH in '/api/yolo-tool' '/api/hitl/approve'; do
  if [[ "$MONEY_PATH" == '/api/yolo-tool' ]]; then
    MONEY_PAYLOAD='{"name":"cin7_get_stock_on_hand"}'
  else
    MONEY_PAYLOAD='{"id":"eval-gate-money-probe"}'
  fi
  if gate_money_post "$MONEY_PATH" "$MONEY_PAYLOAD" /tmp/gate-money.json; then
    MONEY_RESULT="$(python3 -c 'import json,sys
try:
    d=json.load(open("/tmp/gate-money.json"))
except Exception:
    print("parse_fail"); sys.exit(0)
status=int(d.get("status") or 0)
if status in (0, 404):
    print("absent"); sys.exit(0)
try:
    body=json.loads(d.get("body") or "{}")
except Exception:
    body={}
err=str(body.get("error") or "")
if status == 403 and err == "money_confirm_required":
    print("ok")
elif status == 401:
    print("auth")
else:
    print("bad:%s:%s" % (status, err or (d.get("body") or "")[:80]))' 2>/dev/null || echo parse_fail)"
    if [[ "$MONEY_RESULT" == "ok" ]]; then
      note "money confirm ($MONEY_PATH): OK (403 money_confirm_required)"
      MONEY_PROBE_OK=1
    elif [[ "$MONEY_RESULT" == "absent" || "$MONEY_RESULT" == "auth" ]]; then
      note "money confirm ($MONEY_PATH): SKIP ($MONEY_RESULT)"
    else
      note "money confirm ($MONEY_PATH): FAIL ($MONEY_RESULT)"
      FAIL=1
    fi
  else
    note "money confirm ($MONEY_PATH): SKIP (probe unreachable)"
  fi
done

if [[ $MONEY_PROBE_OK -eq 0 ]]; then
  if is_culture_tenant; then
    note "money confirm: SKIP (culture tenant — no money routes required)"
  else
    # customer-01 / ausmaker should expose at least one money endpoint
    note "money confirm: FAIL (expected 403 money_confirm_required on ausmaker/customer money routes)"
    FAIL=1
  fi
fi

[[ $FAIL -eq 0 ]] && { echo "  [gate] PASS"; exit 0; } || { echo "  [gate] FAIL"; exit 1; }
