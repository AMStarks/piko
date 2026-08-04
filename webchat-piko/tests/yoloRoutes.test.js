const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isYoloPath, registerYoloRoutes, tryHandleYolo } = require('../routes/yolo');
const { createRouteRegistry } = require('../lib/routeRegistry');

describe('P4.2 yolo routes', () => {
  it('isYoloPath covers tool/hitl/upload', () => {
    assert.equal(isYoloPath('/api/yolo-tool'), true);
    assert.equal(isYoloPath('/api/hitl/approve'), true);
    assert.equal(isYoloPath('/api/piko/upload'), true);
    assert.equal(isYoloPath('/api/chat'), false);
  });

  it('registerYoloRoutes catalogs expected paths', () => {
    const reg = createRouteRegistry();
    registerYoloRoutes(reg, {});
    const keys = reg.list().map((r) => `${r.method}|${r.match || 'exact'}|${r.path}`);
    assert.ok(keys.includes('POST|exact|/api/yolo-tool'));
    assert.ok(keys.includes('GET|exact|/api/hitl/pending'));
    assert.ok(keys.includes('POST|exact|/api/hitl/approve'));
  });

  it('tryHandleYolo denies unauthenticated tool call', async () => {
    let status = 0;
    let body = '';
    const res = {};
    await tryHandleYolo(
      { method: 'POST', headers: {}, url: '/api/yolo-tool' },
      res,
      {
        pathname: '/api/yolo-tool',
        send: (_res, code, b) => { status = code; body = b; },
        readBody: async () => '{}',
        checkYoloOrSessionAuth: () => false,
      },
    );
    assert.equal(status, 401);
    assert.ok(String(body).includes('Unauthorized'));
  });
});
