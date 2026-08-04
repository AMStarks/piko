/**
 * P3.1b — webhook route extraction.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { checkWebhookAuth, tryHandleWebhooks, registerWebhookRoutes } = require('../routes/webhooks');
const { createRouteRegistry } = require('../lib/routeRegistry');
const { setSecret } = require('../lib/secretsStore');

describe('routes/webhooks', () => {
  let tmp;
  let prevDataDir;
  let prevWebhook;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wh-'));
    prevDataDir = process.env.PIKO_DATA_DIR;
    prevWebhook = process.env.PIKO_WEBHOOK_SECRET;
    process.env.PIKO_DATA_DIR = tmp;
    delete process.env.PIKO_WEBHOOK_SECRET;
  });

  after(() => {
    if (prevDataDir === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevDataDir;
    if (prevWebhook === undefined) delete process.env.PIKO_WEBHOOK_SECRET;
    else process.env.PIKO_WEBHOOK_SECRET = prevWebhook;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('checkWebhookAuth fails closed when secret unset', () => {
    fs.rmSync(path.join(tmp, 'secrets'), { recursive: true, force: true });
    delete process.env.PIKO_WEBHOOK_SECRET;
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer x' } }), false);
  });

  it('checkWebhookAuth accepts bearer or x-webhook-key', () => {
    setSecret('webhook', 's3cret');
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer s3cret' } }), true);
    assert.equal(checkWebhookAuth({ headers: { 'x-webhook-key': 's3cret' } }), true);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer wrong' } }), false);
  });

  it('unauthenticated webhook returns 401', () => {
    setSecret('webhook', 'need-auth');
    let status = null;
    let body = null;
    const res = {};
    const handled = tryHandleWebhooks(
      { method: 'POST', headers: {} },
      res,
      {
        pathname: '/api/webhooks/events',
        send: (_r, code, b) => { status = code; body = b; },
        readBody: async () => '{}',
      },
    );
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.ok(String(body).includes('Webhook auth required'));
  });

  it('non-webhook path returns false', () => {
    const handled = tryHandleWebhooks(
      { method: 'GET', headers: {} },
      {},
      { pathname: '/api/health', send: () => {}, readBody: async () => '' },
    );
    assert.equal(handled, false);
  });

  it('registerWebhookRoutes mounts all six catalog paths', () => {
    const reg = createRouteRegistry();
    registerWebhookRoutes(reg, {});
    const paths = reg.list().map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(paths, [
      'POST /api/webhook/alert',
      'POST /api/webhooks/ausmaker',
      'POST /api/webhooks/events',
      'POST /webhook/alert',
      'POST /webhook/cin7',
      'POST /webhook/inventory-alert',
    ]);
  });
});
