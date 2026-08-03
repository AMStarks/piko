/**
 * Sales summary routing helpers — shared period/top parsing and reply formatting.
 */
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  hasWord,
  extractDigitRuns,
  collapseWhitespace,
} = require('./text');

const VALID_PERIODS = new Set(['today', 'yesterday', 'week', 'month']);

const SALES_QUERY_PHRASES = [
  'how are sales', 'how were sales', 'how was sales', 'how did sales',
  'sales going', 'sales doing', 'sales today', 'sales yesterday',
  'sales this week', 'sales this month',
  'biggest seller', 'biggest sellers', 'best seller', 'best sellers',
  'top seller', 'top sellers', 'top 1 sellers', 'top 2 sellers', 'top 3 sellers',
  'top 4 sellers', 'top 5 sellers', 'top 6 sellers', 'top 7 sellers',
  'top 8 sellers', 'top 9 sellers', 'top 10 sellers',
  'revenue', 'what about yesterday', 'how were sales then',
  'scan sales', 'check sales', 'get sales', 'show sales', 'pull sales',
];

function periodLabel(period) {
  const p = String(period || 'today').toLowerCase();
  if (p === 'yesterday') return 'yesterday';
  if (p === 'week') return 'this week';
  if (p === 'month') return 'this month';
  return 'today';
}

function normalizePeriod(period) {
  const p = String(period || 'today').toLowerCase();
  return VALID_PERIODS.has(p) ? p : 'today';
}

function recentText(recentTurns) {
  return (recentTurns || [])
    .slice(-4)
    .map((t) => String(t.content || ''))
    .join(' ')
    .toLowerCase();
}

function parseSalesPeriod(message, recentTurns = []) {
  const t = toLowerAsciiish(message);
  const recent = recentText(recentTurns);

  if (hasWord(t, 'yesterday')) return 'yesterday';
  if (includesAny(t, ['today', 'this morning', 'so far today'])) return 'today';
  if (includesAny(t, ['this week', 'past week', 'last 7 days'])) return 'week';
  if (includesAny(t, ['this month', 'past month'])) return 'month';

  if (includesAny(t, ['what about', 'how about']) || hasWord(t, 'and')) {
    if (hasWord(t, 'yesterday') || hasWord(t, 'then')) {
      return hasWord(t, 'yesterday') ? 'yesterday' : 'today';
    }
  }

  if (includesAny(t, ['how were', 'how was', 'how did']) && includesAny(t, ['sales', 'revenue', 'seller', 'sellers'])) {
    return hasWord(t, 'yesterday') ? 'yesterday' : 'today';
  }

  if (includesAny(recent, ['sales', 'revenue', 'seller', 'top sku'])) {
    if (hasWord(t, 'yesterday')) return 'yesterday';
    if (hasWord(t, 'week')) return 'week';
    if (hasWord(t, 'month')) return 'month';
    if (hasWord(t, 'today')) return 'today';
    if (includesAny(t, ['what about', 'how about']) || hasWord(t, 'and')) return 'yesterday';
  }

  if (hasWord(t, 'week')) return 'week';
  if (hasWord(t, 'month')) return 'month';
  return 'today';
}

function parseTopLimit(message, fallback = 5) {
  const t = toLowerAsciiish(message);
  const idx = t.indexOf('top ');
  if (idx >= 0) {
    const after = t.slice(idx + 4);
    const runs = extractDigitRuns(after);
    if (runs.length && runs[0].index === 0) {
      return Math.max(1, Math.min(20, runs[0].value));
    }
  }
  return fallback;
}

function isSalesSummaryQuery(message, recentTurns = []) {
  const t = collapseWhitespace(toLowerAsciiish(String(message || '').trim()));
  if (!t) return false;
  if (includesAny(t, SALES_QUERY_PHRASES)) return true;
  // "top N sellers" with arbitrary N
  if (t.includes('top ') && (t.includes('seller') || t.includes('sellers'))) return true;
  if ((t.includes('scan') || t.includes('check') || t.includes('get') || t.includes('show') || t.includes('pull'))
    && t.includes('sales')) return true;

  const recent = recentText(recentTurns);
  if (includesAny(recent, ['sales for', 'top sku', 'top skus', 'units sold', 'revenue'])) {
    return hasAnyWord(t, ['yesterday', 'today', 'week', 'month', 'then'])
      || includesAny(t, ['what about', 'how about', 'how were', 'how did']);
  }
  return false;
}

