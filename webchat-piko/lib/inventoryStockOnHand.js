/**
 * Stock-on-hand lookup — AusMaker sku-details first, local sales_cache fallback.
 * Used by stock_on_hand_get so chat never invents inventory quantities.
 */
const fs = require('fs');
const path = require('path');
const { getUrl } = require('./legionRunPoller');

function baseUrl(override) {
  const raw = String(
    override
      || process.env.AUSMAKER_BASE_URL
      || process.env.PIKO_AUSMAKER_BASE_URL
      || 'http://127.0.0.1:5001'
  ).trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Conservative SKU shape check — character scan, not intent regex. */
function isValidSku(sku) {
  const s = String(sku || '').trim();
  if (s.length < 2 || s.length > 64) return false;
  for (const ch of s) {
    const ok =
      (ch >= 'A' && ch <= 'Z')
      || (ch >= 'a' && ch <= 'z')
      || (ch >= '0' && ch <= '9')
      || ch === '-'
      || ch === '_'
      || ch === '.';
    if (!ok) return false;
  }
  return true;
}

function resolveSalesCachePath(dataDir) {
  const explicit = String(process.env.PIKO_SALES_CACHE_PATH || process.env.SALES_CACHE_PATH || '').trim();
  if (explicit) return explicit;
  const candidates = [
    dataDir ? path.join(dataDir, 'sales_cache.sqlite') : null,
    path.join(__dirname, '..', 'data', 'sales_cache.sqlite'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

async function fetchFromAusMaker(sku, ausmakerBase) {
  const url = `${baseUrl(ausmakerBase)}/api/sku-details/${encodeURIComponent(sku)}`;
  const res = await getUrl(url);
  if (res.statusCode !== 200) return null;
  let data;
  try {
    data = JSON.parse(res.body || '{}');
  } catch (_) {
    return null;
  }
  if (!data || (data.soh == null && data.stock_on_hand == null && data.available == null)) {
    return null;
  }
  const soh = data.soh != null ? Number(data.soh) : (data.stock_on_hand != null ? Number(data.stock_on_hand) : null);
  return {
    ok: true,
    found: true,
    sku,
    stock_on_hand: Number.isFinite(soh) ? soh : null,
    available: data.available != null ? Number(data.available) : null,
    allocated: data.allocated != null ? Number(data.allocated) : null,
    on_order: data.on_order != null ? Number(data.on_order) : null,
    supplier_name: data.supplier_name || null,
    source: 'ausmaker',
    updated_at: data.updated_at || null,
  };
}

function fetchFromSalesCache(sku, dataDir) {
  const dbPath = resolveSalesCachePath(dataDir);
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(
        'SELECT sku, soh, allocated, available, on_order, supplier_name, updated_at FROM products WHERE UPPER(sku) = UPPER(?) LIMIT 1'
      ).get(sku);
      if (!row) return null;
      return {
        ok: true,
        found: true,
        sku: row.sku,
        stock_on_hand: row.soh != null ? Number(row.soh) : null,
        available: row.available != null ? Number(row.available) : null,
        allocated: row.allocated != null ? Number(row.allocated) : null,
        on_order: row.on_order != null ? Number(row.on_order) : null,
        supplier_name: row.supplier_name || null,
        source: 'sales_cache',
        updated_at: row.updated_at || null,
      };
    } finally {
      db.close();
    }
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} sku
 * @param {{ ausmakerBase?: string, dataDir?: string }} [opts]
 */
async function getStockOnHand(sku, opts = {}) {
  const target = String(sku || '').trim();
  if (!isValidSku(target)) {
    return { ok: false, found: false, sku: target, error: 'invalid_sku' };
  }

  try {
    const fromApi = await fetchFromAusMaker(target, opts.ausmakerBase);
    if (fromApi) return fromApi;
  } catch (_) { /* fall through */ }

  const fromCache = fetchFromSalesCache(target, opts.dataDir);
  if (fromCache) return fromCache;

  return {
    ok: true,
    found: false,
    sku: target,
    stock_on_hand: null,
    available: null,
    allocated: null,
    on_order: null,
    supplier_name: null,
    source: null,
    updated_at: null,
  };
}

function formatStockOnHandReply(result) {
  if (!result || result.error === 'invalid_sku') {
    return "I need a valid product SKU to look up stock on hand.";
  }
  if (!result.found) {
    return `I could not find stock data for ${result.sku}. Please check the SKU and try again.`;
  }
  const soh = result.stock_on_hand;
  if (soh == null || !Number.isFinite(soh)) {
    return `I found ${result.sku} but stock on hand was not available from the data source.`;
  }
  const parts = [`${result.sku} has ${soh} units on hand.`];
  const extras = [];
  if (result.available != null && Number.isFinite(result.available)) extras.push(`available ${result.available}`);
  if (result.allocated != null && Number.isFinite(result.allocated)) extras.push(`allocated ${result.allocated}`);
  if (result.on_order != null && Number.isFinite(result.on_order)) extras.push(`on order ${result.on_order}`);
  if (extras.length) parts.push(extras.join(', ') + '.');
  if (result.supplier_name) parts.push(`Supplier: ${result.supplier_name}.`);
  if (result.source) parts.push(`Source: ${result.source === 'sales_cache' ? 'sales cache' : 'AusMaker'}.`);
  return parts.join(' ');
}

module.exports = {
  isValidSku,
  getStockOnHand,
  formatStockOnHandReply,
  resolveSalesCachePath,
};
