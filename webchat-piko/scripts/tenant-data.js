#!/usr/bin/env node
/**
 * Per-tenant data lifecycle (P3.6): export tarball or quarantine-delete (reversible).
 * Never rm -rf — delete moves the data root into a timestamped quarantine folder.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.error('Usage: node scripts/tenant-data.js export <dataDir> [output.tar.gz]');
  console.error('       node scripts/tenant-data.js delete <dataDir>');
  process.exit(1);
}

function resolveDataDir(raw) {
  const dir = path.resolve(String(raw || '').trim());
  if (!dir) throw new Error('dataDir required');
  if (!fs.existsSync(dir)) throw new Error(`dataDir not found: ${dir}`);
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);
  return dir;
}

function exportData(dataDir, outPath) {
  const resolved = resolveDataDir(dataDir);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  const output = outPath
    ? path.resolve(outPath)
    : path.join(parent, `${base}-export-${Date.now()}.tar.gz`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync('tar', ['-czf', output, '-C', parent, base], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || 'tar failed').trim();
    throw new Error(msg || 'tar export failed');
  }
  return output;
}

/**
 * Quarantine-move tenant data — parent/.quarantine-delete-<ts>/<basename>.
 * Reversible; 14-day cleanup is an operator concern (see PIKO_QUARANTINE_DAYS).
 */
function deleteData(dataDir) {
  const resolved = resolveDataDir(dataDir);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  const ts = Date.now();
  const quarantineRoot = path.join(parent, `.quarantine-delete-${ts}`);
  fs.mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 });
  const dest = path.join(quarantineRoot, base);
  if (fs.existsSync(dest)) {
    throw new Error(`quarantine destination already exists: ${dest}`);
  }
  fs.renameSync(resolved, dest);
  return { quarantineRoot, dest, ts };
}

function main() {
  const [cmd, dataDir, extra] = process.argv.slice(2);
  if (!cmd || !dataDir) usage();
  if (cmd === 'export') {
    const out = exportData(dataDir, extra);
    console.log(out);
    return;
  }
  if (cmd === 'delete') {
    const out = deleteData(dataDir);
    console.log(JSON.stringify({ ok: true, ...out }));
    return;
  }
  usage();
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}

module.exports = {
  exportData,
  deleteData,
  resolveDataDir,
};
