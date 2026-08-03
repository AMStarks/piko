const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  buildLegionCommandFromDecision,
  executeDecisionAction,
  replayDecisionActionDeadLetter,
} = require('../lib/phase0/decisionActions');
const { listDeadLetters } = require('../lib/phase0/actionDeadLetters');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-action-'));
}

test('buildLegionCommandFromDecision maps approve_execution to approve_task', () => {
  const cmd = buildLegionCommandFromDecision({
    trace_id: 'trc_12345678',
    task_id: '123',
    legion_id: '1',
    user_id: 'default-user',
    decision_type: 'approve_execution',
    action_route: 'auto_execute',
  });
  assert.ok(cmd);
  assert.equal(cmd.type, 'approve_task');
  assert.equal(cmd.task_id, '123');
});

test('buildLegionCommandFromDecision returns null when not auto route', () => {
  const cmd = buildLegionCommandFromDecision({
    trace_id: 'trc_12345678',
    task_id: '123',
    legion_id: '1',
    user_id: 'default-user',
    decision_type: 'approve_execution',
    action_route: 'human_review',
  });
  assert.equal(cmd, null);
});

test('executeDecisionAction sends command via dependency', async () => {
  let called = null;
  const out = await executeDecisionAction({
    trace_id: 'trc_12345678',
    task_id: '123',
    legion_id: '1',
    user_id: 'default-user',
    decision_type: 'approve_execution',
    action_route: 'auto_execute',
  }, {
    sendLegionCommand: async (cmd) => {
      called = cmd;
      return { ok: true, accepted: true };
    },
  });
  assert.ok(called);
  assert.equal(called.type, 'approve_task');
  assert.equal(out.attempted, true);
  assert.equal(out.status, 'sent');
});

test('executeDecisionAction writes dead letter on send failure', async () => {
  const dataDir = mkTmpDataDir();
  const out = await executeDecisionAction({
    trace_id: 'trc_99999999',
    task_id: '123',
    legion_id: '1',
    user_id: 'default-user',
    decision_type: 'approve_execution',
    action_route: 'auto_execute',
  }, {
    dataDir,
    sendLegionCommand: async () => {
      const err = new Error('downstream unavailable');
      err.code = 'DOWNSTREAM_UNAVAILABLE';
      throw err;
    },
  });
  assert.equal(out.status, 'failed');
  assert.ok(out.deadLetterId);
  const dead = listDeadLetters(dataDir, { limit: 10 });
  assert.equal(dead.length, 1);
  assert.equal(dead[0].id, out.deadLetterId);
  assert.equal(dead[0].status, 'open');
});

test('replayDecisionActionDeadLetter resolves dead letter on success', async () => {
  const dataDir = mkTmpDataDir();
  const failed = await executeDecisionAction({
    trace_id: 'trc_88888888',
    task_id: '123',
    legion_id: '1',
    user_id: 'default-user',
    decision_type: 'approve_execution',
    action_route: 'auto_execute',
  }, {
    dataDir,
    sendLegionCommand: async () => {
      throw new Error('initial failure');
    },
  });
  assert.equal(failed.status, 'failed');
  const replay = await replayDecisionActionDeadLetter(failed.deadLetterId, {
    dataDir,
    sendLegionCommand: async () => ({ ok: true, accepted: true }),
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.deadLetter.status, 'resolved');
});
