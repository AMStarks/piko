/**
 * Pending money-plane dual-confirm (P4.4) — same shape as configMutatePending.
 * HTTP callers use confirm_token; chat callers reply YES/NO.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stripTrailingSentencePunct } = require('./text');

const PENDING_TTL_MS = 5 * 60 * 1000;

const CONFIRM_WORDS = new Set(['yes', 'y', 'confirm', 'ok', 'sure', 'yes please', 'do it']);
const CANCEL_WORDS = new Set(['no', 'n', 'cancel', 'stop', 'nevermind', 'never mind']);

function getPendingFile() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'pending-money-mutations.json');
}

function loadPendingMap() {
  const map = new Map();
  try {
    const pendingFile = getPendingFile();
    if (!fs.existsSync(pendingFile)) return map;
    const raw = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && v.intent && v.expiresAt > now) map.set(k, v);
    }
  } catch (err) {
    void err;
  }
  return map;
}

function savePendingMap(map) {
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  const pendingFile = getPendingFile();
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify(obj, null, 2), 'utf8');
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function setPending(sessionKey, intent) {
  const map = loadPendingMap();
  const row = {
    intent,
    token: newToken(),
    expiresAt: Date.now() + PENDING_TTL_MS,
    createdAt: new Date().toISOString(),
  };
  map.set(sessionKey, row);
  savePendingMap(map);
  return row;
}

function clearPending(sessionKey) {
  const map = loadPendingMap();
  map.delete(sessionKey);
  savePendingMap(map);
}

function getPending(sessionKey) {
  const map = loadPendingMap();
  const row = map.get(sessionKey);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    map.delete(sessionKey);
    savePendingMap(map);
    return null;
  }
  return row;
}

/**
 * Consume a confirm_token issued by setPending (HTTP dual-confirm).
 * @returns {object|null} pending row if token matched
 */
function consumeToken(sessionKey, token) {
  const pending = getPending(sessionKey);
  if (!pending) return null;
  if (String(pending.token || '') !== String(token || '').trim()) return null;
  clearPending(sessionKey);
  return pending;
}

/**
 * Chat YES/NO against a pending money intent.
 * @returns {{ reply: string, route: string, intent?: object } | null}
 */
function tryConfirm(sessionKey, message) {
  const trimmed = stripTrailingSentencePunct(message).toLowerCase();
  const pending = getPending(sessionKey);
  if (!pending) return null;

  if (CANCEL_WORDS.has(trimmed)) {
    clearPending(sessionKey);
    return { reply: 'Cancelled — no money / ERP action was taken.', route: 'money_mutate_cancelled' };
  }

  if (!CONFIRM_WORDS.has(trimmed)) return null;

  clearPending(sessionKey);
  return {
    reply: null,
    route: 'money_mutate_confirmed',
    intent: pending.intent,
    confirmed: true,
  };
}

module.exports = {
  PENDING_TTL_MS,
  setPending,
  clearPending,
  getPending,
  consumeToken,
  tryConfirm,
};
