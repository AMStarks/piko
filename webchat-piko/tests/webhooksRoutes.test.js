/**
 * P3.1b — webhook route extraction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkWebhookAuth, tryHandleWebhooks, registerWebhookRoutes } = require('../routes/webhooks');
const { createRouteRegistry } = require('../lib/routeRegistry');

describe('routes/webhooks', () => {
  it('checkWebhookAuth fails closed when secret unset', () => {
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer x' } }, ''), false);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer x' } }, null), false);
  });

  it('checkWebhookAuth accepts bearer or x-webhook-key', () => {
    const secret = 's3cret';
    assert.equal(checkWebhookAuth({ headers: { authorization: `Bearer ${secret}` } }, secret), true);
    assert.equal(checkWebhookAuth({ headers: { 'x-webhook-key': secret } }, secret), true);
    assert.equal(checkWebhookAuth({ headers: { authorization: 'Bearer wrong' } }, secret), false);
  });

  it('unauthenticated webhook returns 401', () => {
    let status = null;
    let body = null;
    const res = {};
    const handled = tryHandleWebhooks(
      { method: 'POST', headers: {} },
      res,
      {
        pathname: '/api/webhooks/events',
        webhookSecret: 'need-auth',
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
      { pathname: '/api/health', webhookSecret: 'x', send: () => {}, readBody: async () => '' },
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
