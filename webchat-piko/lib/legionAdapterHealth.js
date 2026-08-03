/**
 * Probe Legion adapter API reachability (GET /api/adapters).
 */
const http = require('http');
const https = require('https');

const DEFAULT_BASE = 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 8000;

const {
  stripTrailingSlash,
} = require('./text');

function getLegionAdapterBaseUrl() {
  return stripTrailingSlash(String(
    process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || DEFAULT_BASE,
  ).trim());
}

function fetchJson(urlString, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {};
    const bearer = String(process.env.PIKO_LEGION_ADAPTER_API_BEARER || process.env.LEGION_ADAPTER_API_BEARER || '').trim();
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 0, body: JSON.parse(data || '{}') });
        } catch (e) {
          reject(new Error(`invalid JSON from ${urlString}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('legion adapter health timeout')));
    req.end();
  });
}

async function checkLegionAdapterHealth(opts = {}) {
  const baseUrl = stripTrailingSlash((opts.baseUrl || getLegionAdapterBaseUrl()));
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  let requiredId = String(opts.requiredAdapterId || process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || '').trim();
  if (!requiredId) {
    try {
      const { getDefaultAdapter } = require('./knowledgeManifest');
      requiredId = String(getDefaultAdapter() || '').trim();
    } catch (_) {
      requiredId = 'ausmakersupplies';
    }
  }
  if (!requiredId) requiredId = 'ausmakersupplies';

  const out = {
    ok: false,
    baseUrl,
    adapters: [],
    requiredAdapterId: requiredId,
    ausmakersuppliesHealthy: false,
    error: null,
    checkedAt: new Date().toISOString(),
  };
  try {
    const res = await fetchJson(`${baseUrl}/api/adapters`, timeoutMs);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      out.error = `HTTP ${res.statusCode}`;
      return out;
    }
    const adapters = Array.isArray(res.body.adapters) ? res.body.adapters : [];
    out.adapters = adapters.map((a) => ({
      adapter_id: a.adapter_id || a.id,
      healthy: !!(a.healthy ?? a.health?.ok),
      display_name: a.display_name || a.adapter_id,
    }));
    const am = out.adapters.find((a) => a.adapter_id === 'ausmakersupplies');
    out.ausmakersuppliesHealthy = !!(am && am.healthy);
    const required = out.adapters.find((a) => a.adapter_id === requiredId);
    out.ok = !!(required && required.healthy);
    // Fallback: if required adapter isn't listed but another healthy adapter exists
    // (tenant-specific docker image), accept any healthy adapter.
    if (!out.ok && !required && out.adapters.some((a) => a.healthy)) {
      out.ok = true;
    }
    if (!out.ok && !out.error) {
      out.error = adapters.length
        ? `${requiredId} adapter unhealthy`
        : 'no adapters registered';
    }
    return out;
  } catch (e) {
    out.error = e.message || String(e);
    return out;
  }
}

function formatLegionAdapterUnavailable(health, capability) {
  const cap = capability ? ` (${capability})` : '';
  const hint = health && health.error
    ? health.error
    : 'Legion adapter API not reachable';
  return `Couldn't run that business task${cap} — ${hint}. Check legion-adapter on port 8000 or run ./scripts/deploy-legion-adapter-rodimus.sh`;
}

module.exports = {
  getLegionAdapterBaseUrl,
  checkLegionAdapterHealth,
  formatLegionAdapterUnavailable,
};
