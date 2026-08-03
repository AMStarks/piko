/**
 * Legate answer-mode lookups — local tools, not a classifier router.
 * Legate decides which lookups to run; we execute them against corpus/jobs/campaign.
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./agentRegistry');
const {
  endsWithAny,
  toLowerAsciiish,
  extractDigitRuns,
  includesAny,
} = require('./text');

const LOOKUP_IDS = new Set(['authors', 'stats', 'jobs', 'campaign', 'learning', 'activity', 'scorecard']);

let _stateBlockCache = { at: 0, text: '' };
const STATE_BLOCK_TTL_MS = 30_000;

function bustCampaignStateBlockCache() {
  _stateBlockCache = { at: 0, text: '' };
}

function culturesDbPath() {
  const root = String(
    process.env.EGYPTIAN_INSIGHTS_DATA_DIR
    || process.env.PIKO_EGYPTIAN_DATA_DIR
    || process.env.PIKO_EGYPTIAN_DATA
    || '',
  ).trim()
    || path.join(path.dirname(dataDir()), 'egyptian-insights');
  const candidates = [
    path.join(root, 'cultures_cache.sqlite'),
    path.join(dataDir(), '..', 'egyptian-insights', 'cultures_cache.sqlite'),
    '/home/chief/data/egyptian-insights/cultures_cache.sqlite',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function culturesDataRoot() {
  return path.dirname(culturesDbPath());
}

function loadFlagsMap() {
  const flagCandidates = [
    path.join(culturesDataRoot(), 'corpus_flags.json'),
    path.join(dataDir(), 'egyptian-insights', 'corpus_flags.json'),
  ];
  for (const p of flagCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return raw.items && typeof raw.items === 'object' ? raw.items : raw;
    } catch (_) {}
  }
  return {};
}

function normalizeAuthor(value) {
  return require('./corpusAuthorMeta').normalizeAuthor(value);
}

function authorsFromRow(title, meta) {
  return require('./corpusAuthorMeta').extractAuthors(title, meta);
}

function listCorpusAuthors(opts = {}) {
  const Database = require('better-sqlite3');
  const dbPath = culturesDbPath();
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: `cultures_cache not found at ${dbPath}`, authors: [], kept_items: 0 };
  }
  const flags = loadFlagsMap();
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare('SELECT id, title, meta_json FROM harvest_items').all();
    const counts = new Map();
    let kept = 0;
    let dropped = 0;
    for (const r of rows) {
      const fl = (flags[String(r.id)] || flags[r.id] || {}).flag;
      if (fl === 'drop') {
        dropped += 1;
        continue;
      }
      kept += 1;
      let meta = {};
      try { meta = JSON.parse(r.meta_json || '{}'); } catch (_) { meta = {}; }
      const authors = authorsFromRow(r.title, meta);
      if (!authors.length) {
        counts.set('(no author metadata)', (counts.get('(no author metadata)') || 0) + 1);
        continue;
      }
      for (const a of authors) {
        counts.set(a, (counts.get(a) || 0) + 1);
      }
    }
    const authors = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name.startsWith('(')) return 1;
        if (b.name.startsWith('(')) return -1;
        return b.count - a.count || a.name.localeCompare(b.name);
      });
    return {
      ok: true,
      db_path: dbPath,
      kept_items: kept,
      dropped_items: dropped,
      authors,
      named_authors: authors.filter((a) => !a.name.startsWith('(')),
    };
  } finally {
    db.close();
  }
}

function corpusStats() {
  try {
    const { getStats } = require('./culturesCorpusApi');
    const s = getStats();
    return {
      ok: !!s.ok,
      harvest_items: s.harvest_items,
      transcriptions: s.transcriptions,
      critiques: s.critiques,
      by_kind: s.by_kind || {},
      by_source: s.by_source || {},
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function agentJobsStatus(opts = {}) {
  try {
    const { getAgentStatus } = require('./agentOrchestrator');
    const st = getAgentStatus({ rootDir: opts.rootDir, limit: opts.limit || 20 });
    const active = (st.jobs || []).map((j) => {
      const p = j.payload || {};
      return {
        id: j.id,
        status: j.status,
        type: j.type,
        agent_id: p.agent_id || null,
        brief: String(p.brief || p.goal || '').slice(0, 120),
      };
    });
    return {
      ok: true,
      orch_enabled: !!st.orch_enabled,
      counts: st.counts || {},
      active,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function campaignStatusLookup() {
  try {
    const { getCampaignStatus } = require('./eiResearchCampaign');
    const out = getCampaignStatus();
    const st = out.status || null;
    // Plain-English state line — small models misread raw booleans
    // (e.g. `paused: false` becomes "the campaign is paused").
    let stateSummary = null;
    if (st) {
      if (!st.enabled) stateSummary = 'STOPPED — the campaign is not running.';
      else if (st.paused) stateSummary = 'PAUSED — the campaign is temporarily paused.';
      else stateSummary = `ACTIVE — the campaign is running normally (not paused)${st.mode && String(st.mode).includes('idle') ? ', currently idle between finds' : ''}.`;
    }
    return { ok: !!out.ok, state_summary: stateSummary, status: st };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function ragChunkCountBestEffort() {
  try {
    const { memoryDir } = require('./eiCorpusRag');
    const dir = memoryDir();
    if (!fs.existsSync(dir)) return 0;
    // Best-effort without opening LanceDB / loading the embedder.
    let n = 0;
    const walk = (d, depth) => {
      if (depth > 4 || n > 50000) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const ent of entries) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p, depth + 1);
        else if (endsWithAny(toLowerAsciiish(ent.name), ['.lance', '.bin', '.idx', '.manifest']) || ent.name === 'data.lance') n += 1;
      }
    };
    walk(dir, 0);
    return n;
  } catch (_) {
    return null;
  }
}

function learningStatusLookup() {
  try {
    const { getCampaignStatus, getLearningScorecard } = require('./eiResearchCampaign');
    const st = (getCampaignStatus().status) || {};
    let recentNotes = [];
    try {
      const { listNotes } = require('./eiCorpusNotes');
      // Include substance (summary, open questions), not just titles — the
      // synthesis pass can only talk about what it is given.
      recentNotes = listNotes(6).map((n) => ({
        title: String(n.title || n.work_title || 'untitled').slice(0, 120),
        author: n.author || null,
        summary: n.summary ? String(n.summary).slice(0, 320) : null,
        open_questions: Array.isArray(n.open_questions)
          ? n.open_questions.slice(0, 2).map((q) => String(q).slice(0, 160))
          : [],
        disagreements: Array.isArray(n.disagreements)
          ? n.disagreements.slice(0, 1).map((d) => String(d).slice(0, 160))
          : [],
      }));
    } catch (_) { /* optional */ }
    let scorecard = null;
    try { scorecard = getLearningScorecard(); } catch (_) { /* optional */ }
    let improvement_outcomes = null;
    try {
      improvement_outcomes = require('./eiOutcomeLedger').outcomeSummaryForLookup(8);
    } catch (_) { /* optional */ }
    return {
      ok: true,
      notes_count: st.notes_count || 0,
      dossiers: st.dossiers || { count: 0, stale: 0 },
      articles: st.articles || { count: 0 },
      expertise: st.expertise || {},
      recent_notes: recentNotes,
      rag_files_approx: ragChunkCountBestEffort(),
      scorecard,
      improvement_outcomes,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function scorecardLookup() {
  try {
    const { getLearningScorecard } = require('./eiResearchCampaign');
    const card = getLearningScorecard();
    let improvement_outcomes = null;
    try {
      improvement_outcomes = require('./eiOutcomeLedger').outcomeSummaryForLookup(8);
    } catch (_) { /* optional */ }
    if (card && typeof card === 'object') {
      return { ...card, improvement_outcomes };
    }
    return card;
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function recentActivityLookup() {
  const cycles = [];
  try {
    const p = path.join(culturesDataRoot(), 'campaign_cycles.jsonl');
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-5);
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          cycles.push({
            ts: row.ts || row.at || null,
            cycle: row.cycle ?? row.cycle_count ?? null,
            seeks: row.seeks ?? (Array.isArray(row.seeks) ? row.seeks.length : null),
            keeps: row.keeps ?? null,
            leads_added: row.leads_added ?? null,
            idle: row.idle ?? null,
          });
        } catch (_) { /* skip bad line */ }
      }
    }
  } catch (_) { /* optional */ }

  const kept = [];
  try {
    const { loadState } = require('./eiResearchCampaign');
    const { getItem } = require('./culturesCorpusApi');
    const state = loadState();
    const reps = Array.isArray(state.reports) ? state.reports : [];
    const ids = [];
    for (let i = reps.length - 1; i >= 0 && ids.length < 5; i -= 1) {
      const keeps = reps[i].keeps || [];
      for (let j = keeps.length - 1; j >= 0 && ids.length < 5; j -= 1) {
        const id = keeps[j];
        if (id != null && !ids.includes(id)) ids.push(id);
      }
    }
    for (const id of ids.slice(0, 5)) {
      try {
        const item = getItem(id);
        const row = item && (item.item || item);
        if (row && (row.title || row.id != null)) {
          kept.push({
            id,
            title: String(row.title || 'untitled').slice(0, 120),
            source: row.source || null,
          });
        } else {
          kept.push({ id, title: `item #${id}`, source: null });
        }
      } catch (_) {
        kept.push({ id, title: `item #${id}`, source: null });
      }
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e), cycles, kept_items: kept };
  }
  return { ok: true, cycles, kept_items: kept };
}

