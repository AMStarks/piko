#!/usr/bin/env node
/**
 * Ratchet: fail if empty catch (_) {} / catch (e) {} blocks grow (P2.4d).
 * Baseline measured 2026-08-04 on lib/ + server.js.
 * No regex literals — stays clean under check-no-regex --zero.
 */
const fs = require('fs');
const path = require('path');

/** Do not lower without fixing empties; only raise when intentional. */
const BASELINE = 191;

const ROOT = path.join(__dirname, '..');

function isIdentChar(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || ch === '_' || ch === '$';
}

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function countEmptyCatches(text) {
  let n = 0;
  let i = 0;
  const needle = 'catch';
  while (i < text.length) {
    const idx = text.indexOf(needle, i);
    if (idx < 0) break;
    const prev = idx > 0 ? text[idx - 1] : ' ';
    if (isIdentChar(prev)) {
      i = idx + needle.length;
      continue;
    }
    let j = idx + needle.length;
    while (j < text.length && isSpace(text[j])) j += 1;
    if (text[j] !== '(') {
      i = idx + needle.length;
      continue;
    }
    const closeParen = text.indexOf(')', j);
    if (closeParen < 0) break;
    let k = closeParen + 1;
    while (k < text.length && isSpace(text[k])) k += 1;
    if (text[k] !== '{') {
      i = idx + needle.length;
      continue;
    }
    const closeBrace = text.indexOf('}', k);
    if (closeBrace < 0) break;
    const body = text.slice(k + 1, closeBrace);
    let empty = true;
    for (let b = 0; b < body.length; b += 1) {
      if (!isSpace(body[b])) {
        empty = false;
        break;
      }
    }
    if (empty) n += 1;
    i = closeBrace + 1;
  }
  return n;
}

const files = [
  path.join(ROOT, 'server.js'),
  ...walk(path.join(ROOT, 'lib')),
  ...walk(path.join(ROOT, 'routes')),
];
let total = 0;
for (const f of files) {
  total += countEmptyCatches(fs.readFileSync(f, 'utf8'));
}

if (total > BASELINE) {
  console.error(`[empty-catch] FAIL: ${total} empty catch blocks > baseline ${BASELINE}`);
  process.exit(1);
}
console.log(`[empty-catch] OK: ${total} <= baseline ${BASELINE}`);
process.exit(0);
