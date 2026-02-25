#!/usr/bin/env node
/**
 * Phase 2.3: Doctor script — quick health check: Node, Ollama, env, data dirs, optional /api/health.
 * Run from repo root: node scripts/doctor.js
 * Optional: PIKO_WEBCHAT_URL=http://localhost:3000 to also GET /api/health
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const WEBCHAT_URL = process.env.PIKO_WEBCHAT_URL || '';

const checks = [];

function ok(name, message) {
  checks.push({ name, ok: true, message });
  console.log('✔', name, message || '');
}
function fail(name, message) {
  checks.push({ name, ok: false, message });
  console.log('✖', name, message || '');
}

// Node
const nodeVersion = process.version;
if (process.versions.node) {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  ok('Node', `${process.version} (need >= 16)`);
  if (major < 16) fail('Node', 'Node 16+ required');
} else {
  fail('Node', 'Could not read version');
}

// Env
const envVars = ['PIKO_DATA_DIR', 'PORT'];
const optional = ['PIKO_WEBCHAT_URL', 'OLLAMA_URL', 'PIKO_PRIMARY_HUMAN', 'PIKO_PROMPTS_DIR'];
envVars.forEach((v) => {
  if (process.env[v]) ok(`env ${v}`, process.env[v]);
  else if (v === 'PIKO_DATA_DIR') ok(`env ${v}`, `default ${DATA_DIR}`);
  else if (v === 'PORT') ok(`env ${v}`, process.env[v] || 'default 3000');
});
optional.forEach((v) => {
  if (process.env[v]) ok(`env ${v}`, '(set)');
});

// Data dirs
const dirs = [
  DATA_DIR,
  path.join(DATA_DIR, 'memory'),
  path.join(DATA_DIR, 'learning'),
  path.join(DATA_DIR, 'mind'),
  path.join(DATA_DIR, 'truth'),
];
dirs.forEach((d) => {
  try {
    if (fs.existsSync(d)) ok('dir', d);
    else {
      fs.mkdirSync(d, { recursive: true });
      ok('dir', d + ' (created)');
    }
  } catch (e) {
    fail('dir', d + ' ' + e.message);
  }
});

// Ollama (optional): GET base URL
const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
try {
  const u = new URL(ollamaUrl);
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.get(u.origin + '/api/tags', (res) => {
    if (res.statusCode === 200) ok('Ollama', u.origin);
    else fail('Ollama', u.origin + ' returned ' + res.statusCode);
    maybeHealth();
  });
  req.setTimeout(3000, () => {
    req.destroy();
    fail('Ollama', 'timeout');
    maybeHealth();
  });
  req.on('error', (e) => {
    fail('Ollama', u.origin + ' ' + e.message);
    maybeHealth();
  });
} catch (e) {
  fail('Ollama', e.message);
  maybeHealth();
}

function maybeHealth() {
  if (!WEBCHAT_URL) {
    console.log('(Set PIKO_WEBCHAT_URL to check /api/health)');
    process.exit(checks.some((c) => !c.ok) ? 1 : 0);
    return;
  }
  const u = new URL(WEBCHAT_URL + '/api/health');
  const lib = u.protocol === 'https:' ? https : http;
  const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, timeout: 5000 };
  const req = lib.request(opts, (res) => {
    let data = '';
    res.on('data', (ch) => (data += ch));
    res.on('end', () => {
      if (res.statusCode === 200) ok('/api/health', res.statusCode);
      else fail('/api/health', res.statusCode + ' ' + (data || '').slice(0, 80));
      process.exit(checks.some((c) => !c.ok) ? 1 : 0);
    });
  });
  req.on('error', (e) => {
    fail('/api/health', e.message);
    process.exit(1);
  });
  req.on('timeout', () => {
    req.destroy();
    fail('/api/health', 'timeout');
    process.exit(1);
  });
  req.end();
}
