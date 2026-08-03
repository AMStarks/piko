const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createProactiveEngine } = require('../lib/proactiveEngine');

function makeEngineWithData(events, runtime) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-proactive-status-'));
  fs.writeFileSync(path.join(dataDir, 'proactive-events.json'), JSON.stringify(events, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'proactive-runtime.json'), JSON.stringify(runtime || {
    deliveries: [],
    keyHistory: [],
    ackHistory: [],
    escalation: {},
    lastRunAt: null,
    lastSummary: null,
  }, null, 2), 'utf8');
  return createProactiveEngine({
    dataDir,
    loadPolicy: () => ({ mode: 'draft_only', categories: {} }),
    loadIntents: () => [],
    sendTelegram: async () => ({ ok: true }),
    appendPending: async () => ({ ok: true }),
    sendWebhook: async () => ({ ok: true }),
    log: () => {},
  });
}

test('getStatus applies status/type/since filters', () => {
  const events = [
    { at: '2026-02-27T10:00:00.000Z', category: 'deadlineRisk', status: 'draft_ready' },
    { at: '2026-02-27T11:00:00.000Z', category: 'projectGap', status: 'suppressed' },
    { at: '2026-02-27T12:00:00.000Z', category: 'deadlineRisk', status: 'failed' },
  ];
  const engine = makeEngineWithData(events);
  const out = engine.getStatus({
    limit: 50,
    status: 'suppressed',
    type: 'projectGap',
    since: '2026-02-27T10:30:00.000Z',
  });
  assert.equal(out.total, 1);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].category, 'projectGap');
  assert.equal(out.events[0].status, 'suppressed');
  assert.equal(out.filters.status, 'suppressed');
  assert.equal(out.filters.type, 'projectgap');
});

test('getStatus supports since as unix epoch milliseconds', () => {
  const events = [
    { at: '2026-02-27T10:00:00.000Z', category: 'deadlineRisk', status: 'draft_ready' },
    { at: '2026-02-27T12:00:00.000Z', category: 'deadlineRisk', status: 'failed' },
  ];
  const sinceMs = Date.parse('2026-02-27T11:00:00.000Z');
  const engine = makeEngineWithData(events);
  const out = engine.getStatus({ limit: 50, since: String(sinceMs) });
  assert.equal(out.total, 1);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].status, 'failed');
});
