const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENT_TYPES,
  EVENT_STATUSES,
  SUPPRESSION_REASONS,
  normalizeSignal,
  normalizeCandidate,
  toLifecycleStatus,
  toSuppressionReason,
} = require('../lib/proactive/contracts');

test('contracts expose expected enums', () => {
  assert.ok(EVENT_TYPES.includes('deadlineRisk'));
  assert.ok(EVENT_TYPES.includes('securityAlerts'));
  assert.ok(EVENT_STATUSES.includes('draft_ready'));
  assert.ok(SUPPRESSION_REASONS.includes('duplicate'));
});

test('normalizeSignal coerces invalid input to defaults', () => {
  const signal = normalizeSignal({ source: 'bad.js', eventType: 'bad_type', payload: 7 });
  assert.equal(signal.source, 'deadline.js');
  assert.equal(signal.eventType, 'projectGap');
  assert.deepEqual(signal.payload, {});
  assert.ok(signal.observedAt.length > 0);
});

test('normalizeCandidate sanitizes and lowercases dedupe key', () => {
  const candidate = normalizeCandidate({
    category: 'deadlineRisk',
    confidence: 3,
    urgency: 'high',
    subject: '  Ship invoice reminders  ',
    dedupeKey: 'DEADLINE:INVOICE',
    reason: 'pending intent due within 48 hours',
    signalSource: 'deadline.js',
  });
  assert.equal(candidate.eventType, 'deadlineRisk');
  assert.equal(candidate.confidence, 1);
  assert.equal(candidate.urgency, 'high');
  assert.equal(candidate.subject, 'Ship invoice reminders');
  assert.equal(candidate.dedupeKey, 'deadline:invoice');
});

test('decision to status/suppression reason mapping is deterministic', () => {
  assert.equal(toLifecycleStatus('suppressed_dedupe'), 'suppressed');
  assert.equal(toSuppressionReason('suppressed_dedupe'), 'duplicate');
  assert.equal(toLifecycleStatus('suppressed_ack_category'), 'suppressed');
  assert.equal(toSuppressionReason('suppressed_ack_category'), 'cooldown');
  assert.equal(toLifecycleStatus('drafted'), 'draft_ready');
  assert.equal(toSuppressionReason('drafted'), '');
  assert.equal(toLifecycleStatus('delivery_failed'), 'failed');
});
