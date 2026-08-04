/**
 * Structured corpus notes — digest kept items for downstream tasks.
 */
const fs = require('fs');
const path = require('path');
const { getItem, listItems } = require('./culturesCorpusApi');
const { resolveReadableContent } = require('./eiCorpusContentReview');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { notesDir } = require('./eiBibliography');
const { normalizeTitle } = require('./eiGoalParse');

const WINDOW_CHARS = 12000;
const DEEP_MIN_CHARS = 30000;

const {
  collapseWhitespace,
} = require('./text');

function notePath(harvestId) {
  return path.join(notesDir(), `item_${Number(harvestId)}.json`);
}

function getModel() {
  return (
    process.env.PIKO_EI_DIGEST_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

function digestMaxTokens() {
  return Math.max(400, Math.min(4000, Number(process.env.PIKO_EI_DIGEST_MAX_TOKENS) || 1400));
}

function deepDigestChunks() {
  return Math.max(2, Math.min(6, Number(process.env.PIKO_EI_DEEP_DIGEST_CHUNKS) || 4));
}

function digestSystemPrompt(extra = '') {
  return `You digest one research text into structured notes for later tasks.
Return JSON only:
{"claims":["..."],"people":["..."],"sites":["..."],"methods":["..."],"disagreements":["..."],"key_quotes":["..."],"open_questions":["..."],"summary":"2-3 sentences"}
Keep each list to at most 8 short items. Quotes under 200 chars.${extra ? `\n${extra}` : ''}`;
}

function tryParseDigest(raw) {
  try {
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Empty / useless parse — treat as failure so we retry
    const hasContent = String(parsed.summary || '').trim()
      || (Array.isArray(parsed.claims) && parsed.claims.length);
    if (!hasContent) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function noteFromParsed(hid, title, author, parsed, extras = {}) {
  return {
    harvest_id: hid,
    title,
    author,
    summary: String(parsed.summary || '').slice(0, 600),
    claims: (parsed.claims || []).map(String).slice(0, 8),
    people: (parsed.people || []).map(String).slice(0, 8),
    sites: (parsed.sites || []).map(String).slice(0, 8),
    methods: (parsed.methods || []).map(String).slice(0, 8),
    disagreements: (parsed.disagreements || []).map(String).slice(0, 8),
    key_quotes: (parsed.key_quotes || []).map(String).slice(0, 8),
    open_questions: (parsed.open_questions || []).map(String).slice(0, 8),
    updated_at: new Date().toISOString(),
    ...extras,
  };
}

function stubNote(hid, title, author, text) {
  return {
    harvest_id: hid,
    title,
    author,
    summary: String(text || '').slice(0, 400),
    claims: [],
    people: [],
    sites: [],
    methods: [],
    disagreements: [],
    key_quotes: [],
    open_questions: [],
    digest_failed: true,
    updated_at: new Date().toISOString(),
  };
}

function saveNote(note) {
  fs.mkdirSync(notesDir(), { recursive: true });
  fs.writeFileSync(notePath(note.harvest_id), JSON.stringify(note, null, 2));
}

async function callDigestLlm(title, author, sample, opts = {}) {
  const systemExtra = opts.retry
    ? 'Your previous output was cut off. Return COMPLETE minified JSON only. Maximum 6 items per list, each under 120 chars.'
    : '';
  return ollamaNativeChat(getModel(), [
    { role: 'system', content: digestSystemPrompt(systemExtra) },
    { role: 'user', content: `Title: ${title}\nAuthor: ${author}\n\n${sample}` },
  ], {
    format: 'json',
    temperature: opts.retry ? 0 : 0.2,
    max_tokens: digestMaxTokens(),
    num_ctx: Number(process.env.PIKO_EI_DIGEST_NUM_CTX || 8192),
    timeoutMs: Math.max(15000, Number(process.env.PIKO_EI_DIGEST_TIMEOUT_MS || 120000)),
    priority: 'background',
    lane: 'worker',
    tag: opts.tag || 'eiCorpusNotes',
  });
}

/**
 * Deduplicate list items case-insensitively and cap length.
 */
function dedupeCap(list, cap) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const s = String(item || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Merge multiple partial digests into one deep note payload (pure).
 * Caps: claims 20, people/sites/methods 12, key_quotes 12, open_questions 10.
 */
function mergeDigests(partials) {
  const lists = {
    claims: [],
    people: [],
    sites: [],
    methods: [],
    disagreements: [],
    key_quotes: [],
    open_questions: [],
  };
  const summaries = [];
  for (const p of partials || []) {
    if (!p || typeof p !== 'object') continue;
    for (const k of Object.keys(lists)) {
      if (Array.isArray(p[k])) lists[k].push(...p[k]);
    }
    if (p.summary) summaries.push(String(p.summary));
  }
  return {
    claims: dedupeCap(lists.claims, 20),
    people: dedupeCap(lists.people, 12),
    sites: dedupeCap(lists.sites, 12),
    methods: dedupeCap(lists.methods, 12),
    disagreements: dedupeCap(lists.disagreements, 12),
    key_quotes: dedupeCap(lists.key_quotes, 12),
    open_questions: dedupeCap(lists.open_questions, 10),
    window_summaries: summaries,
    summary: '', // filled by LLM merge or join fallback
  };
}

/**
 * Evenly spaced windows: start, 1/3, 2/3, end (for n=4).
 */
function sampleWindows(text, n, windowChars = WINDOW_CHARS) {
  const t = String(text || '');
  const len = t.length;
  if (len <= windowChars) return [t];
  const count = Math.max(1, Math.min(n, Math.floor(len / Math.max(1000, windowChars / 2))));
  const windows = [];
  for (let i = 0; i < count; i++) {
    const start = count === 1
      ? 0
      : Math.floor((i / (count - 1)) * Math.max(0, len - windowChars));
    windows.push(t.slice(start, start + windowChars));
  }
  return windows;
}

async function digestSample(hid, title, author, sample, extras = {}) {
  let raw = await callDigestLlm(title, author, sample, { tag: extras.tag });
  let parsed = tryParseDigest(raw);
  if (!parsed) {
    raw = await callDigestLlm(title, author, sample, { retry: true, tag: extras.tag });
    parsed = tryParseDigest(raw);
  }
  if (!parsed) {
    const note = stubNote(hid, title, author, sample);
    Object.assign(note, extras);
    saveNote(note);
    return { ok: true, note, digest_failed: true };
  }
  const note = noteFromParsed(hid, title, author, parsed, extras);
  // Allow deeper caps when extras.deep — noteFromParsed slices to 8 by default
  if (extras.deep && parsed) {
    note.claims = (parsed.claims || []).map(String).slice(0, 20);
    note.people = (parsed.people || []).map(String).slice(0, 12);
    note.sites = (parsed.sites || []).map(String).slice(0, 12);
    note.methods = (parsed.methods || []).map(String).slice(0, 12);
    note.key_quotes = (parsed.key_quotes || []).map(String).slice(0, 12);
    note.open_questions = (parsed.open_questions || []).map(String).slice(0, 10);
    note.disagreements = (parsed.disagreements || []).map(String).slice(0, 12);
  }
  saveNote(note);
  return { ok: true, note };
}

async function digestItem(harvestId, opts = {}) {
  const hid = Number(harvestId);
  const got = getItem(hid);
  if (!got.ok || !got.item) return { ok: false, error: 'not_found', harvest_id: hid };
  const content = await resolveReadableContent(got.item, {
    maxChars: Number(opts.contentChars || WINDOW_CHARS),
  });
  if (content.kind === 'none' || !content.text) {
    return { ok: false, error: 'no_text', harvest_id: hid };
  }
  const sample = String(content.text).slice(0, Number(opts.contentChars || WINDOW_CHARS));
  const title = got.item.title || '';
  const author = (got.item.meta && (got.item.meta.author || got.item.meta.work_author)) || '';
  return digestSample(hid, title, author, sample);
}

async function mergeSummaries(windowSummaries, title, author) {
  const joined = (windowSummaries || []).filter(Boolean).join('\n---\n');
  if (!joined) return '';
  try {
    const raw = await ollamaNativeChat(getModel(), [
      {
        role: 'system',
        content: 'Merge window summaries of one research book into a single summary of at most 5 sentences. Return JSON only: {"summary":"..."}',
      },
      {
        role: 'user',
        content: `Title: ${title}\nAuthor: ${author}\n\nWindow summaries:\n${joined.slice(0, 6000)}`,
      },
    ], {
      format: 'json',
      temperature: 0.1,
      max_tokens: 400,
      priority: 'background',
      lane: 'worker',
      tag: 'eiCorpusNotes.deepMerge',
    });
    const parsed = tryParseDigest(raw) || (() => {
      try { return extractJsonObject(raw); } catch (_) { return null; }
    })();
    if (parsed && parsed.summary) return String(parsed.summary).slice(0, 600);
  } catch (_) { /* fall through */ }
  return (windowSummaries || []).join(' ').slice(0, 600);
}

/**
 * Multi-window digest for major works. Self-selects: short texts use digestItem.
 */
function deepMaxChars() {
  // Enough for N evenly spaced windows across a long book (not full OCR dump).
  return Math.max(DEEP_MIN_CHARS, deepDigestChunks() * WINDOW_CHARS * 4);
}

async function deepDigestItem(harvestId, opts = {}) {
  const hid = Number(harvestId);
  const got = getItem(hid);
  if (!got.ok || !got.item) return { ok: false, error: 'not_found', harvest_id: hid };
  const content = await resolveReadableContent(got.item, { maxChars: deepMaxChars() });
  if (content.kind === 'none' || !content.text) {
    return { ok: false, error: 'no_text', harvest_id: hid };
  }
  const text = String(content.text);
  const fullChars = Math.max(Number(content.chars) || 0, text.length);
  const title = got.item.title || '';
  const author = (got.item.meta && (got.item.meta.author || got.item.meta.work_author)) || '';

  if (fullChars < DEEP_MIN_CHARS || text.length < DEEP_MIN_CHARS) {
    return digestItem(hid, opts);
  }

  const windows = sampleWindows(text, deepDigestChunks(), WINDOW_CHARS);
  const partials = [];
  for (let i = 0; i < windows.length; i++) {
    let raw = await callDigestLlm(title, author, windows[i], { tag: 'eiCorpusNotes.deep' });
    let parsed = tryParseDigest(raw);
    if (!parsed) {
      raw = await callDigestLlm(title, author, windows[i], { retry: true, tag: 'eiCorpusNotes.deep' });
      parsed = tryParseDigest(raw);
    }
    if (parsed) partials.push(parsed);
  }

  if (!partials.length) {
    const note = stubNote(hid, title, author, text);
    note.deep = true;
    saveNote(note);
    return { ok: true, note, digest_failed: true };
  }

  const merged = mergeDigests(partials);
  merged.summary = await mergeSummaries(merged.window_summaries, title, author);
  if (!merged.summary) {
    merged.summary = (merged.window_summaries || []).join(' ').slice(0, 600);
  }
  const note = {
    harvest_id: hid,
    title,
    author,
    summary: String(merged.summary || '').slice(0, 600),
    claims: merged.claims,
    people: merged.people,
    sites: merged.sites,
    methods: merged.methods,
    disagreements: merged.disagreements,
    key_quotes: merged.key_quotes,
    open_questions: merged.open_questions,
    deep: true,
    windows: windows.length,
    updated_at: new Date().toISOString(),
  };
  saveNote(note);
  return { ok: true, note };
}

function loadNote(harvestId) {
  const p = notePath(harvestId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isNoteFilename(f) {
  // item_<digits>.json — no regex (P1.6 + no-regex ratchet).
  const name = String(f || '');
  if (!name.startsWith('item_') || !name.endsWith('.json')) return false;
  const mid = name.slice(5, -5);
  if (!mid) return false;
  for (let i = 0; i < mid.length; i += 1) {
    const c = mid.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function listNotes(limit = 50) {
  const dir = notesDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(isNoteFilename);
  // P1.6: sort by mtime BEFORE reading/slicing so newest digests stay visible
  // as the corpus grows past 2×limit files.
  const ranked = files.map((f) => {
    const full = path.join(dir, f);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(full).mtimeMs || 0; } catch (_) { mtimeMs = 0; }
    return { f, full, mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);

  const notes = [];
  for (const { full, mtimeMs } of ranked.slice(0, Math.max(limit * 2, limit))) {
    try {
      const n = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!n.updated_at && mtimeMs) n.updated_at = new Date(mtimeMs).toISOString();
      notes.push(n);
    } catch (_) { /* skip */ }
  }
  return notes
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, limit);
}

/**
 * Retrieve notes relevant to a goal/query for planner/worker injection.
 */
function notesForQuery(query, opts = {}) {
  const q = normalizeTitle(query);
  const toks = collapseWhitespace(q).split(' ').filter((t) => t.length > 3);
  const notes = listNotes(opts.limit || 40);
  const scored = notes.map((n) => {
    const blob = normalizeTitle([
      n.title, n.author, n.summary,
      ...(n.claims || []), ...(n.people || []), ...(n.sites || []),
    ].join(' '));
    let score = 0;
    for (const t of toks) {
      if (blob.includes(t)) score += 1;
    }
    return { score, note: n };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.top || 5).map((x) => x.note);
}

function formatNotesBlock(notes) {
  if (!notes || !notes.length) return '';
  const lines = ['Corpus notes (use for this task; cite by title):'];
  for (const n of notes) {
    lines.push(`\n• ${n.title || 'untitled'}${n.author ? ` — ${n.author}` : ''}`);
    if (n.summary) lines.push(`  ${n.summary}`);
    if (n.claims && n.claims.length) {
      lines.push(`  Claims: ${n.claims.slice(0, 3).join('; ')}`);
    }
  }
  return lines.join('\n').slice(0, 3500);
}

function getNotesContextForGoal(goal) {
  try {
    const notes = notesForQuery(goal, { top: 4 });
    return formatNotesBlock(notes);
  } catch (_) {
    return '';
  }
}

/**
 * Paginate listItems so backfill can see beyond the newest page.
 * @param {(opts: object) => {items?: object[]}} listFn
 * @param {{ page?: number, maxPages?: number, exclude_candidates?: boolean }} opts
 */
function paginateCorpusItems(listFn, opts = {}) {
  const page = Math.max(1, Math.min(200, Number(opts.page) || 100));
  const maxPages = Math.max(1, Math.min(50, Number(opts.maxPages) || 50));
  const items = [];
  let offset = 0;
  for (let guard = 0; guard < maxPages; guard += 1) {
    const out = listFn({
      limit: page,
      offset,
      exclude_candidates: opts.exclude_candidates !== false,
    }) || {};
    const batch = out.items || [];
    if (!batch.length) break;
    items.push(...batch);
    if (batch.length < page) break;
    offset += page;
  }
  return items;
}

/**
 * Digest + RAG-index keeps that lack notes yet (expertise backfill).
 * When opts.deep: use deepDigestItem; also re-digest shallow notes for long texts.
 * @param {{ limit?: number, index?: boolean, deep?: boolean }} opts
 */
async function backfillCorpusLearning(opts = {}) {
  const limit = Math.max(1, Math.min(80, Number(opts.limit) || 40));
  const doIndex = opts.index !== false;
  const deep = !!opts.deep;
  const items = paginateCorpusItems(listItems, { page: 100, exclude_candidates: true });
  const report = { scanned: items.length, digested: [], skipped: [], errors: [], indexed: [], deep };
  let done = 0;
  for (const it of items) {
    if (done >= limit) break;
    const hid = Number(it.id || it.harvest_id);
    if (!Number.isFinite(hid) || hid <= 0) continue;
    const existing = loadNote(hid);
    if (existing && !deep) {
      report.skipped.push(hid);
      continue;
    }
    if (existing && deep && existing.deep === true) {
      report.skipped.push(hid);
      continue;
    }
    // When deep=true and shallow note exists: only re-digest if underlying text is long enough
    if (existing && deep && !existing.deep) {
      try {
        const got = getItem(hid);
        if (got.ok && got.item) {
          const content = await resolveReadableContent(got.item, { maxChars: 2000 });
          const len = Math.max(Number(content.chars) || 0, String(content.text || '').length);
          if (len < DEEP_MIN_CHARS) {
            report.skipped.push(hid);
            continue;
          }
        }
      } catch (_) { /* proceed to digest */ }
    }
    try {
      const dig = deep ? await deepDigestItem(hid) : await digestItem(hid);
      if (dig.ok) {
        report.digested.push(hid);
        done += 1;
        if (doIndex) {
          try {
            const { indexHarvest } = require('./eiCorpusRag');
            await indexHarvest(hid);
            report.indexed.push(hid);
          } catch (e) {
            report.errors.push({ harvest_id: hid, stage: 'index', error: String(e.message || e).slice(0, 120) });
          }
        }
      } else {
        report.errors.push({ harvest_id: hid, stage: 'digest', error: dig.error || 'failed' });
      }
    } catch (e) {
      report.errors.push({ harvest_id: hid, stage: 'digest', error: String(e.message || e).slice(0, 120) });
    }
  }
  // After digest, re-attribute other→thread coverage via the sanctioned migration seam.
  try {
    const campaign = require('./eiResearchCampaign');
    const state = campaign.loadState();
    campaign.migrateCampaignState(state);
    campaign.saveState(state);
    report.reattributed = Number((state._last_reattributed || 0));
  } catch (_) { /* optional — campaign may be unavailable in unit tests */ }
  return { ok: true, ...report };
}

module.exports = {
  digestItem,
  deepDigestItem,
  mergeDigests,
  sampleWindows,
  dedupeCap,
  loadNote,
  listNotes,
  notesForQuery,
  formatNotesBlock,
  getNotesContextForGoal,
  notePath,
  backfillCorpusLearning,
  paginateCorpusItems,
  DEEP_MIN_CHARS,
  WINDOW_CHARS,
};
