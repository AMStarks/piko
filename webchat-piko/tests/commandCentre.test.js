const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTenantLinks } = require('../lib/commandCentre');

test('resolveTenantLinks builds dashboard from public_url', () => {
  const links = resolveTenantLinks({
    tenant_id: 'customer-03',
    public_url: 'http://114.73.210.115/piko-ei',
    break_glass_dashboard_url: 'http://114.73.210.115/piko-ei/ios-dashboard',
    node_host: 'optimus',
    piko_port: 3021,
  }, null);
  assert.equal(links.dashboard_url, 'http://114.73.210.115/piko-ei/ios-dashboard');
  assert.equal(links.primary_url, 'http://114.73.210.115/piko-ei/ios-dashboard');
});

test('resolveTenantLinks prefers break_glass for primary_url', () => {
  const links = resolveTenantLinks({
    tenant_id: 'customer-01',
    dashboard_url: 'https://andrewstarkey.net/piko/ios-dashboard',
    break_glass_dashboard_url: 'http://114.73.210.115:3000/ios-dashboard',
  }, null);
  assert.equal(links.primary_url, 'http://114.73.210.115:3000/ios-dashboard');
});
