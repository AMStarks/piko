const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 2000;

function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const envDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(__dirname, '..', '..', 'data');
}

function filePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-action-dead-letters.json');
}

function loadAll(dataDir) {
  const p = filePath(dataDir);
  try {
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveAll(dataDir, rows) {
  const p = filePath(dataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
  } catch (_) {}
}

function createDeadLetter(dataDir, payload) {
  const rows = loadAll(dataDir);
  const now = new Date().toISOString();
  const letter = {
    id: `adl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'open',
    at: now,
    replayCount: 0,
    ...payload,
  };
  rows.push(letter);
  if (rows.length > MAX_ITEMS) rows.splice(0, rows.length - MAX_ITEMS);
  saveAll(dataDir, rows);
  return letter;
}

function listDeadLetters(dataDir, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const limit = Math.max(1, Math.min(1000, Number(opts.limit || 100)));
  const status = String(opts.status || '').trim();
  let rows = loadAll(dataDir);
  if (status) rows = rows.filter((r) => String(r && r.status || '') === status);
  return rows.slice(-limit).reverse();
}

function getDeadLetter(dataDir, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const rows = loadAll(dataDir);
  return rows.find((r) => String(r && r.id || '') === key) || null;
}

function updateDeadLetter(dataDir, id, patch) {
  const key = String(id || '').trim();
  if (!key) return null;
  const rows = loadAll(dataDir);
  const idx = rows.findIndex((r) => String(r && r.id || '') === key);
  if (idx < 0) return null;
  rows[idx] = { ...rows[idx], ...(patch || {}) };
  saveAll(dataDir, rows);
  return rows[idx];
}

module.exports = {
  createDeadLetter,
  listDeadLetters,
  getDeadLetter,
  updateDeadLetter,
};
