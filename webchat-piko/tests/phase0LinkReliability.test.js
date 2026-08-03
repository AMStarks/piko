const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  canSend,
  recordSuccess,
  recordFailure,
  getSnapshot,
} = require('../lib/phase0/linkReliability');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-link-'));
}

test('link reliability opens circuit after threshold failures', () => {
  const dataDir = mkTmpDataDir();
  process.env.LEGION_LINK_CIRCUIT_FAIL_THRESHOLD = '2';
  process.env.LEGION_LINK_CIRCUIT_COOLDOWN_SEC = '30';

  assert.equal(canSend(dataDir).ok, true);
  recordFailure(dataDir, 'fail 1', 1000);
  assert.equal(canSend(dataDir, 1001).ok, true);
  recordFailure(dataDir, 'fail 2', 2000);
  const gate = canSend(dataDir, 2001);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'CIRCUIT_OPEN');

  delete process.env.LEGION_LINK_CIRCUIT_FAIL_THRESHOLD;
  delete process.env.LEGION_LINK_CIRCUIT_COOLDOWN_SEC;
});

test('link reliability closes on success', () => {
  const dataDir = mkTmpDataDir();
  process.env.LEGION_LINK_CIRCUIT_FAIL_THRESHOLD = '1';
  process.env.LEGION_LINK_CIRCUIT_COOLDOWN_SEC = '30';
  recordFailure(dataDir, 'fail', 1000);
  assert.equal(canSend(dataDir, 1001).ok, false);
  recordSuccess(dataDir, 2000);
  const snap = getSnapshot(dataDir, 2001);
  assert.equal(snap.circuitOpen, false);
  assert.equal(snap.consecutiveFailures, 0);
  assert.equal(snap.totalSuccess, 1);
  delete process.env.LEGION_LINK_CIRCUIT_FAIL_THRESHOLD;
  delete process.env.LEGION_LINK_CIRCUIT_COOLDOWN_SEC;
});
