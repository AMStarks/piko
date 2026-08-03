/**
 * Fetch Legion adapter run log (Phase 8).
 */
const http = require('http');
const https = require('https');

const {
  stripTrailingSlash,
} = require('./text');

function getUrl(urlString, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
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

async function fetchLegionRuns(opts = {}) {
  const base = stripTrailingSlash((opts.baseUrl || getLegionAdapterBase()));
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || '10', 10) || 10));
  const offset = Math.max(0, parseInt(opts.offset || '0', 10) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts.adapterId) params.set('adapter_id', String(opts.adapterId));
  if (opts.capability) params.set('capability', String(opts.capability));
  if (opts.status) params.set('status', String(opts.status));
  const url = `${base}/api/adapters/runs?${params.toString()}`;
  const res = await getUrl(url, opts.timeoutMs || 15000);
  if (res.statusCode !== 200) {
    return { ok: false, error: `HTTP ${res.statusCode}`, runs: [] };
  }
  try {
    const json = JSON.parse(res.body || '{}');
    return { ok: true, runs: Array.isArray(json.runs) ? json.runs : [], limit, offset };
  } catch (e) {
    return { ok: false, error: e.message, runs: [] };
  }
}

async function fetchLegionRunDetail(runId, opts = {}) {
  const base = stripTrailingSlash((opts.baseUrl || getLegionAdapterBase()));
  const rid = String(runId || '').trim();
  if (!rid) return { ok: false, error: 'run_id required' };
  const url = `${base}/api/adapters/runs/${encodeURIComponent(rid)}`;
  const res = await getUrl(url, opts.timeoutMs || 15000);
  if (res.statusCode === 404) return { ok: false, error: 'not_found' };
  if (res.statusCode !== 200) return { ok: false, error: `HTTP ${res.statusCode}` };
  try {
    const json = JSON.parse(res.body || '{}');
    return { ok: true, run: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  fetchLegionRuns,
  fetchLegionRunDetail,
  getLegionAdapterBase,
};
