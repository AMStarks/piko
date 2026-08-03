/**
 * Outcome ledger for EI improvement / engineering tasks (WP4.7 / S3).
 * One JSONL record per finished task so proposers and lookups can see what worked.
 */
const fs = require('fs');
const path = require('path');

function ledgerPath(rootDir) {
  const base = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  return path.join(base, 'ei-engineering', 'outcomes.jsonl');
}

/**
 * @param {{
 *   id: string,
 *   category?: string,
 *   kind?: string,
 *   subject?: string,
 *   outcome: string,
 *   release_id?: string|null,
 *   detail?: string,
 *   at?: string,
 * }} record
 */
function appendOutcome(record, rootDir) {
  if (!record || !record.id || !record.outcome) {
    return { ok: false, error: 'id_and_outcome_required' };
  }
  const row = {
    id: String(record.id),
    category: record.category || null,
    kind: record.kind || null,
    subject: record.subject ? String(record.subject).slice(0, 200) : null,
    outcome: String(record.outcome).slice(0, 80),
    release_id: record.release_id || null,
    detail: record.detail != null ? String(record.detail).slice(0, 400) : null,
    at: record.at || new Date().toISOString(),
  };
  try {
    const p = ledgerPath(rootDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${JSON.stringify(row)}\n`, 'utf8');
    return { ok: true, record: row };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }
}

function recentOutcomes(limit = 10, rootDir) {
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  try {
    const p = ledgerPath(rootDir);
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n);
    const out = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch (_) { /* skip */ }
    }
    return out;
  } catch (_) {
    return [];
  }
}

function outcomeSummaryForLookup(limit = 8, rootDir) {
  const rows = recentOutcomes(limit, rootDir);
  if (!rows.length) {
    return { ok: true, count: 0, recent: [], line: 'No improvement outcomes recorded yet.' };
  }
  const ok = rows.filter((r) => /^(applied|ready_for_review|done|success)$/i.test(r.outcome)).length;
  const failed = rows.filter((r) => /fail/i.test(r.outcome)).length;
  const line = `Improvement outcomes (last ${rows.length}): ${ok} ok · ${failed} failed`
    + (rows[rows.length - 1]
      ? ` · latest=${rows[rows.length - 1].outcome} (${rows[rows.length - 1].subject || rows[rows.length - 1].id})`
      : '');
  return {
    ok: true,
    count: rows.length,
    ok_count: ok,
    failed_count: failed,
    recent: rows.slice(-limit),
    line,
  };
}

function formatOutcomesForProposer(limit = 5, rootDir) {
  const rows = recentOutcomes(limit, rootDir);
  if (!rows.length) return '';
  return [
    'Recent improvement outcomes (do not repeat failed approaches blindly):',
    ...rows.map((r) => `- ${r.outcome}: ${r.subject || r.id}${r.detail ? ` — ${r.detail}` : ''}`),
  ].join('\n');
}

module.exports = {
  ledgerPath,
  appendOutcome,
  recentOutcomes,
  outcomeSummaryForLookup,
  formatOutcomesForProposer,
};
