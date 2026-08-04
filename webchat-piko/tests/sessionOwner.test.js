const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('sessionOwner + sessionStore tenant meta', () => {
  let dir;
  let prevData;
  let prevTenant;
  let sessionStore;
  let sessionOwner;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-owner-'));
    prevData = process.env.PIKO_DATA_DIR;
    prevTenant = process.env.PIKO_TENANT_ID;
    process.env.PIKO_DATA_DIR = dir;
    process.env.PIKO_TENANT_ID = 'customer-test';
    // Fresh module load against temp DATA_DIR
    delete require.cache[require.resolve('../lib/sessionStore')];
    delete require.cache[require.resolve('../lib/sessionOwner')];
    sessionStore = require('../lib/sessionStore');
    sessionOwner = require('../lib/sessionOwner');
  });

  after(() => {
    if (prevData === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevTenant === undefined) delete process.env.PIKO_TENANT_ID;
    else process.env.PIKO_TENANT_ID = prevTenant;
    delete require.cache[require.resolve('../lib/sessionStore')];
    delete require.cache[require.resolve('../lib/sessionOwner')];
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('stamps tenant_id on append and meta owner', () => {
    assert.equal(sessionStore.append('s1', 'user', 'hi', { owner: 'admin:alice' }), true);
    const meta = sessionStore.getSessionMeta('s1');
    assert.equal(meta.owner, 'admin:alice');
    assert.equal(meta.tenant_id, 'customer-test');
  });

  it('forbids other principal without override', () => {
    const denied = sessionOwner.assertSessionAccess('s1', { kind: 'admin', id: 'bob' }, {
      sessionStore,
      req: {},
      query: {},
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
  });

  it('allows owner and shared unified session', () => {
    const ok = sessionOwner.assertSessionAccess('s1', { kind: 'admin', id: 'alice' }, {
      sessionStore,
    });
    assert.equal(ok.ok, true);
    const shared = sessionOwner.assertSessionAccess('main', { kind: 'api_key', id: 'shared' }, {
      sessionStore,
    });
    assert.equal(shared.ok, true);
    assert.equal(shared.shared, true);
  });

  it('legacy history without meta stamps operator', () => {
    // Simulate legacy: insert via ensure path after append without going through ownership
    assert.equal(sessionStore.append('legacy1', 'user', 'old'), true);
    // Clear meta to simulate pre-P3.3 rows
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'conversations.db'));
    db.prepare('DELETE FROM session_meta WHERE session_id = ?').run('legacy1');
    db.close();
    const access = sessionOwner.assertSessionAccess('legacy1', { kind: 'admin', id: 'carol' }, {
      sessionStore,
    });
    assert.equal(access.ok, false);
    assert.equal(sessionStore.getSessionMeta('legacy1').owner, 'operator:operator');
  });
});
