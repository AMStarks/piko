const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isBackgroundJobEnabled,
  notificationMatchesTenant,
  resetTenantBackgroundProfileCache,
  JOB_DEFS,
} = require('../lib/tenantBackgroundJobs');

test('ausmaker jobs are disabled on culture profile', () => {
  resetTenantBackgroundProfileCache();
  const prev = process.env.PIKO_BACKGROUND_JOBS_PROFILE;
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'culture';
  try {
    assert.equal(isBackgroundJobEnabled('ausmaker_watchman', __dirname), false);
    assert.equal(isBackgroundJobEnabled('tripwire', __dirname), false);
    assert.equal(isBackgroundJobEnabled('nightly_quant', __dirname), false);
    assert.equal(isBackgroundJobEnabled('urgency_engine', __dirname), false);
    assert.equal(isBackgroundJobEnabled('context_refresh', __dirname), true);
    assert.equal(isBackgroundJobEnabled('legion_watch', __dirname), true);
    assert.equal(isBackgroundJobEnabled('intent_poller', __dirname), true);
  } finally {
    if (prev === undefined) delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
    else process.env.PIKO_BACKGROUND_JOBS_PROFILE = prev;
    resetTenantBackgroundProfileCache();
  }
});

test('ausmaker jobs are enabled on ausmaker profile', () => {
  resetTenantBackgroundProfileCache();
  const prev = process.env.PIKO_BACKGROUND_JOBS_PROFILE;
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'ausmaker';
  try {
    assert.equal(isBackgroundJobEnabled('ausmaker_watchman', __dirname), true);
    assert.equal(isBackgroundJobEnabled('tripwire', __dirname), true);
    assert.equal(isBackgroundJobEnabled('nightly_quant', __dirname), true);
  } finally {
    if (prev === undefined) delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
    else process.env.PIKO_BACKGROUND_JOBS_PROFILE = prev;
    resetTenantBackgroundProfileCache();
  }
});

test('PIKO_DISABLE_AUSMAKER_WATCHMAN kills watchman even on ausmaker', () => {
  resetTenantBackgroundProfileCache();
  const prevProfile = process.env.PIKO_BACKGROUND_JOBS_PROFILE;
  const prevDisable = process.env.PIKO_DISABLE_AUSMAKER_WATCHMAN;
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'ausmaker';
  process.env.PIKO_DISABLE_AUSMAKER_WATCHMAN = '1';
  try {
    assert.equal(isBackgroundJobEnabled('ausmaker_watchman', __dirname), false);
  } finally {
    if (prevProfile === undefined) delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
    else process.env.PIKO_BACKGROUND_JOBS_PROFILE = prevProfile;
    if (prevDisable === undefined) delete process.env.PIKO_DISABLE_AUSMAKER_WATCHMAN;
    else process.env.PIKO_DISABLE_AUSMAKER_WATCHMAN = prevDisable;
    resetTenantBackgroundProfileCache();
  }
});

test('notificationMatchesTenant blocks legacy AusMaker bleed on culture', () => {
  const culture = { profileId: 'culture', tenant_id: 'customer-03' };
  assert.equal(notificationMatchesTenant({
    text: 'SOVEREIGN ALERT: AUSMAKER AT RISK',
    source: 'telegramNotify',
  }, culture), false);
  assert.equal(notificationMatchesTenant({
    text: 'Inventory reorder spike',
    category: 'nightly_quant',
  }, culture), false);
  assert.equal(notificationMatchesTenant({
    tenant_id: 'customer-03',
    profile: 'culture',
    text: 'Harvest batch complete',
  }, culture), true);
});

test('notificationMatchesTenant keeps legacy rows on ausmaker', () => {
  const ausmaker = { profileId: 'ausmaker', tenant_id: 'customer-01' };
  assert.equal(notificationMatchesTenant({
    text: 'SOVEREIGN ALERT: AUSMAKER AT RISK',
  }, ausmaker), true);
});

test('JOB_DEFS lists ausmaker_watchman as ausmaker-only', () => {
  assert.deepEqual(JOB_DEFS.ausmaker_watchman.profiles, ['ausmaker']);
});
