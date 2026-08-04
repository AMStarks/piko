#!/usr/bin/env node
/**
 * Generate webchat-piko/.env.example from lib/config.js SCHEMA (P2.2c).
 */
const fs = require('fs');
const path = require('path');
const { schemaForExample } = require('../lib/config');

const outPath = path.join(__dirname, '..', '.env.example');
const rows = schemaForExample();

const lines = [
  '# Auto-generated from lib/config.js — do not hand-edit.',
  '# Regenerate: node scripts/generate-env-example.js',
  '#',
  '# Set PIKO_ENV_STRICT=1 on a tenant only after confirming no false failures.',
  '',
];

for (const s of rows) {
  lines.push(`# ${s.description || s.key} (${s.type}${s.requiredWhenStrict ? ', required when strict' : ''})`);
  if (s.values && s.values.filter(Boolean).length) {
    lines.push(`# allowed: ${s.values.filter(Boolean).join(' | ')}`);
  }
  const val = s.default != null ? String(s.default) : '';
  lines.push(`${s.key}=${val}`);
  lines.push('');
}

fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outPath} (${rows.length} keys)`);
