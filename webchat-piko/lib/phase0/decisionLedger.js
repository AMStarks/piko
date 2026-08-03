const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 5000;

function filePath(dataDir) {
  return path.join(dataDir, 'phase0-decision-ledger.json');
}

function readAll(dataDir) {
  const p = filePath(dataDir);
  try {
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeAll(dataDir, rows) {
  const p = filePath(dataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
  } catch (_) {}
}

function appendDecision(dataDir, entry) {
  const rows = readAll(dataDir);
  rows.push(entry);
  if (rows.length > MAX_ITEMS) rows.splice(0, rows.length - MAX_ITEMS);
  writeAll(dataDir, rows);
  return entry;
}

function listDecisions(dataDir, limit) {
  const max = Math.max(1, Math.min(1000, Number(limit || 100)));
  const rows = readAll(dataDir);
  return rows.slice(-max).reverse();
}

function findDecisionByTrace(dataDir, traceId) {
  const key = String(traceId || '').trim();
  if (!key) return null;
  const rows = listDecisions(dataDir, 1000);
  return rows.find((r) => String(r && r.trace_id || '') === key) || null;
}

module.exports = {
  appendDecision,
  listDecisions,
  findDecisionByTrace,
};
