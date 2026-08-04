/**
 * P3.1a — Route parity safety net for server.js decomposition.
 *
 * Frozen fixture: tests/fixtures/routeParity.json
 * Asserts every catalogued (method, path, match) still appears in the live
 * route sources (server.js + routes/**). Update the fixture deliberately
 * when adding/removing routes.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadRouteCatalog, catalogKey, indexCatalog } = require('../lib/routeCatalog');
const { createRouteRegistry } = require('../lib/routeRegistry');

const ROOT = path.join(__dirname, '..');

function walkJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, acc);
    else if (ent.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function collectRouteSources() {
  const files = [path.join(ROOT, 'server.js'), ...walkJs(path.join(ROOT, 'routes'))];
  return files.filter((f) => fs.existsSync(f)).map((f) => ({
    file: path.relative(ROOT, f),
    text: fs.readFileSync(f, 'utf8'),
  }));
}

/**
 * Discover route registrations from source without requiring a live server.
 * Matches the patterns used in server.js today and routes/* after extraction.
 */
function discoverRoutesFromSources(sources) {
  const found = new Map();
  for (const { text } of sources) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const methodMatch = line.match(/req\.method\s*===\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/);
      // Also accept registry.add('GET', '/api/...')
      const addMatch = line.match(/\.add\(\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]\s*,\s*['"]([^'"]+)['"]/);
      if (addMatch) {
        const method = addMatch[1];
        const pth = addMatch[2];
        const match = /match\s*:\s*['"]prefix['"]/.test(line) || /match\s*:\s*['"]prefix['"]/.test(lines[i + 1] || '')
          ? 'prefix'
          : 'exact';
        const key = `${method}|${match}|${pth}`;
        found.set(key, { method, path: pth, match });
        continue;
      }
      if (!methodMatch) continue;
      const method = methodMatch[1];
      const window = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join('\n');
      for (const m of window.matchAll(/pathname\s*===\s*['"]([^'"]+)['"]/g)) {
        const key = `${method}|exact|${m[1]}`;
        found.set(key, { method, path: m[1], match: 'exact' });
      }
      for (const m of window.matchAll(/pathname\.startsWith\(\s*['"]([^'"]+)['"]/g)) {
        const key = `${method}|prefix|${m[1]}`;
        found.set(key, { method, path: m[1], match: 'prefix' });
      }
    }
  }
  return found;
}

describe('P3.1a route parity fixture', () => {
  const catalog = loadRouteCatalog();

  it('loads a non-empty frozen catalog', () => {
    assert.ok(catalog.routes.length >= 100, `expected >=100 routes, got ${catalog.routes.length}`);
    assert.equal(catalog.generated_from, 'server.js');
  });

  it('every catalog entry has method/path/match/auth/group', () => {
    for (const r of catalog.routes) {
      assert.ok(r.method, `missing method: ${JSON.stringify(r)}`);
      assert.ok(r.path && r.path.startsWith('/'), `bad path: ${JSON.stringify(r)}`);
      assert.ok(r.match === 'exact' || r.match === 'prefix', `bad match: ${JSON.stringify(r)}`);
      assert.ok(r.auth, `missing auth: ${JSON.stringify(r)}`);
      assert.ok(r.group, `missing group: ${JSON.stringify(r)}`);
    }
  });

  it('catalog keys are unique', () => {
    const idx = indexCatalog(catalog.routes);
    assert.equal(idx.size, catalog.routes.length);
  });

  it('every catalogued route still exists in server.js or routes/', () => {
    const sources = collectRouteSources();
    assert.ok(sources.some((s) => s.file === 'server.js'));
    const live = discoverRoutesFromSources(sources);
    const missing = [];
    for (const r of catalog.routes) {
      const key = catalogKey(r);
      if (!live.has(key)) missing.push(key);
    }
    assert.equal(
      missing.length,
      0,
      `routes missing from live sources (update fixture only if intentional):\n${missing.slice(0, 20).join('\n')}`,
    );
  });

  it('live sources do not grow beyond catalog without fixture update (ratchet)', () => {
    const sources = collectRouteSources();
    const live = discoverRoutesFromSources(sources);
    const idx = indexCatalog(catalog.routes);
    const extras = [];
    for (const key of live.keys()) {
      if (!idx.has(key)) extras.push(key);
    }
    // Allow a small slack for discovery false-positives (suffix windows, etc.).
    // Fail hard if many untracked routes appear during decomposition.
    assert.ok(
      extras.length <= 15,
      `too many uncatalogued live routes (${extras.length}). Add to fixture:\n${extras.slice(0, 30).join('\n')}`,
    );
  });

  it('extraction groups used by the handoff are present', () => {
    const groups = new Set(catalog.routes.map((r) => r.group));
    for (const g of ['webhooks', 'admin', 'ops', 'agents', 'cultures', 'chat']) {
      assert.ok(groups.has(g), `missing group ${g}`);
    }
  });
});

describe('P3.1a routeRegistry', () => {
  it('dispatches exact and prefix routes', async () => {
    const reg = createRouteRegistry();
    const hits = [];
    reg.add('GET', '/api/health', async () => { hits.push('health'); }, { group: 'ops', auth: 'public' });
    reg.add('GET', '/api/agents/jobs/', async () => { hits.push('job'); }, {
      match: 'prefix',
      group: 'agents',
      auth: 'open',
    });
    const handled1 = await reg.dispatch(
      { method: 'GET', url: '/api/health' },
      {},
      { pathname: '/api/health' },
    );
    const handled2 = await reg.dispatch(
      { method: 'GET', url: '/api/agents/jobs/abc' },
      {},
      { pathname: '/api/agents/jobs/abc' },
    );
    const handled3 = await reg.dispatch(
      { method: 'POST', url: '/api/health' },
      {},
      { pathname: '/api/health' },
    );
    assert.equal(handled1, true);
    assert.equal(handled2, true);
    assert.equal(handled3, false);
    assert.deepEqual(hits, ['health', 'job']);
  });

  it('list() exposes registered catalog shape', () => {
    const reg = createRouteRegistry();
    reg.add('POST', '/api/webhooks/events', async () => {}, { group: 'webhooks', auth: 'webhook' });
    const row = reg.list()[0];
    assert.equal(row.method, 'POST');
    assert.equal(row.path, '/api/webhooks/events');
    assert.equal(row.group, 'webhooks');
  });
});
