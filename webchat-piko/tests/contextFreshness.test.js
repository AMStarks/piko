const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  saveLegionResult,
  getContextFreshness,
  isContextFresh,
  getCapabilityFreshness,
  DEFAULT_CONTEXT_MAX_AGE_MS,
} = require('../lib/sharedContext');

function tmpDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ctx-'));
  return path.join(dir, 'data');
}

test('getContextFreshness reports fresh context and per-capability source', () => {
  const dataDir = tmpDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  saveLegionResult(dataDir, 'inventory.low_stock.scan', { summary: 'ok' }, { source: 'scheduled' });
  const f = getContextFreshness(dataDir);
  assert.equal(f.hasData, true);
  assert.equal(f.fresh, true);
  assert.equal(f.capabilities['inventory.low_stock.scan'].source, 'scheduled');
  assert.equal(f.capabilities['inventory.low_stock.scan'].fresh, true);
  assert.equal(isContextFresh(dataDir), true);
  assert.equal(getCapabilityFreshness(dataDir, 'inventory.low_stock.scan').fresh, true);
  assert.equal(getCapabilityFreshness(dataDir, 'missing.cap').hasData, false);
});

test('stale context when updatedAt older than max age', () => {
  const dataDir = tmpDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const staleAt = new Date(Date.now() - DEFAULT_CONTEXT_MAX_AGE_MS - 1000).toISOString();
  fs.writeFileSync(path.join(dataDir, 'ausmaker-context.json'), JSON.stringify({
    updatedAt: staleAt,
    capabilities: {
      'sales.analysis.run': { result: { summary: 'old' }, updatedAt: staleAt, source: 'scheduled' },
    },
  }, null, 2));
  const f = getContextFreshness(dataDir);
  assert.equal(f.fresh, false);
  assert.equal(isContextFresh(dataDir), false);
});
