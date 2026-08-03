/**
 * Legion adapter discovery — fetches adapters + capabilities from Legion API,
 * optionally scans /adapters folder for manifests. Merges with static registry.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const LEGION_BASE = String(process.env.PIKO_LEGION_ADAPTER_API_BASE || process.env.LEGION_ADAPTER_API_BASE || 'http://127.0.0.1:8000').trim();
const LEGION_BEARER = String(process.env.PIKO_LEGION_ADAPTER_API_BEARER || process.env.LEGION_ADAPTER_API_BEARER || '').trim();
const DISCOVERY_TIMEOUT_MS = Math.max(2000, parseInt(process.env.PIKO_LEGION_DISCOVERY_TIMEOUT_MS || '5000', 10));
const CACHE_TTL_MS = Math.max(60000, parseInt(process.env.PIKO_LEGION_DISCOVERY_CACHE_MS || '300000', 10)); // 5 min default

let cached = null;
let cachedAt = 0;

const {
  stripTrailingSlash,
} = require('./text');

function getAdaptersPath(rootDir) {
  const root = rootDir || path.join(__dirname, '..');
  const envPath = process.env.PIKO_ADAPTERS_PATH;
  if (envPath) return path.isAbsolute(envPath) ? envPath : path.join(root, envPath);
  return path.join(root, 'legion-adapters');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(
      url,
      { method: 'GET', timeout: DISCOVERY_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.on('data', (ch) => { data += ch; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (_) {
            reject(new Error('Invalid JSON from Legion'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.setTimeout(DISCOVERY_TIMEOUT_MS);
    if (LEGION_BEARER) req.setHeader('Authorization', `Bearer ${LEGION_BEARER}`);
    req.end();
  });
}

/**
 * Fetch adapters and capabilities from Legion API.
 * @returns {Promise<{ id: string, description: string }[]>}
 */
async function fetchFromLegionApi() {
  const base = stripTrailingSlash(LEGION_BASE);
  const adaptersRes = await httpGet(`${base}/api/adapters`);
  const adapters = Array.isArray(adaptersRes) ? adaptersRes : (adaptersRes && adaptersRes.adapters) || [];
  const capabilities = [];
  const seen = new Set();

  for (const a of adapters) {
    const id = String(a && (a.id || a.adapter_id || a.adapterId) || '').trim();
    if (!id) continue;
    try {
      const capsRes = await httpGet(`${base}/api/adapters/${encodeURIComponent(id)}/capabilities`);
      const caps = Array.isArray(capsRes) ? capsRes : (capsRes && capsRes.capabilities) || [];
      for (const c of caps) {
        const capId = String(c && (c.id || c.capability_id) || '').trim();
        if (!capId || seen.has(capId)) continue;
        seen.add(capId);
        capabilities.push({
          id: capId,
          description: String(c.description || c.summary || '').slice(0, 200) || capId,
          adapterId: id,
        });
      }
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionDiscovery] capabilities for', id, ':', e.message);
    }
  }
  return capabilities;
}

/**
 * Scan /adapters folder for manifest.json files.
 * Each adapter folder: adapters/{id}/manifest.json with { id, capabilities: [{ id, description }] }
 * @param {string} [rootDir] - Project root
 * @returns {{ id: string, description: string }[]}
 */
function scanAdaptersFolder(rootDir) {
  const adaptersPath = getAdaptersPath(rootDir);
  if (!fs.existsSync(adaptersPath) || !fs.statSync(adaptersPath).isDirectory()) return [];
  const capabilities = [];
  const seen = new Set();

  const entries = fs.readdirSync(adaptersPath, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = path.join(adaptersPath, e.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const m = JSON.parse(raw);
      const adapterId = String(m.id || e.name || '').trim();
      const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
      for (const c of caps) {
        const capId = String(c && (c.id || c.capability_id) || '').trim();
        if (!capId || seen.has(capId)) continue;
        seen.add(capId);
        capabilities.push({
          id: capId,
          description: String(c.description || c.summary || '').slice(0, 200) || capId,
          adapterId,
        });
      }
    } catch (err) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionDiscovery] adapter manifest', e.name, ':', err.message);
    }
  }
  return capabilities;
}

/**
 * Discover capabilities from Legion API + adapters folder. Cached.
 * @param {string} [rootDir] - Project root
 * @returns {Promise<{ id: string, description: string }[]>}
 */
async function discoverCapabilities(rootDir) {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  const seen = new Set();
  const merged = [];

  // 1. Legion API
  try {
    const fromApi = await fetchFromLegionApi();
    for (const c of fromApi) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionDiscovery] API:', e.message);
  }

  // 2. Adapters folder
  const fromFolder = scanAdaptersFolder(rootDir);
  for (const c of fromFolder) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  }

  cached = merged;
  cachedAt = Date.now();
  return merged;
}

/** Clear cache (for tests). */
function clearCache() {
  cached = null;
  cachedAt = 0;
}

/** Sync: return cached discovered capabilities (empty if not yet run). */
function getDiscoveredCapabilitiesSync() {
  return Array.isArray(cached) ? cached : [];
}

module.exports = {
  discoverCapabilities,
  scanAdaptersFolder,
  fetchFromLegionApi,
  clearCache,
  getAdaptersPath,
  getDiscoveredCapabilitiesSync,
};
