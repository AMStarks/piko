/**
 * Operator-editable corpus Flag rules (keep / drop / review).
 * Written by chat (corpusReviewRulesMutate) or API; consumed by assessPrimaryText.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot } = require('./culturesCorpusApi');

const DEFAULTS = {
  notes: [],
  blocked_extra: [],
  blocked_remove: [],
  force_keep: [],
  force_drop: [],
  force_review: [],
  primary_signals_extra: [],
  period_signals_extra: [],
  accept_min_score: 70,
  reject_max_score: 40,
  require_site_hit_for_accept: true,
  /** Prefer real documents/images; drop thin link-only / online-stub items. */
  prefer_local_assets: false,
};

function rulesPath() {
  return path.join(culturesDataRoot(), 'corpus_review_rules.json');
}

function normalizeTermList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const t = String(raw || '').toLowerCase().trim();
    if (!t || t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function clampScore(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeRules(raw) {
  const base = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    updated_at: base.updated_at || null,
    updated_by: base.updated_by || null,
    notes: Array.isArray(base.notes)
      ? base.notes.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 40)
      : [],
    blocked_extra: normalizeTermList(base.blocked_extra),
    blocked_remove: normalizeTermList(base.blocked_remove),
    force_keep: normalizeTermList(base.force_keep),
    force_drop: normalizeTermList(base.force_drop),
    force_review: normalizeTermList(base.force_review),
    primary_signals_extra: normalizeTermList(base.primary_signals_extra),
    period_signals_extra: normalizeTermList(base.period_signals_extra),
    accept_min_score: clampScore(base.accept_min_score, DEFAULTS.accept_min_score),
    reject_max_score: clampScore(base.reject_max_score, DEFAULTS.reject_max_score),
    require_site_hit_for_accept: base.require_site_hit_for_accept !== false,
    prefer_local_assets: !!base.prefer_local_assets,
  };
}

