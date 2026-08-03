const { isPhase0LegionEnabled, isAuthorized, isAllowedOrigin } = require('../phase0/auth');
const { readExisting, storeResult } = require('../phase0/idempotency');
const { appendDecision } = require('../phase0/decisionLedger');
const { executeDecisionAction } = require('../phase0/decisionActions');
const { PHASE0_CONTRACT_VERSION } = require('../phase0/contract');
const { validateDecisionRequestPayload } = require('../phase0/validate');
const { loadPolicy: loadProactivePolicy } = require('../proactivePolicy');

function errorEnvelope(code, message, retryable) {
  return { ok: false, error: { code, message, retryable } };
}

function pickDecision(payload, policyMode) {
  if (policyMode === 'off') return 'reject';
  const risk = String(payload?.proposal?.risk_level || '').toLowerCase();
  if (risk === 'high') return 'needs_input';
  if (policyMode === 'draft_only') return 'needs_input';
  return 'approve';
}

function toActionRoute(decision) {
  if (decision === 'approve') return 'auto_execute';
  if (decision === 'needs_input') return 'human_review';
  return 'blocked';
}

async function handleLegateDecisionRequestRoute(req, res, pathname, deps = {}) {
  if (req.method !== 'POST' || pathname !== '/api/legate/decision-request') return false;
  const startedAt = Date.now();
  const finish = (status, payload, outcome, errorCode) => {
    if (typeof deps.observe === 'function') {
      deps.observe({
        route: '/api/legate/decision-request',
        status,
        latencyMs: Date.now() - startedAt,
        outcome: outcome || '',
        errorCode: errorCode || '',
        trace_id: payload && payload.trace && payload.trace.trace_id ? payload.trace.trace_id : '',
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
  const valid = validateDecisionRequestPayload(parsed);
  if (!valid.ok) return finish(400, errorEnvelope('INVALID_PAYLOAD', valid.error, false), 'invalid_payload', 'INVALID_PAYLOAD');

  const policy = deps.loadPolicy ? deps.loadPolicy() : loadProactivePolicy();
  const policyMode = String((policy && policy.mode) || 'draft_only');
  const decision = pickDecision(parsed, policyMode);
  const out = {
    ok: true,
    contract_version: PHASE0_CONTRACT_VERSION,
    decision,
    reason: decision === 'needs_input'
      ? 'High-risk action requires human confirmation.'
      : decision === 'reject'
        ? 'Current policy mode blocks autonomous decision execution.'
      : 'Action is aligned with current constraints.',
    constraints: {
      require_artifact_summary: true,
      max_runtime_sec: 900,
      policy_mode: policyMode,
      action_route: toActionRoute(decision),
    },
    trace: {
      trace_id: parsed.trace_id,
      task_id: parsed.task_id,
      legion_id: parsed.legion_id,
      user_id: parsed.user_id,
    },
  };
  const autoExecuteEnabled = String(process.env.PIKO_PHASEC_AUTO_EXECUTE_DECISIONS || '').trim() === '1';
  const shouldAutoExecute = out.constraints.action_route === 'auto_execute' && autoExecuteEnabled;
  if (shouldAutoExecute) {
    try {
      const execution = await (deps.executeDecisionAction || executeDecisionAction)({
        trace_id: parsed.trace_id,
        task_id: parsed.task_id,
        legion_id: parsed.legion_id,
        user_id: parsed.user_id,
        decision_type: parsed.decision_type,
        action_route: out.constraints.action_route,
      }, {
        sendLegionCommand: deps.sendLegionCommand,
        dataDir: deps.dataDir,
      });
      out.execution = execution;
    } catch (e) {
      out.execution = {
        attempted: true,
        status: 'failed',
        reason: e && e.message ? e.message : 'AUTO_EXECUTION_FAILED',
      };
    }
  } else {
    out.execution = {
      attempted: false,
      status: 'skipped',
      reason: autoExecuteEnabled ? 'NON_AUTO_ROUTE' : 'AUTO_EXECUTE_DISABLED',
    };
  }
  appendDecision(deps.dataDir, {
    at: new Date().toISOString(),
    requestId: req.requestId || '',
    trace_id: parsed.trace_id,
    task_id: parsed.task_id,
    legion_id: parsed.legion_id,
    user_id: parsed.user_id,
    decision_type: parsed.decision_type,
    risk_level: String(parsed?.proposal?.risk_level || '').toLowerCase(),
    policy_mode: policyMode,
    decision,
    action_route: out.constraints.action_route,
    execution_status: out.execution && out.execution.status ? out.execution.status : '',
    execution_command_type: out.execution && out.execution.commandType ? out.execution.commandType : '',
  });
  storeResult(deps.dataDir, idempotencyKey, out);
  deps.log('info', 'phase0_legate_decision_request', {
    trace_id: parsed.trace_id,
    task_id: parsed.task_id,
    legion_id: parsed.legion_id,
    user_id: parsed.user_id,
    decision_type: parsed.decision_type,
    decision,
  }, req.requestId);
  return finish(200, out, 'decision_returned');
}

module.exports = {
  handleLegateDecisionRequestRoute,
};
