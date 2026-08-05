const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMobileHelpers } = require('../lib/mobileHelpers');

describe('P6.4 mobileHelpers', () => {
  let dir;
  let helpers;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-helpers-'));
    helpers = createMobileHelpers({
      dataDir: dir,
      preferencesFile: path.join(dir, 'ea-preferences.json'),
      loadIntents: () => [
        { type: 'reminder', status: 'pending', dueAt: new Date(Date.now() + 3600000).toISOString(), title: 'soon' },
        { type: 'queue', status: 'pending', title: 'q1' },
      ],
      stripTrailingSlash: (s) => {
        let t = String(s || '');
        while (t.endsWith('/')) t = t.slice(0, -1);
        return t;
      },
      mergeMobilePreferences: (cur, next) => ({ ...cur, ...next, updatedAt: '2026-01-01T00:00:00.000Z' }),
    });
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('loads defaults and saves preferences', () => {
    const d = helpers.loadMobilePreferences();
    assert.equal(d.mobilePushEnabled, true);
    const saved = helpers.saveMobilePreferences({ quietStart: '22:00' });
    assert.equal(saved.quietStart, '22:00');
    assert.equal(helpers.loadMobilePreferences().quietStart, '22:00');
  });

  it('builds intent snapshot and poll hint', () => {
    const snap = helpers.buildIntentSnapshot(new Date());
    assert.equal(snap.queueLength, 1);
    assert.equal(snap.remindersCount, 1);
    assert.ok(snap.nextReminder);
    assert.equal(helpers.getMobilePollHintSeconds(snap), 60);
  });

  it('exports URL helpers', () => {
    assert.equal(typeof helpers.getMobileLanBaseURL, 'function');
    assert.equal(typeof helpers.getMobilePublicBaseURL, 'function');
  });
});
