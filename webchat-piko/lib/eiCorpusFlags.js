/**
 * Corpus keep/drop flags — Piko review of each source for the research goal.
 * Mandatory content review: read OCR/text/PDF/image, not metadata heuristics alone.
 * Stored beside cultures_cache (writable without fighting root-owned sqlite).
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot, listItems, getItem } = require('./culturesCorpusApi');
const { loadResearchGoal } = require('./eiResearchGoal');
const { assessPrimaryText } = require('./eiTextScout');
const { contentReviewEnabled, reviewItemContent } = require('./eiCorpusContentReview');
const { loadRules, formatRulesSummary } = require('./corpusReviewRules');

// Prefer the same blob TextScout uses (includes meta / official_text / source_id).
function itemBlob(item) {
  try {
    const { blobForItem } = require('./eiTextScout');
    if (typeof blobForItem === 'function') return blobForItem(item);
  } catch (_) { /* fall through */ }
  const meta = item.meta || {};
  return [
    item.title,
    item.source_name,
    item.source,
    item.source_id,
    item.location,
    item.site,
    item.kind,
    item.type,
    item.official_text,
    meta.creator,
    JSON.stringify(meta),
  ].map((x) => String(x || '')).join(' ').toLowerCase();
}

function flagsPath() {
  return path.join(culturesDataRoot(), 'corpus_flags.json');
}

function loadFlags() {
  const p = flagsPath();
  try {
    if (!fs.existsSync(p)) return { updated_at: null, items: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      updated_at: raw.updated_at || null,
      items: raw.items && typeof raw.items === 'object' ? raw.items : {},
    };
  } catch (_) {
    return { updated_at: null, items: {} };
  }
}

