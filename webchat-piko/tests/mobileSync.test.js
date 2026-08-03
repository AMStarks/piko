const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHm,
  makeWeakEtag,
  parseIfMatchVersion,
  buildMobilePolicyPatch,
  mergeMobilePreferences,
} = require('../lib/mobileSync');

test('etag helpers round-trip version values', () => {
  const version = '2026-03-01T01:23:45.000Z';
  const etag = makeWeakEtag(version);
  assert.equal(etag, `W/"${version}"`);
  assert.equal(parseIfMatchVersion(etag), version);
});

test('buildMobilePolicyPatch only applies allowed safe fields', () => {
  const current = {
    mode: 'draft_only',
    quietHours: { start: '23:00', end: '06:00', draftOnly: true, onlyHighUrgency: true, maxUrgentPerNight: 2 },
    categories: { importantComms: true, deadlineRisk: true },
    dispatch: { replayCooldownSec: 15 },
  };
  const out = buildMobilePolicyPatch(current, {
    mode: 'full_auto',
    quietHours: { start: '21:00', end: '07:30', draftOnly: false },
    categories: { importantComms: false },
    dispatch: { replayCooldownSec: 0 },
  });
  assert.equal(out.mode, 'draft_only');
  assert.equal(out.quietHours.start, '21:00');
  assert.equal(out.quietHours.end, '07:30');
  assert.equal(out.quietHours.draftOnly, false);
  assert.equal(out.categories.importantComms, false);
  assert.equal(out.dispatch.replayCooldownSec, 15);
});

test('mergeMobilePreferences updates allowed fields with timestamp', () => {
  const current = { quietStart: null, quietEnd: null, mobilePushEnabled: true, backgroundSyncEnabled: true, updatedAt: null };
  const out = mergeMobilePreferences(current, {
    quietStart: '22:15',
    quietEnd: '07:00',
    mobilePushEnabled: false,
  });
  assert.equal(out.quietStart, '22:15');
  assert.equal(out.quietEnd, '07:00');
  assert.equal(out.mobilePushEnabled, false);
  assert.equal(out.backgroundSyncEnabled, true);
  assert.equal(typeof out.updatedAt, 'string');
  assert.equal(normalizeHm('25:99'), '23:59');
});

