#!/usr/bin/env node
/**
 * P6.2a — Mint named API keys under PIKO_DATA_DIR/secrets/.
 * Usage (on a spine host, with PIKO_DATA_DIR set or --data-dir):
 *   node scripts/mint-named-api-keys.js [--data-dir PATH] [--clients telegram,ios,adapters,monitor]
 * Idempotent: skips names that already have a current secret.
 * Prints client=name (never the secret value) for operator wiring.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CLIENTS = ['telegram', 'ios', 'adapters', 'monitor'];

function parseArgs(argv) {
  const out = { dataDir: '', clients: DEFAULT_CLIENTS.slice(), force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir' && argv[i + 1]) {
      out.dataDir = String(argv[++i]);
    } else if (a === '--clients' && argv[i + 1]) {
      out.clients = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--force') {
      out.force = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: mint-named-api-keys.js [--data-dir PATH] [--clients a,b] [--force]');
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.dataDir) process.env.PIKO_DATA_DIR = opts.dataDir;
  if (!process.env.PIKO_DATA_DIR) {
    console.error('PIKO_DATA_DIR required (or --data-dir)');
    process.exit(1);
  }
  // Resolve secretsStore after env is set
  const secretsStore = require(path.join(__dirname, '..', 'webchat-piko', 'lib', 'secretsStore'));
  const minted = [];
  const kept = [];
  for (const client of opts.clients) {
    const secretName = `api-key-${client}`;
    const existing = secretsStore.getSecret(secretName);
    if (existing && !opts.force) {
      kept.push(client);
      continue;
    }
    const value = `p6-${client}-${crypto.randomBytes(24).toString('hex')}`;
    secretsStore.setSecret(secretName, value);
    minted.push(client);
  }
  // Ensure secrets dir mode
  try {
    fs.chmodSync(secretsStore.secretsDir(), 0o700);
  } catch (_) { /* ok */ }
  console.log(JSON.stringify({
    ok: true,
    data_dir: process.env.PIKO_DATA_DIR,
    minted,
    kept,
    files: minted.map((c) => `api-key-${c}.json`),
  }, null, 2));
}

main();
