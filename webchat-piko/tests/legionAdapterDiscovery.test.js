/**
 * Legion adapter discovery — API fetch + folder scan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  scanAdaptersFolder,
  getAdaptersPath,
  clearCache,
  getDiscoveredCapabilitiesSync,
} = require('../lib/legionAdapterDiscovery');

function mkTempAdapters() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legion-adapters-'));
  fs.mkdirSync(path.join(root, 'legion-adapters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'legion-adapters', 'foo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'legion-adapters', 'foo', 'manifest.json'),
    JSON.stringify({
      id: 'foo',
      capabilities: [
        { id: 'foo.cap.a', description: 'Cap A' },
        { id: 'foo.cap.b', description: 'Cap B' },
      ],
    }),
    'utf8'
  );
  return root;
}

test('scanAdaptersFolder returns capabilities from manifest', () => {
  clearCache();
  const root = mkTempAdapters();
  const caps = scanAdaptersFolder(root);
  assert.equal(caps.length, 2);
  assert.ok(caps.some((c) => c.id === 'foo.cap.a' && c.description === 'Cap A'));
  assert.ok(caps.some((c) => c.id === 'foo.cap.b' && c.description === 'Cap B'));
});

test('scanAdaptersFolder returns empty when folder missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-empty-'));
  const caps = scanAdaptersFolder(root);
  assert.equal(caps.length, 0);
});

test('getAdaptersPath returns legion-adapters by default', () => {
  const root = '/tmp/piko';
  const p = getAdaptersPath(root);
  assert.ok(p.includes('legion-adapters'));
  assert.ok(p.includes(root));
});

test('getDiscoveredCapabilitiesSync returns empty when cache empty', () => {
  clearCache();
  const caps = getDiscoveredCapabilitiesSync();
  assert.ok(Array.isArray(caps));
  assert.equal(caps.length, 0);
});
