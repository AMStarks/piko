const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { handleLegateEventsRoute } = require('../lib/routes/legateEvents');
const { handleLegateDecisionRequestRoute } = require('../lib/routes/legateDecisionRequest');
const {
  validateDecisionRequestPayload,
  validateEventPayload,
  validateCommandPayload,
} = require('../lib/phase0/validate');
const { listDecisions } = require('../lib/phase0/decisionLedger');
const { PHASE0_CONTRACT_VERSION } = require('../lib/phase0/contract');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-contract-'));
}

function mkDeps(dataDir, payload) {
  return {
    dataDir,
    readBody: async () => JSON.stringify(payload),
    send: (res, status, body) => {
      res.statusCode = status;
      res.body = body;
      return true;
    },
    log: () => {},
  };
}

test('phase0 validate helpers enforce enum and contract version', () => {
  const event = {
    event_id: 'evt_a',
    trace_id: 'trace_12345',
    occurred_at: new Date().toISOString(),
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    type: 'task_started',
    summary: 'ok',
    contract_version: PHASE0_CONTRACT_VERSION,
  };
  assert.equal(validateEventPayload(event).ok, true);
  assert.equal(validateEventPayload({ ...event, type: 'not_supported' }).ok, false);
  assert.equal(validateEventPayload({ ...event, contract_version: 'phase0.v2' }).ok, false);

  const decision = {
    trace_id: 'trace_12345',
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    decision_type: 'execute',
    proposal: { action: 'run', risk_level: 'low' },
    contract_version: PHASE0_CONTRACT_VERSION,
  };
  assert.equal(validateDecisionRequestPayload(decision).ok, true);
  assert.equal(validateDecisionRequestPayload({ ...decision, decision_type: 'ship_it' }).ok, false);
  assert.equal(validateDecisionRequestPayload({ ...decision, proposal: { action: 'run', risk_level: 'severe' } }).ok, false);

  const command = {
    command_id: 'cmd_1',
    trace_id: 'trace_12345',
    legion_id: '1',
    user_id: 'u1',
    type: 'pause_legion',
    contract_version: PHASE0_CONTRACT_VERSION,
  };
  assert.equal(validateCommandPayload(command).ok, true);
  assert.equal(validateCommandPayload({ ...command, type: 'pause_everything' }).ok, false);
});

test('legate events response includes contract version and idempotent replay', async () => {
  process.env.PIKO_LEGION_ENABLED = '1';
  process.env.PIKO_LEGION_API_KEY = 'test-key';

  const dataDir = mkTmpDataDir();
  const payload = {
    event_id: 'evt_abc',
    trace_id: 'trace_12345',
    occurred_at: new Date().toISOString(),
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    type: 'task_started',
    summary: 'task started',
  };
  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      'idempotency-key': 'idem_phase0_events_1',
    },
    requestId: 'req_phase0_events_1',
  };

  const res1 = {};
  await handleLegateEventsRoute(req, res1, '/api/legate/events', mkDeps(dataDir, payload));
  assert.equal(res1.statusCode, 200);
  const first = JSON.parse(res1.body);
  assert.equal(first.ok, true);
  assert.equal(first.contract_version, PHASE0_CONTRACT_VERSION);

  const res2 = {};
  await handleLegateEventsRoute(req, res2, '/api/legate/events', mkDeps(dataDir, payload));
  assert.equal(res2.statusCode, 200);
  const replay = JSON.parse(res2.body);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.contract_version, PHASE0_CONTRACT_VERSION);
});

test('decision request response includes contract version and rejects unsupported decision type', async () => {
  process.env.PIKO_LEGION_ENABLED = '1';
  process.env.PIKO_LEGION_API_KEY = 'test-key';

  const dataDir = mkTmpDataDir();
  const goodReq = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      'idempotency-key': 'idem_phase0_decision_1',
    },
    requestId: 'req_phase0_decision_1',
  };

  const goodPayload = {
    trace_id: 'trace_12345',
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    decision_type: 'approve_execution',
    proposal: { action: 'run', risk_level: 'low' },
  };
  const res1 = {};
  await handleLegateDecisionRequestRoute(goodReq, res1, '/api/legate/decision-request', mkDeps(dataDir, goodPayload));
  assert.equal(res1.statusCode, 200);
  const first = JSON.parse(res1.body);
  assert.equal(first.ok, true);
  assert.equal(first.contract_version, PHASE0_CONTRACT_VERSION);
  assert.equal(first.constraints.policy_mode, 'draft_only');
  assert.equal(first.constraints.action_route, 'human_review');
  assert.equal(first.decision, 'needs_input');
  assert.equal(first.execution.status, 'skipped');

  const badReq = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      'idempotency-key': 'idem_phase0_decision_2',
    },
    requestId: 'req_phase0_decision_2',
  };
  const badPayload = {
    trace_id: 'trace_12345',
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    decision_type: 'unknown_action',
    proposal: { action: 'run', risk_level: 'low' },
  };
  const res2 = {};
  await handleLegateDecisionRequestRoute(badReq, res2, '/api/legate/decision-request', mkDeps(dataDir, badPayload));
  assert.equal(res2.statusCode, 400);
  const bad = JSON.parse(res2.body);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'INVALID_PAYLOAD');
});

test('decision routing is policy-aware and persisted to decision ledger', async () => {
  process.env.PIKO_LEGION_ENABLED = '1';
  process.env.PIKO_LEGION_API_KEY = 'test-key';

  const dataDir = mkTmpDataDir();
  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      'idempotency-key': 'idem_phase0_decision_3',
    },
    requestId: 'req_phase0_decision_3',
  };
  const payload = {
    trace_id: 'trace_zz99999',
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    decision_type: 'approve_execution',
    proposal: { action: 'run', risk_level: 'low' },
  };
  const res = {};
  await handleLegateDecisionRequestRoute(req, res, '/api/legate/decision-request', {
    ...mkDeps(dataDir, payload),
    loadPolicy: () => ({ mode: 'full_auto' }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.decision, 'approve');
  assert.equal(body.constraints.policy_mode, 'full_auto');
  assert.equal(body.constraints.action_route, 'auto_execute');
  assert.equal(body.execution.status, 'skipped');

  const rows = listDecisions(dataDir, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trace_id, payload.trace_id);
  assert.equal(rows[0].decision, 'approve');
  assert.equal(rows[0].policy_mode, 'full_auto');
});

test('decision route attempts auto execution when enabled', async () => {
  process.env.PIKO_LEGION_ENABLED = '1';
  process.env.PIKO_LEGION_API_KEY = 'test-key';
  process.env.PIKO_PHASEC_AUTO_EXECUTE_DECISIONS = '1';

  const dataDir = mkTmpDataDir();
  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-key',
      'idempotency-key': 'idem_phase0_decision_4',
    },
    requestId: 'req_phase0_decision_4',
  };
  const payload = {
    trace_id: 'trace_autoexec_1',
    legion_id: '1',
    user_id: 'u1',
    task_id: 't1',
    decision_type: 'approve_execution',
    proposal: { action: 'run', risk_level: 'low' },
  };
  const res = {};
  await handleLegateDecisionRequestRoute(req, res, '/api/legate/decision-request', {
    ...mkDeps(dataDir, payload),
    loadPolicy: () => ({ mode: 'full_auto' }),
    executeDecisionAction: async () => ({ attempted: true, status: 'sent', commandType: 'approve_task' }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.execution.status, 'sent');

  const rows = listDecisions(dataDir, 10);
  assert.equal(rows[0].execution_status, 'sent');

  delete process.env.PIKO_PHASEC_AUTO_EXECUTE_DECISIONS;
});
