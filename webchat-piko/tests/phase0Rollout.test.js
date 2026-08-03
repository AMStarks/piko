const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { loadRollout, saveRollout, canExecuteProductionAction } = require('../lib/phase0/rollout');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-rollout-'));
}

test('rollout defaults to shadow and blocks execution', () => {
  const dataDir = mkTmpDataDir();
  const state = loadRollout(dataDir);
  assert.equal(state.stage, 'shadow');
  assert.equal(state.trafficPercent, 0);
  const gate = canExecuteProductionAction(state);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'ROLLOUT_SHADOW');
});

test('rollout canary with traffic allows execution', () => {
  const dataDir = mkTmpDataDir();
  const saved = saveRollout(dataDir, { stage: 'canary', trafficPercent: 25 });
  assert.equal(saved.stage, 'canary');
  assert.equal(saved.trafficPercent, 25);
  const gate = canExecuteProductionAction(saved);
  assert.equal(gate.ok, true);
});

test('emergency rollback forces block regardless of stage', () => {
  const gate = canExecuteProductionAction({ stage: 'full', trafficPercent: 100, emergencyRollback: true });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'EMERGENCY_ROLLBACK');
});
