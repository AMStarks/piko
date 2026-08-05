const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProactiveWebhookHelpers } = require('../lib/proactiveWebhook');

describe('P6.4 proactiveWebhook helpers', () => {
  let dir;
  let helpers;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-wh-'));
    helpers = createProactiveWebhookHelpers({
      dataDir: dir,
      pendingNotificationsFile: path.join(dir, 'pending.txt'),
      webhookUrl: 'https://example.com/hook',
      whatsappUrl: 'https://example.com/wa',
      imessageUrl: '',
      bearer: '',
    });
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('appends pending notifications', () => {
    assert.equal(helpers.appendPendingNotification('hello'), true);
    const body = fs.readFileSync(path.join(dir, 'pending.txt'), 'utf8');
    assert.ok(body.includes('hello'));
  });

  it('resolves webhook targets', () => {
    assert.equal(helpers.resolveProactiveWebhookUrl({ target: 'whatsapp_bridge' }), 'https://example.com/wa');
    assert.equal(helpers.resolveProactiveWebhookUrl({ target: 'other' }), 'https://example.com/hook');
    assert.equal(
      helpers.resolveProactiveWebhookUrl({ target: 'https://direct.example/x' }),
      'https://direct.example/x',
    );
  });
});
