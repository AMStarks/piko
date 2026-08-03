/**
 * Route Executor — executes a routed action and returns the reply string.
 * Used by the Plan-and-Execute Orchestrator and can be reused by server.js.
 * @param {object} route - From routeToAction
 * @param {object} opts - { message, sessionModel, dataDir, ausmakerBaseUrl }
 * @returns {Promise<string>}
 */
const {
  stripTrailingSlash,
} = require('./text');

async function executeRoute(route, opts = {}) {
  const { message = '', sessionModel = 'piko:finetune', dataDir, ausmakerBaseUrl } = opts;
  const baseUrl = stripTrailingSlash((ausmakerBaseUrl || process.env.AUSMAKER_BASE_URL || 'http://127.0.0.1:5001'));
  const DATA_DIR = dataDir || process.env.PIKO_DATA_DIR || require('path').join(__dirname, '..', 'data');

  const { getUrl, postJson, formatInventoryReply } = require('./legionRunPoller');

  if (route.actionType === 'run_capability' && route.capability === 'business.metrics.aggregate') {
    const { aggregateBusinessMetrics } = require('./adapters/business.metrics');
    const r = await aggregateBusinessMetrics();
    return r.success
      ? `**Business Metrics (${r.data.timeframe}):**\n• Total units sold: ${r.data.total_sales}\n• Revenue: $${r.data.revenue}`
      : `Couldn't fetch metrics: ${r.error}`;
  }

  if (route.actionType === 'run_capability' && route.capability === 'system.health.ping') {
    const { pingEndpoints } = require('./adapters/system.health');
    let urls = (route.opts && route.opts.urls) || (process.env.PIKO_HEALTH_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) urls = [baseUrl];
    const r = await pingEndpoints(urls);
    return r.success
      ? `**System Health:** ${r.overall_status}\n${r.results.map((x) => `• ${x.url}: ${x.ok ? x.status : (x.error || 'Failed')}`).join('\n')}`
      : `Health check failed: ${r.error}`;
  }

  if (route.actionType === 'run_capability' && route.capability === 'performance.benchmark.run') {
    const { runPerformanceBenchmark } = require('./adapters/performance.benchmark');
    const url = (route.opts && route.opts.url) || process.env.PIKO_HEALTH_CHECK_URL || baseUrl;
    const r = await runPerformanceBenchmark(url);
    return r.success
      ? `**Performance:** ${r.target}\n• Latency: ${r.latency_ms}ms (${r.status})\n• HTTP: ${r.http_status}`
      : `Benchmark failed: ${r.error}`;
  }

  if (route.actionType === 'web_research_run' && route.query) {
    const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
    return await sovereignSearchAndSynthesize(route.query, message, sessionModel, { topN: 2 });
  }

  if (route.actionType === 'legion_deploy_agent' && route.role && route.taskContext) {
    const { deploySubAgent } = require('./legionSwarm');
    const raw = await deploySubAgent(route.role, route.taskContext);
    return raw.startsWith('Error:') ? raw : `**Legion ${route.role} Agent:**\n\n${raw}`;
  }

  if (route.actionType === 'forecast_get' && route.sku) {
    const { formatForecastSummary, fetchForecastSummary } = require('./ausmakerForecast');
    const sku = String(route.sku).trim();
    const data = await fetchForecastSummary(sku, baseUrl);
    return formatForecastSummary(data, sku);
  }

  if (route.actionType === 'forecast_review' && route.sku) {
    const { buildForecastReviewReply } = require('./ausmakerForecast');
    return await buildForecastReviewReply(message, String(route.sku).trim(), sessionModel, baseUrl);
  }

  if (route.actionType === 'forecast_recompute' && route.sku) {
    const { buildForecastRecomputeReply } = require('./ausmakerForecast');
    return await buildForecastRecomputeReply(String(route.sku).trim(), baseUrl);
  }

  if (route.actionType === 'sales_summary_get') {
    const { runSalesSummaryReply } = require('./salesSummary');
    const { reply } = await runSalesSummaryReply({
      getUrl,
      baseUrl,
      route,
      message,
      recentTurns: opts.recentTurns,
    });
    return reply;
  }

  if (route.actionType === 'email_send' && route.to && route.subject != null) {
    const { sendEmail } = require('./emailClient');
    return await sendEmail({ to: route.to, subject: route.subject, body: route.body || '' });
  }

  if (route.actionType === 'memory_subconscious_search' && route.query) {
    const vectorMemory = require('./vectorMemory');
    const hits = await vectorMemory.search(route.query, { limit: 5 });
    return hits.length === 0 ? 'No relevant past context found.' : 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
  }

  const LEGION_CAPABILITIES = [
    'inventory.low_stock.scan',
    'inventory.report.export',
    'sales.analysis.run',
    'purchase_order.draft.create',
    'ausmaker.runbook.execute',
    'ausmaker.business.health.review',
  ];
  if (route.actionType === 'run_capability' && LEGION_CAPABILITIES.includes(route.capability)) {
    if (route.capability === 'ausmaker.business.health.review') {
      const { runBusinessHealthReview, formatBusinessHealthReply } = require('./proactive/analyst');
      const review = await runBusinessHealthReview(DATA_DIR, { forceAnalyze: true });
      return formatBusinessHealthReply(review);
    }
    const { executeLegionCapabilityStep } = require('./legionCapabilityStep');
    const out = await executeLegionCapabilityStep(
      {
        capability: route.capability,
        runbook_id: route.opts && route.opts.runbook_id,
        label: route.opts && route.opts.label,
        sku: route.opts && route.opts.sku,
      },
      {
        dataDir: DATA_DIR,
        message,
        sessionModel,
        ausmakerBaseUrl: baseUrl,
        legionAdapterApiBase: opts.legionAdapterApiBase,
        source: 'orchestrator',
        pikoUserId: 'orchestrator',
      },
    );
    return out.summary || out.error || "Legion didn't complete.";
  }

  return null;
}

module.exports = { executeRoute };
