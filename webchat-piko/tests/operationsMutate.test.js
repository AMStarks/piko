const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseOperationsMutateIntent,
  executeOperationsMutation,
  isOperationsMutateIntent,
} = require('../lib/operationsMutate');
const { tryConfirm, setPending } = require('../lib/operationsMutatePending');
const { isJobEnabled } = require('../lib/operationsOverrides');

test('parses disable intent poller', () => {
  const intent = parseOperationsMutateIntent('Disable intent poller');
  assert.ok(intent);
  assert.equal(intent.jobId, 'intent-poller');
  assert.equal(intent.enabled, false);
});

test('does not steal proactive updates from config mutate', () => {
  assert.equal(isOperationsMutateIntent('Turn off proactive updates'), false);
});

test('apply override via confirm', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ops-mutate-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  try {
    const intent = parseOperationsMutateIntent('Disable nightly wisdom');
    setPending('sess-ops', intent);
    const applied = tryConfirm('sess-ops', 'yes');
    assert.equal(applied.route, 'operations_mutate_applied');
    assert.equal(isJobEnabled('nightly-wisdom'), false);
    const result = executeOperationsMutation({
      type: 'operations_toggle',
      jobId: 'nightly-wisdom',
      jobName: 'nightly-wisdom',
      enabled: true,
      toggleType: 'override',
      source: 'node-cron',
    });
    assert.equal(result.ok, true);
    assert.equal(isJobEnabled('nightly-wisdom'), true);
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
