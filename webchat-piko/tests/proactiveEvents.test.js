const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { detectDeadlineRisk } = require('../lib/proactive/events/deadline');
const { detectCalendarConflicts } = require('../lib/proactive/events/calendarConflicts');
const { detectImportantComms } = require('../lib/proactive/events/importantComms');
const { detectProjectGap } = require('../lib/proactive/events/projectGap');
const { detectSecurityAlerts } = require('../lib/proactive/events/securityAlerts');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-proactive-events-'));
}

test('deadline detector emits due-soon pending intents', () => {
  const now = new Date('2026-02-27T10:00:00Z');
  const intents = [
    { id: 1, status: 'pending', title: 'Submit summary', dueAt: '2026-02-27T14:00:00Z' },
    { id: 2, status: 'done', title: 'Ignore', dueAt: '2026-02-27T12:00:00Z' },
  ];
  const out = detectDeadlineRisk({ intents, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'deadlineRisk');
  assert.equal(out[0].signalSource, 'deadline.js');
});

test('calendar conflict detector reports overlap in next 24h', () => {
  const dataDir = makeTempDir();
  const now = new Date('2026-02-27T10:00:00Z');
  fs.writeFileSync(path.join(dataDir, 'calendar-snapshot.json'), JSON.stringify({
    events: [
      { title: 'A', start: '2026-02-27T12:00:00Z', end: '2026-02-27T13:00:00Z' },
      { title: 'B', start: '2026-02-27T12:30:00Z', end: '2026-02-27T13:30:00Z' },
    ],
  }), 'utf8');
  const out = detectCalendarConflicts({ dataDir, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'calendarConflicts');
  assert.equal(out[0].signalSource, 'calendarConflicts.js');
});

test('important comms detector finds recent email alerts', () => {
  const dataDir = makeTempDir();
  const now = new Date('2026-02-27T10:00:00Z');
  fs.writeFileSync(path.join(dataDir, 'ea-alerts.json'), JSON.stringify([
    { at: now.getTime() - 10 * 60 * 1000, category: 'gmail', title: 'Owner email' },
  ]), 'utf8');
  const out = detectImportantComms({ dataDir, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'importantComms');
  assert.equal(out[0].signalSource, 'importantComms.js');
});

test('project gap detector triggers on aging pending backlog', () => {
  const now = new Date('2026-02-27T10:00:00Z');
  const intents = Array.from({ length: 6 }).map((_, i) => ({
    id: i + 1,
    status: 'pending',
    createdAt: '2026-02-20T10:00:00Z',
  }));
  const out = detectProjectGap({ intents, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'projectGap');
  assert.equal(out[0].signalSource, 'projectGap.js');
});

test('security alerts detector finds high severity recent alert', () => {
  const dataDir = makeTempDir();
  const now = new Date('2026-02-27T10:00:00Z');
  fs.writeFileSync(path.join(dataDir, 'ea-alerts.json'), JSON.stringify([
    { at: now.getTime() - 5 * 60 * 1000, severity: 'high', title: 'Auth anomaly' },
  ]), 'utf8');
  const out = detectSecurityAlerts({ dataDir, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'securityAlerts');
  assert.equal(out[0].signalSource, 'securityAlerts.js');
});
