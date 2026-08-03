/**
 * AusMaker ops runbooks — NL → runbook_id for Legion adapter ausmaker.runbook.execute.
 * Mirrors /api/ops/runbooks on the dashboard and yolo_protocol.ausmaker_runbook.
 */
const {
  toLowerAsciiish,
  includesAny,
  hasWord,
  collapseWhitespace,
  isAsciiLetter,
  isAsciiDigit,
} = require('./text');

const RUNBOOKS = [
  {
    id: 'load_recent_data',
    label: 'Load recent sales data',
    phrases: [
      'load recent', 'sync recent', 'recent data', 'recent sync',
      'incremental sync', 'sync sales data', 'sync data', 'load recent data',
    ],
  },
  {
    id: 'full_data_load',
    label: 'Full data load (12 months)',
    phrases: [
      'full data load', 'full load', 'full sync',
      'rebuild the sales cache', 'rebuild sales cache', 'rebuild the cache', 'rebuild cache',
      '12 months', '12 month', 'rebuild from scratch',
    ],
  },
  {
    id: 'monitor_sync_progress',
    label: 'Monitor sync progress',
    phrases: [
      'sync status', 'sales status', 'sync progress', 'sales progress',
      'monitor sync', 'how is sync going', 'hows sync going', "how's sync going",
    ],
    match: (t) => t.includes('sync') && t.includes('progress'),
  },
  {
    id: 'refresh_forecast',
    label: 'Refresh forecast',
    phrases: [
      'refresh the forecast', 'refresh forecast',
      'recompute the forecast', 'recompute forecast',
      'regenerate the forecast', 'regenerate forecast',
      'update the forecast', 'update forecast',
    ],
    excludeIf: (t) => hasWord(t, 'sku') || extractSkuFromMessage(t),
  },
  {
    id: 'integration_attachment_survey',
    label: 'Integration API survey',
    phrases: [
      'integration survey', 'integration attachment', 'integration audit',
      'api attachment', 'probe apis', 'probe api', 'probe integrations', 'probe integration',
    ],
    match: (t) => t.includes('cin7') && t.includes('shopify')
      && includesAny(t, ['survey', 'audit', 'hook', 'hooks']),
  },
  {
    id: 'list_runbooks',
    label: 'List runbooks',
    phrases: [
      'list runbooks', 'list runbook', 'what runbooks', 'what runbook',
      'available runbooks', 'available runbook',
    ],
  },
];

const SKIP_SKU_WORDS = new Set([
  'the', 'and', 'for', 'please', 'this', 'that', 'piko', 'legion', 'me', 'my', 'our', 'all',
]);

function isSkuChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '_' || ch === '.' || ch === '-';
}

function extractSkuAfterCue(text, cue) {
  const t = String(text || '');
  const low = toLowerAsciiish(t);
  let from = 0;
  while (from < low.length) {
    const idx = low.indexOf(cue, from);
    if (idx < 0) return '';
    let i = idx + cue.length;
    while (i < t.length && (t[i] === ' ' || t[i] === ':' || t[i] === '#' || t[i] === '\t')) i += 1;
    let sku = '';
    while (i < t.length && isSkuChar(t[i]) && sku.length < 64) {
      sku += t[i];
      i += 1;
    }
    if (sku.length >= 3 && !SKIP_SKU_WORDS.has(sku.toLowerCase())) return sku;
    from = idx + cue.length;
  }
  return '';
}

function extractSkuFromMessage(text) {
  for (const cue of ['sku', 'reforecast ', 'for ']) {
    const sku = extractSkuAfterCue(text, cue);
    if (sku) return sku;
  }
  return '';
}

/**
 * @returns {{ runbook_id: string, sku?: string, label: string } | null}
 */
function parseRunbookFromMessage(message) {
  const t = String(message || '').trim();
  if (!t) return null;
  const low = collapseWhitespace(toLowerAsciiish(t));

  const sku = extractSkuFromMessage(t);
  if (sku && (hasWord(low, 'reforecast') || hasWord(low, 'recompute'))) {
    const meta = RUNBOOKS.find((r) => r.id === 'reforecast_sku') || { id: 'reforecast_sku', label: `Reforecast SKU ${sku}` };
    return { runbook_id: 'reforecast_sku', sku, label: meta.label };
  }

  for (const rb of RUNBOOKS) {
    if (typeof rb.excludeIf === 'function' && rb.excludeIf(t)) continue;
    let hit = false;
    if (rb.phrases && includesAny(low, rb.phrases)) hit = true;
    if (!hit && typeof rb.match === 'function' && rb.match(low)) hit = true;
    if (hit) {
      return { runbook_id: rb.id, sku: sku || undefined, label: rb.label };
    }
  }
  return null;
}

function buildRunbookCapabilityRoute(parsed) {
  if (!parsed) return null;
  return {
    actionType: 'run_capability',
    capability: 'ausmaker.runbook.execute',
    opts: {
      runbook_id: parsed.runbook_id,
      sku: parsed.sku,
      label: parsed.label,
    },
  };
}

function buildCapabilityInput(route) {
  const cap = route.capability;
  const opts = route.opts || {};
  if (cap === 'ausmaker.runbook.execute') {
    const input = { runbook_id: opts.runbook_id };
    if (opts.sku) input.sku = opts.sku;
    return input;
  }
  if (cap === 'inventory.low_stock.scan') {
    return { include_raw: true, ...(opts.top10 ? { top10: true } : {}) };
  }
  if (cap === 'inventory.report.export' || cap === 'inventory.csv.generate') {
    return { include_all: true };
  }
  return opts.input || {};
}

function formatRunbookReply(result, parsed) {
  if (!result) return 'Runbook finished — no details returned.';
  if (result.ok === false && result.error) {
    return `Runbook failed: ${result.error}`;
  }
  const id = parsed?.runbook_id || result.runbook_id || 'runbook';
  if (id === 'monitor_sync_progress' || result.status) {
    const st = result.status || result.phase || 'unknown';
    return `Sales sync status: ${st}${result.message ? ` — ${result.message}` : ''}`;
  }
  if (id === 'list_runbooks' && Array.isArray(result.runbooks)) {
    const names = result.runbooks.map((r) => r.id || r.title).filter(Boolean).slice(0, 8);
    return `AusMaker runbooks: ${names.join(', ')}${result.runbooks.length > 8 ? '…' : ''}`;
  }
  if (result.summary && typeof result.summary === 'object') {
    const flagged = result.summary.flagged_recommendations_count;
    if (flagged != null) return `Forecast refreshed — ${flagged} SKUs flagged for review.`;
  }
  if (result.sku_count != null) {
    return `Forecast run complete — ${result.sku_count} SKUs in the grid.`;
  }
  if (result.status === 'started' || result.status === 'building' || result.status === 'updating') {
    return `Started ${parsed?.label || id} — sync is running in the background. Ask for sync status in a few minutes.`;
  }
  return `${parsed?.label || id} completed.`;
}

module.exports = {
  RUNBOOKS,
  parseRunbookFromMessage,
  buildRunbookCapabilityRoute,
  buildCapabilityInput,
  formatRunbookReply,
  extractSkuFromMessage,
};
