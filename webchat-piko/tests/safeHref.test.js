const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeChatHref } = require('../lib/safeHref');

test('WP1.5: allowlist http(s) and relative paths; reject javascript/data', () => {
  assert.equal(isSafeChatHref('https://example.com/a'), true);
  assert.equal(isSafeChatHref('http://example.com'), true);
  assert.equal(isSafeChatHref('/api/exports/foo.csv'), true);
  assert.equal(isSafeChatHref('/piko-ei/ios-dashboard'), true);
  assert.equal(isSafeChatHref('javascript:alert(1)'), false);
  assert.equal(isSafeChatHref('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeChatHref('//evil.example/path'), false);
  assert.equal(isSafeChatHref(''), false);
});
