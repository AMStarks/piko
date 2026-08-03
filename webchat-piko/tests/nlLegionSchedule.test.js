const test = require('node:test');
const assert = require('node:assert/strict');
const { tryParseLegionScheduleFromNL, to24Hour } = require('../lib/nlLegionSchedule');

test('to24Hour converts am/pm', () => {
  assert.equal(to24Hour(6, 0, 'am'), '06:00');
  assert.equal(to24Hour(6, 0, 'pm'), '18:00');
  assert.equal(to24Hour(12, 0, 'pm'), '12:00');
});

test('parses daily schedule without explicit time', () => {
  const parsed = tryParseLegionScheduleFromNL(
    'Please schedule a daily update that tells me how many units were sold today.',
  );
  assert.ok(parsed);
  assert.equal(parsed.schedule, 'daily 08:00');
  assert.match(parsed.objective, /daily units sold update/i);
});

test('parses daily at explicit time', () => {
  const parsed = tryParseLegionScheduleFromNL('Schedule a low stock scan every day at 9am');
  assert.ok(parsed);
  assert.equal(parsed.schedule, 'daily 09:00');
  assert.match(parsed.objective, /low stock scan/i);
});

test('parses hourly window', () => {
  const parsed = tryParseLegionScheduleFromNL(
    'Run load recent data every hour between 6am and 11pm',
  );
  assert.ok(parsed);
  assert.equal(parsed.schedule, 'hourly 06:00-23:00');
});

test('ignores cancel/list phrasing', () => {
  assert.equal(tryParseLegionScheduleFromNL('Cancel my daily schedule'), null);
  assert.equal(tryParseLegionScheduleFromNL('What is scheduled today?'), null);
});

test('ignores explain questions about queued jobs', () => {
  assert.equal(
    tryParseLegionScheduleFromNL('Can you explain what smoke low stock scan (daily 08:00) is?'),
    null,
  );
  assert.equal(tryParseLegionScheduleFromNL('What is sales sync daily at 06:00?'), null);
});

test('ignores slash commands', () => {
  assert.equal(tryParseLegionScheduleFromNL('/legion schedule daily 08:00 scan'), null);
});

test('parses check stock daily at time without schedule keyword', () => {
  const parsed = tryParseLegionScheduleFromNL(
    'check stock level for AL-VULC-RED-1-80-180 daily at 12pm',
  );
  assert.ok(parsed);
  assert.equal(parsed.schedule, 'daily 12:00');
  assert.match(parsed.objective, /AL-VULC-RED-1-80-180|stock/i);
});
