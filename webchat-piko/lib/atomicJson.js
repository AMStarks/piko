/**
 * Atomic JSON persistence — write temp + fsync + rename (P2.1).
 * Crash mid-write leaves the previous file intact.
 */
const fs = require('fs');
const path = require('path');

/**
 * Atomically write a JSON-serializable value to `filePath`.
 * Uses `${filePath}.tmp.<pid>` in the same directory, fsyncs, then renameSync.
 */
function atomicWriteJson(filePath, obj, opts = {}) {
  const target = String(filePath || '');
  if (!target) throw new Error('atomicWriteJson: path required');
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(target)}.tmp.${process.pid}`);
  const pretty = opts.pretty !== false;
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  return target;
}

/**
 * Append a single JSON line (JSONL). Not fully atomic across concurrent writers
 * on all platforms, but avoids read-modify-write of the whole file.
 */
function atomicAppendJsonl(filePath, obj) {
  const target = String(filePath || '');
  if (!target) throw new Error('atomicAppendJsonl: path required');
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const line = `${JSON.stringify(obj)}\n`;
  fs.appendFileSync(target, line, 'utf8');
  return target;
}

/**
 * Read JSON file; return `fallback` on missing/corrupt (never throw).
 */
function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !String(raw).trim()) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/**
 * Write content to a new path, then remove the old path (safe status transition).
 * Never unlinks the source before the destination exists.
 */
function atomicMoveJson(fromPath, toPath, obj) {
  atomicWriteJson(toPath, obj);
  if (fromPath && fromPath !== toPath && fs.existsSync(fromPath)) {
    try { fs.unlinkSync(fromPath); } catch (_) { /* destination already durable */ }
  }
  return toPath;
}

module.exports = {
  atomicWriteJson,
  atomicAppendJsonl,
  atomicMoveJson,
  readJsonSafe,
};
