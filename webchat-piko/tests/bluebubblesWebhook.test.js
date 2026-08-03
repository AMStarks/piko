const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  assertWebhookSecret,
  resolveWebhookBind,
} = require(path.join(__dirname, '..', '..', 'adapters', 'bluebubbles', 'server.js'));

test('WP1.7: bluebubbles requires webhook secret by default', () => {
  assert.throws(() => assertWebhookSecret({}), /BLUEBUBBLES_WEBHOOK_SECRET/);
  assert.equal(assertWebhookSecret({ BLUEBUBBLES_WEBHOOK_SECRET: 's3cret' }), 's3cret');
  assert.equal(assertWebhookSecret({ PIKO_WEBHOOK_SECRET: 'alt' }), 'alt');
  assert.equal(assertWebhookSecret({ BLUEBUBBLES_WEBHOOK_INSECURE: '1' }), '');
});

test('WP1.7: bluebubbles default bind is loopback', () => {
  assert.equal(resolveWebhookBind({}), '127.0.0.1');
  assert.equal(resolveWebhookBind({ BLUEBUBBLES_WEBHOOK_BIND: '0.0.0.0' }), '0.0.0.0');
});
