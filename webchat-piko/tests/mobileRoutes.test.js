/**
 * P3.1b — mobile route extraction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tryHandleMobile, registerMobileRoutes, isMobilePath } = require('../routes/mobile');
const { createRouteRegistry } = require('../lib/routeRegistry');

describe('routes/mobile', () => {
  it('isMobilePath recognises mobile prefixes', () => {
    assert.equal(isMobilePath('/api/mobile/discovery'), true);
    assert.equal(isMobilePath('/api/mobile/summary'), true);
    assert.equal(isMobilePath('/api/control/mobile-devices'), false);
  });

  it('non-mobile path returns false', async () => {
    const handled = await tryHandleMobile(
      { method: 'GET', url: '/api/health' },
      {},
      { pathname: '/api/health', send: () => {}, readBody: async () => '', parseUrl: () => ({ query: {} }) },
    );
    assert.equal(handled, false);
  });

  it('summary rejects missing key when healthApiKey set', async () => {
    let status = null;
    let body = null;
    const handled = await tryHandleMobile(
      { method: 'GET', url: '/api/mobile/summary' },
      {},
      {
        pathname: '/api/mobile/summary',
        healthApiKey: 'secret',
        send: (_r, code, b) => { status = code; body = b; },
        readBody: async () => '',
        parseUrl: () => ({ query: {} }),
      },
    );
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.ok(String(body).includes('Unauthorized'));
  });

  it('discovery returns ok without auth', async () => {
    let status = null;
    let body = null;
    const handled = await tryHandleMobile(
      { method: 'GET', url: '/api/mobile/discovery' },
      {},
      {
        pathname: '/api/mobile/discovery',
        port: 3000,
        send: (_r, code, b) => { status = code; body = b; },
        readBody: async () => '',
        parseUrl: () => ({ query: {} }),
        getMobileLanBaseURL: () => 'http://192.168.1.1:3000',
        getMobilePublicBaseURL: () => 'https://example.com/piko',
      },
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    const parsed = JSON.parse(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.port, 3000);
    assert.equal(parsed.lanBaseURL, 'http://192.168.1.1:3000');
  });

  it('registerMobileRoutes mounts all ten catalog paths', () => {
    const reg = createRouteRegistry();
    registerMobileRoutes(reg, {});
    const paths = reg.list().map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(paths, [
      'GET /api/mobile/discovery',
      'GET /api/mobile/live-activity',
      'GET /api/mobile/preferences',
      'GET /api/mobile/proactive-policy',
      'GET /api/mobile/summary',
      'POST /api/mobile/device-heartbeat',
      'POST /api/mobile/proactive-policy',
      'POST /api/mobile/push-ack',
      'POST /api/mobile/push-token',
      'PUT /api/mobile/preferences',
    ]);
  });
});
