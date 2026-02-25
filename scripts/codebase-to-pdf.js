#!/usr/bin/env node
/**
 * Dumps full Piko codebase to CODEBASE_FULL.txt and CODEBASE_FULL.pdf.
 * Run from repo root: node scripts/codebase-to-pdf.js
 * Requires: npm install pdfkit (run in webchat-piko for PDF output).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_TXT = path.join(ROOT, 'CODEBASE_FULL.txt');
const OUT_PDF = path.join(ROOT, 'CODEBASE_FULL.pdf');

const SKIP_DIRS = new Set(['node_modules', '.git', 'auth', 'history', 'logs', 'build', 'DerivedData', '.build']);
const SKIP_FILES = new Set(['CODEBASE_FULL.txt', 'CODEBASE_FULL.pdf', 'package-lock.json']);
const INCLUDE_EXT = new Set(['.js', '.ts', '.json', '.md', '.html', '.css', '.swift', '.plist', '.sh', '.yaml', '.yml', '.env.example', '.gitignore']);

function shouldInclude(name, ext, fullPath) {
  if (SKIP_FILES.has(name)) return false;
  if (fullPath.includes('node_modules') || fullPath.includes('.git/')) return false;
  if (INCLUDE_EXT.has(ext)) return true;
  if (name.endsWith('.env.example') || name === '.gitignore') return true;
  return false;
}

function walk(dir, base = ROOT) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      files.push(...walk(full, base));
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (shouldInclude(e.name, ext, full)) files.push(full);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function buildFullText() {
  const files = walk(ROOT);
  const lines = [];
  lines.push('PIKO CODEBASE EXPORT');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('Root: ' + ROOT);
  lines.push('');
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    lines.push('');
    lines.push('=== ' + rel + ' ===');
    lines.push('');
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const safe = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      lines.push(safe);
    } catch (err) {
      lines.push('(binary or unreadable: ' + err.message + ')');
    }
  }
  return lines.join('\n');
}

// 1. Regenerate CODEBASE_FULL.txt
const fullText = buildFullText();
fs.writeFileSync(OUT_TXT, fullText, 'utf8');
console.log('Wrote', OUT_TXT, '(' + (fullText.length / 1024).toFixed(1) + ' KB)');

// 2. PDF if pdfkit available
const pdfkitPath = path.join(ROOT, 'webchat-piko', 'node_modules', 'pdfkit');
try {
  const PDFDocument = require(pdfkitPath);
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  doc.pipe(fs.createWriteStream(OUT_PDF));
  doc.fontSize(7).font('Courier');
  doc.text(fullText, { lineBreak: true, align: 'left' });
  doc.end();
  console.log('Wrote', OUT_PDF);
} catch (e) {
  console.log('PDF skip (install in webchat-piko: npm install pdfkit):', e.message);
}
