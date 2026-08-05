const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { telegramNotify } = require('../lib/telegramNotify');

describe('P6.4 telegramNotify extract', () => {
  it('exports a function that returns a thenable', async () => {
    assert.equal(typeof telegramNotify, 'function');
    // Without Telegram creds, notifyAdmin still returns a result shape.
    const r = await telegramNotify('p6 extract ping', { category: 'system', skipTelegram: true });
    assert.ok(r);
    assert.ok('statusCode' in r || 'telegram' in r || 'feed' in r);
  });
});
