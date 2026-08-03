/**
 * Poll Legion adapter run until completed, then build user-facing summary.
 * Used after dispatchLegionBrief to deliver scan results (e.g. reorder items) to the user.
 * Tracks previous scan flags to report status changes (OK → Reorder).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LAST_SCAN_FLAGS_FILE = 'legion-last-scan-flags.json';

const {
  stripTrailingSlash,
  collapseWhitespace,
} = require('./text');

function getLastScanPath(dataDir) {
  return path.join(dataDir || path.join(__dirname, '..', 'data'), LAST_SCAN_FLAGS_FILE);
}

function loadLastScanFlags(dataDir) {
  try {
    const p = getLastScanPath(dataDir);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.flags === 'object' ? parsed.flags : null;
  } catch (_) {
    return null;
  }
}

function saveLastScanFlags(dataDir, flags) {
  try {
    const dir = path.dirname(getLastScanPath(dataDir));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      getLastScanPath(dataDir),
      JSON.stringify({ timestamp: new Date().toISOString(), flags }, null, 2),
      'utf8'
    );
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionRunPoller] save flags:', e.message);
  }
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = Math.max(
  15000,
  parseInt(process.env.PIKO_LEGION_POLL_TIMEOUT_MS || process.env.PIKO_LEGION_TIMEOUT_MS || '120000', 10),
);

function getUrl(urlString) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: {},
    };
    if (process.env.LEGION_ADAPTER_API_BEARER) {
      opts.headers.Authorization = `Bearer ${process.env.LEGION_ADAPTER_API_BEARER}`;
    }
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('request timeout')));
    req.end();
  });
}

function postJson(urlString, payload, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const body = JSON.stringify(payload || {});
    const lib = u.protocol === 'https:' ? https : http;
    const timeoutMs = opts.timeoutMs || 10000;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

/**
 * Poll GET /api/adapters/runs/{runId} until status === 'completed' or timeout.
 * @param {string} runId - e.g. run_abc123
 * @param {string} baseUrl - Legion base URL (e.g. http://192.168.0.121:8000)
 * @returns {Promise<{ ok: boolean, result?: object, status?: string, error?: string }>}
 */
