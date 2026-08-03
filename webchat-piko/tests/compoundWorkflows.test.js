const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchCompoundWorkflow,
  synthesizeWorkflowReply,
  WORKFLOWS,
} = require('../lib/compoundWorkflows');

test('sync_stock_order matches acceptance phrase', () => {
  const msg = 'Sync sales, check stock, tell me what needs ordering';
  const wf = matchCompoundWorkflow(msg);
  assert.ok(wf);
  assert.equal(wf.id, 'sync_stock_order');
  assert.equal(wf.steps.length, 2);
});

test('morning_ops and weekly_review match', () => {
  assert.equal(matchCompoundWorkflow('run morning ops')?.id, 'morning_ops');
  assert.equal(matchCompoundWorkflow('weekly business review')?.id, 'weekly_review');
});

test('sku_deep_dive requires sku', () => {
  assert.equal(matchCompoundWorkflow('deep dive forecast for SKU ABC-123')?.id, 'sku_deep_dive');
  assert.equal(matchCompoundWorkflow('deep dive forecast'), null);
});

test('synthesizeWorkflowReply joins steps into one message', () => {
  const reply = synthesizeWorkflowReply('sync_stock_order', 'sync stock', [
    { ok: true, summary: 'Sales sync started.' },
    { ok: true, summary: '3 SKUs need reorder.' },
  ]);
  assert.match(reply, /ordering picture/i);
  assert.match(reply, /Sales sync/);
  assert.match(reply, /3 SKUs/);
});

test('workflow registry has expected ids', () => {
  const ids = WORKFLOWS.map((w) => w.id);
  assert.ok(ids.includes('sync_stock_order'));
  assert.ok(ids.includes('morning_ops'));
  assert.ok(ids.includes('weekly_review'));
  assert.ok(ids.includes('sku_deep_dive'));
});
