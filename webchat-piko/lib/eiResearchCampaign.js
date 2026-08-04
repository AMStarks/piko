/**
 * Autonomous research campaign — a standing agent that keeps growing the corpus
 * on a topic, learns from what it keeps, and sets its own next seek missions.
 *
 * Cycle: pick leads → seek/ingest (mission-fit gated) → expand bibliographies →
 * digest + RAG-index keeps → reflect (LLM reads notes + coverage, proposes new
 * leads) → save state. Dedupe ledger prevents re-seeking the same queries and
 * re-ingesting works already in the corpus.
 *
 * Operator controls: start / pause / resume / stop (API + dashboard + chat tool).
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot, listItems } = require('./culturesCorpusApi');
const { normalizeTitle, titleMatchScore } = require('./eiGoalParse');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const {
  collapseWhitespace,
  toLowerAsciiish,
  includesAny,
  startsWithIgnoreCase,
  startsWithAny,
  endsWithAny,
  extractDigitRuns,
  replaceAllLiteral,
  hasWord,
  hasAnyWord,
} = require('./text');

const PLACEHOLDER_AUTHOR_WORDS = [
  'surname', 'lastname', 'author', 'unknown', 'n/a', 'na', 'tbd', 'placeholder',
];

function hasPlaceholderAuthor(text) {
  const low = toLowerAsciiish(text);
  return hasAnyWord(low, PLACEHOLDER_AUTHOR_WORDS) || low.includes('n/a');
}

function isBadLeadText(text) {
  const s = String(text || '');
  const low = toLowerAsciiish(s);
  if (includesAny(s, ['"Surname"', '" Surname"', '"Surname "'])) return true;
  if (includesAny(low, ['by surname', 'surname pdf'])) return true;
  // loose: " Surname " inside quotes
  if (low.includes('surname') && s.includes('"')) return true;
  return false;
}

function stripQuotes(s) {
  let t = String(s || '');
  for (const q of ['"', '\u201c', '\u201d']) t = replaceAllLiteral(t, q, '');
  return t.trim();
}

function firstAuthorSurname(author) {
  let a = String(author || '');
  const andIdx = toLowerAsciiish(a).indexOf(' and ');
  if (andIdx >= 0) a = a.slice(0, andIdx);
  else {
    const comma = a.indexOf(',');
    if (comma >= 0) a = a.slice(0, comma);
  }
  const parts = collapseWhitespace(a).split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function stripTrailingSlashes(s) {
  let t = String(s || '');
  while (t.length > 1 && t.endsWith('/')) t = t.slice(0, -1);
  return t || '/';
}

function archiveIdentifierFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = toLowerAsciiish(parts[i]);
    if (seg === 'details' || seg === 'download' || seg === 'stream') {
      try {
        return decodeURIComponent(parts[i + 1]).toLowerCase();
      } catch (_) {
        return toLowerAsciiish(parts[i + 1]);
      }
    }
  }
  return null;
}

function parseQuotedQuery(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (q.startsWith('"')) {
    const end = q.indexOf('"', 1);
    if (end > 1) {
      const title = q.slice(1, end).trim();
      let rest = q.slice(end + 1).trim();
      if (endsWithAny(toLowerAsciiish(rest), [' pdf'])) {
        rest = rest.slice(0, -4).trim();
      } else if (toLowerAsciiish(rest) === 'pdf') {
        rest = '';
      }
      return { title, author: rest };
    }
  }
  // Author "Title"
  const iq = q.indexOf('"');
  if (iq > 0) {
    const end = q.indexOf('"', iq + 1);
    if (end > iq) {
      return {
        author: q.slice(0, iq).trim(),
        title: q.slice(iq + 1, end).trim(),
      };
    }
  }
  return null;
}

function pdYearFromBlob(blob) {
  for (const run of extractDigitRuns(blob)) {
    if (run.text.length !== 4) continue;
    const y = run.value;
    // 1600–1929
    if (y >= 1600 && y <= 1929) return run.text;
  }
  return null;
}

const QUERY_COOLDOWN_DAYS = Number(
  process.env.PIKO_EI_QUERY_COOLDOWN_DAYS
  || process.env.PIKO_EI_CAMPAIGN_COOLDOWN_DAYS
  || 7,
);
/** Shorter cooldown after failed/empty seeks (days). */
const FAIL_COOLDOWN_DAYS = Math.max(
  1,
  Number(process.env.PIKO_EI_FAIL_COOLDOWN_DAYS || 2),
);
/** Retire pending leads skipped for cooldown longer than this many days. */
const COOLDOWN_SKIP_RETIRE_DAYS = QUERY_COOLDOWN_DAYS + 2;
const STALE_RUNNING_MS = 45 * 60 * 1000;
const UNSURE_PAUSE_THRESHOLD = Number(process.env.PIKO_EI_CAMPAIGN_UNSURE_PAUSE || 5);
const IDLE_BACKOFF_MIN = Math.max(1, Number(process.env.PIKO_EI_CAMPAIGN_IDLE_BACKOFF_MIN || 30));
const IDLE_STREAK_THRESHOLD = 3;
const ATTEMPTED_PRUNE_DAYS = 30;
/** Cap attempted ledger size; drop oldest keys (and matching meta) beyond this. */
const ATTEMPTED_MAX_KEYS = Math.max(
  1,
  Number(process.env.PIKO_EI_ATTEMPTED_MAX_KEYS || 5000) || 5000,
);
const MAX_LEAD_RETRIES = 2;
const BIB_LEADS_PER_CYCLE = Math.max(0, Math.min(8, Number(process.env.PIKO_EI_CAMPAIGN_BIB_LEADS || 3)));
const TERMINAL_SUCCESS = new Set(['keep', 'kept', 'unsure']);
const TERMINAL_DONE = new Set(['keep', 'kept', 'unsure', 'drop']); // drop = wrong book, do not re-mine
const RETRYABLE_EDGE = new Set(['seek_failed', 'empty', 'error']);

const DEFAULT_TOPIC = 'Alternative history — lost civilizations, cataclysms, anomalous engineering: '
  + 'Egypt (Giza, Abydos/Oserion, Heliopolis), Göbekli Tepe, Tiahuanaco/Puma Punku, '
  + 'Younger Dryas and megaflood geology, Atlantis/antediluvian literature, comparative flood myths, '
  + 'archaeoastronomy, and the orthodox excavation record the alternative authors argue against.';

/** Standing threads mirroring the adapter research goal — first-cycle lead source. */
const DEFAULT_THREADS = [
  { id: 'giza', label: 'Giza / precision engineering', queries: [
    '"The Giza Power Plant" Dunn PDF',
    'Petrie "Pyramids and Temples of Gizeh" survey PDF',
    'Giza pyramid construction engineering analysis PDF',
  ] },
  { id: 'abydos', label: 'Abydos / Oserion', queries: [
    'Osireion Abydos architecture excavation report PDF',
    '"Umm el-Qa\'ab" early dynastic excavation PDF',
  ] },
  { id: 'gobekli-tepe', label: 'Göbekli Tepe', queries: [
    '"Göbekli Tepe" Schmidt excavation report PDF',
    'Karahan Tepe Tas Tepeler excavation PDF',
  ] },
  { id: 'tiahuanaco', label: 'Tiahuanaco / Puma Punku', queries: [
    'Puma Punku stonework analysis PDF',
    'Tiwanaku excavation report archaeology PDF',
  ] },
  { id: 'cataclysm', label: 'Younger Dryas / megafloods', queries: [
    'Bretz "Channeled Scabland" paper PDF',
    'Younger Dryas impact hypothesis Firestone PNAS PDF',
    'meltwater pulse 1B sea level rise PDF',
  ] },
  { id: 'flood-myths', label: 'Flood myths / Atlantis literature', queries: [
    'Plato Timaeus Critias translation Atlantis PDF',
    '"Popol Vuh" translation Tedlock PDF',
    'Atrahasis Gilgamesh flood tablet translation PDF',
  ] },
];

const KNOWN_THREAD_IDS = new Set([
  ...DEFAULT_THREADS.map((t) => t.id),
  'atlantis',
  'other',
]);

/**
 * Normalize LLM/operator thread strings: first pipe segment, known ids only.
 */
function normalizeThreadId(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return 'other';
  if (s.includes('|')) s = s.split('|')[0].trim();
  return KNOWN_THREAD_IDS.has(s) ? s : 'other';
}

function statePath() {
  return path.join(culturesDataRoot(), 'research_campaign.json');
}

function defaultState() {
  return {
    enabled: false,
    paused: false,
    topic: DEFAULT_TOPIC,
    // Default 1 min: start the next cycle about a minute after the last finishes.
    interval_minutes: Math.max(1, Number(process.env.PIKO_EI_CAMPAIGN_INTERVAL_MIN || 1)),
    seeks_per_cycle: Number(process.env.PIKO_EI_CAMPAIGN_SEEKS || 2),
    running: false,
    running_since: null,
    cycle_count: 0,
    last_cycle_at: null,
    leads: [],
    attempted_queries: {},
    attempted_meta: {},
    revision: 0,
    idle_streak: 0,
    stats: {
      seeks: 0,
      keeps: 0,
      unsures: 0,
      expands: 0,
      reflections: 0,
      skipped_duplicates: 0,
      reflection_leads_proposed: 0,
      reflection_leads_added: 0,
      reflection_leads_sought: 0,
      reflection_leads_kept: 0,
      keeps_by_via_seed_url: 0,
      keeps_by_via_seek: 0,
      keeps_by_via_other: 0,
    },
    thread_coverage: {},
    reports: [],
    /** Rolling list of recently rejected reflection titles (WP7.1). */
    reflection_rejected_recent: [],
    /** Harvest ids already backfilled for bibliography edges (WP7.4). */
    bib_backfill_done_ids: [],
    created_at: null,
    updated_at: null,
  };
}

function cycleLogPath() {
  return path.join(culturesDataRoot(), 'campaign_cycles.jsonl');
}

function appendCycleLog(entry) {
  try {
    const p = cycleLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const { appendJsonlBounded } = require('./jsonlBounded');
    const maxLines = Number(process.env.PIKO_CAMPAIGN_CYCLES_JSONL_MAX || 2000) || 2000;
    appendJsonlBounded(p, entry, { maxLines });
  } catch (_) { /* best-effort */ }
}

/** Aggregate cycle log lines from the last 24 hours. */
function last24hStats() {
  const out = { cycles: 0, seeks: 0, keeps: 0, leads_added: 0, idle_pct: 0 };
  try {
    const p = cycleLogPath();
    if (!fs.existsSync(p)) return out;
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    let idle = 0;
    for (const line of lines.slice(-2000)) {
      let row;
      try { row = JSON.parse(line); } catch (_) { continue; }
      const ts = row.ts ? new Date(row.ts).getTime() : 0;
      if (!ts || ts < cutoff) continue;
      out.cycles += 1;
      out.seeks += Number(row.seeks || 0);
      out.keeps += Number(row.keeps || 0);
      out.leads_added += Number(row.leads_added || 0);
      if (Number(row.seeks || 0) === 0 && Number(row.leads_added || 0) === 0) idle += 1;
    }
    out.idle_pct = out.cycles ? Math.round((idle / out.cycles) * 1000) / 10 : 0;
  } catch (_) { /* optional */ }
  return out;
}

function effectiveIntervalMinutes(state) {
  const s = state || loadState();
  if ((s.idle_streak || 0) >= IDLE_STREAK_THRESHOLD) return IDLE_BACKOFF_MIN;
  return Math.max(1, Number(s.interval_minutes) || 1);
}

function resetIdleStreak(state) {
  const s = state || loadState();
  s.idle_streak = 0;
  if (!state) saveState(s);
  return s;
}

/** Pending leads that are not on cooldown (and thus can be sought). */
function eligiblePendingLeads(state) {
  return (state.leads || []).filter(
    (l) => l.status === 'pending' && !queryOnCooldown(state, l.query),
  );
}

/**
 * Reflection normally pauses during idle backoff to save LLM cycles, but a
 * starved campaign (zero eligible pending leads) must still reflect —
 * reflection is the lead generator. Pending leads that are all cooling count
 * as starved (WP2.8).
 */
function shouldReflectThisCycle(state) {
  const idleBackingOff = (state.idle_streak || 0) >= IDLE_STREAK_THRESHOLD;
  if (!idleBackingOff) return { run: true, reason: 'normal' };
  const eligible = eligiblePendingLeads(state).length;
  if (eligible === 0) return { run: true, reason: 'starvation_recovery' };
  return { run: false, reason: 'idle_backoff' };
}

/** Cycle-end idle accounting: any seek or new lead resets the streak. */
function updateIdleStreak(state, seekCount, leadsAdded) {
  if (Number(seekCount || 0) === 0 && Number(leadsAdded || 0) === 0) {
    state.idle_streak = (state.idle_streak || 0) + 1;
  } else {
    state.idle_streak = 0;
  }
  return state.idle_streak;
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return { ...defaultState(), ...raw };
  } catch (_) {
    return defaultState();
  }
}

/**
 * Clear a running lock stranded by a process restart. Cycles run in-process,
 * so any lock present at boot is stale by definition — without this the
 * campaign silently stalls for STALE_RUNNING_MS after a mid-cycle restart.
 * No-op (and no state file created) when there is no persisted state.
 */
