#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '_',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

const OUTPUT_FILE = path.join(ROOT, `PIKO_CODEBASE_EXPORT_${stamp}.txt`);

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv-finetune',
  'Texts',
  'Piko-iOS',
  '.cursor',
  '.idea',
  '.vscode',
  'dist',
  'build',
  '.next',
  'coverage',
]);

const EXCLUDED_FILE_SUFFIXES = [
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.mp4',
  '.mov',
  '.avi',
  '.wav',
  '.mp3',
  '.sqlite',
  '.db',
  '.bin',
];

const MAX_FILE_SIZE_BYTES = 1_500_000;

function isExcludedPath(absPath) {
  const rel = path.relative(ROOT, absPath);
  if (rel === '') return false;
  if (rel.startsWith('..')) return true;
  const parts = rel.split(path.sep);
  return parts.some((p) => EXCLUDED_DIRS.has(p));
}

function hasExcludedSuffix(fileName) {
  const lower = fileName.toLowerCase();
  return EXCLUDED_FILE_SUFFIXES.some((s) => lower.endsWith(s));
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample[i];
    if (c === 0) return true;
    if (c < 7 || (c > 14 && c < 32)) suspicious += 1;
  }
  return sample.length > 0 && (suspicious / sample.length) > 0.2;
}

function collectFiles(dir, out) {
  if (isExcludedPath(dir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (isExcludedPath(abs)) continue;
    if (entry.isDirectory()) {
      collectFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (hasExcludedSuffix(entry.name)) continue;

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;
    out.push(abs);
  }
}

function main() {
  const files = [];
  collectFiles(ROOT, files);

  const lines = [];
  lines.push('==================================================================================');
  lines.push('PIKO FULL CODEBASE EXPORT');
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push('==================================================================================');
  lines.push('Scope: repository root recursive (text files only)');
  lines.push(`Excluded directories: ${Array.from(EXCLUDED_DIRS).join(', ')}`);
  lines.push(`Excluded suffixes: ${EXCLUDED_FILE_SUFFIXES.join(', ')}`);
  lines.push(`Max file size included: ${MAX_FILE_SIZE_BYTES} bytes`);
  lines.push('==================================================================================');
  lines.push('');

  for (const abs of files) {
    const rel = `./${path.relative(ROOT, abs).split(path.sep).join('/')}`;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;

    const content = buf.toString('utf8');
    lines.push('==================================================================================');
    lines.push(`FILE: ${rel}`);
    lines.push('==================================================================================');
    lines.push(content);
    if (!content.endsWith('\n')) lines.push('');
  }

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
  console.log(OUTPUT_FILE);
}

main();
