const { isPhase0LegionEnabled, isAuthorized, isAllowedOrigin } = require('../phase0/auth');
const { readExisting, storeResult } = require('../phase0/idempotency');
const { PHASE0_CONTRACT_VERSION } = require('../phase0/contract');
const { validateEventPayload } = require('../phase0/validate');

function errorEnvelope(code, message, retryable) {
  return { ok: false, error: { code, message, retryable } };
}

async function handleLegateEventsRoute(req, res, pathname, deps = {}) {
  if (req.method !== 'POST' || pathname !== '/api/legate/events') return false;
  const startedAt = Date.now();
  let observedTraceId = '';
  const finish = (status, payload, outcome, errorCode) => {
    if (typeof deps.observe === 'function') {
      deps.observe({
        route: '/api/legate/events',
        status,
        latencyMs: Date.now() - startedAt,
        outcome: outcome || '',
        errorCode: errorCode || '',
        trace_id: observedTraceId || (payload && payload.trace && payload.trace.trace_id ? payload.trace.trace_id : '') || (payload && payload.trace_id ? payload.trace_id : ''),
      });
    }
    return deps.send(res, status, JSON.stringify(payload));
  };
  if (!isPhase0LegionEnabled()) return finish(404, { ok: false, error: 'Not enabled' }, 'disabled');
  if (!isAuthorized(req)) return finish(401, errorEnvelope('UNAUTHORIZED', 'Missing or invalid token', false), 'auth_failed', 'UNAUTHORIZED');
  if (!isAllowedOrigin(req)) return finish(403, errorEnvelope('FORBIDDEN_ORIGIN', 'Origin not allowed', false), 'origin_blocked', 'FORBIDDEN_ORIGIN');

  const idempotencyKey = String((req.headers && req.headers['idempotency-key']) || '').trim();
  if (!idempotencyKey) return finish(400, errorEnvelope('INVALID_PAYLOAD', 'Missing Idempotency-Key header', false), 'invalid_payload', 'INVALID_PAYLOAD');
  const existing = readExisting(deps.dataDir, idempotencyKey);
  if (existing) return finish(200, { ...existing, idempotent_replay: true }, 'idempotent_replay');

  let parsed = {};
  try {
    parsed = JSON.parse((await deps.readBody(req)) || '{}');
  } catch (_) {
    return finish(400, errorEnvelope('INVALID_PAYLOAD', 'Invalid JSON body', false), 'invalid_json', 'INVALID_PAYLOAD');
  }
  observedTraceId = String(parsed && parsed.trace_id || '');
  const valid = validateEventPayload(parsed);
  if (!valid.ok) return finish(400, errorEnvelope('INVALID_PAYLOAD', valid.error, false), 'invalid_payload', 'INVALID_PAYLOAD');

  const out = {
    ok: true,
    accepted: true,
    contract_version: PHASE0_CONTRACT_VERSION,
    decision_ref: `dec_${Date.now()}`,
    delivery_plan: {
      notify_user: true,
      urgency: parsed.severity || 'normal',
      channels: String(process.env.PIKO_LEGION_DEFAULT_CHANNELS || 'telegram,pending_file')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
  storeResult(deps.dataDir, idempotencyKey, out);
  deps.log('info', 'phase0_legate_event', {
    trace_id: parsed.trace_id,
    event_id: parsed.event_id,
    task_id: parsed.task_id,
    legion_id: parsed.legion_id,
    user_id: parsed.user_id,
    type: parsed.type,
  }, req.requestId);
  return finish(200, out, 'accepted');
}

module.exports = {
  handleLegateEventsRoute,
};
