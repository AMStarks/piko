/**
 * Article drafts with corpus citations + verification.
 * Produces drafts only — operator reviews before anything is final.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot, getItem } = require('./culturesCorpusApi');
const { loadDossier, matchThreadId, notesForThread, THREAD_DEFS } = require('./eiThreadDossiers');
const { notesForQuery, loadNote } = require('./eiCorpusNotes');
const { searchCorpus } = require('./eiCorpusRag');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const {
  toLowerAsciiish,
  isLetterOrNumber,
  isAsciiDigit,
  isAsciiLetter,
  startsWithIgnoreCase,
  splitLines,
} = require('./text');

function slugify(topic) {
  const str = toLowerAsciiish(topic || 'article');
  let out = '';
  let prevDash = false;
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (isLetterOrNumber(ch)) {
      out += ch;
      prevDash = false;
    } else if (!prevDash && out.length) {
      out += '-';
      prevDash = true;
    }
  }
  while (out.startsWith('-')) out = out.slice(1);
  while (out.endsWith('-')) out = out.slice(0, -1);
  return out.slice(0, 60) || 'article';
}

/** Find [S123] citation tokens; returns [{id, start, end}] */
function findCitationSpans(text) {
  const str = String(text || '');
  const spans = [];
  for (let i = 0; i < str.length - 3; i++) {
    if (str[i] !== '[' || str[i + 1] !== 'S') continue;
    let j = i + 2;
    let digits = '';
    while (j < str.length && isAsciiDigit(str[j])) {
      digits += str[j];
      j += 1;
    }
    if (!digits || str[j] !== ']') continue;
    spans.push({ id: Number(digits), start: i, end: j + 1 });
    i = j;
  }
  return spans;
}

function stripCitationTokens(text) {
  const spans = findCitationSpans(text);
  if (!spans.length) return String(text || '');
  let out = '';
  let cursor = 0;
  for (const sp of spans) {
    out += text.slice(cursor, sp.start);
    cursor = sp.end;
  }
  out += text.slice(cursor);
  return out;
}

function replaceCitationId(text, id, repl) {
  const token = `[S${id}]`;
  return String(text || '').split(token).join(repl);
}