/**
 * Compact 6–8 line ground-truth block for the decide prompt / fall-through brain.
 * Cached 30s — cheap status asks should not re-hit disk every turn.
 */
function buildCampaignStateBlock(opts = {}) {
  const force = opts.force === true;
  const now = Date.now();
  if (!force && _stateBlockCache.text && (now - _stateBlockCache.at) < STATE_BLOCK_TTL_MS) {
    return _stateBlockCache.text;
  }
  let text = '';
  try {
    const { getCampaignStatus } = require('./eiResearchCampaign');
    const s = (getCampaignStatus().status) || {};
    const mode = s.enabled ? (s.paused ? 'PAUSED' : 'ACTIVE') : 'stopped';
    const h = s.last_24h || {};
    const lines = [
      'LIVE RESEARCH STATE (ground truth — do not invent numbers outside this):',
      `Campaign: ${mode}`
        + (s.mode ? ` · mode=${s.mode}` : '')
        + ` · cycles=${s.cycle_count || 0}`
        + ` · keeps=${(s.stats && s.stats.keeps) || 0}`
        + ` · pending_leads=${s.pending_leads || 0}`,
      `Last 24h: cycles=${h.cycles || 0} · seeks=${h.seeks || 0}`
        + ` · keeps=${h.keeps || 0} · leads_added=${h.leads_added || 0}`
        + ` · idle=${h.idle_pct != null ? h.idle_pct : 0}%`,
      `Learning: notes=${s.notes_count || 0}`
        + ` · dossiers=${(s.dossiers && s.dossiers.count) || 0}`
        + `${(s.dossiers && s.dossiers.stale) ? ` (${s.dossiers.stale} stale)` : ''}`
        + ` · articles=${(s.articles && s.articles.count) || 0}`,
    ];
    if (s.next_cycle_due && s.enabled && !s.paused) {
      lines.push(`Next cycle due: ${s.next_cycle_due}`);
    }
    try {
      const stats = corpusStats();
      if (stats.ok) {
        lines.push(
          `Corpus: ${stats.harvest_items || 0} harvest items`
            + ` · ${stats.transcriptions || 0} transcriptions`
            + ` · ${stats.critiques || 0} critiques`,
        );
      }
    } catch (_) { /* optional */ }
    text = lines.join('\n');
  } catch (e) {
    text = `LIVE RESEARCH STATE: unavailable (${e.message || e})`;
  }
  _stateBlockCache = { at: now, text };
  return text;
}

