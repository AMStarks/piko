/**
 * Frozen route catalog helpers (P3.1a).
 * The authoritative fixture lives at tests/fixtures/routeParity.json;
 * production code can load a copy under routes/catalog.json once extractions land.
 */
const fs = require('fs');
const path = require('path');

function defaultFixturePath() {
  return path.join(__dirname, '..', 'tests', 'fixtures', 'routeParity.json');
}

function loadRouteCatalog(filePath) {
  const p = filePath || defaultFixturePath();
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw);
  const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
  return {
    generated_from: parsed.generated_from || null,
    generated_at: parsed.generated_at || null,
    routes,
  };
}

function catalogKey(route) {
  return `${route.method}|${route.match}|${route.path}`;
}

function indexCatalog(routes) {
  const map = new Map();
  for (const r of routes || []) {
    map.set(catalogKey(r), r);
  }
  return map;
}

module.exports = {
  defaultFixturePath,
  loadRouteCatalog,
  catalogKey,
  indexCatalog,
};
