const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseLegionScheduleMutateIntent,
  executeLegionScheduleMutation,
  formatLegionScheduleMutateConfirm,
} = require('../lib/legionScheduleMutate');
const { tryConfirm, setPending } = require('../lib/legionScheduleMutatePending');

function withTempIntents(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legion-mutate-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  const intents = [
    {
      id: 'intent_test_6',
      type: 'legion_scheduled',
      status: 'pending',
      task_id: 6,
      schedule: 'daily 09:00',
      dueAt: '2026-06-11T09:00:00.000Z',
      title: 'low stock scan',
      briefFields: { objective: 'low stock scan' },
    },
  ];
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'intents.json'), JSON.stringify(intents, null, 2));
  try {
    return fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('parses reschedule by Task #N', () => {
  withTempIntents(() => {
    const intent = parseLegionScheduleMutateIntent('Move Task #6 to 10am');
    assert.ok(intent);
    assert.equal(intent.type, 'legion_schedule_reschedule');
    assert.equal(intent.task_id, 6);
    assert.equal(intent.schedule, 'daily 10:00');
  });
});

test('parses cancel by Task #N', () => {
  withTempIntents(() => {
    const intent = parseLegionScheduleMutateIntent('Cancel Task #6');
    assert.ok(intent);
    assert.equal(intent.type, 'legion_schedule_cancel');
    assert.equal(intent.task_id, 6);
  });
});

test('confirm and apply reschedule', () => {
  withTempIntents((tmp) => {
    const parsed = parseLegionScheduleMutateIntent('Reschedule Task #6 to 10am');
    assert.match(formatLegionScheduleMutateConfirm(parsed), /YES to confirm/i);
    setPending('sess-1', parsed);
    const applied = tryConfirm('sess-1', 'yes');
    assert.equal(applied.route, 'legion_schedule_mutate_applied');
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'intents.json'), 'utf8'));
    const row = raw.find((i) => i.id === 'intent_test_6');
    assert.equal(row.schedule, 'daily 10:00');
    assert.ok(row.dueAt);
  });
});

test('permission questions are not legion mutate', () => {
  withTempIntents(() => {
    assert.equal(parseLegionScheduleMutateIntent('Am I able to move Task #6?'), null);
  });
});
