const test = require('node:test');
const assert = require('node:assert/strict');
const { createDispatcher } = require('../lib/proactive/dispatch');

test('dispatcher retries per channel config and succeeds on retry', async () => {
  let telegramCalls = 0;
  const dispatcher = createDispatcher({
    sendTelegram: async () => {
      telegramCalls += 1;
      if (telegramCalls === 1) {
        const err = new Error('temporary fail');
        err.code = 'TEMP_DOWN';
        throw err;
      }
    },
    appendPending: () => {},
    sendWebhook: async () => {},
    retryBaseMs: 1,
    jitterRatio: 0,
    random: () => 0,
  });
  const out = await dispatcher.dispatchWithRetry({
    channels: ['telegram'],
    message: 'hello',
    urgency: 'normal',
    channelConfig: {
      telegram: { enabled: true, retryMax: 1, timeoutMs: 2000 },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.retryUsed, true);
  assert.equal(telegramCalls, 2);
  assert.ok(out.attempts.length >= 2);
});

test('dispatcher adds deterministic failure envelope when all channels fail', async () => {
  const dispatcher = createDispatcher({
    sendTelegram: async () => {
      const err = new Error('permanent fail');
      err.code = 'PERM_FAIL';
      throw err;
    },
    appendPending: () => {},
    sendWebhook: async () => {},
    retryBaseMs: 1,
    jitterRatio: 0,
    random: () => 0,
  });
  const out = await dispatcher.dispatchWithRetry({
    channels: ['telegram'],
    message: 'hello',
    urgency: 'normal',
    fallbackToPending: false,
    channelConfig: {
      telegram: { enabled: true, retryMax: 0, timeoutMs: 2000 },
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.failure.code, 'DISPATCH_ALL_CHANNELS_FAILED');
  assert.equal(Array.isArray(out.failure.failedChannels), true);
  assert.equal(out.failure.failedChannels.length, 1);
});

test('dispatcher enforces per-channel timeout wrapper', async () => {
  const dispatcher = createDispatcher({
    sendTelegram: async () => new Promise(() => {}),
    appendPending: () => {},
    sendWebhook: async () => {},
    retryBaseMs: 1,
    jitterRatio: 0,
    random: () => 0,
  });
  const out = await dispatcher.dispatchWithRetry({
    channels: ['telegram'],
    message: 'hello',
    urgency: 'normal',
    fallbackToPending: false,
    channelConfig: {
      telegram: { enabled: true, retryMax: 0, timeoutMs: 500 },
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.attempts[0].errorCode, 'DISPATCH_TIMEOUT');
});

test('dispatcher falls back to pending_file when primary channels fail', async () => {
  const pending = [];
  const dispatcher = createDispatcher({
    sendTelegram: async () => {
      const err = new Error('telegram down');
      err.code = 'TELEGRAM_DOWN';
      throw err;
    },
    appendPending: (msg) => pending.push(msg),
    sendWebhook: async () => {},
    retryBaseMs: 1,
    jitterRatio: 0,
    random: () => 0,
  });
  const out = await dispatcher.dispatchWithRetry({
    channels: ['telegram'],
    message: 'fallback me',
    urgency: 'normal',
    channelConfig: {
      telegram: { enabled: true, retryMax: 0, timeoutMs: 2000 },
      pending_file: { enabled: true, retryMax: 0, timeoutMs: 2000 },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(pending.length, 1);
  const fallbackAttempt = out.attempts.find((a) => a.channel === 'pending_file');
  assert.ok(fallbackAttempt);
  assert.equal(fallbackAttempt.fallback, true);
});

test('dispatcher routes webhook:target channels to sendWebhook target', async () => {
  let seenTarget = '';
  const dispatcher = createDispatcher({
    sendTelegram: async () => {},
    appendPending: () => {},
    sendWebhook: async (_message, meta) => { seenTarget = meta && meta.target ? meta.target : ''; },
    retryBaseMs: 1,
    jitterRatio: 0,
    random: () => 0,
  });
  const out = await dispatcher.dispatchWithRetry({
    channels: ['webhook:custom_ops'],
    message: 'webhook test',
    urgency: 'high',
    channelConfig: {
      'webhook:custom_ops': { enabled: true, retryMax: 0, timeoutMs: 2000 },
    },
    fallbackToPending: false,
  });
  assert.equal(out.ok, true);
  assert.equal(seenTarget, 'custom_ops');
});