function formatSalesReply(data, period, limit = 5, cacheMeta = null) {
  const p = normalizePeriod(period);
  const top = (data.top_skus || []).slice(0, limit).map((row) => `${row.sku}: ${row.units}`).join(', ');
  let reply = `Sales for ${periodLabel(p)}: ${data.total_units_sold || 0} units sold, $${Number(data.total_revenue || 0).toFixed(2)} revenue. Top SKUs: ${top || 'none'}.`;

  const lastSynced = cacheMeta && cacheMeta.last_synced_at ? String(cacheMeta.last_synced_at) : '';
  if (lastSynced) {
    const syncedMs = Date.parse(lastSynced);
    if (!Number.isNaN(syncedMs)) {
      const ageDays = (Date.now() - syncedMs) / (24 * 60 * 60 * 1000);
      if (ageDays > 2) {
        const syncedDate = lastSynced.slice(0, 10);
        reply += ` Note: sales cache last synced ${syncedDate} — I may be missing recent Shopify orders until sync runs.`;
      }
    }
  }
  if ((data.total_units_sold || 0) === 0 && data.message) {
    reply += ` ${data.message}`;
  }
  return reply;
}

function stripTrailingSlash(baseUrl) {
  let base = String(baseUrl || '');
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

async function fetchSalesSummary(getUrl, baseUrl, period, sku) {
  const p = normalizePeriod(period);
  let url = `${stripTrailingSlash(baseUrl)}/api/sales/summary?period=${encodeURIComponent(p)}`;
  if (sku && String(sku).trim()) url += `&sku=${encodeURIComponent(String(sku).trim())}`;
  const getRes = await getUrl(url);
  if (getRes.statusCode !== 200) {
    return { ok: false, error: 'Sales API unavailable. Try again in a minute.' };
  }
  const data = JSON.parse(getRes.body || '{}');
  let cacheMeta = null;
  try {
    const statusRes = await getUrl(`${stripTrailingSlash(baseUrl)}/api/sales-db/status`);
    if (statusRes.statusCode === 200) cacheMeta = JSON.parse(statusRes.body || '{}');
  } catch (_) {}
  return { ok: true, data, cacheMeta, period: p };
}

function buildSalesRoute(message, recentTurns = [], opts = {}) {
  if (!isSalesSummaryQuery(message, recentTurns)) return null;
  return {
    actionType: 'sales_summary_get',
    period: parseSalesPeriod(message, recentTurns),
    topLimit: parseTopLimit(message, opts.topLimit || 5),
  };
}

async function runSalesSummaryReply(opts = {}) {
  const { getUrl, baseUrl, route, message, finalizeToolReply } = opts;
  const period = normalizePeriod(route.period || parseSalesPeriod(message, opts.recentTurns));
  const limit = route.topLimit || parseTopLimit(message, 5);
  const fetched = await fetchSalesSummary(getUrl, baseUrl, period, route.sku);
  if (!fetched.ok) return { reply: fetched.error };
  const formatted = formatSalesReply(fetched.data, fetched.period, limit, fetched.cacheMeta);
  if (typeof finalizeToolReply === 'function') {
    const reply = await finalizeToolReply({
      route: { ...route, period: fetched.period },
      userMessage: message,
      toolResult: fetched.data,
      formattedFallback: formatted,
    });
    return { reply, data: fetched.data, period: fetched.period };
  }
  return { reply: formatted, data: fetched.data, period: fetched.period };
}

module.exports = {
  VALID_PERIODS,
  periodLabel,
  normalizePeriod,
  parseSalesPeriod,
  parseTopLimit,
  isSalesSummaryQuery,
  formatSalesReply,
  fetchSalesSummary,
  buildSalesRoute,
  runSalesSummaryReply,
};
