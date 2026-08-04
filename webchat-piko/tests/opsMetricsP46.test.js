const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  snapshot,
  recordPlaneDenied,
  recordSessionForbidden,
  recordSchedulerRun,
  recordChatTurn,
  _resetForTests,
} = require('../lib/opsMetrics');
const { evaluateAndNotify } = require('../lib/opsThresholdAlarms');

describe('P4.6 ops metrics floor', () => {
  beforeEach(() => { _resetForTests(); });

  it('snapshot includes scheduler, worker, denials, secrets fields', () => {
    recordPlaneDenied();
    recordSessionForbidden();
    recordSchedulerRun({ id: 'nightly_wisdom', ok: false, error: 'boom' });
    recordChatTurn({ latency_ms: 100, ok: true });
    const s = snapshot();
    assert.equal(s.ok, true);
    assert.ok(s.scheduler);
    assert.equal(s.scheduler.failures_by_id.nightly_wisdom, 1);
    assert.ok(s.worker);
    assert.equal(typeof s.worker.pending, 'number');
    assert.equal(typeof s.worker.drain, 'boolean');
    assert.ok(s.denials);
    assert.equal(s.denials.plane_denied, 1);
    assert.equal(s.denials.session_forbidden, 1);
    assert.ok(s.secrets);
    assert.ok('api_key_age_s' in s.secrets);
  });

  it('threshold evaluator returns structure without throwing', async () => {
    const out = await evaluateAndNotify({
      thresholds: { queueStuckSec: 1, jobFailureStreak: 99, chatP95Ms: 1, cooldownMs: 0 },
    });
    assert.equal(out.ok, true);
    assert.ok(typeof out.evaluated === 'number');
    assert.ok(Array.isArray(out.fired));
  });
});
