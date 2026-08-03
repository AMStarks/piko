/**
 * POST Legion adapter capability runs (explicit capability — no re-inference).
 */
const http = require('http');
const https = require('https');

const {
  stripTrailingSlash,
} = require('./text');

function postJsonToUrl(urlString, payload, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const body = JSON.stringify(payload || {});
    const lib = u.protocol === 'https:' ? https : http;
    const timeoutMs = opts.timeoutMs || 20000;
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(opts.headers || {}) };
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch (_) {
          parsed = { raw: data };
        }
        resolve({ statusCode: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

function getLegionAdapterBase() {
  return stripTrailingSlash(String(
    process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000',
  ).trim());
}

function getDefaultAdapterId() {
  return String(process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies').trim();
}

/** Culture / Egyptian Insights capabilities — never dispatch to AusMaker. */
const ADAPTER_BY_CAPABILITY = {
  'research.scrape.run': 'egyptian-insights',
  'scribe.transcribe.image': 'egyptian-insights',
  'translation.critique': 'egyptian-insights',
  'culture.pipeline.run': 'egyptian-insights',
  'culture.corpus.search': 'egyptian-insights',
  'health.check': 'egyptian-insights',
  'inventory.low_stock.scan': 'ausmakersupplies',
  'inventory.report.export': 'ausmakersupplies',
  'inventory.csv.generate': 'ausmakersupplies',
  'sales.analysis.run': 'ausmakersupplies',
  'purchase_order.draft.create': 'ausmakersupplies',
  'purchase_order.submit': 'ausmakersupplies',
  'ausmaker.runbook.execute': 'ausmakersupplies',
};

function resolveAdapterForCapability(capability) {
  const cap = String(capability || '').trim();
  if (ADAPTER_BY_CAPABILITY[cap]) return ADAPTER_BY_CAPABILITY[cap];
  try {
    const { getDiscoveredCapabilitiesSync, scanAdaptersFolder } = require('./legionAdapterDiscovery');
    const path = require('path');
    const discovered = getDiscoveredCapabilitiesSync();
    const hit = discovered.find((c) => c && c.id === cap && c.adapterId);
    if (hit && hit.adapterId) return hit.adapterId;
    const fromFolder = scanAdaptersFolder(path.join(__dirname, '..'));
    const folderHit = fromFolder.find((c) => c && c.id === cap && c.adapterId);
    if (folderHit && folderHit.adapterId) return folderHit.adapterId;
  } catch (_) { /* ignore */ }
  return getDefaultAdapterId();
}

/**
 * @param {object} opts
 * @param {string} opts.capability
 * @param {object} [opts.input]
 * @param {string} [opts.adapterId]
 * @param {object} [opts.context]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.piko_user_id]
 */
async function dispatchLegionCapabilityRun(opts = {}) {
  const capability = String(opts.capability || '').trim();
  const adapterId = opts.adapterId || resolveAdapterForCapability(capability) || getDefaultAdapterId();
  if (!capability) {
    return { ok: false, code: 'NO_CAPABILITY', message: 'capability required' };
  }
  const baseUrl = stripTrailingSlash((opts.baseUrl || getLegionAdapterBase()));
  const endpoint = `${baseUrl}/api/adapters/${encodeURIComponent(adapterId)}/run`;
  const payload = {
    capability,
    input: opts.input || {},
    context: {
      trace_id: `trc_cap_${Date.now()}`,
      brief_id: `lcap_${Date.now()}`,
      project_id: adapterId,
      execution_mode: String(opts.execution_mode || 'auto'),
      requested_by: 'piko',
      risk_level: String(opts.risk_level || 'low'),
      piko_user_id: String(opts.piko_user_id || ''),
      piko_decision_id: `dec_cap_${Date.now()}`,
      ...(opts.context || {}),
    },
  };
  const bearer = String(process.env.PIKO_LEGION_ADAPTER_API_BEARER || process.env.LEGION_ADAPTER_API_BEARER || '').trim();
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  const timeoutMs = Math.max(
    5000,
    parseInt(String(opts.timeoutMs || process.env.PIKO_LEGION_TIMEOUT_MS || '120000'), 10),
  );
  const res = await postJsonToUrl(endpoint, payload, { timeoutMs, headers });
  if (res.statusCode >= 200 && res.statusCode < 300 && res.body && res.body.ok) {
    const out = {
      ok: true,
      adapterId,
      capability,
      runId: String(res.body.run_id || ''),
      status: String(res.body.status || 'accepted'),
    };
    try {
      const { logActivity } = require('./activityLog');
      logActivity('legion_adapter_dispatch', {
        runId: out.runId,
        adapterId,
        capability,
        source: String(opts.source || opts.piko_user_id || 'dispatch'),
        outcome: 'accepted',
      });
    } catch (_) {}
    return out;
  }
  return {
    ok: false,
    code: 'DISPATCH_FAILED',
    message: `Legion dispatch failed (HTTP ${res.statusCode})`,
    details: res.body && res.body.error ? res.body.error : null,
  };
}

module.exports = {
  dispatchLegionCapabilityRun,
  getLegionAdapterBase,
  getDefaultAdapterId,
  resolveAdapterForCapability,
  ADAPTER_BY_CAPABILITY,
};
