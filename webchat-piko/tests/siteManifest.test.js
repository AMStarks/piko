const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseSimpleYaml, loadSiteManifest } = require('../lib/siteManifest');

test('parseSimpleYaml reads customer site fields', () => {
  const yaml = `
tenant_id: customer-01
display_name: AusMaker Supplies
public:
  url: https://example.test/piko
`;
  const parsed = parseSimpleYaml(yaml);
  assert.equal(parsed.tenant_id, 'customer-01');
  assert.equal(parsed.public.url, 'https://example.test/piko');
});

test('loadSiteManifest loads repo site.yaml', () => {
  const root = path.join(__dirname, '..');
  const site = loadSiteManifest(root);
  assert.equal(site.tenant_id, 'customer-01');
  assert.ok(site.public?.url);
});
