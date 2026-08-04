/**
 * AusMaker export / telemetry / reorders routes (P4.2).
 */

function registerAusmakerRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/exports/reorder-csv', wrap(handleReorderCsv), { group: 'ausmaker', auth: 'open' });
  registry.add('GET', '/api/ausmaker/telemetry', wrap(handleTelemetry), { group: 'ausmaker', auth: 'open' });
  registry.add('GET', '/api/ausmaker/reorders', wrap(handleReorders), { group: 'ausmaker', auth: 'open' });
}

function isAusmakerPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/exports/reorder-csv'
    || p === '/api/ausmaker/telemetry'
    || p === '/api/ausmaker/reorders';
}

async function tryHandleAusmaker(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'GET' || !isAusmakerPath(pathname)) return false;
  if (pathname === '/api/exports/reorder-csv') return handleReorderCsv(req, res, ctx);
  if (pathname === '/api/ausmaker/telemetry') return handleTelemetry(req, res, ctx);
  if (pathname === '/api/ausmaker/reorders') return handleReorders(req, res, ctx);
  return false;
}

async function handleReorderCsv(req, res, ctx) {
  const { send, stripTrailingSlash, ausmakerBaseUrl } = ctx;
  const { getUrl } = require('../lib/legionRunPoller');
  const csvUrl = `${stripTrailingSlash(ausmakerBaseUrl)}/api/forecast/csv`;
  try {
    const upstream = await getUrl(csvUrl);
    if (upstream.statusCode !== 200) {
      send(res, upstream.statusCode || 502, JSON.stringify({ ok: false, error: 'AusMaker CSV unavailable' }), 'application/json');
      return true;
    }
    const data = JSON.parse(upstream.body || '{}');
    if (!data.success || !data.csv_content) {
      send(res, 404, JSON.stringify({ ok: false, error: data.error || 'No CSV data' }), 'application/json');
      return true;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reorder-report-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(data.csv_content);
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Export failed' }), 'application/json');
  }
  return true;
}

async function handleTelemetry(req, res, ctx) {
  const { send, parseUrl, stripTrailingSlash, ausmakerBaseUrl } = ctx;
  try {
    const { query } = parseUrl(req.url);
    const period = String((query && query.period) || 'today').trim().toLowerCase();
    const safePeriod = ['today', 'week', 'month'].includes(period) ? period : 'today';
    const base = stripTrailingSlash(ausmakerBaseUrl);

    const { getUrl } = require('../lib/legionRunPoller');

    async function fetchSalesSummary(p) {
      const resUp = await getUrl(`${base}/api/sales/summary?period=${encodeURIComponent(p)}`);
      if (resUp.statusCode !== 200) return { ok: false, statusCode: resUp.statusCode, data: null };
      try {
        return { ok: true, statusCode: resUp.statusCode, data: JSON.parse(resUp.body || '{}') };
      } catch (_) {
        return { ok: false, statusCode: resUp.statusCode, data: null };
      }
    }

    // Multi-period momentum (T/W/M). Keep the existing `sales` object as the requested period payload for backward compatibility.
    const salesToday = await fetchSalesSummary('today');
    const salesWeek = await fetchSalesSummary('week');
    const salesMonth = await fetchSalesSummary('month');
    const salesPeriodPayload = safePeriod === 'week' ? salesWeek : (safePeriod === 'month' ? salesMonth : salesToday);
    const sales = salesPeriodPayload.ok ? salesPeriodPayload.data : null;
    const sales_periods = {
      today: salesToday.ok && salesToday.data ? (Number(salesToday.data.total_units_sold) || 0) : 0,
      week: salesWeek.ok && salesWeek.data ? (Number(salesWeek.data.total_units_sold) || 0) : 0,
      month: salesMonth.ok && salesMonth.data ? (Number(salesMonth.data.total_units_sold) || 0) : 0,
    };

    // Forecast cached is cheaper and enough for “inventory health” heuristics.
    const forecastRes = await getUrl(`${base}/api/forecast/cached`);
    let forecast = null;
    if (forecastRes.statusCode === 200) {
      try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
    }

    const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
    const reorderCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder').length : 0;
    const reviewCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'review').length : 0;
    const orderedCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'ordered').length : 0;

    // Simple health heuristic for HUD:
    // - RED if any reorder items exist
    // - YELLOW if any review items exist
    // - GREEN otherwise
    let health = 'GREEN';
    if (reorderCount > 0) health = 'RED';
    else if (reviewCount > 0) health = 'YELLOW';

    // Best-effort “operational sync” timestamp. AusMaker cached forecast includes last_synced_at in the cache key inputs,
    // and may include `_cached_at` in some code paths. We surface whatever exists.
    const sync_ts = (forecast && (forecast.last_synced_at || forecast.last_synced || forecast._cached_at || forecast.timestamp)) || null;

    send(res, 200, JSON.stringify({
      ok: true,
      source: 'ausmaker',
      baseUrl: base,
      period: safePeriod,
      sales: sales,
      sales_periods,
      forecast: {
        has_cached: !!forecast,
        reorderCount,
        reviewCount,
        orderedCount,
      },
      sync_ts,
      health,
      updated_at: new Date().toISOString(),
    }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Telemetry failed' }));
  }
  return true;
}

async function handleReorders(req, res, ctx) {
  const { send, parseUrl, stripTrailingSlash, ausmakerBaseUrl } = ctx;
  try {
    const { query } = parseUrl(req.url);
    const limit = Math.min(200, Math.max(1, parseInt((query && query.limit) || '50', 10) || 50));
    const base = stripTrailingSlash(ausmakerBaseUrl);
    const { getUrl } = require('../lib/legionRunPoller');

    const forecastRes = await getUrl(`${base}/api/forecast/cached`);
    if (forecastRes.statusCode === 204) {
      send(res, 200, JSON.stringify({ ok: true, count: 0, items: [], note: 'No cached forecast yet (204). Run a low stock scan to prime the cache.' }));
      return true;
    }
    if (forecastRes.statusCode !== 200) {
      send(res, 502, JSON.stringify({ ok: false, error: `AusMaker forecast cached returned ${forecastRes.statusCode}`, statusCode: forecastRes.statusCode }));
      return true;
    }
    let forecast = null;
    try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
    const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
    const reorderItems = Array.isArray(recs)
      ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder')
      : [];

    const items = reorderItems.slice(0, limit).map((r) => {
      const sku = (r.shopify_sku || r.sku || r.cin7_sku || r.SKU || '').toString().trim();
      return {
        sku,
        cin7_sku: (r.cin7_sku || '').toString().trim() || undefined,
        shopify_sku: (r.shopify_sku || r.sku || '').toString().trim() || undefined,
        flag: (r.flag || '').toString(),
        current_inventory: r.current_inventory ?? r.soh ?? undefined,
        on_order: r.on_order ?? undefined,
        forecasted_demand: r.forecasted_demand ?? r.total_forecasted_units ?? undefined,
        recommended_quantity: r.recommended_quantity ?? r.quantity ?? r.qty ?? undefined,
      };
    }).filter((x) => x.sku);

    send(res, 200, JSON.stringify({
      ok: true,
      count: reorderItems.length,
      limit,
      items,
      updated_at: new Date().toISOString(),
    }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Reorders drill-down failed' }));
  }
  return true;
}

module.exports = {
  tryHandleAusmaker,
  registerAusmakerRoutes,
  isAusmakerPath,
};
