#!/usr/bin/env node
/**
 * api-ping — synthetic spine probe (purpose: "can a user succeed?" without full smoke).
 */
const http = require('http');
const { stripTrailingSlash } = require('../lib/text');

function defaultWebchatUrl() {
  const fromEnv = String(process.env.PIKO_WEBCHAT_URL || '').trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  const port = String(process.env.PORT || '3000').trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

const WEBCHAT = defaultWebchatUrl();
const ADAPTER = process.env.LEGION_ADAPTER_API_BASE
  || process.env.PIKO_LEGION_ADAPTER_API_BASE
  || 'http://127.0.0.1:8000';

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, timeout: 10000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    }).on('error', reject);
  });
}

async function main() {
  const checks = [];
  const h = await get(`${WEBCHAT}/api/health`);
  checks.push({ id: 'webchat_health', ok: h.status === 200 });

  const o = await get(`${WEBCHAT}/api/observe/summary`);
  checks.push({ id: 'observe_summary', ok: o.status === 200 });

  const a = await get(`${ADAPTER}/health`);
  checks.push({ id: 'adapter_health', ok: a.status === 200 });

  const ok = checks.every((c) => c.ok);
  const out = { ts: new Date().toISOString(), ok, checks };
  console.log(JSON.stringify(out, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