function clearRunningLockAtBoot() {
  if (!fs.existsSync(statePath())) return { cleared: false };
  const state = loadState();
  if (!state.running) return { cleared: false };
  state.running = false;
  state.running_since = null;
  saveState(state);
  return { cleared: true };
}

function saveState(state) {
  const rev = Number(state.revision || 0) + 1;
  const s = { ...state, revision: rev, updated_at: new Date().toISOString() };
  const { atomicWriteJson } = require('./atomicJson');
  atomicWriteJson(statePath(), s);
  return s;
}

/** Mid-cycle save that merges API-written leads/fields first (WP7.8). */
function saveStateMerged(state) {
  return saveState(mergeExternalState(state));
}

/**
 * Merge leads (and a few operator-touched fields) written to disk while a
 * cycle held an in-memory copy — prevents finalizeCycle from clobbering
 * mid-cycle API adds (WP2.7).
 */
function mergeExternalState(localState) {
  let disk;
  try {
    disk = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch (_) {
    return localState;
  }
  if (!disk || typeof disk !== 'object') return localState;
  const local = localState || defaultState();
  const byId = new Map((local.leads || []).map((l) => [l.id, l]));
  for (const lead of disk.leads || []) {
    if (!lead || !lead.id) continue;
    if (!byId.has(lead.id)) {
      (local.leads || (local.leads = [])).push(lead);
      byId.set(lead.id, lead);
    }
  }
  if (Array.isArray(disk.reflection_prompt_extras)) {
    local.reflection_prompt_extras = disk.reflection_prompt_extras;
  }
  if (disk.scorecard_trigger_last_fired && typeof disk.scorecard_trigger_last_fired === 'object') {
    local.scorecard_trigger_last_fired = {
      ...(local.scorecard_trigger_last_fired || {}),
      ...disk.scorecard_trigger_last_fired,
    };
  }
  local.revision = Math.max(Number(local.revision || 0), Number(disk.revision || 0));
  return local;
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

function queryKey(q) {
  return normalizeTitle(q).slice(0, 160);
}

function queryOnCooldown(state, q) {
  const key = queryKey(q);
  const ts = state.attempted_queries && state.attempted_queries[key];
  if (!ts) return false;
  const meta = (state.attempted_meta && state.attempted_meta[key]) || {};
  const days = Number(
    meta.cooldown_days != null && Number.isFinite(Number(meta.cooldown_days))
      ? meta.cooldown_days
      : QUERY_COOLDOWN_DAYS,
  );
  const ageMs = Date.now() - new Date(ts).getTime();
  return ageMs < days * 24 * 3600 * 1000;
}

/** Stamp a query into the cooldown ledger (call on terminal outcome, not start). */
function stampAttempted(state, q, meta = {}) {
  const key = queryKey(q);
  if (!key) return;
  const at = new Date().toISOString();
  state.attempted_queries = state.attempted_queries || {};
  state.attempted_meta = state.attempted_meta || {};
  state.attempted_queries[key] = at;
  const days = meta.days != null ? Number(meta.days) : QUERY_COOLDOWN_DAYS;
  state.attempted_meta[key] = {
    at,
    title: meta.title ? String(meta.title).slice(0, 160) : (state.attempted_meta[key] && state.attempted_meta[key].title) || null,
    author: meta.author ? String(meta.author).slice(0, 120) : (state.attempted_meta[key] && state.attempted_meta[key].author) || null,
    cooldown_days: Number.isFinite(days) ? days : QUERY_COOLDOWN_DAYS,
  };
}

/** True when this ledger key is still inside its cooldown window. */
function keyOnCooldown(state, key, ts) {
  if (!ts) return false;
  const meta = (state.attempted_meta && state.attempted_meta[key]) || {};
  const days = Number(
    meta.cooldown_days != null && Number.isFinite(Number(meta.cooldown_days))
      ? meta.cooldown_days
      : QUERY_COOLDOWN_DAYS,
  );
  const ageMs = Date.now() - new Date(ts).getTime();
  return Number.isFinite(ageMs) && ageMs < days * 24 * 3600 * 1000;
}

/** Cooldown-active title|author lines for the reflection prompt (recency-sorted). */
function buildCooldownActiveList(state, cap = 80) {
  const entries = [];
  const attempted = state.attempted_queries || {};
  const meta = state.attempted_meta || {};
  for (const [key, ts] of Object.entries(attempted)) {
    if (!keyOnCooldown(state, key, ts)) continue;
    const m = meta[key] || {};
    const title = m.title || null;
    const author = m.author || null;
    // WP7.1: prefix raw-key fallbacks so the LLM treats them as queries, not titles.
    const label = title && author
      ? `${title} — ${author}`
      : (title || `query:${key.slice(0, 80)}`);
    entries.push({ key, ts, label, title, author, t: new Date(ts).getTime() || 0 });
  }
  entries.sort((a, b) => b.t - a.t);
  return entries.slice(0, Math.max(1, Math.min(120, Number(cap) || 80)));
}

const REFLECTION_REJECTED_CAP = 30;

/** True when a lead blocks re-adding the same query (live or still cooling). */
function leadBlocksDedupe(state, lead) {
  if (!lead) return false;
  if (lead.status === 'pending' || lead.status === 'running') return true;
  return queryOnCooldown(state, lead.query);
}

function recordReflectionRejection(state, title, author, reason) {
  const t = String(title || '').trim();
  if (!t) return;
  state.reflection_rejected_recent = Array.isArray(state.reflection_rejected_recent)
    ? state.reflection_rejected_recent
    : [];
  state.reflection_rejected_recent.push({
    title: t.slice(0, 160),
    author: String(author || '').slice(0, 120) || null,
    reason: String(reason || 'unknown').slice(0, 40),
    at: new Date().toISOString(),
  });
  if (state.reflection_rejected_recent.length > REFLECTION_REJECTED_CAP) {
    state.reflection_rejected_recent = state.reflection_rejected_recent.slice(-REFLECTION_REJECTED_CAP);
  }
}

function isRecentlyRejectedTitle(state, title) {
  const key = queryKey(title);
  if (!key) return false;
  const recent = state.reflection_rejected_recent || [];
  return recent.some((r) => queryKey(r.title) === key);
}

function allVariantsOnCooldown(state, title, author) {
  if (!title || !author) return false;
  const probe = { title, author };
  for (let attempt = 0; attempt <= MAX_LEAD_RETRIES; attempt += 1) {
    const q = reformulateQuery(probe, attempt);
    if (!queryOnCooldown(state, q)) return false;
  }
  return true;
}

function hintOnCooldown(state, title, author) {
  if (!title || !author) return false;
  if (typeof seedHasBeenAttempted === 'function' && seedHasBeenAttempted(state, title, author)) {
    return true;
  }
  return allVariantsOnCooldown(state, title, author);
}

/**
 * Canonicalize a source URL for dedupe (archive.org details id, strip tracking).
 */
function normalizeSourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!(startsWithIgnoreCase(raw, 'http://') || startsWithIgnoreCase(raw, 'https://'))) {
    // Title fields sometimes store a bare archive path or full URL without scheme.
    const low = toLowerAsciiish(raw);
    if (low.includes('archive.org/') || endsWithAny(low, ['.pdf'])) {
      const bare = raw.startsWith('//') ? raw.slice(2) : raw;
      return normalizeSourceUrl(`https://${bare}`);
    }
    return '';
  }
  try {
    const u = new URL(raw);
    u.hash = '';
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    u.hostname = host;
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) {
      u.searchParams.delete(k);
    }
    if (host === 'archive.org' || host.endsWith('.archive.org')) {
      const id = archiveIdentifierFromPath(u.pathname);
      if (id) return `https://archive.org/details/${id}`;
    }
    let pathname = stripTrailingSlashes(u.pathname) || '/';
    if (endsWithAny(toLowerAsciiish(pathname), ['.pdf'])) {
      const parts = pathname.split('/');
      parts[parts.length - 1] = parts[parts.length - 1].toLowerCase();
      pathname = parts.join('/');
    }
    u.pathname = pathname;
    const q = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${u.pathname}${q ? `?${q}` : ''}`;
  } catch (_) {
    return stripTrailingSlashes(raw.toLowerCase());
  }
}

function itemSourceUrls(it) {
  if (!it || typeof it !== 'object') return [];
  const meta = it.meta || it.meta_extra || {};
  return [
    it.source_url,
    it.document_url,
    meta.document_url,
    meta.pdf_url,
    meta.source_url,
    meta.download_url,
    // Title sometimes is the raw URL (archive.org PDF path).
    (startsWithIgnoreCase(String(it.title || ''), 'http://')
      || startsWithIgnoreCase(String(it.title || ''), 'https://')
      ? it.title : null),
  ].filter(Boolean).map(String);
}

/**
 * Is this source URL already present on a kept corpus item?
 * @param {string} url
 * @param {{ exceptHarvestId?: number }} [opts]
 */
function alreadyKeptUrl(url, opts = {}) {
  const key = normalizeSourceUrl(url);
  if (!key || key.length < 12) return false;
  const exceptId = opts.exceptHarvestId != null ? Number(opts.exceptHarvestId) : null;
  try {
    let offset = 0;
    const page = 100;
    for (let guard = 0; guard < 50; guard += 1) {
      const out = listItems({ limit: page, offset });
      const items = out.items || [];
      if (!items.length) break;
      for (const it of items) {
        const hid = Number(it.id || it.harvest_id);
        if (exceptId != null && hid === exceptId) continue;
        for (const u of itemSourceUrls(it)) {
          if (normalizeSourceUrl(u) === key) return true;
        }
      }
      if (items.length < page) break;
      offset += page;
    }
  } catch (_) { /* best-effort */ }
  return false;
}

/** Is a work with (roughly) this title already kept in the corpus? */
function alreadyInCorpus(titleOrQuery) {
  let probe = stripQuotes(titleOrQuery);
  // Remove standalone PDF tokens
  const parts = collapseWhitespace(probe).split(' ').filter((p) => toLowerAsciiish(p) !== 'pdf');
  probe = parts.join(' ').trim();
  if (probe.length < 8) return false;
  // URL-shaped probes → URL dedupe (title match misses raw-URL titles).
  if (
    startsWithIgnoreCase(probe, 'http://')
    || startsWithIgnoreCase(probe, 'https://')
    || toLowerAsciiish(probe).includes('archive.org/')
  ) {
    if (alreadyKeptUrl(probe)) return true;
  }
  try {
    // listItems caps page size at 100 — paginate so dedupe survives 500+ corpus items.
    let offset = 0;
    const page = 100;
    for (let guard = 0; guard < 50; guard += 1) {
      const out = listItems({ limit: page, offset });
      const items = out.items || [];
      if (!items.length) break;
      for (const it of items) {
        const candidate = [it.title, (it.meta && (it.meta.work_title || it.meta.document_url)) || ''].join(' ');
        if (titleMatchScore(probe, candidate) >= 0.8) return true;
      }
      if (items.length < page) break;
      offset += page;
    }
  } catch (_) { /* corpus check is best-effort */ }
  return false;
}

/**
 * One-off: flag notes for duplicate-URL keeps (keep newest note, mark others merged).
 * Does NOT delete corpus rows.
 */
function flagDuplicateUrlKeeps(opts = {}) {
  const limit = Math.max(10, Math.min(500, Number(opts.limit) || 200));
  const byUrl = new Map();
  let offset = 0;
  const page = 100;
  for (let guard = 0; guard < 50; guard += 1) {
    const out = listItems({ limit: page, offset });
    const items = out.items || [];
    if (!items.length) break;
    for (const it of items) {
      for (const u of itemSourceUrls(it)) {
        const key = normalizeSourceUrl(u);
        if (!key) continue;
        if (!byUrl.has(key)) byUrl.set(key, []);
        byUrl.get(key).push(it);
        break;
      }
    }
    if (items.length < page) break;
    offset += page;
    if (offset >= limit * 2) break;
  }
  const notePathMod = require('./eiCorpusNotes');
  const flagged = [];
  for (const [urlKey, group] of byUrl.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const winner = sorted[0];
    for (const dup of sorted.slice(1)) {
      const hid = Number(dup.id);
      const existing = notePathMod.loadNote(hid);
      if (existing && existing.merged_into) continue;
      const note = existing || {
        harvest_id: hid,
        title: dup.title || '',
        author: dup.author || '',
        summary: '',
        updated_at: new Date().toISOString(),
      };
      note.merged_into = Number(winner.id);
      note.merged_url = urlKey;
      note.updated_at = new Date().toISOString();
      try {
        const p = notePathMod.notePath(hid);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, `${JSON.stringify(note, null, 2)}\n`, 'utf8');
        flagged.push({ harvest_id: hid, merged_into: Number(winner.id), url: urlKey });
      } catch (_) { /* best-effort */ }
    }
  }
  return { ok: true, flagged, groups_checked: byUrl.size };
}

function authorSurname(author) {
  return firstAuthorSurname(author);
}

/**
 * Alternate seek queries for retries so we don't repeat a failed formulation.
 * attempt 0: "Title" Surname PDF
 * attempt 1: Title Surname archive.org
 * attempt 2: Title full text
 */
function reformulateQuery(lead, attempt) {
  const title = stripQuotes((lead && lead.title) || '');
  const surname = authorSurname((lead && lead.author) || '');
  const n = Math.max(0, Number(attempt) || 0);
  if (!title) return collapseWhitespace((lead && lead.query) || '').slice(0, 200);
  if (n <= 0) {
    return collapseWhitespace(`"${title}" ${surname} PDF`).slice(0, 200);
  }
  if (n === 1) {
    return collapseWhitespace(`${title} ${surname} archive.org`).slice(0, 200);
  }
  return collapseWhitespace(`${title} full text`).slice(0, 200);
}

function candidateKey(author, title) {
  return `${normalizeTitle(author)}|${normalizeTitle(title)}`;
}

function threadForHarvestId(harvestId) {
  try {
    const { getItem } = require('./culturesCorpusApi');
    const out = getItem(harvestId);
    const item = out && (out.item || out);
    if (!item) return 'other';
    const meta = item.meta || {};
    const blob = [
      item.title, meta.work_title, meta.note, meta.mission, meta.thread, meta.site,
    ].filter(Boolean).join(' ');
    return normalizeThreadId(meta.thread || guessThreadFromBlob(blob));
  } catch (_) {
    return 'other';
  }
}

function guessThreadFromBlob(blob) {
  const s = toLowerAsciiish(blob);
  if (includesAny(s, ['giza', 'orion', 'petrie', 'dunn'])) return 'giza';
  if (includesAny(s, ['abydos', 'osireion', 'oserion', 'umm el'])) return 'abydos';
  if (includesAny(s, ['göbekli', 'gobekli', 'karahan', 'tepe'])) return 'gobekli-tepe';
  if (includesAny(s, ['tiahuanaco', 'tiwanaku', 'puma punku'])) return 'tiahuanaco';
  if (includesAny(s, ['younger dryas', 'bretz', 'scabland', 'meltwater', 'cataclysm'])) return 'cataclysm';
  if (includesAny(s, ['atlantis', 'antediluvian', 'donnelly'])) return 'atlantis';
  if (includesAny(s, ['flood', 'gilgamesh', 'atrahasis', 'popol vuh'])) return 'flood-myths';
  return 'other';
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function leadId() {
  return `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Default mission phrasing the mission-fit judge and query-pack builder parse
 * cleanly: '... the book <Title> by <Author>.' — mirrors eiSeedSnowball missions.
 */
function missionForQuery(q) {
  const parsed = parseQuotedQuery(q);
  if (parsed && parsed.title) {
    const title = parsed.title.trim();
    const author = (parsed.author || '').trim();
    return `Please find and add to Corpus the book ${title}${author ? ` by ${author}` : ''}.`;
  }
  let rest = String(q || '').trim();
  const restLow = toLowerAsciiish(rest);
  if (restLow.endsWith(' pdf')) rest = rest.slice(0, -4).trim();
  else if (restLow === 'pdf') rest = '';
  return `Please find and add to Corpus ${rest}`;
}

/**
 * Reject hallucinated / placeholder reflection leads.
 * Reflection: require real title + author. Thread/operator: reject placeholders only.
 */
function sanitizeLead(lead) {
  const source = String((lead && lead.source) || 'reflection');
  const rawQuery = String((lead && lead.query) || '').trim();
  const rawMission = String((lead && lead.mission) || '').trim();
  let title = String((lead && lead.title) || '').trim();
  let author = String((lead && lead.author) || '').trim();

  if (
    isBadLeadText(rawQuery) || isBadLeadText(rawMission)
    || hasPlaceholderAuthor(rawQuery) || hasPlaceholderAuthor(rawMission)
  ) {
    return { ok: false, reason: 'placeholder_author' };
  }

  const qm = parseQuotedQuery(rawQuery);
  if (qm) {
    if (!title) title = qm.title;
    if (!author) author = qm.author;
  }
  if (!title && rawMission) {
    const low = toLowerAsciiish(rawMission);
    const bookIdx = low.indexOf('the book ');
    const byIdx = low.lastIndexOf(' by ');
    if (bookIdx >= 0 && byIdx > bookIdx) {
      title = stripQuotes(rawMission.slice(bookIdx + 'the book '.length, byIdx).trim());
      let auth = rawMission.slice(byIdx + 4).trim();
      if (auth.endsWith('.')) auth = auth.slice(0, -1).trim();
      author = author || auth;
    }
  }

  // Build a query from title+author when missing (thread_seed / dossier_gap / reflection)
  let builtQuery = rawQuery;
  if ((!builtQuery || builtQuery.length < 8) && title && author) {
    builtQuery = collapseWhitespace(`"${stripQuotes(title)}" ${firstAuthorSurname(author)} PDF`).slice(0, 200);
  }

  if (source === 'reflection') {
    if (!title || title.length < 5) return { ok: false, reason: 'missing_title' };
    if (!author || author.length < 2) return { ok: false, reason: 'missing_author' };
    if (hasPlaceholderAuthor(author)) return { ok: false, reason: 'placeholder_author' };
    const aLow = toLowerAsciiish(author);
    const tLow = toLowerAsciiish(title);
    if (aLow.includes('churchward') && includesAny(tLow, ['antediluvian world']) && !hasWord(tLow, 'mu')) {
      return { ok: false, reason: 'churchward_antediluvian_confusion' };
    }
    // Always use the reformulation ladder's attempt-0 form so cooldown stamps match.
    const query = reformulateQuery({ title, author }, 0);
    const mission = `Please find and add to Corpus the book ${title} by ${author}.`.slice(0, 400);
    return {
      ok: true,
      lead: {
        query,
        mission,
        title,
        author,
        thread: normalizeThreadId(lead && lead.thread),
        why: String((lead && lead.why) || '').slice(0, 240),
        source,
      },
    };
  }

  // thread / operator / seed — keep query as given (or built) if long enough
  if (!builtQuery || builtQuery.length < 8) return { ok: false, reason: 'short_query' };
  return {
    ok: true,
    lead: {
      query: builtQuery.slice(0, 200),
      mission: (rawMission || (title && author
        ? `Please find and add to Corpus the book ${title} by ${author}.`
        : missionForQuery(builtQuery))).slice(0, 400),
      title: title || null,
      author: author || null,
      thread: normalizeThreadId(lead && lead.thread),
      why: String((lead && lead.why) || '').slice(0, 240),
      source,
    },
  };
}

function pruneBadPendingLeads(state) {
  let pruned = 0;
  for (const l of state.leads || []) {
    if (l.status !== 'pending') continue;
    if (
      isBadLeadText(l.query || '') || isBadLeadText(l.mission || '')
      || hasPlaceholderAuthor(l.query || '') || hasPlaceholderAuthor(l.mission || '')
    ) {
      l.status = 'pruned_bad';
      pruned += 1;
    }
  }
  return pruned;
}

/** Prefer curated Archive.org / seed-pack URLs before open-web seek. */
function seedUrlsForLead(lead) {
  try {
    const { seedsForGoal } = require('./eiSeedPack');
    const mission = lead.mission || lead.query || '';
    const fromMission = seedsForGoal(mission);
    if (fromMission.urls && fromMission.urls.length) return fromMission.urls.slice(0, 4);
    const fromQuery = seedsForGoal(lead.query || '');
    return (fromQuery.urls || []).slice(0, 4);
  } catch (_) {
    return [];
  }
}

const PD_AUTHORS = [
  'petrie', 'donnelly', 'posnansky', 'plato', 'herodotus', 'bretz',
  'diodorus', 'strabo', 'pliny', 'lepsius', 'mariette', 'hapgood',
];

/**
 * Classify lead access likelihood: seeded | public_domain_likely | speculative.
 */
function classifyLeadAccess(lead) {
  const urls = seedUrlsForLead(lead || {});
  if (urls && urls.length) return 'seeded';
  const blob = [
    (lead && lead.title) || '',
    (lead && lead.author) || '',
    (lead && lead.query) || '',
    (lead && lead.mission) || '',
  ].join(' ');
  const year = pdYearFromBlob(blob);
  if (year && Number(year) < 1930) return 'public_domain_likely';
  const author = toLowerAsciiish((lead && lead.author) || blob);
  let extraPd = [];
  try {
    const { loadPdAuthorOverlay } = require('./eiSeedPack');
    extraPd = loadPdAuthorOverlay();
  } catch (_) { /* optional */ }
  const pdList = [...PD_AUTHORS, ...extraPd];
  if (pdList.some((a) => author.includes(a))) return 'public_domain_likely';
  return 'speculative';
}

function addLead(state, lead) {
  const sanitized = sanitizeLead(lead);
  if (!sanitized.ok) return false;
  const clean = sanitized.lead;
  let q = clean.query;
  let retryCount = Math.max(0, Number(lead.retry_count || 0));
  let queryAttempt = 0;
  // Prefer a reformulated query when the default form is still cooling down.
  if (queryOnCooldown(state, q) && clean.title && clean.author && retryCount < MAX_LEAD_RETRIES) {
    for (let attempt = Math.max(1, retryCount + 1); attempt <= MAX_LEAD_RETRIES; attempt += 1) {
      const alt = reformulateQuery(clean, attempt);
      if (queryOnCooldown(state, alt)) continue;
      // WP7.3: only live/cooling leads block reformulation alternatives.
      if (state.leads.some((l) => queryKey(l.query) === queryKey(alt) && leadBlocksDedupe(state, l))) continue;
      q = alt;
      retryCount = attempt;
      queryAttempt = attempt;
      break;
    }
  }
  const key = queryKey(q);
  // WP7.3: dedupe against pending/running, or terminal leads still on cooldown.
  if (state.leads.some((l) => queryKey(l.query) === key && leadBlocksDedupe(state, l))) return false;
  if (queryOnCooldown(state, q)) return false;
  if (alreadyInCorpus(`${clean.title || ''} ${clean.author || ''}`)
    || alreadyInCorpus(q)) return false;
  const access = lead.access || classifyLeadAccess({ ...clean, query: q });
  state.leads.push({
    id: leadId(),
    query: q,
    mission: clean.mission,
    title: clean.title,
    author: clean.author,
    thread: clean.thread,
    why: clean.why,
    source: clean.source || 'operator',
    access,
    retry_count: retryCount,
    query_attempt: queryAttempt,
    status: 'pending',
    added_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Starvation refill — generic thread queries only (dead-thread seeds are seedDeadThreads).
 */
function refillLeadsFromThreads(state) {
  let added = 0;
  for (const t of DEFAULT_THREADS) {
    for (const q of t.queries) {
      if (addLead(state, { query: q, thread: t.id, source: 'thread', why: t.label })) added += 1;
    }
  }
  return added;
}

function seedHasBeenAttempted(state, title, author) {
  if (alreadyInCorpus(`${title} ${author}`)) return true;
  const probe = { title, author };
  for (let attempt = 0; attempt <= MAX_LEAD_RETRIES; attempt += 1) {
    const q = reformulateQuery(probe, attempt);
    if (queryOnCooldown(state, q)) continue;
    if (state.leads.some((l) => queryKey(l.query) === queryKey(q))) continue;
    return false;
  }
  return true;
}

/**
 * WP7.4 — expand existing corpus keeps that have no bibliography edges yet.
 * Breaks the zero-keeps → zero-edges circular dependency during starvation.
 */
async function backfillBibliographyFromKeeps(state, opts = {}) {
  const max = Math.max(0, Math.min(2, Number(opts.max != null ? opts.max : 2) || 2));
  if (!max) return { expanded: 0, ids: [] };
  const done = new Set((state.bib_backfill_done_ids || []).map(Number));
  let edges = [];
  try {
    edges = require('./eiBibliography').loadEdges(5000);
  } catch (_) { /* empty */ }
  const hasEdge = new Set(edges.map((e) => Number(e.from_id)).filter(Number.isFinite));
  let items = [];
  try {
    const listed = listItems({ limit: 100, exclude_candidates: true });
    items = (listed && listed.items) || listed || [];
    if (!Array.isArray(items)) items = [];
  } catch (_) {
    return { expanded: 0, ids: [], error: 'list_items_failed' };
  }
  const expandFn = typeof opts.expandFromItem === 'function'
    ? opts.expandFromItem
    : require('./eiBibliography').expandFromItem;
  const ids = [];
  for (const item of items) {
    if (ids.length >= max) break;
    const hid = Number(item.id != null ? item.id : item.harvest_id);
    if (!Number.isFinite(hid) || hid <= 0) continue;
    if (done.has(hid) || hasEdge.has(hid)) continue;
    try {
      await expandFn(hid, {
        limit: 5,
        queueOnly: true,
        rootDir: opts.rootDir,
        pikoUserId: 'agent:ei-campaign',
      });
      ids.push(hid);
      done.add(hid);
    } catch (_) { /* try next */ }
  }
  state.bib_backfill_done_ids = [...done].slice(-500);
  return { expanded: ids.length, ids };
}

/**
 * Convert bibliography citation edges into campaign leads (compounding loop).
 * Mines: queued edges with no later terminal outcome, plus retryable failed seeks
 * (seek_failed/empty/error). Skips keep/unsure/drop.
 */
function mineBibliographyLeads(state, max = BIB_LEADS_PER_CYCLE) {
  const limit = Math.max(0, Math.min(8, Number(max)));
  if (!limit) return 0;
  let edges = [];
  try {
    edges = require('./eiBibliography').loadEdges(5000);
  } catch (_) {
    return 0;
  }
  if (!edges.length) return 0;

  // Group by candidate; decide from chronological outcomes.
  const byKey = new Map();
  edges.forEach((e, idx) => {
    const title = String(e.candidate_title || '').trim();
    const author = String(e.candidate_author || '').trim();
    if (!title || !author) return;
    const key = candidateKey(author, title);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ idx, e, title, author });
  });

  let added = 0;
  for (const rows of byKey.values()) {
    if (added >= limit) break;
    rows.sort((a, b) => a.idx - b.idx);
    const last = rows[rows.length - 1];
    const outcomes = rows.map((r) => String(r.e.outcome || ''));
    const lastOutcome = outcomes[outcomes.length - 1];
    const hasSuccess = outcomes.some((o) => TERMINAL_SUCCESS.has(o));
    if (hasSuccess || TERMINAL_DONE.has(lastOutcome)) continue;

    // Mine if still queued with no later terminal, or latest is retryable failure.
    const queuedOpen = outcomes.some((o, i) => {
      if (o !== 'queued') return false;
      return !outcomes.slice(i + 1).some((x) => TERMINAL_DONE.has(x) || RETRYABLE_EDGE.has(x) || TERMINAL_SUCCESS.has(x));
    });
    const retryable = RETRYABLE_EDGE.has(lastOutcome);
    if (!queuedOpen && !retryable) continue;

    const { title, author, e } = last;
    const fromId = e.from_id;
    const thread = fromId != null ? threadForHarvestId(fromId) : 'other';
    const retryCount = retryable ? 1 : 0;
    const query = reformulateQuery({ title, author }, retryCount);
    if (addLead(state, {
      title,
      author,
      query,
      thread,
      source: 'bibliography',
      why: String(e.why || 'cited in corpus bibliography').slice(0, 240),
      retry_count: retryCount,
    })) {
      added += 1;
    }
  }
  return added;
}

/** Short block of un-mined bibliography citations for the reflection prompt. */
function formatBibGapsHint(limit = 8, state = null) {
  try {
    const edges = require('./eiBibliography').loadEdges(5000);
    const byKey = new Map();
    edges.forEach((e, idx) => {
      const title = String(e.candidate_title || '').trim();
      const author = String(e.candidate_author || '').trim();
      if (!title || !author) return;
      const key = candidateKey(author, title);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ idx, e, title, author });
    });
    const gaps = [];
    for (const rows of byKey.values()) {
      if (gaps.length >= limit) break;
      rows.sort((a, b) => a.idx - b.idx);
      const outcomes = rows.map((r) => String(r.e.outcome || ''));
      const last = rows[rows.length - 1];
      if (outcomes.some((o) => TERMINAL_SUCCESS.has(o))) continue;
      if (TERMINAL_DONE.has(outcomes[outcomes.length - 1]) && !RETRYABLE_EDGE.has(outcomes[outcomes.length - 1])) {
        continue;
      }
      const lastOutcome = outcomes[outcomes.length - 1];
      const openQueued = outcomes.some((o, i) => (
        o === 'queued' && !outcomes.slice(i + 1).some((x) => x && x !== 'queued')
      ));
      if (!openQueued && !RETRYABLE_EDGE.has(lastOutcome)) continue;
      if (alreadyInCorpus(`${last.title} ${last.author}`)) continue;
      if (state && hintOnCooldown(state, last.title, last.author)) continue;
      gaps.push(`"${last.title}" ${last.author}`);
    }
    if (!gaps.length) return '';
    return `BIBLIOGRAPHY CITATIONS TO CHASE (prefer these — from kept works):\n${gaps.join('\n')}`;
  } catch (_) {
    return '';
  }
}

