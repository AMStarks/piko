const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePolicy, DEFAULT_POLICY } = require('../lib/proactivePolicy');

test('normalizePolicy fills new dispatch/escalation defaults for legacy payload', () => {
  const legacy = {
    mode: 'draft_only',
    thresholds: { draft: 0.7, auto: 0.9 },
    quietHours: { start: '22:00', end: '06:00' },
    limits: { perDay: 4, perHour: 1 },
    categories: { deadlineRisk: true },
  };
  const out = normalizePolicy(legacy, { stampNow: false });
  assert.deepEqual(out.dispatch.defaultChannels, DEFAULT_POLICY.dispatch.defaultChannels);
  assert.ok(out.dispatch.channelConfig.telegram);
  assert.equal(out.dispatch.channelConfig.telegram.enabled, true);
  assert.equal(out.escalation.repeatThreshold, DEFAULT_POLICY.escalation.repeatThreshold);
  assert.equal(out.limits.ackCategorySuppressionHours, DEFAULT_POLICY.limits.ackCategorySuppressionHours);
  assert.ok(Array.isArray(out.escalation.ladder.high));
});

test('normalizePolicy clamps dispatch and escalation values', () => {
  const out = normalizePolicy({
    dispatch: {
      defaultChannels: ['telegram', '', 'pending_file'],
      channelPriority: ['telegram', 'webhook'],
      channelConfig: {
        telegram: { enabled: true, retryMax: 99, timeoutMs: 5 },
      },
    },
    escalation: {
      repeatThreshold: 10,
      criticalThreshold: 2,
      ladder: {
        low: [],
      },
    },
  }, { stampNow: false });
  assert.deepEqual(out.dispatch.defaultChannels, ['telegram', 'pending_file']);
  assert.equal(out.dispatch.channelConfig.telegram.retryMax, 10);
  assert.equal(out.dispatch.channelConfig.telegram.timeoutMs, 500);
  assert.equal(out.escalation.repeatThreshold, 10);
  assert.equal(out.escalation.criticalThreshold, 10);
  assert.ok(out.escalation.ladder.low.length > 0);
});
