const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 60 * 60 * 1000;

function filePath(dataDir) {
  return path.join(dataDir, 'phase0-idempotency.json');
}

function loadMap(dataDir) {
  const p = filePath(dataDir);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return {};
}

function saveMap(dataDir, map) {
  const p = filePath(dataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2), 'utf8');
  } catch (_) {}
}

function pruneExpired(map, nowMs) {
  for (const key of Object.keys(map)) {
    const exp = Number(map[key] && map[key].expiresAt || 0);
    if (!exp || exp <= nowMs) delete map[key];
  }
}

function readExisting(dataDir, key) {
  if (!key) return null;
  const nowMs = Date.now();
  const map = loadMap(dataDir);
  pruneExpired(map, nowMs);
  const hit = map[key];
  if (!hit) {
    saveMap(dataDir, map);
    return null;
  }
  saveMap(dataDir, map);
  return hit.response || null;
}

function storeResult(dataDir, key, response) {
  if (!key) return;
  const nowMs = Date.now();
  const map = loadMap(dataDir);
  pruneExpired(map, nowMs);
  map[key] = {
    expiresAt: nowMs + TTL_MS,
    response,
  };
  saveMap(dataDir, map);
}

module.exports = {
  readExisting,
  storeResult,
};
