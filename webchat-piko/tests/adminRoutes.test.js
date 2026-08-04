/**
 * P3.1b — admin auth/session route extraction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tryHandleAdmin, registerAdminRoutes } = require('../routes/admin');
const { createRouteRegistry } = require('../lib/routeRegistry');

function mockAdminAuth(overrides = {}) {
  return {
    isEnabled: () => true,
    authenticate: () => null,
    createSession: () => 'tok',
    setSessionCookie: () => {},
    clearSessionCookie: () => {},
    getSessionFromRequest: () => null,
    destroySession: () => {},
    listUsers: () => [],
    createUser: () => ({ username: 'u' }),
    resetUserPassword: () => true,
    deleteUser: () => true,
    listDashboards: () => [],
    isOperatorOnlyPagePath: () => false,
    ...overrides,
  };
}

describe('routes/admin', () => {
  it('login returns 503 when admin auth disabled', async () => {
    let status = null;
    await tryHandleAdmin(
      { method: 'POST', headers: {} },
      {},
      {
        pathname: '/api/admin/login',
        send: (_r, code) => { status = code; },
        readBody: async () => '{}',
        adminAuth: mockAdminAuth({ isEnabled: () => false }),
        dataDir: '/tmp',
        rootDir: __dirname,
        matchPath: () => null,
      },
    );
    assert.equal(status, 503);
  });

  it('login returns 401 on bad credentials', async () => {
    let status = null;
    await tryHandleAdmin(
      { method: 'POST', headers: {} },
      {},
      {
        pathname: '/api/admin/login',
        send: (_r, code) => { status = code; },
        readBody: async () => JSON.stringify({ username: 'a', password: 'b' }),
        adminAuth: mockAdminAuth(),
        dataDir: '/tmp',
        rootDir: __dirname,
        matchPath: () => null,
      },
    );
    assert.equal(status, 401);
  });

  it('non-admin path returns false', async () => {
    const handled = await tryHandleAdmin(
      { method: 'GET', headers: {} },
      {},
      {
        pathname: '/api/health',
        send: () => {},
        readBody: async () => '',
        adminAuth: mockAdminAuth(),
        dataDir: '/tmp',
        rootDir: __dirname,
        matchPath: () => null,
      },
    );
    assert.equal(handled, false);
  });

  it('registerAdminRoutes mounts catalog admin paths', () => {
    const reg = createRouteRegistry();
    registerAdminRoutes(reg, {});
    const paths = reg.list().map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(paths, [
      'GET /api/admin/me',
      'GET /api/admin/users',
      'POST /api/admin/login',
      'POST /api/admin/logout',
      'POST /api/admin/users',
    ]);
  });
});
