#!/usr/bin/env node
/**
 * Watch service — on-node health snapshot + Telegram alert on degrade.
 * Prefer localhost probes (avoid WAN hairpin false DOWN). Cooldown alerts.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { stripTrailingSlash } = require('../lib/text');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const WEBCHAT = stripTrailingSlash(process.env.PIKO_WATCH_WEBCHAT_URL
  || process.env.PIKO_WEBCHAT_LOCAL_URL
  || 'http://127.0.0.1:3000');
const ADAPTER = stripTrailingSlash(process.env.PIKO_LEGION_ADAPTER_API_BASE
  || process.env.LEGION_ADAPTER_API_BASE
  || 'http://127.0.0.1:8000');
const AUSMAKER = stripTrailingSlash(process.env.PIKO_AUSMAKER_BASE_URL || process.env.AUSMAKER_BASE_URL || 'http://127.0.0.1:5001');
const OUT = path.join(DATA_DIR, 'watch-state.json');
const TENANT = process.env.PIKO_TENANT_ID || 'customer-01';
const ALERT_COOLDOWN_MS = Math.max(5 * 60 * 1000, Number(process.env.PIKO_WATCH_ALERT_COOLDOWN_MS || 60 * 60 * 1000));

function get(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(raw) });
        } catch (_) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: raw.slice(0, 200) });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function readPrev() {
  if (!fs.existsSync(OUT)) return null;
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return null; }
}

async function maybeAlert(prev, next) {
  if (next.status !== 'degraded') {
    next.fail_streak = 0;
    return;
  }
  const streak = (prev && prev.status === 'degraded' ? Number(prev.fail_streak || 1) : 0) + 1;
  next.fail_streak = streak;
  // Require 2 consecutive degraded polls (~10 min) before paging — absorbs restart flaps.
  if (streak < 2) return;
  if (prev && prev.status === 'degraded' && prev.last_alert_at) {
    const lastAlertAt = Date.parse(prev.last_alert_at) || 0;
    if (lastAlertAt && Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return;
  }
  try {
    const { notifyAdmin } = require('../lib/notifyAdmin');
    await notifyAdmin(
      `⚠️ Legion watch: ${TENANT} spine degraded\nwebchat: ${next.webchat.ok ? 'OK' : 'DOWN'}\nadapter: ${next.adapter.ok ? 'OK' : 'DOWN'}`,
      { category: 'watch', severity: 'warn', source: 'legion-watch', title: 'Spine degraded' },
    );
    next.last_alert_at = new Date().toISOString();
  } catch (e) {
    console.error('alert failed:', e.message);
  }
}

async function main() {
  const prev = readPrev();
  const [webchat, adapter, ausmaker] = await Promise.all([
    get(`${WEBCHAT}/api/health`),
    get(`${ADAPTER}/health`),
    get(`${AUSMAKER}/api/sales-db/status`),
  ]);
  // AusMaker ops API counts as adapter health when dedicated Legion :8000 is down.
  const adapterOk = !!(adapter.ok || (ausmaker.ok && ausmaker.body && Number(ausmaker.body.rows || 0) > 0));
  const ok = !!(webchat.ok && adapterOk);
  const state = {
    ts: new Date().toISOString(),
    tenant_id: TENANT,
    status: ok ? 'healthy' : 'degraded',
    webchat: { ok: !!webchat.ok, status: webchat.status, model: webchat.body?.model, url: WEBCHAT },
    adapter: {
      ok: adapterOk,
      status: adapter.status || ausmaker.status,
      legion: !!adapter.ok,
      ausmaker: !!(ausmaker.ok && ausmaker.body && Number(ausmaker.body.rows || 0) > 0),
      url: ADAPTER,
    },
    host: require('os').hostname(),
    last_alert_at: (prev && prev.last_alert_at) || null,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  await maybeAlert(prev, state);
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  try {
    const { writeSiteHeartbeat } = require('../lib/tenantRegistry');
    writeSiteHeartbeat(DATA_DIR, state);
  } catch (_) { /* ignore */ }
  console.log(JSON.stringify(state));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
