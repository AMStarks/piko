/**
 * Maturation metrics: wisdom growth, relationship trust, truth engine.
 * data/metrics/{wisdom_growth,relationship,truth_engine}.json
 */
const path = require('path');
const fs = require('fs');

const METRICS_DIR = process.env.PIKO_METRICS_DIR || path.join(__dirname, '..', 'data', 'metrics');
const WISDOM_GROWTH_FILE = path.join(METRICS_DIR, 'wisdom_growth.json');
const RELATIONSHIP_FILE = path.join(METRICS_DIR, 'relationship.json');
const TRUTH_ENGINE_FILE = path.join(METRICS_DIR, 'truth_engine.json');

function readJson(file, defaultValue) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getWisdomGrowth() {
  return readJson(WISDOM_GROWTH_FILE, { weekly: [], growth_rate: 0, maturation_score: 0 });
}

function getRelationshipMetrics() {
  return readJson(RELATIONSHIP_FILE, {
    days_wedded: 0,
    trust_score: 0,
    advice_followed: { total: 0, recent_7d: 0, follow_rate: 0 },
    checkin_responses: 0,
  });
}

function getTruthEngineMetrics() {
  return readJson(TRUTH_ENGINE_FILE, {
    claims_this_week: 0,
    confirmed_this_week: 0,
    corrections_this_week: 0,
  });
}

/** Call when primary human acts on Piko's advice (e.g. created reminder, followed suggestion). */
function recordAdviceFollowed(source) {
  const rel = getRelationshipMetrics();
  rel.advice_followed = rel.advice_followed || { total: 0, recent_7d: 0, follow_rate: 0 };
  rel.advice_followed.total = (rel.advice_followed.total || 0) + 1;
  rel.advice_followed.recent_7d = (rel.advice_followed.recent_7d || 0) + 1;
  const total = rel.advice_followed.total;
  const recent = rel.advice_followed.recent_7d;
  rel.advice_followed.follow_rate = total > 0 ? Math.min(1, recent / Math.max(1, Math.min(7, total))) : 0;
  rel.trust_score = total < 5 ? 0.5 + (total * 0.1) : Math.min(0.98, 0.7 + (rel.advice_followed.follow_rate || 0) * 0.28);
  if (!rel.companion_since) rel.companion_since = new Date().toISOString().slice(0, 10);
  rel.days_wedded = rel.companion_since
    ? Math.max(0, Math.floor((Date.now() - new Date(rel.companion_since).getTime()) / (24 * 60 * 60 * 1000)))
    : 0;
  writeJson(RELATIONSHIP_FILE, rel);
  try {
    const { appendImpact } = require('./impact');
    appendImpact({ type: 'advice_followed', source: source || null });
  } catch (_) {}
}

/** Call when primary human affirms a wisdom (e.g. "w001 is spot on"). Updates truth engine and metrics. */
function wisdomConfirmed(wisdomId) {
  const { wisdomConfirmed: truthWisdomConfirmed } = require('./truth');
  const ok = truthWisdomConfirmed(wisdomId);
  if (ok) {
    const te = getTruthEngineMetrics();
    te.confirmed_this_week = (te.confirmed_this_week || 0) + 1;
    writeJson(TRUTH_ENGINE_FILE, te);
    const wg = getWisdomGrowth();
    const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    let week = wg.weekly.find((w) => w.week === weekNum);
    if (!week) {
      week = { week: weekNum, wisdom_total: 0, confirmed: 0, confirmation_rate: 0, top_wisdom: [] };
      wg.weekly.push(week);
    }
    week.confirmed = (week.confirmed || 0) + 1;
    week.wisdom_total = Math.max(week.wisdom_total || 0, week.confirmed);
    week.confirmation_rate = week.wisdom_total ? (week.confirmed / week.wisdom_total) : 0;
    wg.maturation_score = wg.weekly.length ? wg.weekly[wg.weekly.length - 1].confirmation_rate || 0 : 0;
    wg.growth_rate = wg.weekly.length > 1
      ? (wg.weekly[wg.weekly.length - 1].wisdom_total || 0) / Math.max(1, wg.weekly.length)
      : 0;
    writeJson(WISDOM_GROWTH_FILE, wg);
  }
  return ok;
}

/** Aggregate metrics for dashboard: truth stats + wisdom top by score + relationship + growth. */
function getMetrics() {
  const { getTruthStats, getWisdomCache } = require('./truth');
  const truthStats = getTruthStats();
  const cache = getWisdomCache();
  const existingIds = new Set();
  const normalize = (w, i) => {
    const text = (w.text || w || '').trim();
    if (!text) return null;
    const created = w.created_at || w.distilled || new Date().toISOString();
    const distilled = (w.distilled || created).toString().slice(0, 10);
    let id = w.id;
    if (!id || !/^w\d+$/i.test(id)) {
      let n = i + 1;
      while (existingIds.has(`w${String(n).padStart(3, '0')}`)) n++;
      id = `w${String(n).padStart(3, '0')}`;
      existingIds.add(id);
    }
    const ageDays = Math.max(1, Math.floor((Date.now() - new Date(distilled).getTime()) / (24 * 60 * 60 * 1000)));
    const confirmed = typeof w.confirmed === 'number' ? w.confirmed : 0;
    const ageDaysVal = w.age_days != null ? w.age_days : ageDays;
    return {
      id,
      text,
      distilled,
      confirmed,
      age_days: ageDaysVal,
      status: w.status || 'active',
      score: confirmed * Math.max(1, ageDaysVal),
    };
  };
  const scored = (cache.wisdom || [])
    .map((w, i) => normalize(w, i))
    .filter(Boolean)
    .filter((w) => w.status === 'active');
  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  const topWisdom = scored.slice(0, 10).map((w) => ({
    id: w.id,
    text: w.text,
    confirmed: w.confirmed,
    age_days: w.age_days,
    score: w.score,
  }));

  const rel = getRelationshipMetrics();
  const te = getTruthEngineMetrics();
  const wg = getWisdomGrowth();

  return {
    wisdom: {
      total: truthStats.wisdom_count,
      confirmed: (cache.wisdom || []).filter((w) => (w.confirmed || 0) > 0).length,
      last_distilled: truthStats.last_distilled,
      top: topWisdom,
    },
    wisdom_growth: wg,
    relationship: rel,
    truth_engine: {
      ...te,
      claims_count: truthStats.claims_count,
      corrections_count: truthStats.corrections_count,
    },
  };
}

/** Stub: generate weekly retro report (e.g. for Telegram). Call from cron Sunday 8AM. */
function weeklyRetro() {
  const m = getMetrics();
  const lines = [
    'Week 2 maturation report (stub)',
    `Wisdom: ${m.wisdom.total} statements, ${m.wisdom.confirmed} confirmed.`,
    `Trust: ${Math.round((m.relationship.trust_score || 0) * 100)}%`,
    `Growth: ${(m.wisdom_growth.growth_rate || 0).toFixed(1)}x wisdom/week.`,
  ];
  return lines.join('\n');
}

module.exports = {
  recordAdviceFollowed,
  wisdomConfirmed,
  getMetrics,
  getWisdomGrowth,
  getRelationshipMetrics,
  getTruthEngineMetrics,
  weeklyRetro,
  METRICS_DIR,
};
