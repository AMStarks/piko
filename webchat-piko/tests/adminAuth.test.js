const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateCredentials,
  authenticate,
  createUser,
  deleteUser,
  resetUserPassword,
  listUsers,
  createSession,
  getSessionFromRequest,
  destroySession,
  isProtectedPagePath,
  isProtectedApiPath,
  isOperatorOnlyPagePath,
  isOperatorOnlyApiPath,
  isEnabled,
} = require('../lib/adminAuth');

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('auth disabled without PIKO_ADMIN_PASSWORD', () => {
  withEnv({ PIKO_ADMIN_PASSWORD: '' }, () => {
    assert.equal(isEnabled(), false);
  });
});

test('validateCredentials accepts correct user/password', () => {
  withEnv({ PIKO_ADMIN_USER: 'chief', PIKO_ADMIN_PASSWORD: 'secret-pass' }, () => {
    assert.equal(validateCredentials('chief', 'secret-pass'), true);
    assert.equal(validateCredentials('chief', 'wrong'), false);
    assert.equal(validateCredentials('other', 'secret-pass'), false);
  });
});

test('session cookie round-trip', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-admin-'));
  withEnv({ PIKO_ADMIN_USER: 'admin', PIKO_ADMIN_PASSWORD: 'x' }, () => {
    const token = createSession(dataDir, 'admin', 'operator');
    const req = { headers: { cookie: `piko_admin_session=${token}` } };
    const session = getSessionFromRequest(req, dataDir);
    assert.equal(session.username, 'admin');
    assert.equal(session.role, 'operator');
    destroySession(dataDir, token);
    assert.equal(getSessionFromRequest(req, dataDir), null);
  });
});

test('protected paths', () => {
  assert.equal(isProtectedPagePath('/ios-dashboard'), true);
  assert.equal(isProtectedPagePath('/control-learning'), true);
  assert.equal(isProtectedPagePath('/admin/login'), false);
  assert.equal(isProtectedPagePath('/ei-eval'), true);
  assert.equal(isProtectedPagePath('/corpus'), true);
  assert.equal(isProtectedApiPath('/api/control/operations', 'GET'), true);
  assert.equal(isProtectedApiPath('/api/health', 'GET'), false);
  assert.equal(isProtectedApiPath('/api/ei/engineering/tasks', 'GET'), true);
  assert.equal(isProtectedApiPath('/api/cultures/campaign', 'POST'), true);
});

test('operator-only path gates', () => {
  assert.equal(isOperatorOnlyPagePath('/admin'), true);
  assert.equal(isOperatorOnlyPagePath('/hq-dashboard'), true);
  assert.equal(isOperatorOnlyPagePath('/ios-dashboard'), false);
  assert.equal(isOperatorOnlyPagePath('/ei-eval'), true);
  assert.equal(isOperatorOnlyApiPath('/api/hq/tenants'), true);
  assert.equal(isOperatorOnlyApiPath('/api/admin/users'), true);
  assert.equal(isOperatorOnlyApiPath('/api/agents/jobs'), false);
  assert.equal(isOperatorOnlyApiPath('/api/control/legion-adapter-health'), false);
  assert.equal(isOperatorOnlyApiPath('/api/ei/engineering/tasks/x/approve'), true);
});

test('client user lifecycle: create, auth, reset, delete', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-users-'));
  withEnv({ PIKO_ADMIN_USER: 'admin', PIKO_ADMIN_PASSWORD: 'super-secret-pass' }, () => {
    const created = createUser(dataDir, {
      username: 'Sarah.K',
      password: 'client-pass-12',
      createdBy: 'admin',
    });
    assert.equal(created.username, 'sarah.k');
    assert.equal(created.role, 'client');
    assert.equal(listUsers(dataDir).length, 1);

    // Super user still authenticates as operator.
    const op = authenticate(dataDir, 'admin', 'super-secret-pass');
    assert.deepEqual(op, { username: 'admin', role: 'operator' });

    // Client authenticates with role=client (case-insensitive username).
    const client = authenticate(dataDir, 'sarah.k', 'client-pass-12');
    assert.equal(client.username, 'sarah.k');
    assert.equal(client.role, 'client');
    assert.equal(authenticate(dataDir, 'sarah.k', 'wrong'), null);

    // Session carries role.
    const token = createSession(dataDir, client.username, client.role);
    const session = getSessionFromRequest(
      { headers: { cookie: `piko_admin_session=${token}` } },
      dataDir,
    );
    assert.equal(session.role, 'client');

    // Reset password invalidates the old one.
    assert.equal(resetUserPassword(dataDir, 'sarah.k', 'brand-new-pass'), true);
    assert.equal(authenticate(dataDir, 'sarah.k', 'client-pass-12'), null);
    assert.equal(authenticate(dataDir, 'sarah.k', 'brand-new-pass').role, 'client');

    // Delete removes the user and kills their session.
    assert.equal(deleteUser(dataDir, 'sarah.k'), true);
    assert.equal(listUsers(dataDir).length, 0);
    assert.equal(getSessionFromRequest(
      { headers: { cookie: `piko_admin_session=${token}` } },
      dataDir,
    ), null);
  });
});

test('valid session wins over stale duplicate cookies', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-dupe-'));
  withEnv({ PIKO_ADMIN_USER: 'admin', PIKO_ADMIN_PASSWORD: 'x' }, () => {
    const token = createSession(dataDir, 'admin', 'operator');
    // Browser order: fresh prefix-scoped cookie first, stale Path=/ cookie last.
    const freshFirst = { headers: { cookie: `piko_admin_session=${token}; piko_admin_session=deadbeef` } };
    assert.equal(getSessionFromRequest(freshFirst, dataDir).username, 'admin');
    // Reverse order must also resolve to the valid session.
    const staleFirst = { headers: { cookie: `piko_admin_session=deadbeef; piko_admin_session=${token}` } };
    assert.equal(getSessionFromRequest(staleFirst, dataDir).username, 'admin');
    // No valid token at all → null.
    assert.equal(getSessionFromRequest({ headers: { cookie: 'piko_admin_session=deadbeef' } }, dataDir), null);
  });
});

test('createUser rejects reserved and short passwords', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-users-bad-'));
  withEnv({ PIKO_ADMIN_USER: 'admin', PIKO_ADMIN_PASSWORD: 'x' }, () => {
    assert.throws(() => createUser(dataDir, { username: 'admin', password: 'long-enough' }), /reserved/i);
    assert.throws(() => createUser(dataDir, { username: 'ok-user', password: 'short' }), /10 characters/i);
    assert.throws(() => createUser(dataDir, { username: 'a', password: 'long-enough' }), /2–40/i);
  });
});