function saveFlags(store) {
  const p = flagsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = {
    updated_at: new Date().toISOString(),
    items: store.items || {},
  };
  fs.writeFileSync(p, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

function getFlag(harvestId) {
  const id = String(harvestId);
  const store = loadFlags();
  return store.items[id] || null;
}

function setFlag(harvestId, entry) {
  const store = loadFlags();
  store.items[String(harvestId)] = {
    flag: entry.flag,
    reason: entry.reason || '',
    score: entry.score != null ? entry.score : null,
    reasons: entry.reasons || [],
    reviewed_at: entry.reviewed_at || new Date().toISOString(),
    reviewer: entry.reviewer || 'piko',
  };
  saveFlags(store);
  return store.items[String(harvestId)];
}

function clearFlag(harvestId) {
  const store = loadFlags();
  const id = String(harvestId);
  if (!(id in store.items)) return null;
  delete store.items[id];
  saveFlags(store);
  return true;
}

/** Serialize flag writes across concurrent content reviews. */
let _flagWriteChain = Promise.resolve();
function setFlagLocked(harvestId, entry) {
  const run = _flagWriteChain.then(() => setFlag(harvestId, entry));
  _flagWriteChain = run.catch(() => {});
  return run;
}

function verdictToFlag(verdict) {
  if (verdict === 'accept' || verdict === 'keep') return 'keep';
  if (verdict === 'reject' || verdict === 'drop') return 'drop';
  return 'review';
}

function siteDefForItem(item, goal) {
  const siteId = String(item.site || '').toLowerCase();
  const sites = goal.sites || [];
  const hit = sites.find((s) => s.id === siteId);
  if (hit) return hit;
  const blob = `${item.title || ''} ${item.location || ''}`.toLowerCase();
  for (const s of sites) {
    const aliases = [s.id, ...(s.aliases || [])].map((a) => String(a).toLowerCase());
    if (aliases.some((a) => a && blob.includes(a))) return s;
  }
  return { id: siteId || 'unknown', aliases: [], label: item.location || 'unknown' };
}

/**
 * Review one harvest item and persist flag.
 * Always content-reviews when enabled (reads text/OCR/PDF/image).
 */
async function reviewOneItem(harvestId, opts = {}) {
  const full = getItem(harvestId);
  if (!full.ok || !full.item) return { ok: false, error: 'not found', harvest_id: harvestId };
  const goal = opts.goal || loadResearchGoal();
  const rules = opts.rules || loadRules();
  const rulesSummary = opts.rulesSummary || formatRulesSummary(rules);
  const item = full.item;

  if (item.kind === 'source_candidate' && !opts.include_candidates) {
    const entry = await setFlagLocked(harvestId, {
      flag: 'drop',
      reason: 'Source scout candidate — not a primary text',
      score: 0,
      reasons: ['source_candidate'],
      reviewer: 'piko',
    });
    return { ok: true, harvest_id: harvestId, ...entry, title: item.source_name || item.title };
  }

  const siteDef = siteDefForItem(item, goal);
  const assessed = assessPrimaryText(item, siteDef, { rules });

  let flag;
  let reason;
  let reasons;
  let score = assessed.score;
  let content = null;

  if (contentReviewEnabled() && !opts.skip_content_review) {
    try {
      content = await reviewItemContent(item, { goal, rulesSummary });
    } catch (e) {
      content = {
        ok: false,
        verdict: 'review',
        reason_tag: 'content_review:error',
        why: String(e.message || e).slice(0, 180),
        confidence: 0,
      };
    }

    const noReadable = content.reason_tag === 'content_review:no_readable_content';

    if (noReadable) {
      flag = 'drop';
      reason = `${content.reason_tag}${content.why ? ` — ${content.why}` : ''}`;
      reasons = [content.reason_tag, ...(assessed.reasons || []).slice(0, 2)];
      score = 0;
    } else {
      flag = verdictToFlag(content.verdict);
      reason = `${content.reason_tag || `content_review:${flag}`}${content.why ? ` — ${content.why}` : ''}`;
      if (content.content_source) reason += ` [${content.content_source}]`;
      reasons = [
        content.reason_tag || `content_review:${flag}`,
        content.content_source ? `source:${content.content_source}` : null,
        ...(assessed.reasons || []).slice(0, 2),
      ].filter(Boolean);
      if (content.confidence != null) score = Math.round(Number(content.confidence) * 100);
    }
  } else {
    // Fallback: metadata heuristics only (tests / PIKO_EI_CONTENT_REVIEW=0)
    flag = verdictToFlag(assessed.verdict);
    reason = assessed.reasons.slice(0, 4).join(', ');
    reasons = assessed.reasons;
  }

  const entry = await setFlagLocked(harvestId, {
    flag,
    reason: String(reason || '').slice(0, 400),
    score,
    reasons,
    reviewer: 'piko-content',
  });
  return {
    ok: true,
    harvest_id: harvestId,
    title: item.source_name || item.title,
    ...entry,
    assessment: assessed,
    content_review: content,
  };
}

async function mapPool(items, concurrency, fn) {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Review every corpus item (excludes candidates unless asked).
 */
async function reviewAllCorpus(opts = {}) {
  const started = Date.now();
  const pageSize = 80;
  let offset = 0;
  let total = Infinity;
  const ids = [];
  const goal = loadResearchGoal();
  const rules = loadRules();
  const rulesSummary = formatRulesSummary(rules);

  while (offset < total) {
    const page = listItems({
      limit: pageSize,
      offset,
      exclude_candidates: opts.include_candidates ? false : true,
    });
    total = page.total || 0;
    const items = page.items || [];
    if (!items.length) break;
    for (const summary of items) ids.push(summary.id);
    offset += pageSize;
    if (items.length < pageSize) break;
  }

  const concurrency = Math.max(
    1,
    Math.min(4, Number(opts.concurrency || process.env.PIKO_EI_CONTENT_REVIEW_CONCURRENCY || 2)),
  );

  const results = [];
  const counts = { keep: 0, drop: 0, review: 0 };
  const shared = { goal, rules, rulesSummary, ...opts };

  await mapPool(ids, concurrency, async (id) => {
    const out = await reviewOneItem(id, shared);
    if (out.ok) {
      counts[out.flag] = (counts[out.flag] || 0) + 1;
      results.push({
        harvest_id: out.harvest_id,
        title: out.title,
        flag: out.flag,
        score: out.score,
        reason: out.reason,
        content_source: out.content_review && out.content_review.content_source,
      });
    }
    return out;
  });

  const store = loadFlags();
  return {
    ok: true,
    pass: (counts.keep || 0) > 0,
    summary: `Piko content review: keep=${counts.keep || 0} review=${counts.review || 0} drop=${counts.drop || 0} (read sources)`,
    counts,
    reviewed: results.length,
    duration_ms: Date.now() - started,
    updated_at: store.updated_at,
    flags_path: flagsPath(),
    content_review: contentReviewEnabled() && !opts.skip_content_review,
    sample: results.slice(0, 30),
  };
}

function attachFlag(item) {
  if (!item || item.id == null) return item;
  const f = getFlag(item.id);
  if (!f) {
    item.flag = null;
    item.flag_reason = null;
    item.flag_score = null;
    return item;
  }
  item.flag = f.flag;
  item.flag_reason = f.reason || null;
  item.flag_score = f.score;
  item.flag_reviewed_at = f.reviewed_at || null;
  return item;
}

async function runCorpusReview(opts = {}) {
  const report = await reviewAllCorpus(opts);
  let rulesSummary = '';
  try {
    rulesSummary = formatRulesSummary();
  } catch (_) { /* optional */ }
  const lines = [
    '[ei-corpus-reviewer / flag sources]',
    report.summary,
    `Reviewed: ${report.reviewed}`,
    `Content review: ${report.content_review ? 'on (read text/OCR/PDF/image)' : 'off'}`,
    `Flags file: ${report.flags_path}`,
    rulesSummary ? `\n${rulesSummary}` : '',
    '',
    ...report.sample.map(
      (r) => `  [${r.flag}] #${r.harvest_id} ${(r.title || '').slice(0, 60)} — ${r.reason}`,
    ),
  ];
  return {
    status: report.pass ? 'ok' : 'needs_revision',
    artifact_text: lines.filter((l) => l !== '').join('\n'),
    result: report,
    pass: report.pass,
    report,
  };
}

module.exports = {
  loadFlags,
  saveFlags,
  getFlag,
  setFlag,
  clearFlag,
  reviewOneItem,
  reviewAllCorpus,
  runCorpusReview,
  attachFlag,
  flagsPath,
  verdictToFlag,
};
