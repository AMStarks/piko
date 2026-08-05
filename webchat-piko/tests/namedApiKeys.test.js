const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('P5.1c named API keys + session principals', () => {
  let dir;
  let prevData;
  let prevApiKey;
  let secretsStore;
  let apiAuth;
  let sessionOwner;
  let sessionStore;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'named-api-keys-'));
    prevData = process.env.PIKO_DATA_DIR;
    prevApiKey = process.env.PIKO_API_KEY;
    process.env.PIKO_DATA_DIR = dir;
    delete process.env.PIKO_API_KEY;
    for (const mod of [
      '../lib/secretsStore',
      '../lib/apiAuth',
      '../lib/sessionOwner',
      '../lib/sessionStore',
    ]) {
      delete require.cache[require.resolve(mod)];
    }
    secretsStore = require('../lib/secretsStore');
    apiAuth = require('../lib/apiAuth');
    sessionOwner = require('../lib/sessionOwner');
    sessionStore = require('../lib/sessionStore');

    secretsStore.setSecret('api-key', 'shared-secret-aaaa');
    secretsStore.setSecret('api-key-telegram', 'telegram-secret-bbbb');
    secretsStore.setSecret('api-key-ios', 'ios-secret-cccc');
  });

  after(() => {
    if (prevData === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevApiKey === undefined) delete process.env.PIKO_API_KEY;
    else process.env.PIKO_API_KEY = prevApiKey;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('matchNamedApiKey resolves shared and client names', () => {
    assert.deepEqual(secretsStore.matchNamedApiKey('shared-secret-aaaa'), { name: 'shared' });
    assert.deepEqual(secretsStore.matchNamedApiKey('telegram-secret-bbbb'), { name: 'telegram' });
    assert.deepEqual(secretsStore.matchNamedApiKey('ios-secret-cccc'), { name: 'ios' });
    assert.equal(secretsStore.matchNamedApiKey('nope'), null);
  });

  it('resolvePrincipal uses api_key:<name>', () => {
    const reqTg = { headers: { 'x-piko-key': 'telegram-secret-bbbb' } };
    const pTg = sessionOwner.resolvePrincipal(reqTg, { dataDir: dir, query: {} });
    assert.equal(pTg.kind, 'api_key');
    assert.equal(pTg.id, 'telegram');

    const reqShared = { headers: { 'x-piko-key': 'shared-secret-aaaa' } };
    const pShared = sessionOwner.resolvePrincipal(reqShared, { dataDir: dir, query: {} });
    assert.equal(pShared.id, 'shared');
  });

  it('key A cannot read key B session history (403 session_forbidden)', () => {
    const sid = 'client-session-tg-1';
    sessionStore.append(sid, 'user', 'hello from telegram', { owner: 'api_key:telegram' });
    const denied = sessionOwner.assertSessionAccess(sid, { kind: 'api_key', id: 'ios' }, {
      sessionStore,
      req: {},
      query: {},
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.equal(denied.error, 'session_forbidden');

    const allowed = sessionOwner.assertSessionAccess(sid, { kind: 'api_key', id: 'telegram' }, {
      sessionStore,
    });
    assert.equal(allowed.ok, true);
  });

  it('checkApiAuth accepts named keys under strict', () => {
    process.env.PIKO_API_AUTH = 'strict';
    const req = {
      headers: { 'x-piko-key': 'ios-secret-cccc' },
      socket: { remoteAddress: '8.8.8.8' },
    };
    assert.equal(apiAuth.checkApiAuth(req, '/api/chat', {}), null);
    const bad = {
      headers: {},
      socket: { remoteAddress: '8.8.8.8' },
    };
    assert.equal(apiAuth.checkApiAuth(bad, '/api/chat', {}).status, 401);
  });

  it('P5.1d monitor bypass: strict requires key; lan allows loopback', () => {
    const adminAuth = require('../lib/adminAuth');
    const loopReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    process.env.PIKO_API_AUTH = 'strict';
    assert.equal(adminAuth.isMonitorBypass(loopReq, '/api/observe/summary', 'GET'), false);
    const keyed = {
      headers: { 'x-piko-key': 'shared-secret-aaaa' },
      socket: { remoteAddress: '192.168.0.50' },
    };
    assert.equal(adminAuth.isMonitorBypass(keyed, '/api/observe/summary', 'GET'), true);
    process.env.PIKO_API_AUTH = 'lan';
    assert.equal(adminAuth.isMonitorBypass(loopReq, '/api/observe/summary', 'GET'), true);
  });
});
