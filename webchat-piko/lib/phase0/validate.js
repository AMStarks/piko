function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

const {
  PHASE0_CONTRACT_VERSION,
  PHASE0_TASK_EVENT_TYPES,
  PHASE0_DECISION_REQUEST_TYPES,
  PHASE0_COMMAND_TYPES,
  PHASE0_RISK_LEVELS,
} = require('./contract');

function requireFields(payload, fields) {
  const missing = [];
  for (const f of fields) {
    if (!isNonEmptyString(payload && payload[f])) missing.push(f);
  }
  return missing;
}

function validateContractVersion(payload) {
  if (!payload || payload.contract_version == null) return { ok: true };
  if (payload.contract_version !== PHASE0_CONTRACT_VERSION) {
    return { ok: false, error: `Unsupported contract_version: ${String(payload.contract_version)}` };
  }
  return { ok: true };
}

function validateEventPayload(payload) {
  const missing = requireFields(payload, [
    'event_id',
    'trace_id',
    'occurred_at',
    'legion_id',
    'user_id',
    'task_id',
    'type',
    'summary',
  ]);
  if (missing.length) return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  if (!PHASE0_TASK_EVENT_TYPES.includes(payload.type)) {
    return { ok: false, error: `Unsupported event type: ${String(payload.type)}` };
  }
  const contractVersion = validateContractVersion(payload);
  if (!contractVersion.ok) return contractVersion;
  return { ok: true };
}

function validateDecisionRequestPayload(payload) {
  const missing = requireFields(payload, [
    'trace_id',
    'legion_id',
    'user_id',
    'task_id',
    'decision_type',
  ]);
  if (missing.length) return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  if (!PHASE0_DECISION_REQUEST_TYPES.includes(payload.decision_type)) {
    return { ok: false, error: `Unsupported decision_type: ${String(payload.decision_type)}` };
  }
  if (!payload || typeof payload.proposal !== 'object') return { ok: false, error: 'Missing proposal object' };
  if (!isNonEmptyString(payload.proposal.action)) return { ok: false, error: 'proposal.action is required' };
  if (!isNonEmptyString(payload.proposal.risk_level)) return { ok: false, error: 'proposal.risk_level is required' };
  if (!PHASE0_RISK_LEVELS.includes(payload.proposal.risk_level)) {
    return { ok: false, error: `Unsupported proposal.risk_level: ${String(payload.proposal.risk_level)}` };
  }
  const contractVersion = validateContractVersion(payload);
  if (!contractVersion.ok) return contractVersion;
  return { ok: true };
}

function validateCommandPayload(payload) {
  const missing = requireFields(payload, [
    'command_id',
    'trace_id',
    'legion_id',
    'user_id',
    'type',
  ]);
  if (missing.length) return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  if (!PHASE0_COMMAND_TYPES.includes(payload.type)) {
    return { ok: false, error: `Unsupported command type: ${String(payload.type)}` };
  }
  const contractVersion = validateContractVersion(payload);
  if (!contractVersion.ok) return contractVersion;
  return { ok: true };
}

module.exports = {
  validateEventPayload,
  validateDecisionRequestPayload,
  validateCommandPayload,
};
