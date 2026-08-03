const test = require('node:test');
const assert = require('node:assert/strict');

const { toWidgetPayload, toLiveActivityPayload, toIosDashboardPayload } = require('../lib/mobileContracts');

test('widget payload applies defaults for empty input', () => {
  const out = toWidgetPayload(null, {});
  assert.equal(out.ok, true);
  assert.equal(typeof out.contractVersion, 'string');
  assert.equal(out.tensions, 0);
  assert.equal(out.nextReminder, null);
  assert.equal(out.moltbook, null);
  assert.equal(typeof out.generatedAt, 'string');
  assert.equal(typeof out.refreshAfterSec, 'number');
});

test('live activity payload normalizes partial input', () => {
  const out = toLiveActivityPayload({ status: 'hello', queueLength: '4' }, { generatedAt: 'bad', refreshAfterSec: 10 });
  assert.equal(out.ok, true);
  assert.equal(out.status, 'hello');
  assert.equal(out.queueLength, 4);
  assert.equal(out.remindersCount, 0);
  assert.equal(out.refreshAfterSec >= 30, true);
  assert.equal(typeof out.expiresAt, 'string');
});

test('ios dashboard payload keeps stable shape for partial input', () => {
  const out = toIosDashboardPayload({ learning: { tensionsCount: 2 }, contextHint: 'x' }, { refreshAfterSec: 120 });
  assert.equal(out.ok, true);
  assert.equal(out.learning.tensionsCount, 2);
  assert.equal(out.learning.stickyCount, 0);
  assert.equal(out.calendarTodayCount, 0);
  assert.equal(out.remindersPendingCount, 0);
  assert.equal(out.contextHint, 'x');
});

