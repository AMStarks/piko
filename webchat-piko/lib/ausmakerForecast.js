/**
 * AusMaker forecast worker helpers — fetch data, recompute SKU baseline, LLM review.
 */
const { getUrl, postJson } = require('./legionRunPoller');

const {
  stripTrailingSlash,
} = require('./text');

function opsHeaders() {
  const token = String(process.env.PIKO_AUSMAKER_OPS_TOKEN || process.env.AUSMAKER_OPS_TOKEN || '').trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'X-Ops-Token': token };
}

function baseUrl(override) {
  return StringstripTrailingSlash((override || process.env.AUSMAKER_BASE_URL || process.env.PIKO_AUSMAKER_BASE_URL || 'http://127.0.0.1:5001'));
}

async function fetchForecastSummary(sku, ausmakerBase) {
  const url = `${baseUrl(ausmakerBase)}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
  const res = await getUrl(url);
  if (res.statusCode !== 200) {
    throw new Error(`Forecast summary HTTP ${res.statusCode}`);
  }
  return JSON.parse(res.body || '{}');
}

async function fetchSkuDetails(sku, ausmakerBase) {
  const url = `${baseUrl(ausmakerBase)}/api/sku-details/${encodeURIComponent(sku)}`;
  const res = await getUrl(url);
  if (res.statusCode !== 200) {
    return null;
  }
  try {
    return JSON.parse(res.body || '{}');
  } catch (_) {
    return null;
  }
}

async function recomputeForecastSku(sku, ausmakerBase) {
  const url = `${baseUrl(ausmakerBase)}/api/ops/forecast/recompute?sku=${encodeURIComponent(sku)}`;
  const res = await postJson(url, {}, { headers: opsHeaders(), timeoutMs: 120000 });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    let detail = res.body || '';
    try {
      const j = JSON.parse(detail);
      detail = j.detail || j.error || detail;
    } catch (_) {}
    throw new Error(typeof detail === 'string' ? detail.slice(0, 200) : `HTTP ${res.statusCode}`);
  }
  return JSON.parse(res.body || '{}');
}

function formatForecastSummary(data, sku) {
  const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
  return `Forecast for ${sku}: daily run rate ${Number(data.daily_run_rate || 0).toFixed(2)}. Next months: ${months || 'none'}.`;
}

function buildReviewContext(summary, details) {
  const lines = [];
  if (summary) {
    lines.push(
      `Forecast summary: daily_run_rate=${summary.daily_run_rate}; months=${JSON.stringify(summary.months || [])}`
    );
  }
  if (details) {
    lines.push(
      `SKU details: SOH=${details.soh}, on_order=${details.on_order}, avg_12m_sales=${details.avg_12m_sales}, median_12m_sales=${details.median_12m_sales}, active_method=${details.active_method}, final_utilized_forecast=${details.final_utilized_forecast}, agent_forecast=${details.agent_forecast}, median_forecast=${details.median_forecast}`
    );
  }
  return lines.join('\n');
}

async function buildForecastReviewReply(message, sku, sessionModel, ausmakerBase) {
  const summary = await fetchForecastSummary(sku, ausmakerBase);
  const details = await fetchSkuDetails(sku, ausmakerBase).catch(() => null);
  const context = buildReviewContext(summary, details);
  const { ollamaNativeChat } = require('./llm');
  const { getHeavyModel, heavySynthesisEnabled } = require('./frontDesk');
  const model = heavySynthesisEnabled()
    ? getHeavyModel()
    : (process.env.PIKO_CASUAL_MODEL || process.env.PIKO_ROUTER_MODEL || sessionModel || process.env.OLLAMA_MODEL || 'llama3.1:8b');
  const prompt = `You are Piko, an inventory and forecasting assistant for AusMaker Supplies.

The user asked: "${String(message || '').slice(0, 500)}"

Authoritative data for SKU ${sku}:
${context}

Write a concise, practical review (3–6 sentences):
- State the near-term forecast picture (daily rate and next months).
- Compare to 12m median/history if data is present.
- Note stock position (SOH, on order) if available.
- Flag anything that looks high, low, or worth overriding — do not invent numbers not in the data.
- No markdown headers. Speak directly to the user.`;

  const text = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    max_tokens: 450,
    temperature: 0.35,
  });
  return (text && String(text).trim()) || formatForecastSummary(summary, sku);
}

async function buildForecastRecomputeReply(sku, ausmakerBase) {
  const result = await recomputeForecastSku(sku, ausmakerBase);
  const prev = result.previous_daily_run_rate;
  const now = result.daily_run_rate;
  const fs = result.forecast_summary || {};
  const months = (fs.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
  const prevStr = prev != null ? Number(prev).toFixed(2) : 'n/a';
  const nowStr = Number(now || 0).toFixed(2);
  return (
    `Reforecast complete for ${sku}.\n` +
    `Daily run rate: ${prevStr} → ${nowStr} (from ${result.order_lines_90d || 0} order lines in last 90 days).\n` +
    `Updated projection: ${months || 'none'}.`
  );
}

module.exports = {
  opsHeaders,
  fetchForecastSummary,
  fetchSkuDetails,
  recomputeForecastSku,
  formatForecastSummary,
  buildForecastReviewReply,
  buildForecastRecomputeReply,
};
