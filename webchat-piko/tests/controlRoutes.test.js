/**
 * P3.1b — control panel route extraction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  tryHandleControl,
  registerControlRoutes,
  isControlPath,
  canAccessControl,
} = require('../routes/control');
const { createRouteRegistry } = require('../lib/routeRegistry');

describe('routes/control', () => {
  it('non-control path returns false', async () => {
    const handled = await tryHandleControl(
      { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      {},
      { pathname: '/api/health', send: () => {} },
    );
    assert.equal(handled, false);
  });

  it('control HTML path applies gate then falls through', async () => {
    const prevIp = process.env.PIKO_CONTROL_ALLOWED_IP;
    process.env.PIKO_CONTROL_ALLOWED_IP = '10.0.0.1';
    try {
      let status = null;
      const handled = await tryHandleControl(
        { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
        {},
        {
          pathname: '/control',
          send: (_r, code) => { status = code; },
        },
      );
      assert.equal(status, 403);
      assert.equal(handled, true);
    } finally {
      if (prevIp === undefined) delete process.env.PIKO_CONTROL_ALLOWED_IP;
      else process.env.PIKO_CONTROL_ALLOWED_IP = prevIp;
    }
  });

  it('isControlPath matches api control prefix', () => {
    assert.equal(isControlPath('/api/control/proactive-policy'), true);
    assert.equal(isControlPath('/api/chat'), false);
  });

  it('canAccessControl allows when unset', () => {
    const prevIp = process.env.PIKO_CONTROL_ALLOWED_IP;
    const prevHdr = process.env.PIKO_CONTROL_HEADER;
    delete process.env.PIKO_CONTROL_ALLOWED_IP;
    delete process.env.PIKO_CONTROL_HEADER;
    try {
      assert.equal(canAccessControl({ headers: {}, socket: { remoteAddress: '1.2.3.4' } }), true);
    } finally {
      if (prevIp !== undefined) process.env.PIKO_CONTROL_ALLOWED_IP = prevIp;
      if (prevHdr !== undefined) process.env.PIKO_CONTROL_HEADER = prevHdr;
    }
  });

  it('registerControlRoutes mounts catalog control paths', () => {
    const reg = createRouteRegistry();
    registerControlRoutes(reg, {});
    const controlPaths = reg.list()
      .filter((r) => r.group === 'control')
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    assert.ok(controlPaths.includes('GET /api/control'));
    assert.ok(controlPaths.includes('GET /api/integrations/linked'));
    assert.ok(controlPaths.some((p) => p.startsWith('GET /api/control/')));
  });
});
