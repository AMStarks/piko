/**
 * Thread dossiers — Piko's current expert position per research thread,
 * synthesized from corpus notes with source-id traceability.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot } = require('./culturesCorpusApi');
const { listNotes } = require('./eiCorpusNotes');
const { normalizeTitle } = require('./eiGoalParse');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { aliasMatch, collapseWhitespace, toLowerAsciiish, extractAlnumTokens } = require('./text');
const {
  getOntologyPack,
  getThreadDefs,
  resetOntologyCache,
  resolveThreadAliasFromDefs,
} = require('./ontologyPack');

const DEFAULT_THREAD_DEFS = [
  {
    id: 'giza',
    label: 'Giza / precision engineering',
    // NOTE: osireion/oserion belong to abydos — never alias them here (WP11 hotfix).
    aliases: ['giza', 'gizeh', 'great pyramid', 'khufu', 'sphinx'],
  },
  {
    id: 'abydos',
    label: 'Abydos / Oserion',
    // Avoid bare "seti" (fires inside unrelated phrases) — use seti i / seti temple.
    aliases: [
      'abydos', 'oserion', 'osireion', 'osiris temple', 'temenos of osiris',
      'umm el-qaab', 'umm el qaab', 'seti i', 'seti temple',
    ],
  },
  {
    id: 'gobekli-tepe',
    label: 'Göbekli Tepe',
    aliases: ['gobekli', 'göbekli', 'karahan', 'tas tepeler', 'taș tepeler'],
  },
  {
    id: 'tiahuanaco',
    label: 'Tiahuanaco / Puma Punku',
    // Drop bare "anden" (substring/short-alias landmine).
    aliases: ['tiahuanaco', 'tiwanaku', 'puma punku', 'pumapunku', 'andine'],
  },
  {
    id: 'cataclysm',
    label: 'Younger Dryas / megafloods',
    aliases: [
      'cataclysm', 'younger dryas', 'scabland', 'channeled scabland',
      'megaflood', 'meltwater', 'firestone', 'bretz',
    ],
  },
  {
    id: 'flood-myths',
    label: 'Flood myths / comparative deluge literature',
    // Exclusive: atlantis/antediluvian/donnelly belong to the atlantis thread.
    // No bare "flood" — "flood insurance" must not match.
    aliases: [
      'flood myth', 'flood myths', 'great flood', 'the deluge', 'deluge myth',
      'timaeus', 'critias', 'popol vuh', 'gilgamesh', 'atrahasis',
    ],
  },
  {
    id: 'atlantis',
    label: 'Atlantis / antediluvian',
    // No bare "plato" — "Plato on justice" must not route here.
    aliases: ['atlantis', 'antediluvian', 'atlantean', 'donnelly', 'plato atlantis'],
  },
];

/** Short single-token aliases only match near-exact topic queries (≤3 tokens). */
const SHORT_ALIAS_MAX = 5;

function webchatRootDir() {
  return path.join(__dirname, '..');
}

function activeThreadDefs() {
  return getThreadDefs(webchatRootDir()) || DEFAULT_THREAD_DEFS;
}

