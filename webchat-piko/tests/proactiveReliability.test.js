const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createProactiveEngine } = require('../lib/proactiveEngine');

function makeEngineWithData(deliveries, deadLetters) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-proactive-reliability-'));
  fs.writeFileSync(path.join(dataDir, 'proactive-deliveries.json'), JSON.stringify(deliveries, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'proactive-dead-letters.json'), JSON.stringify(deadLetters, null, 2), 'utf8');
  return createProactiveEngine({
    dataDir,
    loadPolicy: () => ({ mode: 'draft_only', categories: {}, dispatch: { defaultChannels: ['pending_file'], channelConfig: {} } }),
    loadIntents: () => [],
    sendTelegram: async () => {},
    appendPending: () => {},
    sendWebhook: async () => {},
    log: () => {},
  });
}

test('getReliabilityMetrics computes rates and per-channel stats', () => {
  const now = Date.now();
  const iso = (deltaMs) => new Date(now - deltaMs).toISOString();
  const deliveries = [
    {
      createdAt: iso(1000),
      status: 'sent',
      retryUsed: false,
      attempts: [{ channel: 'telegram', ok: true }],
    },
    {
      createdAt: iso(2000),
      status: 'acknowledged',
      retryUsed: true,
      attempts: [
        { channel: 'telegram', ok: false },
        { channel: 'telegram', ok: true },
      ],
    },
    {
      createdAt: iso(3000),
      status: 'failed',
      retryUsed: false,
      attempts: [{ channel: 'webhook', ok: false }],
    },
  ];
  const deadLetters = [{ createdAt: iso(2500), status: 'open' }];
  const engine = makeEngineWithData(deliveries, deadLetters);
  const out = engine.getReliabilityMetrics({ sinceHours: 24 });
  assert.equal(out.totalDeliveries, 3);
  assert.equal(out.totalDeadLetters, 1);
  assert.equal(out.retryRate > 0, true);
  assert.equal(out.ackRate > 0, true);
  assert.equal(out.deadLetterRate > 0, true);
  assert.equal(out.byChannel.telegram.attempts, 3);
  assert.equal(out.byChannel.webhook.attempts, 1);
  assert.equal(out.repeatThreshold, 3);
  assert.equal(out.repeatedDedupeCount, 0);
});

test('getReliabilityMetrics flags repeated dedupe keys above threshold', () => {
  const now = Date.now();
  const iso = (deltaMs) => new Date(now - deltaMs).toISOString();
  const deliveries = [
    { createdAt: iso(1000), status: 'sent', dedupeKey: 'alpha', category: 'importantComms', attempts: [] },
    { createdAt: iso(2000), status: 'sent', dedupeKey: 'alpha', category: 'importantComms', attempts: [] },
    { createdAt: iso(3000), status: 'sent', dedupeKey: 'alpha', category: 'importantComms', attempts: [] },
    { createdAt: iso(4000), status: 'sent', dedupeKey: 'beta', category: 'deadlineRisk', attempts: [] },
  ];
  const engine = makeEngineWithData(deliveries, []);
  const out = engine.getReliabilityMetrics({ sinceHours: 24, repeatThreshold: 3 });
  assert.equal(out.repeatedDedupeCount, 1);
  assert.equal(Array.isArray(out.repeatedDedupeAlerts), true);
  assert.equal(out.repeatedDedupeAlerts[0].dedupeKey, 'alpha');
  assert.equal(out.repeatedDedupeAlerts[0].count, 3);
});
