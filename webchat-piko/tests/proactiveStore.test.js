const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createProactiveStore } = require('../lib/proactive/store');

function makeStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-proactive-store-'));
  return createProactiveStore(dataDir, {
    maxEvents: 3,
    maxHistory: 2,
    maxDeliveries: 3,
    maxDeadLetters: 3,
  });
}

test('store trims event and delivery history by configured limits', () => {
  const store = makeStore();
  const events = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const deliveries = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  store.saveEvents(events);
  store.saveDeliveries(deliveries);
  assert.deepEqual(store.loadEvents().map((e) => e.id), [2, 3, 4]);
  assert.deepEqual(store.loadDeliveries().map((d) => d.id), [2, 3, 4]);
});

test('store normalizes and trims runtime structures', () => {
  const store = makeStore();
  const runtime = {
    deliveries: [{ id: 1 }, { id: 2 }, { id: 3 }],
    keyHistory: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    ackHistory: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    escalation: { a: 1, b: 2, c: 3 },
    lastRunAt: 'x',
    lastSummary: { ok: true },
  };
  store.saveRuntime(runtime);
  const loaded = store.loadRuntime();
  assert.equal(loaded.deliveries.length, 2);
  assert.equal(loaded.keyHistory.length, 2);
  assert.equal(loaded.ackHistory.length, 2);
  assert.equal(Object.keys(loaded.escalation).length, 2);
});
