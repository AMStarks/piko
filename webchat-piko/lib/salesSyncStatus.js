/**
 * Deterministic sales cache sync status reads (no mutation).
 */
const { normalizeApostrophes } = require('./queueRead');
const { toLowerAsciiish, includesAny, hasAnyWord, collapseWhitespace, replaceAllLiteral } = require('./text');

function isSalesSyncStatusQuery(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t) return false;
  if (hasAnyWord(t, ['run', 'start', 'trigger', 'perform']) && t.includes('sync')) return false;
  if (includesAny(t, ['kick off', 'do a']) && t.includes('sync')) return false;

  if (includesAny(t, [
    'sales sync status',
    'last sales sync',
    'when was the sales data last updated',
    'when was sales data last updated',
    'when was the sales cache last updated',
    'when was sales cache last updated',
  ])) return true;

  if (includesAny(t, ['sales sync', 'sales last sync', 'shopify sync', 'shopify last sync',
    'sales cache sync', 'sales cache last sync', 'shopify cache sync'])) return true;

  const timeCue = hasAnyWord(t, ['when', 'what']) || includesAny(t, ['what time', 'how long ago']);
  const syncCue = includesAny(t, ['sync', 'synced', 'syncing', 'updated', 'update', 'refresh', 'refreshed']);
  const domainCue = hasAnyWord(t, ['sales', 'shopify', 'cache', 'data']);
  return timeCue && syncCue && domainCue;
}

function formatSalesSyncStatusReply(status) {
  const last = status && status.last_synced_at ? String(status.last_synced_at) : '';
  const rows = status && status.rows != null ? Number(status.rows) : null;
  const state = status && status.state ? String(status.state) : '';
  const progress = status && status.progress ? String(status.progress) : '';

  if (!last && rows == null && !state) {
    return 'Sales cache status is unavailable right now — AusMaker may be starting up. Try again in a minute.';
  }

  const parts = [];
  if (last) {
    const display = replaceAllLiteral(last.slice(0, 19), 'T', ' ');
    parts.push(`Sales cache last synced ${display} UTC`);
  } else {
    parts.push('Sales cache has no recorded sync timestamp yet');
  }
  if (rows != null && Number.isFinite(rows)) {
    parts.push(`${rows.toLocaleString()} order lines in cache`);
  }
  if (state && state !== 'idle') {
    parts.push(`Current state: ${state}${progress ? ` — ${progress}` : ''}`);
  }
  return `${parts.join('. ')}.`;
}

async function fetchSalesSyncStatus(getUrl, baseUrl) {
  let base = String(baseUrl || '');
  while (base.endsWith('/')) base = base.slice(0, -1);
  const url = `${base}/api/sales-db/status`;
  const res = await getUrl(url);
  if (res.statusCode !== 200) {
    return { ok: false, error: 'Sales status API unavailable. Try again in a minute.' };
  }
  const status = JSON.parse(res.body || '{}');
  return { ok: true, reply: formatSalesSyncStatusReply(status), status };
}

module.exports = {
  isSalesSyncStatusQuery,
  formatSalesSyncStatusReply,
  fetchSalesSyncStatus,
};
