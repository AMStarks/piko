const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePolicy } = require('../lib/proactive/policyEvaluator');

function basePolicy() {
  return {
    thresholds: { draft: 0.65, auto: 0.85 },
    quietHours: {
      start: '23:00',
      end: '06:00',
      onlyHighUrgency: true,
      draftOnly: true,
      maxUrgentPerNight: 2,
    },
    limits: {
      perDay: 4,
      perHour: 1,
      perCategoryCooldownHours: 6,
      perThreadCooldownHours: 12,
      ackCategorySuppressionHours: 2,
      duplicateSuppressionHours: 24,
    },
  };
}

function baseRuntime() {
  return {
    deliveries: [],
    keyHistory: [],
    ackHistory: [],
  };
}

function baseCandidate() {
  return {
    eventType: 'importantComms',
    confidence: 0.8,
    urgency: 'normal',
    dedupeKey: 'comms:hello',
  };
}

test('suppresses duplicate dedupe key in suppression window', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.keyHistory.push({ key: 'comms:hello', at: now.getTime() - (10 * 60 * 1000) });
  const out = evaluatePolicy({ now, policy: basePolicy(), runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'suppressed_dedupe');
});

test('suppresses by category cooldown', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.keyHistory.push({ key: 'other:key', category: 'importantComms', at: now.getTime() - (30 * 60 * 1000) });
  const out = evaluatePolicy({ now, policy: basePolicy(), runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'suppressed_category_cooldown');
});

test('suppresses when rate limits exceeded', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.deliveries.push({ at: now.getTime() - 5 * 60 * 1000 });
  const out = evaluatePolicy({ now, policy: basePolicy(), runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'suppressed_rate_limit');
  assert.equal(out.limits.allowed, false);
});

test('suppresses low confidence candidate', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const candidate = { ...baseCandidate(), confidence: 0.4 };
  const out = evaluatePolicy({ now, policy: basePolicy(), runtime: baseRuntime(), candidate, urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'skipped_low_confidence');
});

test('quiet hours forces draft mode', () => {
  const now = new Date('2026-02-27T23:30:00');
  const candidate = { ...baseCandidate(), urgency: 'high' };
  const out = evaluatePolicy({ now, policy: basePolicy(), runtime: baseRuntime(), candidate, urgentSentThisRun: 0 });
  assert.equal(out.allowed, true);
  assert.equal(out.forceDraft, true);
  assert.equal(out.quietHoursActive, true);
});

test('zero category cooldown is respected (not treated as default)', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.keyHistory.push({ key: 'other:key', category: 'importantComms', at: now.getTime() - 1000 });
  const policy = basePolicy();
  policy.limits.perCategoryCooldownHours = 0;
  const out = evaluatePolicy({ now, policy, runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, true);
});

test('suppresses by ack thread window using perThreadCooldownHours', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.ackHistory.push({ key: 'comms:hello', category: 'importantComms', at: now.getTime() - (10 * 60 * 1000) });
  const policy = basePolicy();
  policy.limits.perThreadCooldownHours = 1;
  const out = evaluatePolicy({ now, policy, runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'suppressed_ack');
});

test('suppresses by ack category window', () => {
  const now = new Date('2026-02-27T12:00:00.000Z');
  const runtime = baseRuntime();
  runtime.ackHistory.push({ key: 'different:key', category: 'importantComms', at: now.getTime() - (20 * 60 * 1000) });
  const policy = basePolicy();
  policy.limits.perThreadCooldownHours = 0;
  policy.limits.ackCategorySuppressionHours = 1;
  const out = evaluatePolicy({ now, policy, runtime, candidate: baseCandidate(), urgentSentThisRun: 0 });
  assert.equal(out.allowed, false);
  assert.equal(out.decision, 'suppressed_ack_category');
});
