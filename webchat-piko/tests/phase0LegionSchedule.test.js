// WP6.4: schedule assertions use local Date helpers — pin TZ before any Date/intents use.
process.env.TZ = 'UTC';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadIntents,
  createIntent,
  nextDueFromSchedule,
  migrateIntents,
} = require('../lib/intents');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legion-schedule-'));
}

test('createIntent with type legion_scheduled and briefFields', () => {
  const dataDir = mkTmpDataDir();
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = dataDir;
  try {
    const before = loadIntents();
    const intent = createIntent({
      type: 'legion_scheduled',
      title: 'Low stock scan',
      description: 'Run daily low stock scan',
      dueAt: '2026-02-27T08:00:00.000Z',
      schedule: 'daily 08:00',
      briefFields: { objective: 'Run low stock scan', execution_mode: 'auto' },
      source: 'test',
    });
    assert.ok(intent.id);
    assert.equal(intent.type, 'legion_scheduled');
    assert.equal(intent.title, 'Low stock scan');
    assert.equal(intent.schedule, 'daily 08:00');
    assert.deepEqual(intent.briefFields, { objective: 'Run low stock scan', execution_mode: 'auto' });

    const after = loadIntents();
    assert.equal(after.length, before.length + 1);
    const found = after.find((i) => i.id === intent.id);
    assert.ok(found);
    assert.equal(found.type, 'legion_scheduled');
    assert.ok(found.briefFields);
  } finally {
    if (prev !== undefined) process.env.PIKO_DATA_DIR = prev;
    else delete process.env.PIKO_DATA_DIR;
  }
});

test('nextDueFromSchedule parses daily HH:MM', () => {
  const from = new Date('2026-02-27T06:00:00.000Z');
  const next = nextDueFromSchedule('daily 08:00', from);
  assert.ok(next);
  const d = new Date(next);
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 0);

  const from2 = new Date('2026-02-27T10:00:00.000Z');
  const next2 = nextDueFromSchedule('daily 08:00', from2);
  assert.ok(next2);
  const d2 = new Date(next2);
  assert.ok(d2 > from2);
  assert.equal(d2.getHours(), 8);
  assert.equal(d2.getMinutes(), 0);
});

// Hourly tests use TZ=UTC for deterministic results (schedule 06:00-23:00 = UTC)
test('nextDueFromSchedule - hourly inside window', () => {
  const base = new Date('2026-03-08T10:15:00.000Z');
  const next = nextDueFromSchedule('hourly 06:00-23:00', base);
  assert.ok(next);
  assert.strictEqual(next, '2026-03-08T11:00:00.000Z');
});

test('nextDueFromSchedule - hourly at slot boundary', () => {
  const base = new Date('2026-03-08T10:00:00.000Z');
  const next = nextDueFromSchedule('hourly 06:00-23:00', base);
  assert.ok(next);
  assert.strictEqual(next, '2026-03-08T11:00:00.000Z');
});

test('nextDueFromSchedule - hourly after window', () => {
  const base = new Date('2026-03-08T23:30:00.000Z');
  const next = nextDueFromSchedule('hourly 06:00-23:00', base);
  assert.ok(next);
  assert.strictEqual(next, '2026-03-09T06:00:00.000Z');
});

test('nextDueFromSchedule - hourly before window', () => {
  const base = new Date('2026-03-08T04:00:00.000Z');
  const next = nextDueFromSchedule('hourly 06:00-23:00', base);
  assert.ok(next);
  assert.strictEqual(next, '2026-03-08T06:00:00.000Z');
});

test('nextDueFromSchedule - cron weekdays at 5pm', () => {
  // 2026-02-26 Thu 10:00 UTC -> next weekday 5pm is Thu 17:00 same day (TZ=UTC)
  const base = new Date('2026-02-26T10:00:00.000Z');
  const next = nextDueFromSchedule('cron 0 17 * * 1-5', base);
  assert.ok(next);
  const d = new Date(next);
  assert.ok([1, 2, 3, 4, 5].includes(d.getDay()), 'next should be weekday');
  assert.equal(d.getHours(), 17, 'next should be 5pm');
  assert.strictEqual(next, '2026-02-26T17:00:00.000Z');
});

test('nextDueFromSchedule - cron first of month', () => {
  const base = new Date('2026-02-15T10:00:00.000Z');
  const next = nextDueFromSchedule('cron 0 9 1 * *', base);
  assert.ok(next);
  const d = new Date(next);
  assert.equal(d.getDate(), 1, 'next should be 1st');
  assert.equal(d.getMonth(), 2, 'next should be March');
  assert.equal(d.getHours(), 9, 'next should be 9am');
});

test('migrateIntents preserves legion_scheduled and briefFields', () => {
  const arr = [
    {
      id: 'x1',
      type: 'legion_scheduled',
      status: 'pending',
      title: 'Scan',
      briefFields: { objective: 'Low stock scan', execution_mode: 'auto' },
      schedule: 'daily 08:00',
    },
  ];
  const out = migrateIntents(arr);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'legion_scheduled');
  assert.deepEqual(out[0].briefFields, { objective: 'Low stock scan', execution_mode: 'auto' });
});
