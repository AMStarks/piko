#!/usr/bin/env node
/**
 * CLI — refresh shared context via adapter capabilities.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runContextRefresh } = require('../lib/contextRefresh');
const { stripTrailingSlash } = require('../lib/text');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAdapter(baseUrl, timeoutMs = 120000) {
  const base = stripTrailingSlash(String(baseUrl || 'http://127.0.0.1:8000'));
  const healthUrl = `${base}/health`;
  const started = Date.now();
  let lastError = '';

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { ok: true, waitedMs: Date.now() - started };
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e.message || String(e);
    }
    await sleep(3000);
  }

  return { ok: false, waitedMs: Date.now() - started, error: lastError };
}

async function main() {
  const legionAdapterApiBase = process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000';
  const waitMs = Math.max(0, parseInt(process.env.PIKO_CONTEXT_REFRESH_WAIT_MS || '120000', 10));
  const adapterReady = waitMs > 0
    ? await waitForAdapter(legionAdapterApiBase, waitMs)
    : { ok: true, waitedMs: 0 };
  if (!adapterReady.ok) {
    console.warn(JSON.stringify({
      warning: 'legion_adapter_not_ready_before_context_refresh',
      legionAdapterApiBase,
      waitedMs: adapterReady.waitedMs,
      error: adapterReady.error,
    }));
  }

  const out = await runContextRefresh({
    rootDir: path.join(__dirname, '..'),
    dataDir: process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data'),
    legionAdapterApiBase,
    force: String(process.env.PIKO_CONTEXT_REFRESH_FORCE || '').trim() === '1'
      || process.argv.includes('--force'),
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
