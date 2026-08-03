const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('appendOutcome + recentOutcomes + lookup summary', () => {
  const prev = process.env.PIKO_DATA_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-out-'));
  process.env.PIKO_DATA_DIR = tmp;
  delete require.cache[require.resolve('../lib/eiOutcomeLedger')];
  try {
    const {
      appendOutcome,
      recentOutcomes,
      outcomeSummaryForLookup,
      formatOutcomesForProposer,
    } = require('../lib/eiOutcomeLedger');
    assert.equal(appendOutcome({ id: 'eifix_1', outcome: 'applied', subject: 'seed A' }).ok, true);
    assert.equal(appendOutcome({ id: 'eifix_2', outcome: 'bridge_failed', subject: 'brief B', detail: 'tests_failed' }).ok, true);
    const rows = recentOutcomes(10);
    assert.equal(rows.length, 2);
    const summary = outcomeSummaryForLookup(10);
    assert.equal(summary.ok, true);
    assert.match(summary.line, /failed/i);
    assert.match(formatOutcomesForProposer(5), /bridge_failed|applied/);
  } finally {
    if (prev == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/eiOutcomeLedger')];
  }
});
