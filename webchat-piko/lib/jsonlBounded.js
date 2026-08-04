/**
 * Size-capped JSONL append + compaction (P3.2e).
 * Reuses the notification-feed pattern: append-only hot path, compact when over max.
 */
const fs = require('fs');
const path = require('path');
const { atomicAppendJsonl } = require('./atomicJson');

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Rewrite file keeping the last `maxLines` non-empty lines (atomic temp+rename).
 * @returns {{ kept: number, trimmed: number }}
 */
function compactJsonlFile(filePath, maxLines) {
  const target = String(filePath || '');
  const max = Math.max(1, Number(maxLines) || 500);
  if (!target || !fs.existsSync(target)) return { kept: 0, trimmed: 0 };
  const raw = fs.readFileSync(target, 'utf8');
  const lines = raw.split('\n').filter((l) => l && l.trim());
  if (lines.length <= max) return { kept: lines.length, trimmed: 0 };
  const kept = lines.slice(-max);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(target)}.tmp.${process.pid}`);
  fs.writeFileSync(tmp, `${kept.join('\n')}\n`, 'utf8');
  fs.renameSync(tmp, target);
  return { kept: kept.length, trimmed: lines.length - kept.length };
}

/**
 * Append one JSON object as a line; compact when line count exceeds max + slack.
 */
function appendJsonlBounded(filePath, obj, opts = {}) {
  const maxLines = opts.maxLines != null ? Number(opts.maxLines) : envInt('PIKO_JSONL_MAX_LINES', 2000);
  const slack = opts.slack != null ? Number(opts.slack) : 50;
  atomicAppendJsonl(filePath, obj);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const n = raw.split('\n').filter((l) => l && l.trim()).length;
    if (n > maxLines + slack) compactJsonlFile(filePath, maxLines);
  } catch (_) { /* best-effort compact */ }
  return filePath;
}

/**
 * Tail-read last `maxLines` from a JSONL file without loading the whole file when large.
 * Reads up to `maxBytes` from the end.
 */
function readJsonlTail(filePath, maxLines = 50, maxBytes = 512 * 1024) {
  const target = String(filePath || '');
  const want = Math.max(1, Number(maxLines) || 50);
  if (!target || !fs.existsSync(target)) return [];
  let st;
  try { st = fs.statSync(target); } catch (_) { return []; }
  if (!st.size) return [];
  const bytes = Math.min(st.size, Math.max(4096, Number(maxBytes) || 512 * 1024));
  const start = Math.max(0, st.size - bytes);
  const buf = Buffer.alloc(bytes);
  const fd = fs.openSync(target, 'r');
  try {
    fs.readSync(fd, buf, 0, bytes, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (start > 0) {
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }
  const lines = text.split('\n').filter((l) => l && l.trim());
  const recent = lines.slice(-want);
  return recent.map((line) => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
}

module.exports = {
  compactJsonlFile,
  appendJsonlBounded,
  readJsonlTail,
  envInt,
};