function resetStaleRunningLeads(state) {
  let n = 0;
  const now = Date.now();
  for (const lead of state.leads || []) {
    if (lead.status !== 'running') continue;
    const ts = lead.last_attempt_at || state.running_since;
    const age = ts ? now - new Date(ts).getTime() : STALE_RUNNING_MS + 1;
    if (age < STALE_RUNNING_MS) continue;
    lead.retry_count = Math.max(0, Number(lead.retry_count || 0)) + 1;
    // WP7.3: only reformulate onto a variant that is NOT on cooldown.
    if (lead.title && lead.author && lead.retry_count <= MAX_LEAD_RETRIES) {
      const alt = reformulateQuery(lead, lead.retry_count);
      if (alt && !queryOnCooldown(state, alt)) {
        lead.query = alt;
      }
      // else leave original query; cooldown_deferred path will handle it
    }
    lead.status = 'pending';
    n += 1;
  }
  return n;
}

function leadMatchesSeed(lead, title, author) {
  const blob = normalizeTitle([
    (lead && lead.title) || '',
    (lead && lead.author) || '',
    (lead && lead.query) || '',
  ].join(' '));
  const t = normalizeTitle(title);
  const aParts = collapseWhitespace(String(author || '')).split(' ').filter(Boolean);
  const a = normalizeTitle(aParts.length ? aParts[aParts.length - 1] : author);
  if (!t || !a) return false;
  return blob.includes(t.slice(0, 24)) && blob.includes(a);
}

