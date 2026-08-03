const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  inferCapabilityFromObjective,
  inferCapabilityFromObjectiveAsync,
  loadCapabilityConfig,
  clearConfigCache,
  clearLLMCache,
  DEFAULT_CAPABILITIES,
} = require('../lib/legionCapabilities');

test('inferCapabilityFromObjective maps load recent data to ausmaker.runbook.execute', () => {
  clearConfigCache();
  const cap = inferCapabilityFromObjective({ objective: 'Load Recent Data' });
  assert.equal(cap, 'ausmaker.runbook.execute');
});

test('inferCapabilityFromObjective maps low stock to inventory.low_stock.scan', () => {
  clearConfigCache();
  assert.equal(inferCapabilityFromObjective({ objective: 'low stock scan' }), 'inventory.low_stock.scan');
  assert.equal(inferCapabilityFromObjective({ objective: 'check products' }), 'inventory.low_stock.scan');
});

test('inferCapabilityFromObjective maps purchase order to purchase_order.draft.create', () => {
  clearConfigCache();
  assert.equal(inferCapabilityFromObjective({ objective: 'draft purchase order' }), 'purchase_order.draft.create');
  assert.equal(inferCapabilityFromObjective({ objective: 'prep order sheet' }), 'purchase_order.draft.create');
});

test('inferCapabilityFromObjective returns empty for unknown objective', () => {
  clearConfigCache();
  assert.equal(inferCapabilityFromObjective({ objective: 'water the plants' }), '');
});

test('loadCapabilityConfig uses override from dataDir when present', () => {
  clearConfigCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legion-cap-'));
  const overridePath = path.join(tmp, 'legion-capabilities.json');
  fs.writeFileSync(overridePath, JSON.stringify({
    'custom.capability': ['custom task'],
  }), 'utf8');
  const config = loadCapabilityConfig(tmp);
  assert.ok(config['custom.capability']);
  assert.deepEqual(config['custom.capability'], ['custom task']);
  fs.unlinkSync(overridePath);
  fs.rmdirSync(tmp);
});

test('inferCapabilityFromObjective uses shipped config when no override', () => {
  clearConfigCache();
  const cap = inferCapabilityFromObjective({ objective: 'sync data' });
  assert.equal(cap, 'ausmaker.runbook.execute');
});

test('inferCapabilityFromObjective keeps sales analysis separate from sync', () => {
  clearConfigCache();
  const cap = inferCapabilityFromObjective({ objective: 'run sales analysis report' });
  assert.equal(cap, 'sales.analysis.run');
});

// Phase 3: async inference — keyword path matches sync when PIKO_LLM_CAPABILITY_INFERENCE is not set
test('inferCapabilityFromObjectiveAsync returns same as sync for keyword matches', async () => {
  clearConfigCache();
  clearLLMCache();
  const orig = process.env.PIKO_LLM_CAPABILITY_INFERENCE;
  delete process.env.PIKO_LLM_CAPABILITY_INFERENCE;
  try {
    const cap = await inferCapabilityFromObjectiveAsync({ objective: 'low stock scan' });
    assert.equal(cap, 'inventory.low_stock.scan');
    const cap2 = await inferCapabilityFromObjectiveAsync({ objective: 'draft purchase order' });
    assert.equal(cap2, 'purchase_order.draft.create');
    const cap3 = await inferCapabilityFromObjectiveAsync({ objective: 'water the plants' });
    assert.equal(cap3, '');
  } finally {
    if (orig !== undefined) process.env.PIKO_LLM_CAPABILITY_INFERENCE = orig;
  }
});
