/**
 * Operator unsure queue — items flagged review / unsure for keep/drop decisions.
 */
const { loadFlags, setFlag, getFlag, clearFlag } = require('./eiCorpusFlags');
const { getItem, deleteHarvestItem, listItems } = require('./culturesCorpusApi');

function listUnsureQueue(opts = {}) {
  const limit = Math.max(1, Math.min(100, Number(opts.limit || 40)));
  const store = loadFlags();
  const items = [];
  for (const [id, entry] of Object.entries(store.items || {})) {
    const flag = String((entry && entry.flag) || '').toLowerCase();
    if (flag !== 'review' && flag !== 'unsure') continue;
    const hid = Number(id);
    let title = '';
    let author = '';
    let hasDoc = false;
    try {
      const got = getItem(hid);
      if (got.ok && got.item) {
        title = got.item.title || '';
        author = (got.item.meta && (got.item.meta.author || got.item.meta.work_author)) || '';
        hasDoc = !!(got.item.has_local_document || got.item.local_document_path);
      }
    } catch (_) { /* ok */ }
    items.push({
      harvest_id: hid,
      flag,
      reason: (entry && entry.reason) || '',
      reviewed_at: (entry && entry.reviewed_at) || null,
      title,
      author,
      has_local_document: hasDoc,
    });
  }
  items.sort((a, b) => String(b.reviewed_at || '').localeCompare(String(a.reviewed_at || '')));
  return { ok: true, items: items.slice(0, limit), count: items.length };
}

/**
 * Promote unsure → keep (or demote → drop/purge).
 */
async function resolveUnsure(harvestId, action, opts = {}) {
  const hid = Number(harvestId);
  if (!Number.isFinite(hid) || hid <= 0) return { ok: false, error: 'invalid id' };
  const act = String(action || '').toLowerCase();
  if (act === 'keep') {
    setFlag(hid, {
      flag: 'keep',
      reason: opts.reason || 'operator_approved_unsure',
      reviewer: opts.reviewer || 'operator',
    });
    try {
      require('./eiCorpusRag').indexHarvest(hid).catch(() => {});
    } catch (_) { /* ok */ }
    return { ok: true, harvest_id: hid, action: 'keep' };
  }
  if (act === 'drop' || act === 'purge') {
    if (act === 'purge' || opts.purge !== false) {
      const del = deleteHarvestItem(hid);
      if (del.ok) {
        try { clearFlag(hid); } catch (_) { /* ok */ }
        return { ok: true, harvest_id: hid, action: 'purged' };
      }
    }
    setFlag(hid, {
      flag: 'drop',
      reason: opts.reason || 'operator_rejected_unsure',
      reviewer: opts.reviewer || 'operator',
    });
    return { ok: true, harvest_id: hid, action: 'drop' };
  }
  return { ok: false, error: 'action must be keep|drop|purge' };
}

module.exports = {
  listUnsureQueue,
  resolveUnsure,
};
