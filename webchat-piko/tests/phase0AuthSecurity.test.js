const test = require('node:test');
const assert = require('node:assert/strict');

const { isAuthorized, getAcceptedTokens } = require('../lib/phase0/auth');

function reqWithToken(token) {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : '',
    },
  };
}

test('phase0 auth accepts primary and next keys', () => {
  process.env.PIKO_LEGION_API_KEY = 'primary_key';
  process.env.PIKO_LEGION_API_KEY_NEXT = 'next_key';
  const accepted = getAcceptedTokens();
  assert.equal(accepted.includes('primary_key'), true);
  assert.equal(accepted.includes('next_key'), true);
  assert.equal(isAuthorized(reqWithToken('primary_key')), true);
  assert.equal(isAuthorized(reqWithToken('next_key')), true);
  assert.equal(isAuthorized(reqWithToken('wrong_key')), false);
  delete process.env.PIKO_LEGION_API_KEY;
  delete process.env.PIKO_LEGION_API_KEY_NEXT;
});