function splitSentences(text) {
  const str = String(text || '');
  const parts = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    cur += ch;
    if ((ch === '.' || ch === '!' || ch === '?') && i + 1 < str.length && (str[i + 1] === ' ' || str[i + 1] === '\n')) {
      parts.push(cur.trim());
      cur = '';
      while (i + 1 < str.length && (str[i + 1] === ' ' || str[i + 1] === '\n')) i += 1;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function stripSourcesSection(markdown) {
  const lines = splitLines(markdown);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (startsWithIgnoreCase(lines[i].trim(), '## Sources')) break;
    out.push(lines[i]);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

function sanitizeArticleSlug(slug) {
  const str = toLowerAsciiish(slug || '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '-') out += ch;
  }
  return out;
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

function articlesDir() {
  return path.join(culturesDataRoot(), 'articles');
}

function articleModel() {
  return (
    process.env.PIKO_EI_ARTICLE_MODEL
    || process.env.PIKO_EI_DIGEST_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

function yyyymmdd(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Extract citation tokens [S107] from markdown; return unique ids + sentence map.
 */
function extractCitations(markdown) {
  const text = String(markdown || '');
  const ids = new Set();
  const sentences = [];
  const parts = splitSentences(text);
  for (const part of parts) {
    const found = findCitationSpans(part).map((sp) => sp.id);
    if (!found.length) continue;
    for (const id of found) ids.add(id);
    sentences.push({
      text: part.trim(),
      source_ids: [...new Set(found)],
    });
  }
  return { ids: [...ids], sentences };
}

/**
 * Replace citations for not_found claims with [unverified].
 * details: [{ sentence, verdict, source_ids }]
 */
function applyVerification(markdown, details) {
  let out = String(markdown || '');
  let notFound = 0;
  let supported = 0;
  let partial = 0;
  for (const d of details || []) {
    const v = String(d.verdict || '').toLowerCase();
    if (v === 'supported') supported += 1;
    else if (v === 'partial') partial += 1;
    else if (v === 'not_found') {
      notFound += 1;
      const sentence = String(d.sentence || '');
      if (sentence && out.includes(sentence)) {
        let cleanedSentence = sentence;
        for (const sp of findCitationSpans(sentence)) {
          cleanedSentence = replaceCitationId(cleanedSentence, sp.id, '[unverified]');
        }
        out = out.split(sentence).join(cleanedSentence);
      } else {
        for (const id of d.source_ids || []) {
          out = replaceCitationId(out, id, '[unverified]');
        }
      }
    }
  }
  const total = supported + partial + notFound;
  const status = total > 0 && notFound / total > 0.2 ? 'needs_work' : 'draft';
  return {
    markdown: out,
    status,
    verification: { total, supported, partial, not_found: notFound, details: details || [] },
  };
}

function buildSourcesSection(sourceIds, resolveItem) {
  const resolver = resolveItem || ((id) => {
    try {
      const got = getItem(Number(id));
      return got && got.ok ? got.item : null;
    } catch (_) {
      return null;
    }
  });
  const lines = ['## Sources'];
  const sources = [];
  for (const id of sourceIds) {
    const item = resolver(Number(id));
    const title = (item && item.title) || `Corpus item #${id}`;
    const author = (item && item.meta && (item.meta.author || item.meta.work_author)) || '';
    lines.push(`- [S${id}] ${title}${author ? ` — ${author}` : ''}`);
    sources.push({ id: Number(id), title, author });
  }
  return { section: lines.join('\n'), sources };
}

function appendSourcesSection(markdown, sourceIds, resolveItem) {
  const body = stripSourcesSection(markdown);
  const { section, sources } = buildSourcesSection(sourceIds, resolveItem);
  return { markdown: `${body}\n\n${section}\n`, sources };
}

async function gatherSources(topic, opts = {}) {
  const thread = opts.thread || matchThreadId(topic);
  let dossier = thread ? loadDossier(thread) : null;
  const notes = [];
  const sourceIds = new Set();

  if (dossier) {
    for (const c of dossier.key_claims || []) {
      for (const id of c.source_ids || []) sourceIds.add(Number(id));
    }
    for (const id of dossier.note_ids || []) sourceIds.add(Number(id));
  } else {
    for (const n of notesForQuery(topic, { top: 10 })) {
      notes.push(n);
      if (n.harvest_id) sourceIds.add(Number(n.harvest_id));
    }
  }

  if (thread) {
    for (const n of notesForThread(thread, { limit: 20 })) {
      notes.push(n);
      if (n.harvest_id) sourceIds.add(Number(n.harvest_id));
    }
  }

  for (const id of [...sourceIds]) {
    const n = loadNote(id);
    if (n) notes.push(n);
  }

  let ragHits = [];
  try {
    ragHits = await searchCorpus(topic, { limit: opts.ragTop || 12 });
    for (const h of ragHits) {
      if (h.harvest_id) sourceIds.add(Number(h.harvest_id));
    }
  } catch (_) { /* optional */ }

  const uniqueNotes = [];
  const seen = new Set();
  for (const n of notes) {
    const id = Number(n.harvest_id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    uniqueNotes.push(n);
  }

  return {
    thread,
    dossier,
    notes: uniqueNotes,
    ragHits,
    sourceIds: [...sourceIds].filter((n) => Number.isFinite(n) && n > 0),
  };
}

function pushArticleGapLeads(topic, needed) {
  try {
    const campaign = require('./eiResearchCampaign');
    const state = campaign.loadState();
    let added = 0;
    for (const n of (needed || []).slice(0, 3)) {
      if (campaign.addLead(state, {
        title: n.title || topic,
        author: n.author || 'Unknown Author',
        thread: n.thread || matchThreadId(topic) || 'other',
        why: n.why || 'needed for article',
        source: 'article_gap',
      })) added += 1;
    }
    if (added) campaign.saveState(state);
    return added;
  } catch (_) {
    return 0;
  }
}

async function outlineArticle(topic, gather, chatFn) {
  const allowed = gather.sourceIds;
  const noteBlock = gather.notes.slice(0, 12).map((n) => (
    `ID ${n.harvest_id}: ${n.title || ''} — ${n.author || ''}\n  ${(n.summary || '').slice(0, 300)}\n  Claims: ${(n.claims || []).slice(0, 4).join('; ')}`
  )).join('\n\n');
  const dossierBlock = gather.dossier
    ? `DOSSIER SUMMARY:\n${gather.dossier.summary || ''}\nORTHODOX: ${gather.dossier.orthodox_view || ''}\nALTERNATIVE: ${gather.dossier.alternative_view || ''}`
    : '';
  const raw = await chatFn(articleModel(), [
    {
      role: 'system',
      content: `Create an article outline as JSON only:
{"title":"...","sections":[{"heading":"...","claims":[{"text":"...","source_ids":[107],"contested":false}]}]}
source_ids may ONLY be from the allowed list. Contested claims need both alternative and orthodox framing later.`,
    },
    {
      role: 'user',
      content: `TOPIC: ${topic}\nALLOWED IDS: ${allowed.join(', ')}\n\n${dossierBlock}\n\nNOTES:\n${noteBlock}`,
    },
  ], {
    format: 'json',
    temperature: 0.2,
    max_tokens: 1200,
    priority: 'background',
    lane: 'worker',
    tag: 'eiArticleWriter.outline',
  });
  try {
    return extractJsonObject(raw) || {};
  } catch (_) {
    return {};
  }
}

async function draftArticle(topic, outline, gather, chatFn) {
  const allowed = gather.sourceIds;
  const outlineText = JSON.stringify(outline).slice(0, 4000);
  const ragBlock = (gather.ragHits || []).slice(0, 8).map((h) => {
    let body = String(h.text || '');
    const lines = splitLines(body);
    let start = 0;
    if (startsWithIgnoreCase(lines[0] || '', 'Title:')) start = 1;
    if (startsWithIgnoreCase(lines[start] || '', 'Author:')) start += 1;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    body = lines.slice(start).join('\n');
    return `[S${h.harvest_id}] ${body.slice(0, 400)}`;
  }).join('\n\n');
  const raw = await chatFn(articleModel(), [
    {
      role: 'system',
      content: `Write a clear, honest research article in markdown (800-1500 words).
Rules:
- Every factual sentence MUST end with a citation token like [S107] using ONLY these ids: ${allowed.join(', ')}.
- Contested claims must present the alternative view AND the orthodox/mainstream view with attribution.
- No claims without a source. Measured tone, no sensationalism.
- Do NOT invent a ## Sources section (code will append it).
- Do not invent titles, authors, or facts beyond the provided material.`,
    },
    {
      role: 'user',
      content: `TOPIC: ${topic}\nTITLE: ${outline.title || topic}\nOUTLINE:\n${outlineText}\n\nPASSAGES:\n${ragBlock || '(use notes from outline)'}`,
    },
  ], {
    temperature: 0.3,
    max_tokens: 2500,
    priority: 'background',
    lane: 'worker',
    tag: 'eiArticleWriter.draft',
  });
  return String(raw || '').trim();
}

async function verifyClaims(markdown, chatFn, searchFn) {
  const { sentences } = extractCitations(markdown);
  const details = [];
  const batchSize = 8;
  for (let i = 0; i < sentences.length; i += batchSize) {
    const batch = sentences.slice(i, i + batchSize);
    const evidence = [];
    for (const s of batch) {
      const id = s.source_ids[0];
      let hits = [];
      try {
        hits = await searchFn(stripCitationTokens(s.text).trim(), { limit: 3 });
      } catch (_) { hits = []; }
      const filtered = (hits || []).filter((h) => Number(h.harvest_id) === Number(id));
      const chunk = (filtered[0] || hits[0] || {}).text || '';
      evidence.push({
        sentence: s.text,
        source_ids: s.source_ids,
        chunk: String(chunk).slice(0, 500),
      });
    }
    const raw = await chatFn(articleModel(), [
      {
        role: 'system',
        content: `Judge whether each sentence is supported by its chunk. Return JSON:
{"judgments":[{"i":0,"verdict":"supported|partial|not_found"}]}
supported = chunk clearly backs the claim; partial = related but weak; not_found = unsupported.`,
      },
      {
        role: 'user',
        content: evidence.map((e, idx) => (
          `#${idx}\nSENTENCE: ${e.sentence}\nCHUNK: ${e.chunk || '(empty)'}`
        )).join('\n\n'),
      },
    ], {
      format: 'json',
      temperature: 0,
      max_tokens: 600,
      priority: 'background',
      lane: 'worker',
      tag: 'eiArticleWriter.verify',
    });
    let judgments = [];
    try {
      const parsed = extractJsonObject(raw) || {};
      judgments = Array.isArray(parsed.judgments) ? parsed.judgments : [];
    } catch (_) { judgments = []; }
    for (let j = 0; j < evidence.length; j++) {
      const jg = judgments.find((x) => Number(x.i) === j) || judgments[j] || {};
      let verdict = String(jg.verdict || 'not_found').toLowerCase();
      if (!['supported', 'partial', 'not_found'].includes(verdict)) verdict = 'not_found';
      if (!evidence[j].chunk) verdict = 'not_found';
      details.push({
        sentence: evidence[j].sentence,
        source_ids: evidence[j].source_ids,
        verdict,
      });
    }
  }
  return applyVerification(markdown, details);
}

/**
 * Full article pipeline.
 * @param {string} topic
 * @param {{ thread?: string, chatFn?: Function, searchFn?: Function, rootDir?: string }} opts
 */
async function writeArticle(topic, opts = {}) {
  const t = String(topic || '').trim();
  if (!t) return { ok: false, error: 'topic_required' };
  const chatFn = opts.chatFn || ollamaNativeChat;
  const searchFn = opts.searchFn || searchCorpus;

  const gather = await gatherSources(t, { thread: opts.thread });
  if (gather.sourceIds.length < 3) {
    const needed = (gather.dossier && gather.dossier.wanted_sources) || [
      { title: t, author: 'Primary Source', why: 'insufficient corpus for article', thread: gather.thread },
    ];
    const gapAdded = pushArticleGapLeads(t, needed.map((n) => ({ ...n, thread: gather.thread })));
    return {
      ok: false,
      error: 'insufficient_sources',
      source_count: gather.sourceIds.length,
      needed,
      article_gap_added: gapAdded,
      thread: gather.thread,
    };
  }

  const outline = await outlineArticle(t, gather, chatFn);
  let draft = await draftArticle(t, outline, gather, chatFn);
  if (!draft) return { ok: false, error: 'draft_empty', thread: gather.thread };

  const verified = await verifyClaims(draft, chatFn, searchFn);
  const cited = extractCitations(verified.markdown).ids;
  const useIds = cited.length ? cited : gather.sourceIds.slice(0, 8);
  const withSources = appendSourcesSection(verified.markdown, useIds);

  // Unverified claims → article_gap leads
  const unverified = (verified.verification.details || [])
    .filter((d) => d.verdict === 'not_found')
    .slice(0, 3)
    .map((d) => ({
      title: t,
      author: 'Supporting Source',
      why: `Unverified claim: ${String(d.sentence || '').slice(0, 120)}`,
      thread: gather.thread || 'other',
    }));
  if (unverified.length) pushArticleGapLeads(t, unverified);

  const slug = `${slugify(t)}-${yyyymmdd()}`;
  const meta = {
    slug,
    topic: t,
    thread: gather.thread || null,
    title: outline.title || t,
    status: verified.status,
    created_at: new Date().toISOString(),
    sources: withSources.sources,
    verification: verified.verification,
  };

  fs.mkdirSync(articlesDir(), { recursive: true });
  fs.writeFileSync(path.join(articlesDir(), `${slug}.md`), withSources.markdown);
  fs.writeFileSync(path.join(articlesDir(), `${slug}.json`), JSON.stringify(meta, null, 2));

  try {
    const { recordNotification } = require('./notificationFeed');
    const v = verified.verification;
    recordNotification({
      category: 'system',
      title: 'EI article draft',
      text: `EI article draft ready: ${t} (verified ${v.supported}/${v.total} claims; status=${verified.status})`,
      severity: verified.status === 'needs_work' ? 'warn' : 'info',
      source: 'eiArticleWriter',
      meta: { slug, thread: gather.thread },
    });
  } catch (_) { /* optional */ }

  return {
    ok: true,
    slug,
    status: verified.status,
    path: path.join(articlesDir(), `${slug}.md`),
    meta,
    markdown: withSources.markdown,
  };
}

function listArticles() {
  const dir = articlesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function loadArticle(slug) {
  const s = sanitizeArticleSlug(slug);
  if (!s) return null;
  const metaPath = path.join(articlesDir(), `${s}.json`);
  const mdPath = path.join(articlesDir(), `${s}.md`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
    return { meta, markdown };
  } catch (_) {
    return null;
  }
}

/**
 * Campaign cadence: enqueue one article_write when a thread is ripe.
 */
function maybeEnqueueAutoArticle(state, opts = {}) {
  // Default OFF — operator prompts when to write; intake/learning stay autonomous.
  if (!envFlagOn('PIKO_EI_ARTICLE_AUTO', false)) {
    return { enqueued: false, reason: 'disabled' };
  }
  const minH = Math.max(1, Number(process.env.PIKO_EI_ARTICLE_MIN_INTERVAL_H) || 24);
  if (state.last_article_at) {
    const ageH = (Date.now() - new Date(state.last_article_at).getTime()) / 3600000;
    if (ageH < minH) return { enqueued: false, reason: 'interval' };
  }
  const articles = listArticles();
  for (const def of THREAD_DEFS) {
    const cov = (state.thread_coverage || {})[def.id] || {};
    if ((cov.keeps || 0) < 3) continue;
    const dossier = loadDossier(def.id);
    if (!dossier) continue;
    const existing = articles.filter((a) => a.thread === def.id);
    if (existing.length) {
      const last = existing[0];
      const lastNotes = Number(last.dossier_note_count || 0);
      if (Number(dossier.note_count || 0) - lastNotes < 3) continue;
    }
    try {
      const { enqueueAgentJob } = require('./agentOrchestrator');
      const queued = enqueueAgentJob('article_write', {
        topic: def.label,
        thread: def.id,
        source: 'campaign_auto',
      }, { rootDir: opts.rootDir });
      if (queued.ok) {
        state.last_article_at = new Date().toISOString();
        return { enqueued: true, thread: def.id, job: queued.job || null };
      }
      return { enqueued: false, reason: queued.error || 'enqueue_failed' };
    } catch (e) {
      return { enqueued: false, reason: String(e.message || e).slice(0, 120) };
    }
  }
  return { enqueued: false, reason: 'no_ripe_thread' };
}

module.exports = {
  writeArticle,
  listArticles,
  loadArticle,
  extractCitations,
  applyVerification,
  buildSourcesSection,
  appendSourcesSection,
  gatherSources,
  maybeEnqueueAutoArticle,
  articlesDir,
  slugify,
};
