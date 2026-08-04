/**
 * P4.1: admin gate fail-closed under PIKO_ENV_STRICT when unconfigured.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isConfigured,
  mustFailClosed,
  denyIfUnconfigured,
  isEnabled,
} = require('../lib/adminAuth');

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('P4.1: strict off + no password → not fail-closed (dev legacy)', () => {
  withEnv({ PIKO_ENV_STRICT: '0', PIKO_ADMIN_PASSWORD: '' }, () => {
    assert.equal(isEnabled(), false);
    assert.equal(mustFailClosed('/tmp'), false);
    assert.equal(denyIfUnconfigured('/api/agents/jobs', 'GET', '/tmp'), null);
  });
});

test('P4.1: strict on + no password + no users → 503 on protected API', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-admin-fc-'));
  withEnv({ PIKO_ENV_STRICT: '1', PIKO_ADMIN_PASSWORD: '' }, () => {
    assert.equal(isConfigured(dir), false);
    assert.equal(mustFailClosed(dir), true);
    const denied = denyIfUnconfigured('/api/agents/jobs', 'GET', dir);
    assert.ok(denied);
    assert.equal(denied.status, 503);
    const body = JSON.parse(denied.body);
    assert.equal(body.error, 'admin_auth_unconfigured');
    // public health stays open
    assert.equal(denyIfUnconfigured('/api/health', 'GET', dir), null);
    assert.equal(denyIfUnconfigured('/api/chat', 'POST', dir), null);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P4.1: strict on + password set → configured, no 503', () => {
  withEnv({ PIKO_ENV_STRICT: '1', PIKO_ADMIN_PASSWORD: 'sekret' }, () => {
    assert.equal(isEnabled(), true);
    assert.equal(isConfigured('/tmp'), true);
    assert.equal(mustFailClosed('/tmp'), false);
    assert.equal(denyIfUnconfigured('/api/agents/jobs', 'GET', '/tmp'), null);
  });
});

test('P4.1: strict on + dashboard users file counts as configured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-admin-fc-'));
  fs.writeFileSync(
    path.join(dir, 'dashboard-users.json'),
    JSON.stringify({ users: [{ username: 'client1', role: 'client', salt: 'x', hash: 'y' }] }),
  );
  withEnv({ PIKO_ENV_STRICT: '1', PIKO_ADMIN_PASSWORD: '' }, () => {
    assert.equal(isEnabled(), false);
    assert.equal(isConfigured(dir), true);
    assert.equal(mustFailClosed(dir), false);
    assert.equal(denyIfUnconfigured('/api/ops/metrics', 'GET', dir), null);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