/**
 * Every cycle: enqueue curated seed-pack leads for threads with 0 keeps.
 * Dead = keeps===0 AND (seeks>=3 OR untried seed-pack entries exist).
 * If a matching lead is already pending under the wrong thread, retarget it.
 */
function seedDeadThreads(state) {
  let added = 0;
  let seedsForThread;
  try {
    seedsForThread = require('./eiSeedPack').seedsForThread;
  } catch (_) {
    return 0;
  }
  for (const t of DEFAULT_THREADS) {
    const cov = (state.thread_coverage || {})[t.id] || {};
    if ((cov.keeps || 0) > 0) continue;

    const allSeeds = (seedsForThread(t.id) || []).filter((seed) => {
      const title = (seed.title_hints && seed.title_hints[0]) || '';
      const author = (seed.authors && seed.authors[0]) || '';
      if (!title || !author) return false;
      return !!(seed.urls && seed.urls.length) || !!(seed.ia_ids && seed.ia_ids.length);
    });
    // If a curated seed is already in the corpus but never credited to this
    // thread (common when ingest ran under thread=other), credit the keep.
    for (const seed of allSeeds) {
      const title = (seed.title_hints && seed.title_hints[0]) || '';
      const author = (seed.authors && seed.authors[0]) || '';
      if (alreadyInCorpus(`${title} ${author}`) && (cov.keeps || 0) === 0) {
        bumpThread(state, t.id, 'keeps', 1);
        cov.keeps = (state.thread_coverage[t.id] && state.thread_coverage[t.id].keeps) || 1;
      }
    }
    if ((cov.keeps || 0) > 0) continue;

    const untried = allSeeds.filter((seed) => {
      const title = (seed.title_hints && seed.title_hints[0]) || '';
      const author = (seed.authors && seed.authors[0]) || '';
      return !seedHasBeenAttempted(state, title, author);
    });
    const dead = (cov.seeks || 0) >= 3 || untried.length > 0;
    if (!dead || !untried.length) continue;

    const hasPendingOnThread = pendingLeads(state).some((l) => (
      normalizeThreadId(l.thread) === t.id
      && (l.source === 'thread_seed' || l.access === 'seeded')
    ));
    if (hasPendingOnThread) continue;

    let seeded = 0;
    for (const seed of untried.length ? untried : allSeeds) {
      if (seeded >= 2) break;
      const title = (seed.title_hints && seed.title_hints[0]) || '';
      const author = (seed.authors && seed.authors[0]) || '';
      // Retarget a mis-threaded pending match (common: reflection put it on "other")
      const match = pendingLeads(state).find((l) => leadMatchesSeed(l, title, author));
      if (match) {
        match.thread = t.id;
        match.source = 'thread_seed';
        match.access = 'seeded';
        match.why = `dead-thread seed for ${t.label}`;
        seeded += 1;
        added += 1;
        continue;
      }
      if (seedHasBeenAttempted(state, title, author)) continue;
      if (addLead(state, {
        title,
        author,
        thread: t.id,
        source: 'thread_seed',
        why: `dead-thread seed for ${t.label}`,
        access: 'seeded',
      })) {
        seeded += 1;
        added += 1;
      }
    }
  }
  return added;
}

function pendingLeads(state) {
  return state.leads.filter((l) => l.status === 'pending');
}

const PRIORITY_SOURCES = new Set(['operator', 'dossier_gap', 'thread_seed', 'article_gap']);

function leadPriority(lead) {
  const src = String((lead && lead.source) || '');
  if (PRIORITY_SOURCES.has(src)) return 0;
  const acc = String((lead && lead.access) || '');
  if (acc === 'seeded') return 1;
  if (acc === 'public_domain_likely') return 2;
  return 3; // speculative / untagged
}

/** Stable priority order for seek batch selection (replaces FIFO). */
function orderLeads(pending) {
  return [...(pending || [])].sort((a, b) => {
    const d = leadPriority(a) - leadPriority(b);
    if (d !== 0) return d;
    return String(a.added_at || '').localeCompare(String(b.added_at || ''));
  });
}

/**
 * Pick normal seek batch (max N) then seeded-extra leads not already in batch.
 */
function pickSeekBatches(pending, seeksPerCycle, seededExtra) {
  const ordered = orderLeads(pending);
  const batch = ordered.slice(0, Math.max(1, Math.min(4, Number(seeksPerCycle) || 2)));
  const inBatch = new Set(batch.map((l) => l.id));
  const extraMax = Math.max(0, Math.min(4, Number(seededExtra) || 0));
  const seededExtraLeads = ordered
    .filter((l) => l.access === 'seeded' && !inBatch.has(l.id))
    .slice(0, extraMax);
  return { batch, seededExtraLeads };
}

/**
 * Move keeps counted under `other` to a real thread when a corpus note clearly matches.
 * Tracks harvest ids so the same note is never moved twice. Never invents keeps.
 */
function reattributeOtherCoverageFromNotes(state) {
  if (!state.thread_coverage || typeof state.thread_coverage !== 'object') {
    state.thread_coverage = {};
  }
  const other = state.thread_coverage.other;
  if (!other || !(Number(other.keeps) > 0)) {
    state._last_reattributed = 0;
    return 0;
  }
  if (!Array.isArray(state.reattributed_harvest_ids)) state.reattributed_harvest_ids = [];
  const done = new Set(state.reattributed_harvest_ids.map(Number).filter((n) => Number.isFinite(n)));
  let notes = [];
  let matchThreadId;
  try {
    const { listNotes } = require('./eiCorpusNotes');
    notes = listNotes(200);
    ({ matchThreadId } = require('./eiThreadDossiers'));
  } catch (_) {
    state._last_reattributed = 0;
    return 0;
  }
  let moved = 0;
  for (const n of notes) {
    if (!(Number(other.keeps) > 0)) break;
    const hid = Number(n.harvest_id || n.id);
    if (!Number.isFinite(hid) || hid <= 0 || done.has(hid)) continue;
    const blob = [n.title, n.author, n.summary, ...(n.sites || []), ...(n.people || [])]
      .filter(Boolean)
      .join(' ');
    const tid = normalizeThreadId(matchThreadId(blob) || 'other');
    done.add(hid);
    if (tid === 'other') continue;
    if (!state.thread_coverage[tid]) state.thread_coverage[tid] = { keeps: 0, seeks: 0 };
    other.keeps -= 1;
    state.thread_coverage[tid].keeps = (state.thread_coverage[tid].keeps || 0) + 1;
    moved += 1;
  }
  state.reattributed_harvest_ids = [...done].slice(-500);
  state._last_reattributed = moved;
  return moved;
}

/**
 * Idempotent hygiene: merge pipe-junk coverage keys; backfill access + thread on pending leads.
 */
