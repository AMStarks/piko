const test = require('node:test');
const assert = require('node:assert/strict');
const { checkApiAuth, isPrivateIp, cameThroughProxy } = require('../lib/apiAuth');

function fakeReq(ip, headers = {}) {
  return { socket: { remoteAddress: ip }, headers };
}

test('isPrivateIp classification', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.0.5', '10.48.0.9', '172.16.4.4', '172.31.255.1', 'fe80::1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['114.73.210.115', '8.8.8.8', '172.32.0.1', '::ffff:114.73.210.115', '']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('LAN mode: private socket allowed, WAN denied, key overrides', () => {
  process.env.PIKO_API_AUTH = 'lan';
  process.env.PIKO_API_KEY = 'sekret';
  assert.equal(checkApiAuth(fakeReq('192.168.0.7'), '/api/agents/jobs', {}), null);
  const denied = checkApiAuth(fakeReq('114.73.210.115'), '/api/agents/jobs', {});
  assert.equal(denied.status, 401);
  assert.equal(checkApiAuth(fakeReq('114.73.210.115', { 'x-piko-key': 'sekret' }), '/api/agents/jobs', {}), null);
  assert.equal(checkApiAuth(fakeReq('114.73.210.115', { authorization: 'Bearer sekret' }), '/api/chat', {}), null);
  assert.equal(checkApiAuth(fakeReq('114.73.210.115'), '/api/chat', { piko_key: 'sekret' }), null);
  assert.equal(checkApiAuth(fakeReq('114.73.210.115', { 'x-piko-key': 'wrong' }), '/api/chat', {}).status, 401);
});

test('x-forwarded-for never grants trust', () => {
  process.env.PIKO_API_AUTH = 'lan';
  process.env.PIKO_API_KEY = 'sekret';
  const spoofed = fakeReq('114.73.210.115', { 'x-forwarded-for': '192.168.0.1' });
  assert.equal(checkApiAuth(spoofed, '/api/cultures/items', {}).status, 401);
});

test('WP1.2: proxied loopback does not get LAN trust', () => {
  process.env.PIKO_API_AUTH = 'lan';
  process.env.PIKO_API_KEY = 'sekret';
  assert.equal(cameThroughProxy(fakeReq('127.0.0.1', { 'x-forwarded-prefix': '/piko-ei' })), true);
  const proxied = fakeReq('127.0.0.1', {
    'x-forwarded-for': '114.73.210.115',
    'x-forwarded-prefix': '/piko-ei',
  });
  assert.equal(checkApiAuth(proxied, '/api/ei/engineering/tasks/x/approve', {}).status, 401);
  assert.equal(
    checkApiAuth(fakeReq('127.0.0.1', { 'x-forwarded-prefix': '/piko-ei', 'x-piko-key': 'sekret' }), '/api/ei/engineering/tasks/x/approve', {}),
    null,
  );
  // Direct (unproxied) LAN still allowed in lan mode.
  assert.equal(checkApiAuth(fakeReq('127.0.0.1'), '/api/agents/jobs', {}), null);
  assert.equal(checkApiAuth(fakeReq('192.168.0.7'), '/api/cultures/campaign', {}), null);
});

test('health stays open; non-api paths untouched; off disables', () => {
  process.env.PIKO_API_AUTH = 'lan';
  assert.equal(checkApiAuth(fakeReq('114.73.210.115'), '/api/health', {}), null);
  assert.equal(checkApiAuth(fakeReq('114.73.210.115'), '/ios-dashboard', {}), null);
  process.env.PIKO_API_AUTH = 'off';
  assert.equal(checkApiAuth(fakeReq('114.73.210.115'), '/api/agents/jobs', {}), null);
  process.env.PIKO_API_AUTH = 'lan';
});

test('strict mode requires key even from LAN', () => {
  process.env.PIKO_API_AUTH = 'strict';
  process.env.PIKO_API_KEY = 'sekret';
  assert.equal(checkApiAuth(fakeReq('192.168.0.7'), '/api/agents/jobs', {}).status, 401);
  assert.equal(checkApiAuth(fakeReq('192.168.0.7', { 'x-piko-key': 'sekret' }), '/api/agents/jobs', {}), null);
  process.env.PIKO_API_AUTH = 'lan';
});

test('admin login endpoints are open from WAN (login is its own gate)', () => {
  process.env.PIKO_API_AUTH = 'lan';
  process.env.PIKO_API_KEY = 'sekret';
  for (const p of ['/api/admin/login', '/api/admin/me', '/api/admin/logout']) {
    assert.equal(checkApiAuth(fakeReq('114.73.210.115'), p, {}), null, p);
  }
  // Everything else under /api/admin/ still requires trust.
  assert.equal(checkApiAuth(fakeReq('114.73.210.115'), '/api/admin/whatever', {}).status, 401);
});

test('valid admin session cookie passes the WAN gate', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const adminAuth = require('../lib/adminAuth');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiauth-sess-'));
  const prevPw = process.env.PIKO_ADMIN_PASSWORD;
  process.env.PIKO_API_AUTH = 'lan';
  process.env.PIKO_ADMIN_PASSWORD = 'hunter2';
  try {
    const token = adminAuth.createSession(dir, 'admin');
    const req = fakeReq('114.73.210.115', { cookie: `piko_admin_session=${token}` });
    assert.equal(checkApiAuth(req, '/api/agents/jobs', {}, { dataDir: dir }), null);
    // Bogus cookie still denied.
    const bad = fakeReq('114.73.210.115', { cookie: 'piko_admin_session=nope' });
    assert.equal(checkApiAuth(bad, '/api/agents/jobs', {}, { dataDir: dir }).status, 401);
    // No dataDir → cookie cannot grant access.
    assert.equal(checkApiAuth(req, '/api/agents/jobs', {}).status, 401);
  } finally {
    if (prevPw === undefined) delete process.env.PIKO_ADMIN_PASSWORD;
    else process.env.PIKO_ADMIN_PASSWORD = prevPw;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
