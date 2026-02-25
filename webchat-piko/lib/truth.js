/**
 * Truth engine: claims, corrections, wisdom cache. Daily truth state for the prompt.
 */
const path = require('path');
const fs = require('fs');

const TRUTH_DIR = process.env.PIKO_TRUTH_DIR || path.join(__dirname, '..', 'data', 'truth');
const CLAIMS_FILE = path.join(TRUTH_DIR, 'claims.json');
const CORRECTIONS_FILE = path.join(TRUTH_DIR, 'corrections.json');
const WISDOM_FILE = path.join(TRUTH_DIR, 'wisdom_cache.json');
const RECENT_CLAIMS = 5;
const RECENT_CORRECTIONS = 5;
const WISDOM_TOP_N = 3;

function readJson(file, defaultValue) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(TRUTH_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(items, prefix) {
  const nums = (items || [])
    .map((x) => (x.id && x.id.startsWith(prefix) ? parseInt(x.id.slice(prefix.length), 10) : 0))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function appendClaim(text, source = 'chat', status = 'asserted') {
  const claims = readJson(CLAIMS_FILE, []);
  const id = nextId(claims, 'c');
  const entry = {
    id,
    text: String(text).trim().slice(0, 1000),
    source,
    status,
    created_at: new Date().toISOString(),
  };
  claims.push(entry);
  writeJson(CLAIMS_FILE, claims);
  return id;
}

const CORRECTIONS_ESCALATION_THRESHOLD = 3;

function appendCorrection(wrongClaim, correction) {
  const corrections = readJson(CORRECTIONS_FILE, []);
  const id = nextId(corrections, 'r');
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const entry = {
    id,
    wrong_claim: String(wrongClaim).trim().slice(0, 500),
    correction: String(correction).trim().slice(0, 500),
    created_at: now,
  };
  corrections.push(entry);
  writeJson(CORRECTIONS_FILE, corrections);

  const correctionsToday = corrections.filter((r) => (r.created_at || '').slice(0, 10) === today).length;
  if (correctionsToday > CORRECTIONS_ESCALATION_THRESHOLD) {
    appendWisdom('Piko needs to improve inference accuracy.', { priority: 'self_improvement', distilled: today });
  }
  return id;
}

function getRecentClaims(n = RECENT_CLAIMS) {
  const claims = readJson(CLAIMS_FILE, []);
  return claims.slice(-n);
}

function getRecentCorrections(n = RECENT_CORRECTIONS) {
  const corrections = readJson(CORRECTIONS_FILE, []);
  return corrections.slice(-n);
}

function getWisdomCache() {
  return readJson(WISDOM_FILE, { wisdom: [], last_distilled: null });
}

/** Normalize wisdom entry to full shape: id, text, distilled, confirmed, age_days, status. */
function normalizeWisdomEntry(w, index, existingIds) {
  const text = (w.text || w || '').trim().slice(0, 500);
  if (!text) return null;
  const created = w.created_at || w.distilled || new Date().toISOString();
  const distilled = (w.distilled || created).toString().slice(0, 10);
  let id = (w.id && /^w\d+$/i.test(w.id)) ? w.id : null;
  if (!id) {
    let n = index + 1;
    while (existingIds.has(`w${String(n).padStart(3, '0')}`)) n++;
    id = `w${String(n).padStart(3, '0')}`;
  }
  existingIds.add(id);
  const ageDays = Math.max(1, Math.floor((Date.now() - new Date(distilled).getTime()) / (24 * 60 * 60 * 1000)));
  return {
    id,
    text,
    distilled,
    confirmed: typeof w.confirmed === 'number' ? w.confirmed : 0,
    age_days: w.age_days != null ? w.age_days : ageDays,
    status: w.status || 'active',
    priority: w.priority || null,
  };
}

function nextWisdomId(cache) {
  const wisdom = cache.wisdom || [];
  const existingIds = new Set(wisdom.map((w) => w.id).filter(Boolean));
  let n = 1;
  while (existingIds.has(`w${String(n).padStart(3, '0')}`)) n++;
  return `w${String(n).padStart(3, '0')}`;
}

function appendWisdom(text, opts = {}) {
  const cache = getWisdomCache();
  cache.wisdom = cache.wisdom || [];
  const id = opts.id || nextWisdomId(cache);
  const now = new Date().toISOString();
  const distilled = (opts.distilled || now).toString().slice(0, 10);
  cache.wisdom.push({
    id,
    text: String(text).trim().slice(0, 500),
    distilled,
    confirmed: opts.confirmed != null ? opts.confirmed : 0,
    age_days: 1,
    status: opts.status || 'active',
    priority: opts.priority || null,
    created_at: now,
  });
  cache.last_distilled = distilled;
  writeJson(WISDOM_FILE, cache);
  return id;
}

function setWisdomCache(wisdomArray, lastDistilled) {
  const existingIds = new Set();
  const wisdom = (Array.isArray(wisdomArray) ? wisdomArray : []).map((t, i) => {
    const w = typeof t === 'string' ? { text: t, created_at: new Date().toISOString() } : t;
    return normalizeWisdomEntry(w, i, existingIds);
  }).filter(Boolean);
  const cache = {
    wisdom,
    last_distilled: lastDistilled || new Date().toISOString().slice(0, 10),
  };
  writeJson(WISDOM_FILE, cache);
}

/** Increment confirmed for a wisdom by id; used when primary human affirms. */
function wisdomConfirmed(wisdomId) {
  const cache = getWisdomCache();
  const list = cache.wisdom || [];
  const entry = list.find((w) => w.id === wisdomId || w.id === wisdomId.toLowerCase());
  if (!entry) return false;
  entry.confirmed = (entry.confirmed || 0) + 1;
  const distilled = entry.distilled || (entry.created_at || '').slice(0, 10);
  entry.age_days = Math.max(1, Math.floor((Date.now() - new Date(distilled).getTime()) / (24 * 60 * 60 * 1000)));
  writeJson(WISDOM_FILE, cache);
  return true;
}

/**
 * Build the truth block for the system prompt: recent claims, corrections, and top wisdom.
 * Top wisdom = top WISDOM_TOP_N by score (confirmed * age_days); older, affirmed wisdom ranks higher.
 */
function getTruthBlockForPrompt() {
  const claims = getRecentClaims();
  const corrections = getRecentCorrections();
  const cache = getWisdomCache();
  const existingIds = new Set();
  const all = (cache.wisdom || [])
    .map((w, i) => normalizeWisdomEntry(w, i, existingIds))
    .filter(Boolean)
    .filter((w) => (w.status || 'active') === 'active');
  const scored = all.map((w) => ({
    ...w,
    score: (w.confirmed || 0) * Math.max(1, w.age_days || 1),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topWisdom = scored.slice(0, WISDOM_TOP_N).map((w) => ({ id: w.id, text: w.text }));

  const parts = [];
  if (claims.length) {
    parts.push('**Recent claims (tentative):**\n' + claims.map((c) => `- ${(c.text || '').slice(0, 120)}`).join('\n'));
  }
  if (corrections.length) {
    parts.push('**Primary human corrections (final authority):**\n' + corrections.map((r) => `- "${(r.correction || '').slice(0, 120)}"`).join('\n'));
  }
  if (topWisdom.length) {
    parts.push('**Distilled wisdom (top by confirmed × age):**\n' + topWisdom.map((w) => `- [${w.id}] ${(w.text || '').slice(0, 150)}`).join('\n'));
  }
  if (parts.length === 0) return '';
  return '\n\n' + parts.join('\n\n') + '\n\n';
}

/**
 * Stats for control panel.
 */
function getTruthStats() {
  const claims = readJson(CLAIMS_FILE, []);
  const corrections = readJson(CORRECTIONS_FILE, []);
  const cache = getWisdomCache();
  const confirmed = claims.filter((c) => c.status === 'user-confirmed' || c.status === 'tool-verified').length;
  const corrected = claims.filter((c) => c.status === 'user-corrected').length;
  return {
    claims_count: claims.length,
    corrections_count: corrections.length,
    wisdom_count: (cache.wisdom || []).length,
    last_distilled: cache.last_distilled || null,
    claims_confirmed: confirmed,
    claims_corrected: corrected,
  };
}

module.exports = {
  appendClaim,
  appendCorrection,
  getRecentClaims,
  getRecentCorrections,
  getWisdomCache,
  getTruthBlockForPrompt,
  getTruthStats,
  appendWisdom,
  setWisdomCache,
  wisdomConfirmed,
  nextWisdomId,
  TRUTH_DIR,
  CLAIMS_FILE,
  CORRECTIONS_FILE,
  WISDOM_FILE,
};