function migrateCampaignState(state) {
  if (!state.thread_coverage || typeof state.thread_coverage !== 'object') {
    state.thread_coverage = {};
  }
  if (state.idle_streak == null || !Number.isFinite(Number(state.idle_streak))) {
    state.idle_streak = 0;
  }
  if (state.revision == null || !Number.isFinite(Number(state.revision))) {
    state.revision = 0;
  }
  if (!state.attempted_meta || typeof state.attempted_meta !== 'object') {
    state.attempted_meta = {};
  }
  state.stats = state.stats || {};
  for (const k of [
    'reflection_leads_proposed',
    'reflection_leads_added',
    'reflection_leads_sought',
    'reflection_leads_kept',
  ]) {
    if (state.stats[k] == null || !Number.isFinite(Number(state.stats[k]))) {
      state.stats[k] = Number(state.stats[k]) || 0;
    }
  }
  // S1 scorecard auto-trigger cooldowns (persist last-fired per rule).
  if (!state.scorecard_trigger_last_fired || typeof state.scorecard_trigger_last_fired !== 'object') {
    state.scorecard_trigger_last_fired = {};
  }
  if (!state.scorecard_trigger_meta || typeof state.scorecard_trigger_meta !== 'object') {
    state.scorecard_trigger_meta = {};
  }
  if (!Array.isArray(state.reflection_rejected_recent)) {
    state.reflection_rejected_recent = [];
  }
  if (state.reflection_rejected_recent.length > REFLECTION_REJECTED_CAP) {
    state.reflection_rejected_recent = state.reflection_rejected_recent.slice(-REFLECTION_REJECTED_CAP);
  }
  if (!Array.isArray(state.bib_backfill_done_ids)) {
    state.bib_backfill_done_ids = [];
  }
  const cov = state.thread_coverage;
  for (const key of Object.keys(cov)) {
    const target = normalizeThreadId(key);
    if (target === key) continue;
    if (!cov[target]) cov[target] = { keeps: 0, seeks: 0 };
    cov[target].keeps = (cov[target].keeps || 0) + (cov[key].keeps || 0);
    cov[target].seeks = (cov[target].seeks || 0) + (cov[key].seeks || 0);
    delete cov[key];
  }
  // WP7.2: remediate metaless legacy stamps → 2-day fail cooldown (idempotent).
  // Must run before requeue checks so queryOnCooldown sees the shorter window.
  if (state.attempted_queries && typeof state.attempted_queries === 'object') {
    state.attempted_meta = state.attempted_meta || {};
    for (const [k, ts] of Object.entries(state.attempted_queries)) {
      const m = state.attempted_meta[k];
      const hasDays = m && m.cooldown_days != null && Number.isFinite(Number(m.cooldown_days));
      if (hasDays) continue;
      state.attempted_meta[k] = {
        ...(m || {}),
        at: (m && m.at) || ts,
        cooldown_days: FAIL_COOLDOWN_DAYS,
        legacy_remediated: true,
      };
    }
  }
  for (const lead of state.leads || []) {
    // WP7.3: requeue retired/legacy cooling leads once their query cools.
    if (lead.status === 'cooldown_expired_never_ran' || lead.status === 'skipped_cooldown') {
      if (!queryOnCooldown(state, lead.query)) {
        lead.status = 'pending';
        lead.cooldown_first_skip_at = null;
        lead.cooldown_skip_count = 0;
        lead.last_skip_reason = null;
      }
    }
    if (lead.status !== 'pending' && lead.status !== 'running') continue;
    lead.thread = normalizeThreadId(lead.thread);
    if (!lead.access) lead.access = classifyLeadAccess(lead);
  }
  // Prune attempted_queries older than 30 days to stop unbounded growth.
  // Always drop matching attempted_meta entries with them.
  if (state.attempted_queries && typeof state.attempted_queries === 'object') {
    const cutoff = Date.now() - ATTEMPTED_PRUNE_DAYS * 24 * 3600 * 1000;
    for (const [k, ts] of Object.entries(state.attempted_queries)) {
      const t = ts ? new Date(ts).getTime() : 0;
      if (!t || t < cutoff) {
        delete state.attempted_queries[k];
        if (state.attempted_meta) delete state.attempted_meta[k];
      }
    }
    // Cap size: drop oldest timestamps (+ meta) beyond ATTEMPTED_MAX_KEYS.
    const keys = Object.keys(state.attempted_queries);
    if (keys.length > ATTEMPTED_MAX_KEYS) {
      keys
        .map((k) => ({ k, t: new Date(state.attempted_queries[k] || 0).getTime() || 0 }))
        .sort((a, b) => a.t - b.t)
        .slice(0, keys.length - ATTEMPTED_MAX_KEYS)
        .forEach(({ k }) => {
          delete state.attempted_queries[k];
          if (state.attempted_meta) delete state.attempted_meta[k];
        });
    }
  }
  // Drop meta orphans
  if (state.attempted_meta && typeof state.attempted_meta === 'object') {
    for (const k of Object.keys(state.attempted_meta)) {
      if (!state.attempted_queries || !state.attempted_queries[k]) delete state.attempted_meta[k];
    }
  }
  reattributeOtherCoverageFromNotes(state);
  return state;
}

// ---------------------------------------------------------------------------
// Reflection — Piko reads its notes and decides what matters next
// ---------------------------------------------------------------------------

