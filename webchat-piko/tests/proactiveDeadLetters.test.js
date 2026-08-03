const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createProactiveEngine } = require('../lib/proactiveEngine');

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-proactive-deadletters-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function basePolicy() {
  return {
    mode: 'draft_only',
    thresholds: { draft: 0.65, auto: 0.85 },
    quietHours: { start: '23:00', end: '06:00', onlyHighUrgency: true, draftOnly: true, maxUrgentPerNight: 2 },
    limits: {
      perDay: 10,
      perHour: 10,
      perCategoryCooldownHours: 0,
      perThreadCooldownHours: 12,
      duplicateSuppressionHours: 0,
      ackCategorySuppressionHours: 2,
      backoffRule: '1h->6h->24h',
    },
    categories: {
      deadlineRisk: false,
      calendarConflicts: false,
      importantComms: true,
      healthNudges: false,
      projectGap: false,
      securityAlerts: false,
    },
    dispatch: {
      defaultChannels: ['telegram'],
      channelPriority: ['telegram', 'pending_file'],
      replayCooldownSec: 15,
      channelConfig: {
        telegram: { enabled: true, retryMax: 0, timeoutMs: 500 },
        pending_file: { enabled: false, retryMax: 0, timeoutMs: 500 },
      },
    },
  };
}

test('failed dispatch creates standardized dead-letter fields', async () => {
  const dataDir = makeDataDir();
  writeJson(path.join(dataDir, 'ea-alerts.json'), [{ at: Date.now(), category: 'gmail', title: 'Priority email' }]);
  const engine = createProactiveEngine({
    dataDir,
    loadPolicy: () => basePolicy(),
    loadIntents: () => [],
    sendTelegram: async () => {
      const err = new Error('telegram unavailable');
      err.code = 'TELEGRAM_DOWN';
      throw err;
    },
    appendPending: () => {},
    sendWebhook: async () => {},
    log: () => {},
  });

  await engine.runCycle({ source: 'test_dead_letter' });
  const out = engine.getDeadLetters(10);
  assert.equal(out.total, 1);
  const dl = out.deadLetters[0];
  assert.equal(dl.status, 'open');
  assert.equal(typeof dl.failureCode, 'string');
  assert.equal(typeof dl.failureMessage, 'string');
  assert.equal(Array.isArray(dl.failedChannels), true);
  assert.equal(typeof dl.firstFailedAt, 'string');
  assert.equal(typeof dl.lastFailedAt, 'string');
});

test('replayDelivery enforces replay cooldown guard', async () => {
  const dataDir = makeDataDir();
  const deliveriesFile = path.join(dataDir, 'proactive-deliveries.json');
  writeJson(deliveriesFile, [{
    id: 'pd_test_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'test',
    category: 'importantComms',
    urgency: 'normal',
    confidence: 0.8,
    mode: 'draft',
    dedupeKey: 'comms:test',
    channels: ['pending_file'],
    message: 'hello',
    status: 'failed',
    attempts: [],
    dispatch: null,
    replayCount: 0,
    ack: null,
    deadLetterId: null,
  }]);
  const engine = createProactiveEngine({
    dataDir,
    loadPolicy: () => {
      const p = basePolicy();
      p.dispatch.defaultChannels = ['pending_file'];
      p.dispatch.channelConfig.pending_file.enabled = true;
      p.dispatch.replayCooldownSec = 60;
      return p;
    },
    loadIntents: () => [],
    sendTelegram: async () => {},
    appendPending: () => {},
    sendWebhook: async () => {},
    log: () => {},
  });
  const first = await engine.replayDelivery('pd_test_1', 'test_replay');
  assert.equal(first.replayCount, 1);
  await assert.rejects(
    () => engine.replayDelivery('pd_test_1', 'test_replay'),
    (err) => err && err.code === 'REPLAY_COOLDOWN',
  );
});

test('replayDelivery rejects when replay already pending', async () => {
  const dataDir = makeDataDir();
  writeJson(path.join(dataDir, 'proactive-deliveries.json'), [{
    id: 'pd_test_2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'test',
    category: 'importantComms',
    urgency: 'normal',
    confidence: 0.8,
    mode: 'draft',
    dedupeKey: 'comms:test2',
    channels: ['pending_file'],
    message: 'hello',
    status: 'replay_pending',
    attempts: [],
    dispatch: null,
    replayCount: 0,
    ack: null,
    deadLetterId: null,
  }]);
  const engine = createProactiveEngine({
    dataDir,
    loadPolicy: () => basePolicy(),
    loadIntents: () => [],
    sendTelegram: async () => {},
    appendPending: () => {},
    sendWebhook: async () => {},
    log: () => {},
  });
  await assert.rejects(
    () => engine.replayDelivery('pd_test_2', 'test_replay'),
    (err) => err && err.code === 'REPLAY_IN_PROGRESS',
  );
});
