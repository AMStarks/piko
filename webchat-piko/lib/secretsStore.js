/**
 * Local-first secrets store (P3.6) — JSON files under PIKO_DATA_DIR/secrets/.
 * Mode 0600 per file; directory 0700. Supports {current, previous} rotation windows.
 * verifySecret falls back to process.env for bootstrap / legacy tenants.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { atomicWriteJson, readJsonSafe } = require('./atomicJson');

const ENV_BY_NAME = {
  webhook: 'PIKO_WEBHOOK_SECRET',
  'api-key': 'PIKO_API_KEY',
};

function dataRoot() {
  return process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function secretsDir() {
  return path.join(dataRoot(), 'secrets');
}

function assertSafeName(name) {
  const safe = String(name || '').trim();
  if (!safe || safe.includes('/') || safe.includes('\\') || safe.includes('..')) {
    throw new Error('secretsStore: invalid secret name');
  }
  return safe;
}

function secretFilePath(name) {
  return path.join(secretsDir(), `${assertSafeName(name)}.json`);
}

function ensureSecretsDir() {
  const dir = secretsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {
    /* best effort */
  }
  return dir;
}

function normalizeRecord(value) {
  if (value == null) return null;
  if (typeof value === 'string') return { current: String(value) };
  if (typeof value !== 'object') return null;
  const current = value.current != null ? String(value.current) : '';
  const previous = value.previous != null ? String(value.previous) : '';
  const out = { current };
  if (previous) out.previous = previous;
  return out;
}

function writeSecretFile(name, record) {
  ensureSecretsDir();
  const target = secretFilePath(name);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${path.basename(target)}.tmp.${process.pid}`);
  const body = JSON.stringify(record, null, 2);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch (_) {
    /* best effort */
  }
  return target;
}

function loadRecord(name) {
  return readJsonSafe(secretFilePath(name), null);
}

function envFallback(name) {
  const key = ENV_BY_NAME[name];
  if (!key) return '';
  return String(process.env[key] || '').trim();
}

function candidatesFromRecord(record) {
  const norm = normalizeRecord(record);
  if (!norm) return [];
  const out = [];
  if (norm.current) out.push(norm.current);
  if (norm.previous) out.push(norm.previous);
  return out;
}

function timingSafeMatch(presented, expected) {
  if (!expected || !presented) return false;
  const a = Buffer.from(String(presented));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Return the current secret value from the store, or null if unset.
 */
function getSecret(name) {
  const record = loadRecord(name);
  const norm = normalizeRecord(record);
  if (!norm || !norm.current) return null;
  return norm.current;
}

/**
 * Persist a secret. `value` may be a string or `{ current, previous }` for rotation.
 */
function setSecret(name, value) {
  assertSafeName(name);
  const record = normalizeRecord(value);
  if (!record || !record.current) {
    throw new Error('setSecret: current value required');
  }
  return writeSecretFile(name, record);
}

/**
 * True when the store or env fallback has a non-empty configured value.
 */
function hasSecret(name) {
  assertSafeName(name);
  const fromStore = candidatesFromRecord(loadRecord(name));
  if (fromStore.length > 0) return true;
  return !!envFallback(name);
}

/**
 * Verify presented material against store (current + previous) then env fallback.
 */
function verifySecret(name, presented) {
  assertSafeName(name);
  if (!presented) return false;
  const candidates = [...candidatesFromRecord(loadRecord(name))];
  const envVal = envFallback(name);
  if (envVal) candidates.push(envVal);
  for (const expected of candidates) {
    if (timingSafeMatch(presented, expected)) return true;
  }
  return false;
}

module.exports = {
  secretsDir,
  secretFilePath,
  getSecret,
  setSecret,
  hasSecret,
  verifySecret,
  ENV_BY_NAME,
};
