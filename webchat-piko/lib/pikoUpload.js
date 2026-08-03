/**
 * Save uploads into PIKO_TOOL_DATA_ROOT (iOS / share extension transport).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  sanitizeCharset,
} = require('./text');

function toolDataRoot() {
  return (
    (process.env.PIKO_TOOL_DATA_ROOT || '').trim() ||
    (process.env.PIKO_DATA_DIR || '').trim() ||
    path.join(process.env.PIKO_REPO_ROOT || path.join(__dirname, '..', '..'), 'data')
  );
}

function safeFilename(name) {
  const base = path.basename(String(name || 'upload').trim()) || 'upload';
  return sanitizeCharset(base, '._-', '_').slice(0, 180);
}

/**
 * @param {{ filename: string, content_base64: string, subdir?: string }} opts
 * @returns {{ ok: boolean, path: string, size: number }}
 */
function saveUpload(opts) {
  const filename = safeFilename(opts.filename);
  const subdir = sanitizeCharset(String(opts.subdir || 'inbox'), '_-', '') || 'inbox';
  const b64 = String(opts.content_base64 || '').trim();
  if (!b64) throw new Error('content_base64 is required');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('empty file content');
  const maxMb = Number(process.env.PIKO_UPLOAD_MAX_MB) || 25;
  if (buf.length > maxMb * 1024 * 1024) throw new Error(`file exceeds ${maxMb}MB limit`);

  const root = path.resolve(toolDataRoot());
  const dir = path.join(root, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const dest = path.join(dir, `${stamp}_${filename}`);
  fs.writeFileSync(dest, buf);
  return { ok: true, path: dest, size: buf.length, filename };
}

module.exports = { toolDataRoot, saveUpload, safeFilename };
