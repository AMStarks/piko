const fs = require('fs');
const path = require('path');

const PENDING_TTL_MS = 5 * 60 * 1000;

function getPendingFile() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'pending-clarify.json');
}

function loadMap() {
  const map = new Map();
  try {
    const file = getPendingFile();
    if (!fs.existsSync(file)) return map;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && v.bundle && v.expiresAt > now) map.set(k, v);
    }
  } catch (_) {}
  return map;
}

function saveMap(map) {
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  const file = getPendingFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function setPending(sessionKey, row) {
  const map = loadMap();
  map.set(sessionKey, {
    ...row,
    expiresAt: Date.now() + PENDING_TTL_MS,
    createdAt: new Date().toISOString(),
  });
  saveMap(map);
}

function getPending(sessionKey) {
  const map = loadMap();
  const row = map.get(sessionKey);
  if (!row || row.expiresAt <= Date.now()) {
    if (row) {
      map.delete(sessionKey);
      saveMap(map);
    }
    return null;
  }
  return row;
}

function clearPending(sessionKey) {
  const map = loadMap();
  map.delete(sessionKey);
  saveMap(map);
}

module.exports = {
  PENDING_TTL_MS,
  setPending,
  getPending,
  clearPending,
};
