const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  nextReconnectDelayMs,
  decideReconnect,
  BACKOFF_CAP_MS,
  LOGGED_OUT,
} = require(path.join(__dirname, '..', '..', 'adapters', 'whatsapp', 'reconnect.js'));

test('WP6.2 WhatsApp reconnect backoff doubles then caps at 5 min', () => {
  assert.equal(nextReconnectDelayMs(0), 1000);
  assert.equal(nextReconnectDelayMs(1), 2000);
  assert.equal(nextReconnectDelayMs(2), 4000);
  assert.equal(nextReconnectDelayMs(3), 8000);
  assert.equal(nextReconnectDelayMs(9), BACKOFF_CAP_MS);
  assert.equal(nextReconnectDelayMs(20), BACKOFF_CAP_MS);
  assert.equal(BACKOFF_CAP_MS, 5 * 60 * 1000);
});

test('WP6.2 logout exits for re-auth; other closes reconnect', () => {
  const loggedOut = decideReconnect({ error: { output: { statusCode: LOGGED_OUT } } }, 0);
  assert.equal(loggedOut.action, 'exit_reauth');

  const transient = decideReconnect({ error: { output: { statusCode: 408 } } }, 2);
  assert.equal(transient.action, 'reconnect');
  assert.equal(transient.delayMs, 4000);
});
