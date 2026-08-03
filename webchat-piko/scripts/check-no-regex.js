#!/usr/bin/env node
/**
 * WP8 regex ratchet / zero-tolerance checker.
 *
 * Modes:
 *   (default) ratchet — fail if any scanned file exceeds regex-baseline.json
 *   --update-baseline — rewrite baseline from current counts
 *   --zero — fail on any hit in production paths (WP8.8)
 *
 * Exempt: this file, tests/, node_modules/, and optional allowlist.
 * Scans: lib/ (recursive .js), server.js, and runtime scripts (excludes check scripts).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'regex-baseline.json');

const EXEMPT_FILES = new Set([
  path.join('scripts', 'check-no-regex.js'),
  path.join('scripts', 'check-no-routing-regex.js'),
]);

function stripCommentsAndStrings(source) {
  const out = [];
  let i = 0;
  let mode = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; i += 2; out.push(' '); continue; }
      if (ch === '/' && next === '*') { mode = 'block'; i += 2; out.push(' '); continue; }
      if (ch === "'") { mode = 'sq'; i++; out.push(' '); continue; }
      if (ch === '"') { mode = 'dq'; i++; out.push(' '); continue; }
      if (ch === '`') { mode = 'tq'; i++; out.push(' '); continue; }
      out.push(ch);
      i++;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); }
      else out.push(' ');
      i++;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; i += 2; out.push(' '); continue; }
      out.push(ch === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') { i += 2; out.push(' '); continue; }
      if (ch === (mode === 'sq' ? "'" : '"')) { mode = 'code'; i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (mode === 'tq') {
      if (ch === '\\') { i += 2; out.push(' '); continue; }
      if (ch === '`') { mode = 'code'; i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
  }
  return out.join('');
}

function looksLikeRegexLiteral(slice) {
  // Char-scan: /.../ with at least one regex metachar or length>=2 body + flags
  if (!slice.startsWith('/')) return false;
  let i = 1;
  let body = '';
  let escaped = false;
  while (i < slice.length) {
    const ch = slice[i];
    if (escaped) { body += ch; escaped = false; i++; continue; }
    if (ch === '\\') { body += ch; escaped = true; i++; continue; }
    if (ch === '/') break;
    if (ch === '\n') return false;
    body += ch;
    i++;
  }
  if (i >= slice.length || slice[i] !== '/') return false;
  if (!body) return false;
  let flags = '';
  i++;
  while (i < slice.length && 'gimsuy'.includes(slice[i])) {
    flags += slice[i];
    i++;
  }
  // Reject likely division / path fragments: require a regex metachar or flags
  const meta = '[](){}.*+?^$|\\';
  let hasMeta = false;
  for (const ch of body) {
    if (meta.includes(ch)) { hasMeta = true; break; }
  }
  if (!hasMeta && !flags) return false;
  return true;
}

function countRegexHits(source) {
  const code = stripCommentsAndStrings(source);
  const lines = source.split('\n');
  const codeLines = code.split('\n');
  const hits = [];
  for (let li = 0; li < codeLines.length; li++) {
    const line = codeLines[li];
    if (line.includes('RegExp(') || line.includes('new RegExp')) {
      hits.push({ line: li + 1, text: lines[li].trim().slice(0, 120) });
      continue;
    }
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '/') continue;
      const prev = line.slice(0, i).replace(/\s+$/, '');
      const prevCh = prev.length ? prev[prev.length - 1] : '';
      const okPrev = !prevCh
        || '=(:,!&|?~^%*[{+-'.includes(prevCh)
        || prev.endsWith('return')
        || prev.endsWith('case')
        || prev.endsWith('.match')
        || prev.endsWith('.test')
        || prev.endsWith('.exec')
        || prev.endsWith('.search')
        || prev.endsWith('.replace')
        || prev.endsWith('.split')
        || prev.endsWith('.matchAll')
        || prev.endsWith('if')
        || prev.endsWith('while')
        || prev.endsWith('||')
        || prev.endsWith('&&');
      if (!okPrev && prevCh !== '(' && prevCh !== ')') continue;
      if (looksLikeRegexLiteral(line.slice(i))) {
        hits.push({ line: li + 1, text: lines[li].trim().slice(0, 120) });
        break;
      }
    }
  }
  return hits;
}

function walkJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkJs(abs, acc);
    else if (name.endsWith('.js')) acc.push(abs);
  }
  return acc;
}

function collectTargets() {
  const files = [];
  files.push(...walkJs(path.join(ROOT, 'lib')));
  files.push(path.join(ROOT, 'server.js'));
  // Runtime scripts (exclude pure eval/smoke generators later if needed)
  for (const abs of walkJs(path.join(ROOT, 'scripts'))) {
    const rel = path.relative(ROOT, abs);
    if (EXEMPT_FILES.has(rel)) continue;
    // Keep ratchet on production-ish scripts; skip test-only generators is optional
    files.push(abs);
  }
  return files.filter((f) => fs.existsSync(f));
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update-baseline');
  const zero = args.includes('--zero');
  const targets = collectTargets();
  const counts = {};
  const details = {};
  let total = 0;
  for (const abs of targets) {
    const rel = path.relative(ROOT, abs);
    const src = fs.readFileSync(abs, 'utf8');
    const hits = countRegexHits(src);
    counts[rel] = hits.length;
    if (hits.length) details[rel] = hits.slice(0, 5);
    total += hits.length;
  }

  if (update) {
    const payload = {
      updated_at: new Date().toISOString(),
      total,
      files: counts,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
    console.log(`Updated baseline: ${total} hits across ${Object.keys(counts).length} files → ${BASELINE_PATH}`);
    return;
  }

  if (zero) {
    const offenders = Object.entries(counts).filter(([, n]) => n > 0);
    if (offenders.length) {
      console.error('Zero-tolerance regex check FAILED:');
      for (const [f, n] of offenders.sort((a, b) => b[1] - a[1])) {
        console.error(`  ${n}\t${f}`);
        for (const h of (details[f] || [])) console.error(`    L${h.line}: ${h.text}`);
      }
      process.exit(1);
    }
    console.log('Zero-tolerance regex check OK — 0 hits in production paths');
    return;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('Missing regex-baseline.json — run with --update-baseline first');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const baseFiles = baseline.files || {};
  const regressions = [];
  for (const [f, n] of Object.entries(counts)) {
    const prev = baseFiles[f] != null ? baseFiles[f] : 0;
    if (n > prev) {
      regressions.push({ file: f, prev, now: n, delta: n - prev });
    }
  }
  // New files with hits also fail
  for (const [f, n] of Object.entries(counts)) {
    if (baseFiles[f] == null && n > 0) {
      if (!regressions.find((r) => r.file === f)) {
        regressions.push({ file: f, prev: 0, now: n, delta: n, note: 'new_file' });
      }
    }
  }

  if (regressions.length) {
    console.error('Regex ratchet FAILED — counts increased:');
    for (const r of regressions) {
      console.error(`  ${r.file}: ${r.prev} → ${r.now} (+${r.delta})${r.note ? ' [' + r.note + ']' : ''}`);
    }
    process.exit(1);
  }

  const reduced = [];
  for (const [f, prev] of Object.entries(baseFiles)) {
    const now = counts[f] != null ? counts[f] : 0;
    if (now < prev) reduced.push({ file: f, prev, now });
  }
  console.log(`Regex ratchet OK — total=${total} (baseline ${baseline.total || '?'}), reductions=${reduced.length}`);
  if (reduced.length) {
    for (const r of reduced.slice(0, 20)) {
      console.log(`  ↓ ${r.file}: ${r.prev} → ${r.now}`);
    }
  }
}

if (require.main === module) main();

module.exports = { countRegexHits, stripCommentsAndStrings, collectTargets };