function normalizeLookups(raw) {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const out = [];
  for (const item of list) {
    const id = String(item || '').toLowerCase().trim();
    if (LOOKUP_IDS.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function runLookups(lookups, opts = {}) {
  const ids = normalizeLookups(lookups);
  const result = { lookups: ids };
  for (const id of ids) {
    if (id === 'authors') result.authors = listCorpusAuthors(opts);
    else if (id === 'stats') result.stats = corpusStats(opts);
    else if (id === 'jobs') result.jobs = agentJobsStatus(opts);
    else if (id === 'campaign') result.campaign = campaignStatusLookup(opts);
    else if (id === 'learning') result.learning = learningStatusLookup(opts);
    else if (id === 'activity') result.activity = recentActivityLookup(opts);
    else if (id === 'scorecard') result.scorecard = scorecardLookup(opts);
  }
  return result;
}

function formatLookupReply(preface, data) {
  const lines = [];
  const intro = String(preface || '').trim();
  const introLow = toLowerAsciiish(intro);
  if (intro && introLow !== 'got it' && introLow !== 'got it.') lines.push(intro);

  if (data.campaign && data.campaign.ok && data.campaign.status) {
    try {
      const { formatCampaignStatus } = require('./eiResearchCampaign');
      lines.push(formatCampaignStatus(data.campaign.status));
    } catch (_) {
      const s = data.campaign.status;
      lines.push(
        `Research campaign: ${s.enabled ? (s.paused ? 'PAUSED' : 'ACTIVE') : 'stopped'}`
          + ` · cycles=${s.cycle_count || 0} · keeps=${(s.stats && s.stats.keeps) || 0}`,
      );
    }
  } else if (data.campaign && !data.campaign.ok) {
    lines.push(`Could not read campaign: ${data.campaign.error || 'unknown error'}`);
  }

  if (data.learning && data.learning.ok) {
    const L = data.learning;
    lines.push(
      `Learning: notes=${L.notes_count || 0}`
        + ` · dossiers=${(L.dossiers && L.dossiers.count) || 0}`
        + `${(L.dossiers && L.dossiers.stale) ? ` (${L.dossiers.stale} stale)` : ''}`
        + ` · articles=${(L.articles && L.articles.count) || 0}`
        + (L.rag_files_approx != null ? ` · rag_files≈${L.rag_files_approx}` : ''),
    );
    const expertLine = Object.entries(L.expertise || {})
      .slice(0, 8)
      .map(([k, v]) => `${k}:k${v.keeps || 0}/n${v.notes || 0}`)
      .join(' · ');
    if (expertLine) lines.push(`Expertise: ${expertLine}`);
    for (const n of (L.recent_notes || []).slice(0, 5)) {
      lines.push(`• note: ${n.title}${n.author ? ` — ${n.author}` : ''}`);
    }
    if (L.improvement_outcomes && L.improvement_outcomes.line) {
      lines.push(L.improvement_outcomes.line);
    }
  } else if (data.learning && !data.learning.ok) {
    lines.push(`Could not read learning: ${data.learning.error || 'unknown error'}`);
  }

  const sc = (data.scorecard && data.scorecard.ok)
    ? data.scorecard
    : (data.learning && data.learning.scorecard && data.learning.scorecard.ok
      ? data.learning.scorecard
      : null);
  if (sc) {
    lines.push(
      `Scorecard: notes/keep=${sc.notes_keep_ratio ?? '?'}`
        + ` · attributed=${sc.attributed_keep_pct ?? '?'}%`
        + ` · reflection/100=${sc.reflection_survival_per_100_cycles ?? '?'}`
        + ` · dead_threads=${sc.dead_thread_count ?? '?'}`,
    );
    if (sc.improvement_outcomes && sc.improvement_outcomes.line) {
      lines.push(sc.improvement_outcomes.line);
    }
  } else if (data.scorecard && !data.scorecard.ok) {
    lines.push(`Could not read scorecard: ${data.scorecard.error || 'unknown error'}`);
  }

  if (data.activity && data.activity.ok) {
    if ((data.activity.cycles || []).length) {
      lines.push('Recent campaign cycles:');
      for (const c of data.activity.cycles.slice(-5)) {
        lines.push(
          `• cycle ${c.cycle != null ? c.cycle : '?'} @ ${c.ts || '?'}`
            + ` · keeps=${c.keeps != null ? c.keeps : '?'}`,
        );
      }
    }
    if ((data.activity.kept_items || []).length) {
      lines.push('Recent keeps:');
      for (const k of data.activity.kept_items.slice(0, 5)) {
        lines.push(`• #${k.id} ${k.title}${k.source ? ` (${k.source})` : ''}`);
      }
    }
    if (!(data.activity.cycles || []).length && !(data.activity.kept_items || []).length) {
      lines.push('No recent campaign activity on disk yet.');
    }
  } else if (data.activity && !data.activity.ok) {
    lines.push(`Could not read activity: ${data.activity.error || 'unknown error'}`);
  }

  if (data.authors && data.authors.ok) {
    const named = data.authors.named_authors || [];
    lines.push(`Corpus authors (kept items: ${data.authors.kept_items}):`);
    if (!named.length) {
      lines.push('• No structured author metadata yet (titles may still name people).');
    } else {
      for (const a of named.slice(0, 40)) {
        lines.push(`• ${a.name} (${a.count})`);
      }
    }
    const unknown = (data.authors.authors || []).find((a) => a.name.startsWith('('));
    if (unknown) lines.push(`• ${unknown.name}: ${unknown.count} item(s)`);
  } else if (data.authors && !data.authors.ok) {
    lines.push(`Could not read authors: ${data.authors.error || 'unknown error'}`);
  }

  if (data.stats && data.stats.ok) {
    lines.push(
      `Corpus stats: ${data.stats.harvest_items} harvest items · ${data.stats.transcriptions} transcriptions · ${data.stats.critiques} critiques`,
    );
  }

  if (data.jobs && data.jobs.ok) {
    const c = data.jobs.counts || {};
    lines.push(`Agents: ${c.working || 0} working (${c.running || 0} running · ${c.pending || 0} queued)`);
    for (const j of (data.jobs.active || []).slice(0, 8)) {
      lines.push(`• ${j.status} ${j.id} — ${j.agent_id || j.type}${j.brief ? `: ${j.brief}` : ''}`);
    }
    if (!(data.jobs.active || []).length) lines.push('• No agents on a task right now.');
  }

  return lines.join('\n').trim() || 'Nothing to report from local lookups.';
}

/**
 * Collect integers ≥ 10 from lookup JSON for grounding validation.
 */
function collectGroundTruthNumbers(data) {
  const nums = new Set();
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = Math.trunc(Math.abs(v));
      if (n >= 10) nums.add(String(n));
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === 'object') {
      for (const item of Object.values(v)) walk(item);
    } else if (typeof v === 'string') {
      for (const run of extractDigitRuns(v)) {
        if (run.text.length >= 2) nums.add(run.text);
      }
    }
  };
  walk(data);
  return nums;
}

function expectedStateToken(data) {
  const summary = data && data.campaign && data.campaign.state_summary
    ? String(data.campaign.state_summary)
    : '';
  if (summary.includes('ACTIVE')) return 'ACTIVE';
  if (summary.includes('PAUSED')) return 'PAUSED';
  if (summary.includes('STOPPED')) return 'STOPPED';
  const st = data && data.campaign && data.campaign.status;
  if (!st) return null;
  if (!st.enabled) return 'STOPPED';
  if (st.paused) return 'PAUSED';
  return 'ACTIVE';
}

/**
 * Validate synthesis: integers ≥ 10 must appear in lookup JSON; state words must match.
 */
function replyMatchesLookupGroundTruth(reply, data) {
  const text = String(reply || '');
  if (!text) return false;
  const allowed = collectGroundTruthNumbers(data);
  for (const run of extractDigitRuns(text)) {
    if (run.text.length >= 2 && !allowed.has(run.text)) return false;
  }
  const want = expectedStateToken(data);
  if (want) {
    const low = toLowerAsciiish(text);
    const mentioned = [];
    if (low.includes('active')) mentioned.push('ACTIVE');
    if (low.includes('paused')) mentioned.push('PAUSED');
    if (low.includes('stopped')) mentioned.push('STOPPED');
    // "not paused" / "not stopped" are fine with ACTIVE.
    if (includesAny(low, ['not paused', 'not stopped'])) {
      return want === 'ACTIVE' || mentioned.every((t) => t === want || t === 'ACTIVE');
    }
    if (mentioned.length && !mentioned.includes(want)) return false;
  }
  return true;
}

/**
 * One synthesis call: speak lookup JSON in Piko voice. Falls back to template on failure.
 */
async function synthesizeLookupReply(message, data, opts = {}) {
  const fallback = formatLookupReply('', data);
  const model = opts.model
    || process.env.PIKO_LEGATE_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';
  if (String(process.env.PIKO_LEGATE_SYNTHESIS || '1').trim() === '0') {
    return fallback;
  }
  try {
    const { ollamaNativeChat } = require('./llm');
    const { withUniversalIdentity } = require('./pikoIdentity');
    const groundJson = JSON.stringify(data, null, 2).slice(0, 6000);
    const system = withUniversalIdentity(
      'You are Piko, a researcher, answering the operator.\n'
      + 'Use ONLY the ground-truth JSON delimited below. Never invent titles, claims, or numbers.\n'
      + '---GROUND_TRUTH_JSON_BEGIN---\n'
      + `${groundJson}\n`
      + '---GROUND_TRUTH_JSON_END---\n'
      + 'Pick the right register for the question:\n'
      + '- STATUS / PROGRESS questions ("status", "how is it going", "update"): answer in one or two '
      + 'plain sentences that QUOTE the key live numbers from the JSON (e.g. cycles run, sources kept, '
      + 'recent activity). Grounded numbers are mandatory here.\n'
      + '- CONTENT questions ("what have you learned", "what are you reading", "tell me about X"): '
      + 'lead with SUBSTANCE — which authors/works you have been digesting, what they argue, what open '
      + 'questions or disagreements they raise (use recent_notes summaries and open_questions). Numbers '
      + 'are secondary; one or two at most, never a thread-by-thread recital.\n'
      + 'Voice rules for both:\n'
      + '- When the JSON has a "state_summary" field, that is the authoritative running/paused/stopped '
      + 'state — repeat what it says and never contradict it. Do not infer state from raw booleans.\n'
      + '- Speak like a person, not a dashboard. Never enumerate every metric in the JSON.\n'
      + '- No internal jargon: say "sources I kept" not "keeps", "searches" not "seeks", '
      + '"lines of inquiry" not "threads/leads", "indexed files" not "rag chunks". '
      + 'Plain counts like "525 cycles" are fine in status answers.\n'
      + '- If the JSON has real content (summaries, questions), spend the reply on that; if it only has '
      + 'counts, give an honest brief status instead of dressing numbers up as insight.\n'
      + '- Do not claim you have not started if the JSON shows activity.\n'
      + 'Keep it to one short conversational paragraph (two at most). No lists of statistics. No JSON.',
    );
    const user = `Operator question (answer using the ground-truth JSON in the system message only):\n${String(message || '').slice(0, 1500)}`;
    const raw = await ollamaNativeChat(model, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], {
      temperature: 0.2,
      max_tokens: 500,
      num_ctx: Number(process.env.PIKO_LEGATE_NUM_CTX || 4096),
      timeoutMs: Math.max(5000, Number(process.env.PIKO_LEGATE_SYNTHESIS_TIMEOUT_MS || 45000)),
      priority: 'user',
      lane: 'chat',
    });
    const text = String(raw || '').trim();
    if (!text || text.length < 8) return fallback;
    if (!replyMatchesLookupGroundTruth(text, data)) return fallback;
    return text.slice(0, 4000);
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  LOOKUP_IDS,
  normalizeLookups,
  listCorpusAuthors,
  corpusStats,
  agentJobsStatus,
  campaignStatusLookup,
  learningStatusLookup,
  scorecardLookup,
  recentActivityLookup,
  buildCampaignStateBlock,
  bustCampaignStateBlockCache,
  collectGroundTruthNumbers,
  replyMatchesLookupGroundTruth,
  runLookups,
  formatLookupReply,
  synthesizeLookupReply,
};