function reflectionModel() {
  return (
    process.env.PIKO_EI_CAMPAIGN_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

/**
 * Build reflection prompt parts (exported for WP7.1 tests).
 */
function buildReflectPromptParts(state, opts = {}) {
  let noteLines = opts.noteLines;
  if (noteLines == null) {
    try {
      const { listNotes } = require('./eiCorpusNotes');
      const notes = listNotes(20);
      noteLines = notes.map((n) => {
        const bits = [
          `• ${n.title || 'untitled'}${n.author ? ` — ${n.author}` : ''}`,
          n.summary ? `  ${n.summary}` : '',
          (n.open_questions || []).length ? `  Open questions: ${n.open_questions.slice(0, 3).join('; ')}` : '',
          (n.people || []).length ? `  People: ${n.people.slice(0, 5).join(', ')}` : '',
          (n.disagreements || []).length ? `  Disagreements: ${n.disagreements.slice(0, 2).join('; ')}` : '',
        ].filter(Boolean);
        return bits.join('\n');
      }).join('\n');
    } catch (_) {
      noteLines = '';
    }
  }

  const coverage = Object.entries(state.thread_coverage || {})
    .map(([k, v]) => `${k}: keeps=${v.keeps || 0} seeks=${v.seeks || 0}`)
    .join(' · ') || 'none yet';
  const cooldownActive = buildCooldownActiveList(state, 80);
  const recentAttempts = cooldownActive.map((e) => e.label).join(' | ');

  const rejectedLines = (state.reflection_rejected_recent || [])
    .slice()
    .reverse()
    .slice(0, REFLECTION_REJECTED_CAP)
    .map((r) => `- "${r.title}"${r.author ? ` — ${r.author}` : ''} (${r.reason || 'rejected'})`)
    .join('\n');

  let curatedHint = '';
  try {
    const { getSeeds } = require('./eiSeedPack');
    const gaps = [];
    for (const seed of getSeeds()) {
      const title = (seed.title_hints && seed.title_hints[0]) || '';
      const author = (seed.authors && seed.authors[0]) || '';
      if (!title || !author) continue;
      if (!(seed.urls && seed.urls.length) && !(seed.ia_ids && seed.ia_ids.length)) continue;
      if (alreadyInCorpus(`${title} ${author}`)) continue;
      if (hintOnCooldown(state, title, author)) continue;
      gaps.push(`"${title}" ${author}`);
      if (gaps.length >= 8) break;
    }
    if (gaps.length) curatedHint = `CURATED OPEN-ACCESS GAPS (prefer these when relevant):\n${gaps.join('\n')}`;
  } catch (_) { /* optional */ }

  let dossierHint = '';
  let dossierGapAdded = 0;
  try {
    const dossiers = require('./eiThreadDossiers');
    dossierHint = dossiers.formatDossierGapsBlock();
    // WP7.4: filter before cap so cooled wanted_sources don't shadow fresh ones.
    for (const lead of dossiers.dossierWantedLeads(2, {
      filter: (l) => !hintOnCooldown(state, l.title, l.author),
    })) {
      if (addLead(state, lead)) dossierGapAdded += 1;
    }
  } catch (_) { /* optional */ }

  const bibHint = formatBibGapsHint(8, state);

  const extras = Array.isArray(state.reflection_prompt_extras)
    ? state.reflection_prompt_extras.filter(Boolean).slice(0, 8)
    : [];
  const extraBlock = extras.length
    ? `\nOperator-approved prompt extras:\n${extras.map((l) => `- ${l}`).join('\n')}`
    : '';

  const system = `You are Piko, building deep expertise by growing a document corpus.
Propose NEXT seek missions as concrete books/papers with REAL author surnames — never "Surname", "Author", "Unknown", or placeholders.
Prefer public-domain / Archive.org–likely works. Prefer the curated gap list, bibliography citations from kept works, and evidence-gap dossier wanted_sources when they fit.
Do NOT invent fictional titles. Do NOT confuse Churchward (Mu) with Donnelly (Atlantis: The Antediluvian World).
Return JSON only: {"leads":[{"title":"Exact Title","author":"Full Author Name","thread":"giza|abydos|gobekli-tepe|tiahuanaco|cataclysm|flood-myths|atlantis|other","why":"short"}]}
At most 5 leads. Each lead MUST include both title and author fields.${extraBlock}`;

  const rejectedBlock = rejectedLines
    ? `\n\nRECENTLY REJECTED — proposing any of these again is an error and wastes the cycle:\n${rejectedLines}`
    : '';

  const user = `TOPIC:\n${state.topic}\n\nTHREAD COVERAGE:\n${coverage}\n\n${curatedHint}\n\n${bibHint}\n\n${dossierHint}\n\nRECENT CORPUS NOTES:\n${noteLines || '(no notes yet)'}\n\nON COOLDOWN — do not propose these titles (cooldown-active, most recent first):\n${recentAttempts || '(none)'}${rejectedBlock}`;

  const gate = shouldReflectThisCycle(state);
  const recovery = gate.reason === 'starvation_recovery';
  const llmOpts = {
    format: 'json',
    temperature: recovery ? 0.8 : 0.3,
    max_tokens: 700,
    num_ctx: Number(process.env.PIKO_EI_CAMPAIGN_NUM_CTX || 8192),
    timeoutMs: Math.max(20000, Number(process.env.PIKO_EI_CAMPAIGN_TIMEOUT_MS || 120000)),
    priority: 'background',
    lane: 'worker',
    tag: 'eiResearchCampaign',
  };
  if (recovery) llmOpts.seed = Number(state.cycle_count) || 0;

  return { system, user, llmOpts, dossierGapAdded, gate };
}

async function reflect(state, opts = {}) {
  const parts = buildReflectPromptParts(state, opts);
  const llmFn = typeof opts.llmFn === 'function' ? opts.llmFn : ollamaNativeChat;
  const raw = await llmFn(reflectionModel(), [
    { role: 'system', content: parts.system },
    { role: 'user', content: parts.user },
  ], parts.llmOpts);

  const parsed = extractJsonObject(raw) || {};
  const proposed = Array.isArray(parsed.leads) ? parsed.leads : [];
  return applyReflectionProposedLeads(state, proposed, { dossierGapAdded: parts.dossierGapAdded });
}

/**
 * Apply LLM-proposed reflection leads with per-lead rejection reasons.
 * Exported for unit tests (Iteration 0 — diagnose P4).
 */
function applyReflectionProposedLeads(state, proposed, opts = {}) {
  const dossierGapAdded = Number(opts.dossierGapAdded || 0);
  let added = dossierGapAdded;
  let rejected = 0;
  const accessCounts = { seeded: 0, public_domain_likely: 0, speculative: 0 };
  const rejectedDetails = [];
  const rejectLead = (l, reason) => {
    rejected += 1;
    const title = String((l && (l.title || l.query)) || '').slice(0, 120);
    const reasonStr = String(reason || 'unknown').slice(0, 40);
    rejectedDetails.push({ title, reason: reasonStr });
    // WP7.1: persist rejection memory (skip repeat_rejected to avoid self-echo).
    if (reasonStr !== 'repeat_rejected') {
      recordReflectionRejection(state, title, (l && l.author) || null, reasonStr);
    }
  };
  // WP7.3: speculative cap counts only eligible (not cooling) pending leads.
  const pendingSpeculative = () => (state.leads || []).filter(
    (x) => x.status === 'pending'
      && x.access === 'speculative'
      && !queryOnCooldown(state, x.query),
  ).length;
  const list = Array.isArray(proposed) ? proposed : [];
  state.stats = state.stats || {};
  state.stats.reflection_leads_proposed = (state.stats.reflection_leads_proposed || 0) + list.length;
  for (const l of list.slice(0, 5)) {
    const packed = {
      ...l,
      query: l.query || (l.title && l.author ? `"${l.title}" ${l.author} PDF` : ''),
      source: 'reflection',
    };
    // WP7.1: short-circuit repeats before classification / addLead.
    if (isRecentlyRejectedTitle(state, l.title || l.query)) {
      rejectLead(l, 'repeat_rejected');
      continue;
    }
    // WP2.2: no early cooldown gate — let addLead reformulate across variants.
    if (alreadyInCorpus(`${l.title || ''} ${l.author || ''} ${packed.query || ''}`)) {
      rejectLead(l, 'in_corpus');
      continue;
    }
    const access = classifyLeadAccess(packed);
    packed.access = access;
    // WP2.8: cap on pending speculative leads, not per reflection batch.
    if (access === 'speculative' && pendingSpeculative() >= 1) {
      rejectLead(l, 'speculative_cap');
      continue;
    }
    const sanitized = sanitizeLead(packed);
    if (!sanitized.ok) {
      rejectLead(l, sanitized.reason || 'sanitize');
      continue;
    }
    if (addLead(state, packed)) {
      added += 1;
      accessCounts[access] = (accessCounts[access] || 0) + 1;
    } else {
      const q = sanitized.lead.query;
      const title = sanitized.lead.title;
      const author = sanitized.lead.author;
      if ((state.leads || []).some((x) => queryKey(x.query) === queryKey(q) && x.status === 'pending')) {
        rejectLead(l, 'duplicate_pending');
      } else if (title && author && allVariantsOnCooldown(state, title, author)) {
        rejectLead(l, 'cooldown_all_variants');
      } else if (queryOnCooldown(state, q)) {
        rejectLead(l, 'cooldown_all_variants');
      } else if (alreadyInCorpus(`${title || ''} ${author || ''}`) || alreadyInCorpus(q)) {
        rejectLead(l, 'in_corpus');
      } else {
        rejectLead(l, 'sanitize');
      }
    }
  }
  // If LLM added nothing useful, enqueue up to 2 curated seed-pack gaps
  if (added === 0) {
    try {
      const { getSeeds } = require('./eiSeedPack');
      for (const seed of getSeeds()) {
        if (added >= 2) break;
        const title = (seed.title_hints && seed.title_hints[0]) || '';
        const author = (seed.authors && seed.authors[0]) || '';
        if (!title || !author) continue;
        if (!(seed.urls && seed.urls.length) && !(seed.ia_ids && seed.ia_ids.length)) continue;
        if (hintOnCooldown(state, title, author)) continue;
        if (addLead(state, {
          title, author, thread: 'other', source: 'reflection',
          why: 'curated open-access gap fill',
        })) added += 1;
      }
    } catch (_) { /* optional */ }
  }
  state.stats.reflections = (state.stats.reflections || 0) + 1;
  if (!state.stats.reflection_leads_added) state.stats.reflection_leads_added = 0;
  // Count only LLM/self-set adds beyond dossier-gap seeds already queued separately.
  const selfSetAdded = Math.max(0, added - dossierGapAdded);
  state.stats.reflection_leads_added += selfSetAdded;
  return {
    proposed: list.length,
    added,
    rejected,
    rejected_details: rejectedDetails.slice(0, 10),
    dossier_gap_added: dossierGapAdded,
    access: accessCounts,
  };
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

function bumpThread(state, thread, field, n = 1) {
  const t = normalizeThreadId(thread);
  if (!state.thread_coverage[t]) state.thread_coverage[t] = { keeps: 0, seeks: 0 };
  state.thread_coverage[t][field] = (state.thread_coverage[t][field] || 0) + n;
}

function seededExtraLimit() {
  return Math.max(0, Math.min(4, Number(process.env.PIKO_EI_CAMPAIGN_SEEDED_EXTRA ?? 2)));
}

async function runCampaignCycle(opts = {}) {
  let state = loadState();
  if (!state.enabled) return { ok: false, skipped: 'campaign_disabled' };
  if (state.paused) return { ok: false, skipped: 'campaign_paused' };
  if (state.running && state.running_since
    && Date.now() - new Date(state.running_since).getTime() < STALE_RUNNING_MS) {
    return { ok: false, skipped: 'cycle_already_running' };
  }

  migrateCampaignState(state);
  const resetRunning = resetStaleRunningLeads(state);
  state.running = true;
  state.running_since = new Date().toISOString();
  state = saveState(state);

  const report = {
    cycle: state.cycle_count + 1,
    started_at: new Date().toISOString(),
    seeks: [],
    keeps: [],
    unsures: [],
    skipped: [],
    expand: null,
    reflection: null,
    dead_thread_seeds: 0,
    bib_leads: 0,
    leads_added: 0,
    error: null,
  };
  if (resetRunning) report.skipped.push({ reason: 'reset_stale_running', count: resetRunning });

  let leadsAdded = 0;
  const sourceBreakdown = {
    bibliography: 0, reflection: 0, thread: 0, thread_seed: 0, operator: 0, other: 0,
  };

  try {
    const runTool = opts.runToolFn || require('./eiAgentTools').runTool;
    const { expandFromItem } = require('./eiBibliography');

    const pruned = pruneBadPendingLeads(state);
    if (pruned) report.skipped.push({ reason: 'pruned_bad_leads', count: pruned });

    // Operator loop: pause seeking when unsure queue is large
    let unsureCount = 0;
    try {
      const { listUnsureQueue } = require('./eiUnsureQueue');
      unsureCount = (listUnsureQueue({ limit: 50 }).items || []).length;
    } catch (_) { /* optional */ }
    if (unsureCount >= UNSURE_PAUSE_THRESHOLD) {
      report.unsure_gate = { count: unsureCount, threshold: UNSURE_PAUSE_THRESHOLD, seeks_skipped: true };
      const gate = shouldReflectThisCycle(state);
      if (!gate.run) {
        report.reflection = { skipped: gate.reason, added: 0 };
      } else {
        report.reflection = await reflect(state).catch((e) => ({ error: String(e.message || e).slice(0, 160) }));
        if (gate.reason === 'starvation_recovery' && report.reflection) report.reflection.recovery = true;
        leadsAdded += Number((report.reflection && report.reflection.added) || 0);
      }
      state.cycle_count += 1;
      state.last_cycle_at = new Date().toISOString();
    } else {

    // Dead-thread seed rescue — every cycle, not only when starved
    report.dead_thread_seeds = seedDeadThreads(state);
    leadsAdded += Number(report.dead_thread_seeds || 0);
    sourceBreakdown.thread_seed += Number(report.dead_thread_seeds || 0);

    // Compounding: turn bibliography citations into seek leads
    report.bib_leads = mineBibliographyLeads(state, BIB_LEADS_PER_CYCLE);
    leadsAdded += Number(report.bib_leads || 0);
    sourceBreakdown.bibliography += Number(report.bib_leads || 0);

    if (pendingLeads(state).length < 2) {
      const refilled = refillLeadsFromThreads(state);
      leadsAdded += refilled;
      sourceBreakdown.thread += refilled;
    }

    // Skip cooling leads for this cycle (stay pending); retire zombies (WP2.3).
    const eligible = [];
    for (const lead of orderLeads(pendingLeads(state))) {
      if (queryOnCooldown(state, lead.query)) {
        const nowIso = new Date().toISOString();
        lead.last_skip_reason = 'cooldown';
        lead.last_skip_at = nowIso;
        if (!lead.cooldown_first_skip_at) lead.cooldown_first_skip_at = nowIso;
        lead.cooldown_skip_count = (lead.cooldown_skip_count || 0) + 1;
        const firstMs = new Date(lead.cooldown_first_skip_at).getTime();
        if (Number.isFinite(firstMs)
          && Date.now() - firstMs > COOLDOWN_SKIP_RETIRE_DAYS * 24 * 3600 * 1000) {
          lead.status = 'cooldown_expired_never_ran';
          report.skipped.push({ query: lead.query, reason: 'cooldown_expired_never_ran' });
        } else {
          report.skipped.push({ query: lead.query, reason: 'cooldown_deferred' });
        }
        state.stats.skipped_duplicates += 1;
        continue;
      }
      if (alreadyInCorpus(lead.query) || (lead.title && alreadyInCorpus(`${lead.title} ${lead.author || ''}`))) {
        lead.status = 'already_in_corpus';
        report.skipped.push({ query: lead.query, reason: 'already_in_corpus' });
        state.stats.skipped_duplicates += 1;
        continue;
      }
      // Cleared for seek — reset skip tracking
      lead.cooldown_first_skip_at = null;
      lead.cooldown_skip_count = 0;
      lead.last_skip_reason = null;
      eligible.push(lead);
    }

    const { batch, seededExtraLeads } = pickSeekBatches(
      eligible,
      state.seeks_per_cycle,
      seededExtraLimit(),
    );

    const newKeepIds = [];

    async function processLead(lead, { seedOnly = false } = {}) {
      lead.status = 'running';
      lead.last_attempt_at = new Date().toISOString();
      // WP2.4: do NOT stamp cooldown at seek start — stamp on terminal outcome.
      bumpThread(state, lead.thread, 'seeks');
      state.stats.seeks += 1;
      if (lead.source === 'reflection') {
        state.stats.reflection_leads_sought = (state.stats.reflection_leads_sought || 0) + 1;
      }
      saveStateMerged(state);

      const stampMeta = { title: lead.title, author: lead.author };
      const retryOrFail = (status) => {
        stampAttempted(state, lead.query, { ...stampMeta, days: FAIL_COOLDOWN_DAYS });
        const retries = Math.max(0, Number(lead.retry_count || 0));
        if (retries < MAX_LEAD_RETRIES && lead.title && lead.author) {
          const next = retries + 1;
          const alt = reformulateQuery(lead, next);
          if (alt && queryKey(alt) !== queryKey(lead.query) && !queryOnCooldown(state, alt)) {
            lead.retry_count = next;
            lead.query_attempt = next;
            lead.query = alt;
            lead.status = 'pending';
            lead.last_skip_reason = `${status}_retry`;
            return 'retried';
          }
        }
        lead.status = status;
        return status;
      };

      try {
        let keeps = [];
        let unsures = [];
        let via = seedOnly ? 'seed_url' : 'seek';

        const seedUrls = seedUrlsForLead(lead);
        const freshUrls = seedUrls.filter((u) => !alreadyKeptUrl(u));
        if (seedUrls.length && !freshUrls.length) {
          stampAttempted(state, lead.query, { ...stampMeta, days: QUERY_COOLDOWN_DAYS });
          lead.status = 'already_in_corpus';
          report.skipped.push({ query: lead.query, reason: 'already_kept_url', urls: seedUrls.slice(0, 2) });
          state.stats.skipped_duplicates += 1;
          report.seeks.push({
            query: lead.query,
            thread: normalizeThreadId(lead.thread),
            kept: 0,
            unsure: 0,
            via: 'seed_url',
            skipped_duplicate_url: true,
            seed_only: !!seedOnly,
          });
          saveStateMerged(state);
          return;
        }

        for (const url of freshUrls.slice(0, 2)) {
          try {
            const ing = await runTool('ingest_url', {
              url,
              note: lead.mission || lead.query,
              title: lead.title || '',
            }, {
              goal: lead.mission || lead.query,
              rootDir: opts.rootDir,
              source: 'ei_research_campaign',
              pikoUserId: 'agent:ei-campaign',
            });
            if (ing.mission_fit && ing.mission_fit.error === 'mission_fit_error') {
              lead.status = 'mission_fit_error';
              stampAttempted(state, lead.query, { ...stampMeta, days: FAIL_COOLDOWN_DAYS });
              report.seeks.push({
                query: lead.query,
                thread: normalizeThreadId(lead.thread),
                kept: 0,
                unsure: 0,
                via: 'seed_url',
                mission_fit_error: true,
              });
              saveStateMerged(state);
              return;
            }
            const mf = ing.mission_fit || (ing.result && ing.result.mission_fit);
            const k = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'keep' && !j.purged);
            const u = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'unsure' && !j.purged);
            if (k.length) {
              keeps = k;
              unsures = u;
              via = 'seed_url';
              break;
            }
            if (u.length && !unsures.length) unsures = u;
          } catch (_) { /* try next url / fall through */ }
        }

        if (!keeps.length && !seedOnly) {
          const out = await runTool('seek_files', {
            query: lead.query,
            limit: 10,
            max_keeps: 2,
          }, {
            goal: lead.mission || lead.query,
            rootDir: opts.rootDir,
            source: 'ei_research_campaign',
            pikoUserId: 'agent:ei-campaign',
          });
          if (out.mission_fit && out.mission_fit.error === 'mission_fit_error') {
            lead.status = 'mission_fit_error';
            stampAttempted(state, lead.query, { ...stampMeta, days: FAIL_COOLDOWN_DAYS });
            report.seeks.push({
              query: lead.query,
              thread: normalizeThreadId(lead.thread),
              kept: 0,
              unsure: 0,
              via: 'seek',
              mission_fit_error: true,
            });
            saveStateMerged(state);
            return;
          }
          const mf = out.mission_fit || (out.result && out.result.mission_fit);
          keeps = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'keep' && !j.purged);
          unsures = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'unsure' && !j.purged);
          via = 'seek';
        }

        // Keep-time URL dedupe: drop judgments whose source URL is already kept.
        if (keeps.length) {
          const { getItem } = require('./culturesCorpusApi');
          const filtered = [];
          for (const j of keeps) {
            let dup = false;
            try {
              const got = getItem(j.harvest_id);
              if (got.ok && got.item) {
                for (const u of itemSourceUrls(got.item)) {
                  if (alreadyKeptUrl(u, { exceptHarvestId: j.harvest_id })) {
                    dup = true;
                    break;
                  }
                }
              }
            } catch (_) { /* keep */ }
            if (dup) {
              state.stats.skipped_duplicates += 1;
              report.skipped.push({
                query: lead.query,
                reason: 'already_kept_url',
                harvest_id: j.harvest_id,
              });
            } else {
              filtered.push(j);
            }
          }
          keeps = filtered;
        }

        keeps.forEach((j) => { newKeepIds.push(j.harvest_id); });
        report.seeks.push({
          query: lead.query,
          thread: normalizeThreadId(lead.thread),
          kept: keeps.length,
          unsure: unsures.length,
          via,
          seed_only: !!seedOnly,
        });
        report.keeps.push(...keeps.map((j) => j.harvest_id));
        report.unsures.push(...unsures.map((j) => j.harvest_id));
        bumpThread(state, lead.thread, 'keeps', keeps.length);
        state.stats.keeps += keeps.length;
        state.stats.unsures += unsures.length;
        if (keeps.length) {
          // Lifetime via counters (WP6.6) — scorecard must not depend on last-12 reports.
          const viaKey = via === 'seed_url'
            ? 'keeps_by_via_seed_url'
            : (via === 'seek' ? 'keeps_by_via_seek' : 'keeps_by_via_other');
          state.stats[viaKey] = (state.stats[viaKey] || 0) + keeps.length;
          // Completed seek (kept) — full cooldown.
          stampAttempted(state, lead.query, { ...stampMeta, days: QUERY_COOLDOWN_DAYS });
          lead.status = 'done';
          if (lead.source === 'reflection') {
            state.stats.reflection_leads_kept = (state.stats.reflection_leads_kept || 0) + 1;
          }
        } else if (unsures.length) {
          // Reviewed and left unsure — treat as completed outcome, full cooldown.
          stampAttempted(state, lead.query, { ...stampMeta, days: QUERY_COOLDOWN_DAYS });
          lead.status = 'done';
        } else {
          retryOrFail('no_keeps');
        }
      } catch (e) {
        retryOrFail('failed');
        report.seeks.push({ query: lead.query, error: String(e.message || e).slice(0, 160) });
      }
      saveStateMerged(state);
    }

    // --- Seek phase (priority batch; seed URL ingest first, then web seek) ---
    for (const lead of batch) {
      await processLead(lead, { seedOnly: false });
    }

    // --- Seeded fast lane: extra Archive.org ingests, no open-web seek ---
    for (const lead of seededExtraLeads) {
      if (!seedUrlsForLead(lead).length) continue;
      await processLead(lead, { seedOnly: true });
    }

    // --- Expand phase: queue bibliography citations for mining (no inline seek) ---
    if (newKeepIds.length) {
      let queued = 0;
      for (const hid of newKeepIds.slice(0, 3)) {
        try {
          const exp = await expandFromItem(hid, {
            limit: 5,
            queueOnly: true,
            rootDir: opts.rootDir,
            pikoUserId: 'agent:ei-campaign',
          });
          state.stats.expands += 1;
          queued += Number(exp.queued || (exp.citations || []).length || 0);
        } catch (_) { /* continue */ }
      }
      // Same-cycle mine so new citations enter pending immediately
      const minedNow = mineBibliographyLeads(state, BIB_LEADS_PER_CYCLE);
      report.bib_leads = Number(report.bib_leads || 0) + minedNow;
      leadsAdded += minedNow;
      sourceBreakdown.bibliography += minedNow;
      report.expand = { from: Math.min(3, newKeepIds.length), queued, mined: minedNow, new_keeps: 0 };
    }

    // --- Learn phase: deep-digest + RAG-index every new keep ---
    if (newKeepIds.length) {
      const { deepDigestItem } = require('./eiCorpusNotes');
      const { indexHarvest } = require('./eiCorpusRag');
      for (const hid of [...new Set(newKeepIds)].slice(0, 8)) {
        try { await deepDigestItem(hid); } catch (_) { /* best-effort */ }
        try { await indexHarvest(hid); } catch (_) { /* best-effort */ }
      }
    }

    const idleBackingOff = (state.idle_streak || 0) >= IDLE_STREAK_THRESHOLD;

    // --- Reflect phase: read notes, set new missions ---
    // Skips during idle backoff EXCEPT when starved of leads (see
    // shouldReflectThisCycle — a starved campaign must reflect to recover).
    const reflectGate = shouldReflectThisCycle(state);
    if (!reflectGate.run) {
      report.reflection = { skipped: reflectGate.reason, added: 0 };
    } else {
      try {
        report.reflection = await reflect(state);
        if (reflectGate.reason === 'starvation_recovery' && report.reflection) {
          report.reflection.recovery = true;
        }
        const reflAdded = Number((report.reflection && report.reflection.added) || 0);
        leadsAdded += reflAdded;
        sourceBreakdown.reflection += reflAdded;
      } catch (e) {
        report.reflection = { error: String(e.message || e).slice(0, 160) };
      }
    }

    // --- Expert dossiers (stale threads, max 2) ---
    // WP7.4: still refresh during idle backoff when starved (recovery mode).
    if (idleBackingOff && reflectGate.reason !== 'starvation_recovery') {
      report.dossiers = { skipped: 'idle_backoff' };
    } else {
      try {
        const { refreshDossiers } = require('./eiThreadDossiers');
        report.dossiers = await refreshDossiers({ max: 2 });
      } catch (e) {
        report.dossiers = { error: String(e.message || e).slice(0, 160) };
      }
    }

    // WP7.4: bibliography backfill from existing keeps when mining yielded 0 and starved.
    if (
      reflectGate.reason === 'starvation_recovery'
      && Number(report.bib_leads || 0) === 0
    ) {
      try {
        report.bib_backfill = await backfillBibliographyFromKeeps(state, {
          rootDir: opts.rootDir,
          expandFromItem,
          max: 2,
        });
        const minedAfter = mineBibliographyLeads(state, BIB_LEADS_PER_CYCLE);
        report.bib_leads = Number(report.bib_leads || 0) + minedAfter;
        leadsAdded += minedAfter;
        sourceBreakdown.bibliography += minedAfter;
        if (report.bib_backfill) report.bib_backfill.mined = minedAfter;
      } catch (e) {
        report.bib_backfill = { error: String(e.message || e).slice(0, 160) };
      }
    }

    // --- Auto article when a thread is ripe (max 1/day) ---
    try {
      const { maybeEnqueueAutoArticle } = require('./eiArticleWriter');
      report.article = maybeEnqueueAutoArticle(state, { rootDir: opts.rootDir });
    } catch (e) {
      report.article = { error: String(e.message || e).slice(0, 160) };
    }

    state.cycle_count += 1;
    state.last_cycle_at = new Date().toISOString();
    } // end else (not unsure-gated)
  } catch (e) {
    report.error = String(e.message || e).slice(0, 300);
  } finally {
    finalizeCycle();
  }

  function finalizeCycle() {
    report.finished_at = new Date().toISOString();
    report.leads_added = leadsAdded;
    const seekCount = (report.seeks || []).length;
    const keepCount = [...new Set(report.keeps || [])].length;
    updateIdleStreak(state, seekCount, leadsAdded);
    report.idle_streak = state.idle_streak;
    state.running = false;
    state.running_since = null;
    // WP2.7: merge any leads/fields written by API while this cycle ran.
    state = mergeExternalState(state);
    if (state.leads.length > 200) {
      state.leads = state.leads.filter((l) => l.status === 'pending').concat(
        state.leads.filter((l) => l.status !== 'pending').slice(-80),
      );
    }
    state.reports = [...(state.reports || []), report].slice(-12);
    const startedMs = report.started_at ? new Date(report.started_at).getTime() : Date.now();
    appendCycleLog({
      ts: report.finished_at,
      cycle: report.cycle,
      seeks: seekCount,
      keeps: keepCount,
      unsures: [...new Set(report.unsures || [])].length,
      leads_added: leadsAdded,
      source_breakdown: sourceBreakdown,
      idle_streak: state.idle_streak,
      duration_ms: Math.max(0, Date.now() - startedMs),
      error: report.error || null,
    });
    try {
      report.scorecard_snapshot = maybeAppendScorecardSnapshot(state);
    } catch (_) { /* best-effort */ }
    try {
      const { maybeAppendDailyFindings } = require('./eiImprovementLog');
      report.daily_findings = maybeAppendDailyFindings(state);
    } catch (_) { /* best-effort */ }
    saveState(state);
  }

  return { ok: !report.error, report, state: summarize(loadState()) };
}

