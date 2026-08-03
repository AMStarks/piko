const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inferProfileId, PROFILES } = require('../lib/siteContext');

test('inferProfileId selects ausmaker for customer-01', () => {
  assert.equal(inferProfileId({ tenant_id: 'customer-01' }, { defaultAdapter: 'ausmakersupplies' }), 'ausmaker');
});

test('inferProfileId selects culture for egyptian-insights', () => {
  assert.equal(inferProfileId({ tenant_id: 'customer-03' }, { defaultAdapter: 'egyptian-insights' }), 'culture');
});

test('inferProfileId honors explicit dashboardProfile in knowledge manifest', () => {
  assert.equal(inferProfileId({ tenant_id: 'customer-99' }, { dashboardProfile: 'culture' }), 'culture');
});

test('culture profile hides inventory features', () => {
  assert.equal(PROFILES.culture.features.inventory, false);
  assert.equal(PROFILES.culture.features.culture, true);
  assert.equal(PROFILES.culture.features.agents, true);
  assert.equal(PROFILES.ausmaker.features.agents, false);
});
