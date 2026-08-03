/**
 * Knowledge manifest loader — backward compat and manifest-driven config.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadManifest,
  getKnowledgePath,
  clearCache,
  inferAdapterFromBrief,
  getDefaultAdapter,
  DEFAULT_CONTEXT_FILE,
} = require('../lib/knowledgeManifest');

function mkTempKnowledge() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-knowledge-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'knowledge', 'prompts'), { recursive: true });
  return root;
}

test('loadManifest returns defaults when no manifest exists', () => {
  clearCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-no-manifest-'));
  const m = loadManifest(root);
  assert.equal(m.contextFile, DEFAULT_CONTEXT_FILE);
  assert.ok(Array.isArray(m.silentCapabilities));
  assert.ok(m.silentCapabilities.includes('sales.analysis.run'));
  assert.ok(Array.isArray(m.nativeCapabilities));
  assert.ok(m.nativeCapabilities.some((nc) => nc.id === 'ausmaker.business.health.review'));
  assert.equal(m.fromFile, false);
});

test('loadManifest loads from manifest.json when present', () => {
  clearCache();
  const root = mkTempKnowledge();
  const manifestPath = path.join(root, 'knowledge', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    contextFile: 'custom-context.json',
    silentCapabilities: ['sales.analysis.run', 'custom.silent'],
    nativeCapabilities: [{ id: 'custom.review', patterns: ['run custom review'] }],
    defaultAdapter: 'custom-adapter',
  }, null, 2), 'utf8');
  const m = loadManifest(root);
  assert.equal(m.contextFile, 'custom-context.json');
  assert.ok(m.silentCapabilities.includes('custom.silent'));
  assert.ok(m.nativeCapabilities.some((nc) => nc.id === 'custom.review'));
  assert.equal(m.defaultAdapter, 'custom-adapter');
  assert.equal(m.fromFile, true);
});

test('loadManifest falls back to defaults on invalid JSON', () => {
  clearCache();
  const root = mkTempKnowledge();
  fs.writeFileSync(path.join(root, 'knowledge', 'manifest.json'), 'not json', 'utf8');
  const m = loadManifest(root);
  assert.equal(m.contextFile, DEFAULT_CONTEXT_FILE);
  assert.equal(m.fromFile, false);
});

test('getKnowledgePath returns path under root when no env', () => {
  const root = path.join(os.tmpdir(), 'piko');
  const kp = getKnowledgePath(root);
  assert.ok(kp.includes('knowledge'));
  assert.ok(kp.includes(root));
});

test('inferAdapterFromBrief uses manifest adapterAliases', () => {
  clearCache();
  const root = mkTempKnowledge();
  fs.writeFileSync(path.join(root, 'knowledge', 'manifest.json'), JSON.stringify({
    defaultAdapter: 'fallback-adapter',
    adapterAliases: [{ pattern: '\\bshopify\\b', adapterId: 'shopify-store' }],
  }), 'utf8');
  assert.equal(inferAdapterFromBrief({ objective: 'review shopify orders' }, root), 'shopify-store');
  assert.equal(inferAdapterFromBrief({ objective: 'generic task' }, root), 'fallback-adapter');
});

test('default context file is platform aggregate path', () => {
  assert.equal(DEFAULT_CONTEXT_FILE, 'context/aggregate.json');
});
