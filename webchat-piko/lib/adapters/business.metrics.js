/**
 * Business metrics adapter — aggregates KPIs from sales cache (order_lines + products).
 * Path: piko_config.salesCachePath, PIKO_SALES_CACHE_PATH, or data/sales_cache.sqlite.
 * Falls back to AusMaker HTTP API when the SQLite file is unavailable.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { resolveSalesCachePath } = require('../configManager');

const {
  stripTrailingSlash,
} = require('../text');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function aggregateFromApi() {
  const base = StringstripTrailingSlash((process.env.PIKO_AUSMAKER_BASE_URL || process.env.AUSMAKER_BASE_URL || ''));
  if (!base) return null;
  try {
    const status = await fetchJson(`${base}/api/sales-db/status`);
    const rows = Number(status.rows || 0);
    if (rows <= 0) {
      return { success: false, error: 'Sales cache is empty on AusMaker. Run a Full Data Load.' };
    }
    return {
      success: true,
      data: {
        timeframe: 'AusMaker cache (API)',
        total_sales: rows,
        revenue: 'n/a',
        source: 'ausmaker_api',
        last_synced_at: status.last_synced_at || null,
      },
    };
  } catch (e) {
    return { success: false, error: `AusMaker API unavailable: ${e.message}` };
  }
}

async function aggregateBusinessMetrics() {
  try {
    const dbPath = resolveSalesCachePath();
    if (!fs.existsSync(dbPath)) {
      const apiResult = await aggregateFromApi();
      if (apiResult) return apiResult;
      return {
        success: false,
        error: `Sales cache not found at ${dbPath}. Copy from AusMaker Docker or set salesCachePath in Settings.`,
      };
    }

    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const inventory = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM order_lines) AS order_lines
    `).get();

    // Stale/empty host copy (common when Docker holds the live cache) — prefer AusMaker API.
    if (!inventory || (Number(inventory.products) === 0 && Number(inventory.order_lines) === 0)) {
      db.close();
      const apiResult = await aggregateFromApi();
      if (apiResult) return apiResult;
      return {
        success: false,
        error: `Sales cache at ${dbPath} is empty. Run a Full Data Load or sync from AusMaker Docker.`,
      };
    }

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(ol.quantity), 0) AS total_sales,
        COALESCE(SUM(ol.quantity * COALESCE(p.sell_price, 0)), 0) AS revenue
      FROM order_lines ol
      LEFT JOIN products p ON ol.sku = p.sku
      WHERE ol.created_at >= date('now', '-30 days')
    `).get();

    db.close();

    return {
      success: true,
      data: {
        timeframe: 'Last 30 Days',
        total_sales: row ? Number(row.total_sales) : 0,
        revenue: row ? Number(row.revenue).toFixed(2) : '0.00',
        source: 'sales_cache_sqlite',
        cache_path: dbPath,
      },
    };
  } catch (error) {
    const apiResult = await aggregateFromApi();
    if (apiResult && apiResult.success) return apiResult;
    return { success: false, error: error.message };
  }
}

module.exports = { aggregateBusinessMetrics };
