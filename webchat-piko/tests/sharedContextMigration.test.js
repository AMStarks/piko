const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearCache } = require('../lib/knowledgeManifest');
const { loadContext, getContextPath } = require('../lib/sharedContext');

test('migrates legacy ausmaker-context.json to context/aggregate.json on read', () => {
  clearCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ctx-mig-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'manifest.json'), JSON.stringify({
    contextFile: 'context/aggregate.json',
  }), 'utf8');
  const legacy = path.join(dataDir, 'ausmaker-context.json');
  fs.writeFileSync(legacy, JSON.stringify({ updatedAt: new Date().toISOString(), capabilities: {} }), 'utf8');

  const ctx = loadContext(dataDir);
  assert.ok(ctx);
  const target = getContextPath(dataDir);
  assert.ok(fs.existsSync(target));
  assert.ok(target.endsWith('context/aggregate.json'));
});