async function pollLegionRun(runId, baseUrl, opts = {}) {
  const url = `${stripTrailingSlash(baseUrl)}/api/adapters/runs/${encodeURIComponent(runId)}`;
  const start = Date.now();
  const pollTimeout = Math.max(
    15000,
    parseInt(String(opts.timeoutMs || POLL_TIMEOUT_MS), 10) || POLL_TIMEOUT_MS,
  );
  while (Date.now() - start < pollTimeout) {
    if (typeof opts.shouldAbort === 'function' && opts.shouldAbort()) {
      return { ok: false, status: 'cancelled', error: 'cancel_requested', cancelled: true };
    }
    try {
      const res = await getUrl(url);
      if (res.statusCode !== 200) continue;
      const json = JSON.parse(res.body || '{}');
      const status = String(json.status || '').toLowerCase();
      if (status === 'completed') {
        try {
          const { logActivity } = require('./activityLog');
          logActivity('legion_adapter_run', {
            runId,
            outcome: 'completed',
            capability: json.capability || null,
            adapterId: json.adapter_id || null,
          });
        } catch (_) {}
        return { ok: true, result: json.result, status: 'completed' };
      }
      if (status === 'failed' || status === 'error') {
        const err = json.error || (json.result && json.result.error) || json.message || 'Run failed';
        try {
          const { logActivity } = require('./activityLog');
          logActivity('legion_adapter_run', {
            runId,
            outcome: 'failed',
            error: String(err).slice(0, 300),
            capability: json.capability || null,
            adapterId: json.adapter_id || null,
          });
        } catch (_) {}
        return { ok: false, status, error: err, result: json.result || null };
      }
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') {
        console.warn('[legionRunPoller]', e.message);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { ok: false, status: 'timeout', error: 'Poll timeout' };
}

/**
 * Build a short summary for inventory.low_stock.scan result.
 * Compares to previous scan to report status changes (OK → Reorder).
 * @param {object} result - Legion run result
 * @param {string} capability - e.g. inventory.low_stock.scan
 * @param {string} [dataDir] - Data dir for last-scan flags (optional)
 * @returns {string} User-facing summary
 */
function buildSummaryFromResult(result, capability, dataDir) {
  if (!result) return '';
  // Support both Legion format (forecast_summary) and ausmakersupplies (summary)
  const summary = result.forecast_summary || result.summary || {};
  const flagged = Number(summary.flagged_recommendations_count) || 0;
  const total = Number(summary.purchase_recommendations_count) || Number(summary.purchase_order_items_count) || Number(summary.sku_count) || Number(result.sku_count) || 0;

  if (capability === 'inventory.low_stock.scan') {
    const recs = result.forecast_raw?.purchase_recommendations || result.purchase_recommendations || result.data?.purchase_recommendations || [];
    const currentFlags = {};
    for (const r of recs) {
      const sku = (r.sku || r.SKU || r.shopify_sku || r.cin7_sku || '').trim();
      if (sku) currentFlags[sku] = (r.flag || '').toLowerCase();
    }

    const prevFlags = dataDir ? loadLastScanFlags(dataDir) : null;
    let changedToReorder = [];
    let changedToOk = [];
    if (prevFlags) {
      for (const sku of Object.keys(currentFlags)) {
        const prev = (prevFlags[sku] || '').toLowerCase();
        const curr = (currentFlags[sku] || '').toLowerCase();
        if (prev === 'ok' && (curr === 'reorder' || curr === 'review')) changedToReorder.push(sku);
        if ((prev === 'reorder' || prev === 'review') && curr === 'ok') changedToOk.push(sku);
      }
    }

    if (dataDir) saveLastScanFlags(dataDir, currentFlags);

    const lines = [`📦 Inventory scan done. ${total} SKUs checked.`];

    if (changedToReorder.length > 0) {
      const list = changedToReorder.slice(0, 12).join(', ') + (changedToReorder.length > 12 ? '…' : '');
      lines.push(`${changedToReorder.length} changed from OK → Reorder: ${list}`);
    }
    if (changedToOk.length > 0) {
      const list = changedToOk.slice(0, 8).join(', ') + (changedToOk.length > 8 ? '…' : '');
      lines.push(`${changedToOk.length} improved (no longer need reorder): ${list}`);
    }

    // AusMaker flags: reorder (need to order now), ordered (already ordered), review (getting low)
    const reorderItems = recs.filter(isFlaggedReorderItem);
    const orderedItems = recs.filter((r) => (r.flag || '').toLowerCase() === 'ordered');
    const reviewItems = recs.filter((r) => (r.flag || '').toLowerCase() === 'review');
    let reorderCount = reorderItems.length;
    const orderedCount = orderedItems.length;
    const reviewCount = reviewItems.length;

    if (reorderCount === 0) {
      const fallbackCount = getReorderCountFromResult(result);
      if (fallbackCount > 0 && !recs.some((r) => r.flag)) {
        reorderCount = fallbackCount;
      }
    }

    if (reorderCount > 0 || orderedCount > 0 || reviewCount > 0) {
      const parts = [];
      if (reorderCount > 0) {
        const listSource = reorderItems.length > 0 ? reorderItems : recs.filter(isReorderItem);
        const items = listSource.map((r) => {
          const sku = (r.sku || r.SKU || r.shopify_sku || r.cin7_sku || '').trim();
          const qty = r.recommended_quantity ?? r.quantity ?? r.qty ?? '';
          return sku ? `${sku}${qty ? ` (${qty})` : ''}` : '';
        }).filter(Boolean);
        // GUILLOTINE: Cap at 5 sample items to avoid VRAM overspill on 7B
        const maxShow = Math.min(5, items.length);
        const itemList = items.slice(0, maxShow).join(', ') || `${reorderCount} item(s)`;
        parts.push(`${reorderCount} need reorder: ${itemList}${items.length > maxShow ? '…' : ''}`);
      }
      if (orderedCount > 0) parts.push(`${orderedCount} ordered (awaiting delivery)`);
      if (reviewCount > 0) parts.push(`${reviewCount} need review`);
      lines.push(parts.join('. '));
    } else {
      lines.push('No items flagged for reorder.');
    }

    return lines.join(' ');
  }

  if (capability === 'research.scrape.run') {
    const live = Number(result.live_count) || 0;
    const stubs = Number(result.stub_count) || 0;
    const count = Number(result.count) || (Array.isArray(result.items) ? result.items.length : 0);
    const focus = result.focus || 'unscoped';
    const errN = Array.isArray(result.errors) ? result.errors.length : 0;
    const titles = (result.items || []).slice(0, 5).map((i) => i.title || i.source_id).filter(Boolean);
    const stats = result.connector_stats
      ? Object.entries(result.connector_stats).map(([k, v]) => `${k}:${v}`).join(', ')
      : '';
    const q = result.quality || {};
    const lines = [
      `Harvest ${result.ok ? 'ok' : 'FAILED'}: focus=${focus}, live=${live}, stubs=${stubs}, saved=${count}, errors=${errN}.`,
    ];
    if (stats) lines.push(`Connectors: ${stats}.`);
    if (q && (q.substantive_count != null || q.literature_count != null)) {
      lines.push(
        `Quality: substantive=${q.substantive_count || 0} thin=${q.thin_count || 0} `
        + `literature=${q.literature_count || 0} candidates=${q.candidate_count || 0} `
        + `docs=${q.with_document || 0} max_chars=${q.max_text_chars || 0}.`,
      );
    }
    if (titles.length) lines.push(`Samples: ${titles.join(' · ')}`);
    if (!result.ok) {
      const errSample = (result.errors || []).slice(0, 3).join('; ');
      if (errSample) lines.push(`Errors: ${errSample}`);
    }
    return lines.join(' ');
  }

  if (capability === 'culture.corpus.search') {
    const n = Array.isArray(result.items) ? result.items.length : 0;
    const st = result.stats || {};
    return `Corpus search: ${n} hits (cache harvest_items=${st.harvest_items ?? '?'}, transcriptions=${st.transcriptions ?? '?'}).`;
  }

  if (capability === 'culture.pipeline.run') {
    const ids = result.harvest_ids || [];
    return `Pipeline: harvest_ids=${ids.join(',') || 'none'}; steps=${(result.steps || []).length}; ok=${!!result.ok}.`;
  }

  return `Legion run completed. ${flagged > 0 ? `${flagged} flagged.` : ''}`;
}

/** True when an item needs reorder (flag or positive order qty fallback). */
function isReorderItem(r) {
  if (!r) return false;
  const flag = (r.flag || '').toLowerCase();
  if (flag === 'reorder') return true;
  if (flag === 'ordered' || flag === 'review' || flag === 'ok') return false;
  const qty = r.recommended_quantity ?? r.quantity ?? r.qty ?? 0;
  return Number(qty) > 0;
}

/** Items flagged reorder specifically (matches AusMaker dashboard filter). */
function isFlaggedReorderItem(r) {
  if (!r) return false;
  return (r.flag || '').toLowerCase() === 'reorder';
}

/** Get reorder count from inventory result. */
function getReorderCountFromResult(result) {
  if (!result) return 0;
  const flagged = Number(result.flagged_count);
  if (Number.isFinite(flagged) && flagged > 0) return flagged;
  const summary = result.forecast_summary || result.summary || {};
  const fromSummary = Number(summary.flagged_recommendations_count);
  if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;
  const recs = result.forecast_raw?.purchase_recommendations || result.purchase_recommendations || result.data?.purchase_recommendations || [];
  const reorderByFlag = recs.filter(isFlaggedReorderItem).length;
  if (reorderByFlag > 0) return reorderByFlag;
  return recs.filter(isReorderItem).length;
}

/** User asked for full list (list all, show all, full list). */
function userAskedForFullList(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return false;
  const t = collapseWhitespace(String(userMessage).toLowerCase());
  if (t.includes('list all') || t.includes('show all') || t.includes('full list')) return true;
  if (t.includes('all reorder') || t.includes('all product') || t.includes('all products') || t.includes('all item') || t.includes('all items')) return true;
  return false;
}

/**
 * Format inventory reply: if user asked for "all" and count > 10, offer bulk options instead of truncating.
 * @param {object} result - Legion run result
 * @param {string} capability - e.g. inventory.low_stock.scan or inventory.report.export
 * @param {string} [dataDir] - Data dir
 * @param {string} [userMessage] - Original user message
 * @param {{ forceBulkOffer?: boolean, top10?: boolean }} [opts] - forceBulkOffer: always offer bulk; top10: list first 10 items (follow-up from negotiation)
 * @returns {string} User-facing reply
 */
function formatInventoryReply(result, capability, dataDir, userMessage, opts = {}) {
  if (capability === 'inventory.csv.generate' || (result && result.csv_content)) {
    const rows = result.rows_processed || Math.max(0, String(result.csv_content || '').split('\n').length - 1);
    const countHint = rows > 0 ? ` (${rows} items)` : '';
    return `Reorder CSV ready${countHint}. [Download Reorder CSV](/api/exports/reorder-csv)`;
  }
  const scanCap = capability === 'inventory.report.export' ? 'inventory.low_stock.scan' : capability;
  const summary = buildSummaryFromResult(result, scanCap, dataDir);
  if (capability !== 'inventory.low_stock.scan' && capability !== 'inventory.report.export') return summary || 'Done.';
  const reorderCount = getReorderCountFromResult(result);

  if (opts.top10 && reorderCount > 0) {
    const recs = result.forecast_raw?.purchase_recommendations || result.purchase_recommendations || result.data?.purchase_recommendations || [];
    const reorderItems = recs.filter(isFlaggedReorderItem);
    const listSource = reorderItems.length > 0 ? reorderItems : recs.filter(isReorderItem);
    const items = listSource.slice(0, 10).map((r) => {
      const sku = (r.sku || r.SKU || r.shopify_sku || r.cin7_sku || '').trim();
      const qty = r.recommended_quantity ?? r.quantity ?? r.qty ?? '';
      return sku ? `- ${sku}${qty ? ` (${qty})` : ''}` : '';
    }).filter(Boolean);
    const lines = [`Here are the top ${Math.min(10, reorderCount)} items needing reorder:`];
    lines.push(items.join('\n'));
    if (reorderCount > 10) lines.push(`… and ${reorderCount - 10} more.`);
    return lines.join('\n');
  }

  const forceBulk = opts.forceBulkOffer || capability === 'inventory.report.export';
  const recs = result.forecast_raw?.purchase_recommendations || result.purchase_recommendations || result.data?.purchase_recommendations || [];
  const effectiveCount = reorderCount || recs.length;
  const shouldOfferBulk =
    (effectiveCount > 10 && userAskedForFullList(userMessage))
    || (forceBulk && effectiveCount > 0);
  if (shouldOfferBulk) {
    return `The scan found ${effectiveCount} items needing reorder. That's too many to list in this chat window. Reply **download csv** for a file you can save locally, or **top 10** for a short list here.`;
  }
  return summary || 'Done. No items flagged.';
}

module.exports = { pollLegionRun, buildSummaryFromResult, formatInventoryReply, getReorderCountFromResult, userAskedForFullList, getUrl, postJson, POLL_TIMEOUT_MS };