function loadRules() {
  const p = rulesPath();
  try {
    if (!fs.existsSync(p)) return normalizeRules({ ...DEFAULTS });
    return normalizeRules(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (_) {
    return normalizeRules({ ...DEFAULTS });
  }
}

function saveRules(next, meta = {}) {
  const normalized = normalizeRules(next);
  normalized.updated_at = new Date().toISOString();
  normalized.updated_by = meta.updated_by || normalized.updated_by || 'operator';
  const p = rulesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function resetRules(meta = {}) {
  return saveRules({ ...DEFAULTS }, { updated_by: meta.updated_by || 'operator' });
}

/**
 * Apply a patch from chat/API. Term lists use add_* / remove_* helpers.
 */
function applyPatch(patch = {}, meta = {}) {
  const cur = loadRules();
  const next = { ...cur };

  const addTo = (key, terms) => {
    next[key] = normalizeTermList([...(next[key] || []), ...normalizeTermList(terms)]);
  };
  const removeFrom = (key, terms) => {
    const drop = new Set(normalizeTermList(terms));
    next[key] = (next[key] || []).filter((t) => !drop.has(t));
  };

  if (Array.isArray(patch.notes_add)) {
    next.notes = [...(next.notes || []), ...patch.notes_add.map((n) => String(n || '').trim()).filter(Boolean)]
      .slice(-40);
  }
  if (patch.notes_clear) next.notes = [];

  if (patch.blocked_extra_add) addTo('blocked_extra', patch.blocked_extra_add);
  if (patch.blocked_extra_remove) removeFrom('blocked_extra', patch.blocked_extra_remove);
  if (patch.blocked_remove_add) addTo('blocked_remove', patch.blocked_remove_add);
  if (patch.blocked_remove_remove) removeFrom('blocked_remove', patch.blocked_remove_remove);

  if (patch.force_keep_add) {
    addTo('force_keep', patch.force_keep_add);
    removeFrom('force_drop', patch.force_keep_add);
    removeFrom('force_review', patch.force_keep_add);
    removeFrom('blocked_extra', patch.force_keep_add);
  }
  if (patch.force_keep_remove) removeFrom('force_keep', patch.force_keep_remove);

  if (patch.force_drop_add) {
    addTo('force_drop', patch.force_drop_add);
    addTo('blocked_extra', patch.force_drop_add);
    removeFrom('force_keep', patch.force_drop_add);
    removeFrom('force_review', patch.force_drop_add);
  }
  if (patch.force_drop_remove) {
    removeFrom('force_drop', patch.force_drop_remove);
    removeFrom('blocked_extra', patch.force_drop_remove);
  }

  if (patch.force_review_add) {
    addTo('force_review', patch.force_review_add);
    removeFrom('force_keep', patch.force_review_add);
    removeFrom('force_drop', patch.force_review_add);
  }
  if (patch.force_review_remove) removeFrom('force_review', patch.force_review_remove);

  if (patch.primary_signals_extra_add) addTo('primary_signals_extra', patch.primary_signals_extra_add);
  if (patch.period_signals_extra_add) addTo('period_signals_extra', patch.period_signals_extra_add);

  if (patch.accept_min_score != null) next.accept_min_score = clampScore(patch.accept_min_score, next.accept_min_score);
  if (patch.reject_max_score != null) next.reject_max_score = clampScore(patch.reject_max_score, next.reject_max_score);
  if (patch.require_site_hit_for_accept != null) {
    next.require_site_hit_for_accept = !!patch.require_site_hit_for_accept;
  }
  if (patch.prefer_local_assets != null) {
    next.prefer_local_assets = !!patch.prefer_local_assets;
  }

  if (patch.reset === true) {
    return resetRules(meta);
  }

  return saveRules(next, meta);
}

function effectiveBlocked(builtinBlocked) {
  const rules = loadRules();
  const remove = new Set(rules.blocked_remove || []);
  const base = (builtinBlocked || []).map((t) => String(t).toLowerCase()).filter((t) => !remove.has(t));
  return normalizeTermList([...base, ...(rules.blocked_extra || [])]);
}

function firstMatch(blob, terms) {
  const b = String(blob || '').toLowerCase();
  for (const t of terms || []) {
    if (t && b.includes(t)) return t;
  }
  return null;
}

function formatRulesSummary(rules) {
  const r = rules || loadRules();
  const lines = [
    'Corpus Flag rules (operator + defaults):',
    `  keep if score ≥ ${r.accept_min_score}${r.require_site_hit_for_accept ? ' and site match' : ''}`,
    `  drop if score < ${r.reject_max_score} (or weak site + few primary signals)`,
    `  else → review`,
  ];
  if (r.force_keep.length) lines.push(`  always keep: ${r.force_keep.join('; ')}`);
  if (r.force_drop.length) lines.push(`  always drop: ${r.force_drop.join('; ')}`);
  if (r.force_review.length) lines.push(`  always review: ${r.force_review.join('; ')}`);
  if (r.prefer_local_assets) {
    lines.push('  prefer local assets: keep documents/images; drop thin link-only stubs');
  }
  if (r.blocked_extra.length) lines.push(`  extra blocklist: ${r.blocked_extra.join('; ')}`);
  if (r.blocked_remove.length) lines.push(`  removed from default blocklist: ${r.blocked_remove.join('; ')}`);
  if (r.notes.length) {
    lines.push('  notes:');
    for (const n of r.notes.slice(-5)) lines.push(`    - ${n}`);
  }
  if (r.updated_at) lines.push(`  updated: ${r.updated_at} (${r.updated_by || '—'})`);
  return lines.join('\n');
}

module.exports = {
  DEFAULTS,
  rulesPath,
  loadRules,
  saveRules,
  resetRules,
  applyPatch,
  normalizeRules,
  effectiveBlocked,
  firstMatch,
  formatRulesSummary,
};
