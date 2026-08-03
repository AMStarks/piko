const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveDeliveryMode } = require('../lib/proactiveEngine');
const { normalizePolicy } = require('../lib/proactivePolicy');

test('categoryModes hybrid auto-delivers businessHealth at high confidence while global draft_only', () => {
  const policy = normalizePolicy({
    mode: 'draft_only',
    categoryModes: { businessHealth: 'hybrid', deadlineRisk: 'hybrid' },
    thresholds: { draft: 0.65, auto: 0.85 },
  }, { stampNow: false });
  assert.equal(resolveDeliveryMode(policy, 'businessHealth', 0.9, false), 'auto');
  assert.equal(resolveDeliveryMode(policy, 'deadlineRisk', 0.9, false), 'auto');
  assert.equal(resolveDeliveryMode(policy, 'projectGap', 0.9, false), 'draft');
  assert.equal(resolveDeliveryMode(policy, 'businessHealth', 0.7, false), 'draft');
  assert.equal(resolveDeliveryMode(policy, 'businessHealth', 0.9, true), 'draft');
});

test('normalizePolicy preserves categoryModes', () => {
  const out = normalizePolicy({
    categoryModes: { businessHealth: 'hybrid', bogus: 'nope' },
  }, { stampNow: false });
  assert.deepEqual(out.categoryModes, { businessHealth: 'hybrid' });
});