function activeAliasMap() {
  const pack = getOntologyPack(webchatRootDir());
  return (pack && pack.aliases) || null;
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

function dossiersDir() {
  return path.join(culturesDataRoot(), 'dossiers');
}

function dossierPath(threadId) {
  return path.join(dossiersDir(), `${String(threadId)}.json`);
}

function getThreadDef(threadId) {
  const id = String(threadId || '').trim().toLowerCase();
  return activeThreadDefs().find((t) => t.id === id) || null;
}

/**
 * Exact alias / id resolution for planner+tool args ("osireion" → abydos).
 * Does NOT fuzzy-match topics — invented ids like "atlantis-moonbase" stay unknown.
 */
function resolveThreadAlias(input) {
  return resolveThreadAliasFromDefs(input, activeThreadDefs(), activeAliasMap());
}

function matchThreadId(topic) {
  const blob = collapseWhitespace(toLowerAsciiish(normalizeTitle(topic || '')));
  if (!blob) return null;
  // Exact thread id wins.
  if (getThreadDef(blob)) return blob;

  const tokens = extractAlnumTokens(blob);
  const tokenCount = tokens.length;
  let best = null;
  let bestScore = 0;

  for (const t of activeThreadDefs()) {
    let score = 0;
    for (const a of t.aliases) {
      const na = collapseWhitespace(toLowerAsciiish(normalizeTitle(a)));
      if (!na) continue;
      if (!aliasMatch(blob, na)) continue;
      const isShortSingle = !na.includes(' ') && na.length <= SHORT_ALIAS_MAX;
      if (isShortSingle && tokenCount > 3) continue;
      // Prefer longer / multi-word aliases.
      score += na.length + (na.includes(' ') ? 4 : 0);
    }
    // Tie-break: prefer the thread whose id appears in the blob.
    if (aliasMatch(blob, t.id)) score += t.id.length + 2;
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  return bestScore > 0 ? best : null;
}

function notesForThread(threadId, opts = {}) {
  const def = getThreadDef(threadId);
  if (!def) return [];
  const aliases = def.aliases.map((a) => normalizeTitle(a)).filter(Boolean);
  const notes = listNotes(opts.limit || 100);
  return notes.filter((n) => {
    const blob = normalizeTitle([
      n.title, n.author, n.summary,
      ...(n.claims || []), ...(n.people || []), ...(n.sites || []),
      ...(n.open_questions || []),
    ].join(' '));
    return aliases.some((a) => a && blob.includes(a));
  });
}

function dossierModel() {
  return (
    process.env.PIKO_EI_DOSSIER_MODEL
    || process.env.PIKO_EI_DIGEST_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

/**
 * Drop claims whose source_ids are not in the allowed set; cap lists.
 */
function postProcessDossier(parsed, allowedIds, threadId) {
  const allowed = new Set((allowedIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0));
  const claims = [];
  for (const c of Array.isArray(parsed.key_claims) ? parsed.key_claims : []) {
    if (!c || typeof c !== 'object') continue;
    const claim = String(c.claim || '').trim();
    if (!claim) continue;
    const ids = (Array.isArray(c.source_ids) ? c.source_ids : [])
      .map(Number)
      .filter((id) => allowed.has(id));
    if (!ids.length) continue;
    let stance = String(c.stance || 'both').toLowerCase();
    if (!['alternative', 'orthodox', 'both'].includes(stance)) stance = 'both';
    let status = String(c.status || (ids.length > 1 ? 'multi-source' : 'single-source')).toLowerCase();
    if (!['multi-source', 'single-source', 'contested'].includes(status)) {
      status = ids.length > 1 ? 'multi-source' : 'single-source';
    }
    claims.push({ claim: claim.slice(0, 400), source_ids: ids.slice(0, 6), stance, status });
    if (claims.length >= 12) break;
  }
  const wanted = [];
  for (const w of Array.isArray(parsed.wanted_sources) ? parsed.wanted_sources : []) {
    if (!w || typeof w !== 'object') continue;
    const title = String(w.title || '').trim();
    const author = String(w.author || '').trim();
    if (!title || !author) continue;
    wanted.push({
      title: title.slice(0, 200),
      author: author.slice(0, 120),
      why: String(w.why || '').slice(0, 240),
    });
    if (wanted.length >= 5) break;
  }
  const gaps = (Array.isArray(parsed.evidence_gaps) ? parsed.evidence_gaps : [])
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    thread: threadId,
    summary: String(parsed.summary || '').slice(0, 2000),
    key_claims: claims,
    orthodox_view: String(parsed.orthodox_view || '').slice(0, 1200),
    alternative_view: String(parsed.alternative_view || '').slice(0, 1200),
    evidence_gaps: gaps,
    wanted_sources: wanted,
  };
}

async function buildDossier(threadId, opts = {}) {
  const def = getThreadDef(threadId);
  if (!def) return { ok: false, error: 'unknown_thread', thread: threadId };
  const notes = notesForThread(threadId, { limit: 100 }).slice(0, opts.maxNotes || 15);
  if (!notes.length) {
    return { ok: false, error: 'no_notes', thread: threadId };
  }
  const allowedIds = notes.map((n) => Number(n.harvest_id)).filter((n) => Number.isFinite(n));
  const noteBlock = notes.map((n) => {
    return [
      `ID ${n.harvest_id}: ${n.title || 'untitled'}${n.author ? ` — ${n.author}` : ''}`,
      n.summary ? `  Summary: ${n.summary}` : '',
      (n.claims || []).length ? `  Claims: ${n.claims.slice(0, 5).join('; ')}` : '',
      (n.open_questions || []).length ? `  Open: ${n.open_questions.slice(0, 3).join('; ')}` : '',
      (n.disagreements || []).length ? `  Disagreements: ${n.disagreements.slice(0, 2).join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const chatFn = opts.chatFn || ollamaNativeChat;
  const raw = await chatFn(dossierModel(), [
    {
      role: 'system',
      content: `You synthesize an expert research dossier from corpus notes for one thread.
Return JSON only with this shape:
{"summary":"5-8 sentences","key_claims":[{"claim":"...","source_ids":[107],"stance":"alternative|orthodox|both","status":"multi-source|single-source|contested"}],"orthodox_view":"...","alternative_view":"...","evidence_gaps":["..."],"wanted_sources":[{"title":"...","author":"...","why":"..."}]}
Rules: source_ids may ONLY be harvest ids from the notes provided (listed as ID N). Drop any claim you cannot cite. Cap key_claims at 12, evidence_gaps at 6, wanted_sources at 5. Be honest about contested claims.`,
    },
    {
      role: 'user',
      content: `THREAD: ${def.id} — ${def.label}\nALLOWED SOURCE IDS: ${allowedIds.join(', ')}\n\nNOTES:\n${noteBlock}`,
    },
  ], {
    format: 'json',
    temperature: 0.2,
    max_tokens: 1400,
    priority: 'background',
    lane: 'worker',
    tag: 'eiThreadDossiers',
  });

  let parsed = {};
  try {
    parsed = extractJsonObject(raw) || {};
  } catch (_) {
    parsed = {};
  }
  const body = postProcessDossier(parsed, allowedIds, def.id);
  const dossier = {
    ...body,
    note_count: notes.length,
    note_ids: allowedIds,
    built_at: new Date().toISOString(),
  };
  fs.mkdirSync(dossiersDir(), { recursive: true });
  fs.writeFileSync(dossierPath(def.id), JSON.stringify(dossier, null, 2));
  return { ok: true, dossier };
}

function loadDossier(threadId) {
  const p = dossierPath(threadId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listDossiers() {
  const dir = dossiersDir();
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
    .filter(Boolean);
}

function dossierIsStale(threadId) {
  const d = loadDossier(threadId);
  if (!d) return true;
  const notes = notesForThread(threadId, { limit: 100 });
  return notes.length !== Number(d.note_count || 0);
}

/**
 * Rebuild stale dossiers, max 2 per call (LLM cost).
 */
async function refreshDossiers(opts = {}) {
  if (!envFlagOn('PIKO_EI_DOSSIERS', true)) {
    return { ok: true, skipped: 'dossiers_disabled', rebuilt: [] };
  }
  const max = Math.max(1, Math.min(5, Number(opts.max) || 2));
  const rebuilt = [];
  const skipped = [];
  for (const def of activeThreadDefs()) {
    if (rebuilt.length >= max) break;
    const notes = notesForThread(def.id, { limit: 100 });
    if (!notes.length) {
      skipped.push({ thread: def.id, reason: 'no_notes' });
      continue;
    }
    if (!dossierIsStale(def.id) && !opts.force) {
      skipped.push({ thread: def.id, reason: 'fresh' });
      continue;
    }
    try {
      const out = await buildDossier(def.id, opts);
      if (out.ok) rebuilt.push(def.id);
      else skipped.push({ thread: def.id, reason: out.error || 'failed' });
    } catch (e) {
      skipped.push({ thread: def.id, reason: String(e.message || e).slice(0, 120) });
    }
  }
  return { ok: true, rebuilt, skipped };
}

/** Compact gap block for reflection prompts. */
function formatDossierGapsBlock() {
  const dossiers = listDossiers();
  if (!dossiers.length) return '';
  const lines = ['EVIDENCE GAPS (from expert dossiers):'];
  for (const d of dossiers) {
    const gaps = (d.evidence_gaps || []).slice(0, 3);
    const wanted = (d.wanted_sources || []).slice(0, 3)
      .map((w) => `"${w.title}" ${w.author}`)
      .filter(Boolean);
    if (!gaps.length && !wanted.length) continue;
    lines.push(`\n[${d.thread}]`);
    for (const g of gaps) lines.push(`  gap: ${g}`);
    for (const w of wanted) lines.push(`  wanted: ${w}`);
  }
  return lines.length > 1 ? lines.join('\n').slice(0, 2500) : '';
}

/**
 * Enqueue up to `max` wanted_sources from dossiers as campaign leads.
 * WP7.4: optional `filter(lead)` runs before the cap so cooled entries don't
 * permanently shadow fresh ones behind a small max.
 * @param {number} [max=2]
 * @param {{ filter?: (lead: object) => boolean }} [opts]
 */
function dossierWantedLeads(max = 2, opts = {}) {
  const limit = Math.max(0, Number(max) || 0);
  const filter = typeof opts.filter === 'function' ? opts.filter : null;
  const out = [];
  for (const d of listDossiers()) {
    for (const w of d.wanted_sources || []) {
      if (!w.title || !w.author) continue;
      const lead = {
        title: w.title,
        author: w.author,
        thread: d.thread,
        why: w.why || 'dossier evidence gap',
        source: 'dossier_gap',
        query: `"${w.title}" ${w.author} PDF`,
      };
      if (filter && !filter(lead)) continue;
      out.push(lead);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

module.exports = {
  get THREAD_DEFS() {
    return activeThreadDefs();
  },
  DEFAULT_THREAD_DEFS,
  activeThreadDefs,
  notesForThread,
  buildDossier,
  postProcessDossier,
  loadDossier,
  listDossiers,
  dossierIsStale,
  refreshDossiers,
  formatDossierGapsBlock,
  dossierWantedLeads,
  matchThreadId,
  resolveThreadAlias,
  getThreadDef,
  dossiersDir,
  envFlagOn,
  resetOntologyCache,
};
