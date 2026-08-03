const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectBusinessHealth } = require('../lib/proactive/events/businessHealth');
const { formatBusinessHealthReply } = require('../lib/proactive/analyst');
const { DEFAULT_CONTEXT_MAX_AGE_MS } = require('../lib/sharedContext');

function tmpDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-bh-'));
  return path.join(dir, 'data');
}

test('detectBusinessHealth skips when context is stale', async () => {
  const dataDir = tmpDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const staleAt = new Date(Date.now() - DEFAULT_CONTEXT_MAX_AGE_MS - 5000).toISOString();
  fs.writeFileSync(path.join(dataDir, 'ausmaker-context.json'), JSON.stringify({
    updatedAt: staleAt,
    capabilities: {
      'inventory.low_stock.scan': { result: { summary: 'x' }, updatedAt: staleAt },
    },
  }, null, 2));
  const out = await detectBusinessHealth({ dataDir, now: new Date() });
  assert.deepEqual(out, []);
});

test('formatBusinessHealthReply includes stale note', () => {
  const reply = formatBusinessHealthReply({
    action: 'none',
    reason: 'no_data',
    freshness: { fresh: false, ageHours: 30 },
  });
  assert.match(reply, /stale|No business metrics/i);
});
