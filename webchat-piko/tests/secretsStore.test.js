/**
 * P3.6 — secretsStore rotation window + env fallback.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSecret,
  setSecret,
  verifySecret,
  hasSecret,
  secretFilePath,
} = require('../lib/secretsStore');
const { keyMatches } = require('../lib/apiAuth');
const { checkWebhookAuth } = require('../routes/webhooks');

describe('lib/secretsStore', () => {
  let tmp;
  let prevDataDir;
  let prevApiKey;
  let prevWebhook;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-secrets-'));
    prevDataDir = process.env.PIKO_DATA_DIR;
    prevApiKey = process.env.PIKO_API_KEY;
    prevWebhook = process.env.PIKO_WEBHOOK_SECRET;
    process.env.PIKO_DATA_DIR = tmp;
    delete process.env.PIKO_API_KEY;
    delete process.env.PIKO_WEBHOOK_SECRET;
  });

  after(() => {
    if (prevDataDir === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevDataDir;
    if (prevApiKey === undefined) delete process.env.PIKO_API_KEY;
    else process.env.PIKO_API_KEY = prevApiKey;
    if (prevWebhook === undefined) delete process.env.PIKO_WEBHOOK_SECRET;
    else process.env.PIKO_WEBHOOK_SECRET = prevWebhook;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes secrets with mode 0600', () => {
    setSecret('webhook', 'alpha');
    const file = secretFilePath('webhook');
    assert.ok(fs.existsSync(file));
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('getSecret returns current value', () => {
    setSecret('api-key', { current: 'key-v2', previous: 'key-v1' });
    assert.equal(getSecret('api-key'), 'key-v2');
  });

  it('verifySecret accepts current and previous during rotation', () => {
    setSecret('webhook', { current: 'new-secret', previous: 'old-secret' });
    assert.equal(verifySecret('webhook', 'new-secret'), true);
    assert.equal(verifySecret('webhook', 'old-secret'), true);
    assert.equal(verifySecret('webhook', 'wrong'), false);
  });

  it('keyMatches accepts store rotation window', () => {
    fs.rmSync(path.join(tmp, 'secrets'), { recursive: true, force: true });
    delete process.env.PIKO_API_KEY;
    setSecret('api-key', { current: 'key-v2', previous: 'key-v1' });
    assert.equal(keyMatches('key-v2'), true);
    assert.equal(keyMatches('key-v1'), true);
    assert.equal(keyMatches('key-v0'), false);
  });

  it('verifySecret falls back to process.env when store unset', () => {
    process.env.PIKO_API_KEY = 'env-only-key';
    assert.equal(hasSecret('api-key'), true);
    assert.equal(verifySecret('api-key', 'env-only-key'), true);
    assert.equal(keyMatches('env-only-key'), true);
    assert.equal(keyMatches('wrong'), false);
    delete process.env.PIKO_API_KEY;
  });

  it('store takes precedence but env previous still works when store has rotation', () => {
    fs.rmSync(path.join(tmp, 'secrets'), { recursive: true, force: true });
    process.env.PIKO_WEBHOOK_SECRET = 'env-fallback';
    setSecret('webhook', { current: 'store-current', previous: 'store-previous' });
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer store-current' } }), true);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer store-previous' } }), true);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer env-fallback' } }), true);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer nope' } }), false);
    delete process.env.PIKO_WEBHOOK_SECRET;
    fs.rmSync(path.join(tmp, 'secrets'), { recursive: true, force: true });
  });

  it('checkWebhookAuth fails closed when no secret configured', () => {
    delete process.env.PIKO_WEBHOOK_SECRET;
    fs.rmSync(path.join(tmp, 'secrets'), { recursive: true, force: true });
    assert.equal(hasSecret('webhook'), false);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer anything' } }), false);
  });
});
