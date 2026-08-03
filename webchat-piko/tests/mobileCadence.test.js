const test = require('node:test');
const assert = require('node:assert/strict');

const { decideMobilePoll } = require('../lib/mobileCadence');

test('uses fast cadence when next reminder exists', () => {
  const out = decideMobilePoll({
    intentSnapshot: { nextReminder: { at: new Date().toISOString() }, queueLength: 0, scheduledCount: 0 },
    serviceHealth: { modelReachable: true },
  });
  assert.equal(out.pollAfterSec, 60);
  assert.equal(out.urgency, 'high');
  assert.equal(out.degraded, false);
});

test('backs off under constrained background device conditions', () => {
  const out = decideMobilePoll({
    intentSnapshot: { queueLength: 0, scheduledCount: 0, nextReminder: null },
    device: {
      networkConstrained: true,
      appState: 'background',
      batteryLevel: 0.1,
    },
    serviceHealth: { modelReachable: true },
  });
  assert.equal(out.pollAfterSec >= 900, true);
  assert.equal(out.degraded, true);
  assert.equal(out.degradedReasons.includes('network_constrained'), true);
  assert.equal(out.degradedReasons.includes('low_battery_background'), true);
});

test('backs off when model is unreachable', () => {
  const out = decideMobilePoll({
    intentSnapshot: { queueLength: 2, nextReminder: null, scheduledCount: 0 },
    serviceHealth: { modelReachable: false },
  });
  assert.equal(out.pollAfterSec >= 600, true);
  assert.equal(out.degradedReasons.includes('llm_unreachable'), true);
});