function dueForCycle(state) {
  const s = state || loadState();
  if (!s.enabled || s.paused) return false;
  if (s.running && s.running_since
    && Date.now() - new Date(s.running_since).getTime() < STALE_RUNNING_MS) return false;
  if (!s.last_cycle_at) return true;
  const intervalMin = effectiveIntervalMinutes(s);
  return Date.now() - new Date(s.last_cycle_at).getTime() >= intervalMin * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Learning scorecard (Iteration 0)
// ---------------------------------------------------------------------------

const SCORECARD_WEEK_MS = 7 * 24 * 3600 * 1000;

function scorecardPath() {
  return path.join(culturesDataRoot(), 'learning_scorecard.jsonl');
}

/**
 * North-star learning metrics: digestion, attribution, direction, coverage.
 */
function learningScorecard(state) {
  const s = state || loadState();
  const expert = expertiseSnapshot(s);
  const cov = s.thread_coverage || {};
  const expertise = expert.expertise || {};
  const ids = new Set([
    ...DEFAULT_THREADS.map((t) => t.id),
    'atlantis',
    'other',
    ...Object.keys(cov),
    ...Object.keys(expertise),
  ]);

  const byThread = {};
  let attributedKeeps = 0;
  let otherKeeps = 0;
  let deadThreadCount = 0;
  for (const id of ids) {
    const keeps = Number((cov[id] && cov[id].keeps) || (expertise[id] && expertise[id].keeps) || 0);
    const notes = Number((expertise[id] && expertise[id].notes) || 0);
    byThread[id] = {
      keeps,
      notes,
      notes_keep_ratio: keeps > 0 ? Math.round((notes / keeps) * 1000) / 1000 : null,
    };
    if (id === 'other') otherKeeps += keeps;
    else {
      attributedKeeps += keeps;
      if (keeps < 3) deadThreadCount += 1;
    }
  }

  const keepsTotal = Math.max(
    Number((s.stats && s.stats.keeps) || 0),
    attributedKeeps + otherKeeps,
  );
  const notesCount = Number(expert.notes_count || 0);
  const cycles = Number(s.cycle_count || 0);
  // WP2.5: lifetime counters only — never the pruned last-12 reports.
  const reflectionAdded = Number((s.stats && s.stats.reflection_leads_added) || 0);
  const reflectionSought = Number((s.stats && s.stats.reflection_leads_sought) || 0);
  const reflectionKept = Number((s.stats && s.stats.reflection_leads_kept) || 0);
  const reflectionProposed = Number((s.stats && s.stats.reflection_leads_proposed) || 0);
  const keptSoughtRatio = reflectionSought > 0
    ? Math.round((reflectionKept / reflectionSought) * 1000) / 1000
    : null;
  // Keeps originating from reflection leads, per 100 cycles (lifetime).
  const reflectionSurvival = cycles > 0
    ? Math.round((reflectionKept / cycles) * 100 * 100) / 100
    : 0;

  return {
    ok: true,
    at: new Date().toISOString(),
    cycle_count: cycles,
    keeps_total: keepsTotal,
    notes_count: notesCount,
    notes_keep_ratio: keepsTotal > 0 ? Math.round((notesCount / keepsTotal) * 1000) / 1000 : null,
    attributed_keeps: attributedKeeps,
    other_keeps: otherKeeps,
    attributed_keep_pct: keepsTotal > 0
      ? Math.round((attributedKeeps / keepsTotal) * 1000) / 10
      : null,
    reflection_leads_proposed: reflectionProposed,
    reflection_leads_added: reflectionAdded,
    reflection_leads_sought: reflectionSought,
    reflection_leads_kept: reflectionKept,
    reflection_kept_sought_ratio: keptSoughtRatio,
    reflection_survival_per_100_cycles: reflectionSurvival,
    dead_thread_count: deadThreadCount,
    keeps_by_via: expert.keeps_by_via || { seed_url: 0, seek: 0, other: 0 },
    by_thread: byThread,
    targets: {
      notes_keep_ratio: 0.9,
      attributed_keep_pct: 70,
      reflection_survival_per_100_cycles: 5,
      dead_thread_count: 0,
    },
  };
}

/**
 * Append a weekly scorecard snapshot (guarded — at most once per week).
 * Mutates state.last_scorecard_at when written.
 * On append, evaluates S1 scorecard auto-triggers (proposals → pending/ only).
 */
function maybeAppendScorecardSnapshot(state, opts = {}) {
  const s = state || loadState();
  migrateCampaignState(s);
  const last = s.last_scorecard_at;
  if (last && !opts.force) {
    const age = Date.now() - new Date(last).getTime();
    if (Number.isFinite(age) && age < SCORECARD_WEEK_MS) {
      return { ok: true, skipped: true, reason: 'within_week' };
    }
  }
  const card = learningScorecard(s);
  try {
    fs.mkdirSync(path.dirname(scorecardPath()), { recursive: true });
    const { appendJsonlBounded } = require('./jsonlBounded');
    const maxLines = Number(process.env.PIKO_SCORECARD_JSONL_MAX || 500) || 500;
    appendJsonlBounded(scorecardPath(), card, { maxLines });
    s.last_scorecard_at = card.at;
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }

  let triggers = { ok: true, fired: [], results: [], skipped: 'not_run' };
  try {
    const { maybeFileScorecardProposals, readPreviousScorecardSnapshot } = require('./eiScorecardTriggers');
    const previous = opts.previous !== undefined
      ? opts.previous
      : readPreviousScorecardSnapshot(scorecardPath());
    triggers = maybeFileScorecardProposals(s, card, {
      previous,
      scorecardPath: scorecardPath(),
      rootDir: opts.rootDir,
      proposeImprovement: opts.proposeImprovement,
      nowMs: opts.nowMs,
    });
  } catch (_) { /* best-effort — never fail the snapshot write */ }

  return { ok: true, skipped: false, scorecard: card, triggers };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function expertiseSnapshot(state) {
  const s = state || loadState();
  let notesCount = 0;
  let dossiers = [];
  let articles = [];
  let threadDefs = DEFAULT_THREADS.map((t) => ({ id: t.id }));
  let isStale = () => false;
  let notesForThreadFn = null;
  try {
    const { listNotes } = require('./eiCorpusNotes');
    notesCount = listNotes(200).length;
  } catch (_) { /* optional */ }
  try {
    const dmod = require('./eiThreadDossiers');
    dossiers = dmod.listDossiers();
    threadDefs = dmod.THREAD_DEFS;
    isStale = dmod.dossierIsStale;
    notesForThreadFn = dmod.notesForThread;
  } catch (_) { /* optional */ }
  try {
    const { listArticles } = require('./eiArticleWriter');
    articles = listArticles();
  } catch (_) { /* optional */ }

  const dossierByThread = {};
  for (const d of dossiers) dossierByThread[d.thread] = d;
  const articleByThread = {};
  for (const a of articles) {
    if (!a.thread) continue;
    if (!articleByThread[a.thread]) articleByThread[a.thread] = a;
  }

  const expertise = {};
  const ids = new Set([
    ...Object.keys(s.thread_coverage || {}),
    ...threadDefs.map((t) => t.id),
    ...Object.keys(dossierByThread),
  ]);
  for (const id of ids) {
    const cov = (s.thread_coverage || {})[id] || {};
    const d = dossierByThread[id];
    const art = articleByThread[id];
    let notesForT = 0;
    if (notesForThreadFn) {
      try { notesForT = notesForThreadFn(id, { limit: 100 }).length; } catch (_) { notesForT = 0; }
    } else {
      notesForT = d ? Number(d.note_count || 0) : 0;
    }
    expertise[id] = {
      keeps: cov.keeps || 0,
      seeks: cov.seeks || 0,
      notes: notesForT,
      dossier: !!d,
      dossier_stale: d ? !!isStale(id) : null,
      article: art ? (art.status === 'needs_work' ? 'needs_work' : 'draft') : 'none',
    };
  }

  const pending = pendingLeads(s);
  const stats = s.stats || {};
  let keepsByVia = {
    seed_url: Number(stats.keeps_by_via_seed_url) || 0,
    seek: Number(stats.keeps_by_via_seek) || 0,
    other: Number(stats.keeps_by_via_other) || 0,
  };
  // Backfill from reports only when lifetime counters were never bumped (pre-WP6.6 state).
  if (!keepsByVia.seed_url && !keepsByVia.seek && !keepsByVia.other) {
    for (const r of s.reports || []) {
      for (const seek of r.seeks || []) {
        const n = Number(seek.kept != null ? seek.kept : seek.keeps) || 0;
        if (!n) continue;
        if (seek.via === 'seed_url') keepsByVia.seed_url += n;
        else if (seek.via === 'seek' || seek.tool === 'seek_files') keepsByVia.seek += n;
        else keepsByVia.other += n;
      }
    }
  }

  const articlesByStatus = { draft: 0, needs_work: 0 };
  for (const a of articles) {
    if (a.status === 'needs_work') articlesByStatus.needs_work += 1;
    else articlesByStatus.draft += 1;
  }

  return {
    notes_count: notesCount,
    dossiers: {
      count: dossiers.length,
      stale: dossiers.filter((d) => {
        try { return isStale(d.thread); } catch (_) { return false; }
      }).length,
    },
    articles: {
      count: articles.length,
      ...articlesByStatus,
    },
    keeps_by_via: keepsByVia,
    pending_access: {
      seeded: pending.filter((l) => l.access === 'seeded').length,
      public_domain_likely: pending.filter((l) => l.access === 'public_domain_likely').length,
      speculative: pending.filter((l) => l.access === 'speculative').length,
    },
    expertise,
  };
}

function summarize(state) {
  const s = state || loadState();
  const lastReport = (s.reports || [])[s.reports.length - 1] || null;
  const expert = expertiseSnapshot(s);
  const idleStreak = Number(s.idle_streak || 0);
  const backingOff = idleStreak >= IDLE_STREAK_THRESHOLD;
  const intervalEff = effectiveIntervalMinutes(s);
  return {
    enabled: s.enabled,
    paused: s.paused,
    running: !!s.running,
    topic: s.topic,
    interval_minutes: s.interval_minutes,
    effective_interval_minutes: intervalEff,
    idle_streak: idleStreak,
    mode: backingOff ? 'idle (backing off)' : 'active',
    cycle_count: s.cycle_count,
    last_cycle_at: s.last_cycle_at,
    last_article_at: s.last_article_at || null,
    next_cycle_due: s.enabled && !s.paused
      ? new Date((s.last_cycle_at ? new Date(s.last_cycle_at).getTime() : Date.now()) + intervalEff * 60000).toISOString()
      : null,
    pending_leads: pendingLeads(s).length,
    stats: s.stats,
    thread_coverage: s.thread_coverage,
    last_report: lastReport,
    last_24h: last24hStats(),
    ...expert,
  };
}

/**
 * Build up to `max` operator leads from a keep-researching / topic phrase.
 */
function leadsFromTopicPhrase(phrase, max = 3) {
  const text = String(phrase || '').trim();
  if (!text) return [];
  const out = [];
  try {
    const { parseNamedWork, focusedSeekQuery } = require('./eiGoalParse');
    let thread = 'other';
    try {
      const { matchThreadId } = require('./eiThreadDossiers');
      thread = normalizeThreadId(matchThreadId(text) || 'other');
    } catch (_) { /* optional */ }
    const named = parseNamedWork(text);
    if (named.title && named.author) {
      out.push({
        title: named.title,
        author: named.author,
        thread,
        source: 'operator',
        why: 'operator keep-researching focus',
      });
    }
    let topicText = String(text || '');
    const kt = 'keep researching';
    const ktIdx = toLowerAsciiish(topicText).indexOf(kt);
    if (ktIdx >= 0) {
      topicText = (topicText.slice(0, ktIdx) + topicText.slice(ktIdx + kt.length)).trim();
    }
    const q = focusedSeekQuery(text) || named.seekQuery || `${topicText} PDF`;
    if (q && q.length >= 8) {
      out.push({
        query: String(q).slice(0, 200),
        thread,
        source: 'operator',
        why: 'operator keep-researching topic',
      });
    }
  } catch (_) { /* best-effort */ }
  // Deduplicate by query key
  const seen = new Set();
  const uniq = [];
  for (const l of out) {
    const k = queryKey(l.query || `${l.title} ${l.author}`);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(l);
    if (uniq.length >= max) break;
  }
  return uniq;
}

function bustLegateStateCache() {
  try { require('./legateTools').bustCampaignStateBlockCache(); } catch (_) { /* optional */ }
}

function startCampaign(opts = {}) {
  let state = loadState();
  migrateCampaignState(state);
  state.enabled = true;
  state.paused = false;
  state.idle_streak = 0;
  const topicRaw = opts.topic != null ? String(opts.topic).trim() : '';
  const focusOnly = !!opts.focus_only || includesAny(toLowerAsciiish(topicRaw), ['focus only on']);
  // Only overwrite the standing topic when operator says "focus only on …"
  // or when the campaign has never had a topic set.
  if (topicRaw && (focusOnly || !state.topic)) {
    state.topic = topicRaw.slice(0, 1200);
  }
  if (opts.interval_minutes != null) {
    state.interval_minutes = Math.max(1, Math.min(24 * 60, Number(opts.interval_minutes) || 1));
  }
  if (opts.seeks_per_cycle) {
    state.seeks_per_cycle = Math.max(1, Math.min(4, Number(opts.seeks_per_cycle)));
  }
  if (!state.created_at) state.created_at = new Date().toISOString();
  seedDeadThreads(state);
  mineBibliographyLeads(state, BIB_LEADS_PER_CYCLE);
  if (pendingLeads(state).length === 0) refillLeadsFromThreads(state);
  state = saveState(state);
  bustLegateStateCache();
  return { ok: true, status: summarize(state) };
}

function pauseCampaign() {
  const state = loadState();
  state.paused = true;
  saveState(state);
  bustLegateStateCache();
  return { ok: true, status: summarize(state) };
}

function resumeCampaign() {
  const state = loadState();
  if (!state.enabled) return startCampaign();
  state.paused = false;
  state.idle_streak = 0;
  saveState(state);
  bustLegateStateCache();
  return { ok: true, status: summarize(state) };
}

function stopCampaign() {
  const state = loadState();
  state.enabled = false;
  state.paused = false;
  saveState(state);
  bustLegateStateCache();
  return { ok: true, status: summarize(state) };
}

function getCampaignStatus() {
  return { ok: true, status: summarize(loadState()) };
}

function getLearningScorecard() {
  return learningScorecard(loadState());
}

function addCampaignLeads(leads) {
  const state = loadState();
  let added = 0;
  for (const l of Array.isArray(leads) ? leads : [leads]) {
    if (addLead(state, { ...l, source: l.source || 'operator' })) added += 1;
  }
  if (added) state.idle_streak = 0;
  saveState(state);
  return { ok: true, added, status: summarize(state) };
}

function formatCampaignStatus(status) {
  const s = status || summarize(loadState());
  const lines = [
    `Research campaign: ${s.enabled ? (s.paused ? 'PAUSED' : 'ACTIVE') : 'stopped'}`
      + ` · mode=${s.mode || 'active'}`
      + ` · cycles=${s.cycle_count} · keeps=${s.stats.keeps} · unsures=${s.stats.unsures}`
      + ` · pending leads=${s.pending_leads}`,
  ];
  if (s.enabled && !s.paused && s.next_cycle_due) {
    lines.push(`Next cycle due: ${s.next_cycle_due}`
      + ` (every ${s.effective_interval_minutes || s.interval_minutes}m`
      + `${(s.idle_streak || 0) >= IDLE_STREAK_THRESHOLD ? `, idle_streak=${s.idle_streak}` : ''})`);
  }
  if (s.last_24h) {
    lines.push(`Last 24h: cycles=${s.last_24h.cycles} · seeks=${s.last_24h.seeks}`
      + ` · keeps=${s.last_24h.keeps} · leads_added=${s.last_24h.leads_added}`
      + ` · idle=${s.last_24h.idle_pct}%`);
  }
  lines.push(
    `Learning: notes=${s.notes_count || 0}`
      + ` · dossiers=${(s.dossiers && s.dossiers.count) || 0}`
      + `${(s.dossiers && s.dossiers.stale) ? ` (${s.dossiers.stale} stale)` : ''}`
      + ` · articles=${(s.articles && s.articles.count) || 0}`
      + `${(s.articles && s.articles.needs_work) ? ` (${s.articles.needs_work} needs_work)` : ''}`,
  );
  const expertLine = Object.entries(s.expertise || {})
    .map(([k, v]) => `${k}:k${v.keeps}/n${v.notes}/${v.dossier ? 'D' : '-'}/${v.article === 'none' ? '-' : v.article[0]}`)
    .join(' · ');
  if (expertLine) lines.push(`Expertise: ${expertLine}`);
  const cov = Object.entries(s.thread_coverage || {})
    .map(([k, v]) => `${k}=${v.keeps || 0}`).join(' · ');
  if (cov) lines.push(`Coverage (keeps): ${cov}`);
  if (s.last_report) {
    const r = s.last_report;
    lines.push(`Last cycle #${r.cycle}: seeks=${(r.seeks || []).length}`
      + ` kept=${[...new Set(r.keeps || [])].length} unsure=${[...new Set(r.unsures || [])].length}`
      + `${r.reflection && r.reflection.added != null ? ` · new self-set leads=${r.reflection.added}` : ''}`
      + `${r.reflection && r.reflection.access ? ` · access=${JSON.stringify(r.reflection.access)}` : ''}`);
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_THREADS,
  KNOWN_THREAD_IDS,
  QUERY_COOLDOWN_DAYS,
  FAIL_COOLDOWN_DAYS,
  COOLDOWN_SKIP_RETIRE_DAYS,
  ATTEMPTED_MAX_KEYS,
  ATTEMPTED_PRUNE_DAYS,
  IDLE_BACKOFF_MIN,
  IDLE_STREAK_THRESHOLD,
  MAX_LEAD_RETRIES,
  loadState,
  saveState,
  saveStateMerged,
  mergeExternalState,
  clearRunningLockAtBoot,
  runCampaignCycle,
  reflect,
  buildReflectPromptParts,
  recordReflectionRejection,
  isRecentlyRejectedTitle,
  leadBlocksDedupe,
  backfillBibliographyFromKeeps,
  dueForCycle,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  stopCampaign,
  getCampaignStatus,
  getLearningScorecard,
  learningScorecard,
  maybeAppendScorecardSnapshot,
  expertiseSnapshot,
  scorecardPath,
  applyReflectionProposedLeads,
  addCampaignLeads,
  formatCampaignStatus,
  alreadyInCorpus,
  alreadyKeptUrl,
  normalizeSourceUrl,
  itemSourceUrls,
  flagDuplicateUrlKeeps,
  queryOnCooldown,
  stampAttempted,
  buildCooldownActiveList,
  allVariantsOnCooldown,
  hintOnCooldown,
  eligiblePendingLeads,
  addLead,
  sanitizeLead,
  pruneBadPendingLeads,
  classifyLeadAccess,
  normalizeThreadId,
  migrateCampaignState,
  reattributeOtherCoverageFromNotes,
  orderLeads,
  leadPriority,
  pickSeekBatches,
  seedDeadThreads,
  refillLeadsFromThreads,
  leadsFromTopicPhrase,
  summarize,
  mineBibliographyLeads,
  reformulateQuery,
  resetStaleRunningLeads,
  resetIdleStreak,
  shouldReflectThisCycle,
  updateIdleStreak,
  appendCycleLog,
  last24hStats,
  cycleLogPath,
  effectiveIntervalMinutes,
  formatBibGapsHint,
};
