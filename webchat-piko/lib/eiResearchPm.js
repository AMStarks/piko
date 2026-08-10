/**
 * Piko research PM — 27b proposes one named work, deploys a thinking seeker,
 * confirms, then ingest + digest. Campaign daemon is hands-only when PM is on.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { culturesDataRoot } = require('./culturesCorpusApi');
const { getSeeds } = require('./eiSeedPack');
const {
  heuristicPacket,
  rewriteEditionUrl,
  stubRiskForUrl,
  packetIsThinking,
  formatPacketArtifact,
  SPINE_THREADS,
} = require('./eiSeeker');
const { extractJsonObject } = require('./routingParse');
const { ollamaNativeChat } = require('./llm');
const { toLowerAsciiish } = require('./text');

const SUPPORTING_THREADS = new Set([
  'gobekli-tepe', 'cataclysm', 'atlantis', 'tiahuanaco', 'flood-myths',
]);
const SEEK_THREAD_ORDER = [
  'self-view', 'heliopolis', 'premodern-reception', 'abydos', 'giza',
  'gobekli-tepe', 'cataclysm', 'atlantis', 'tiahuanaco', 'flood-myths',
];
const DEAD_FLOOR = 3;
const SELF_VIEW_GATE = 10;
const HISTORY_CAP = 80;
const PENDING_CAP = 3;
const SEEKER_STALE_MS = 30 * 60 * 1000;

function envOn(name, fallback = false) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function pmModeDefaultOn() {
  const v = String(process.env.PIKO_RESEARCH_PM || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function confirmModel() {
  return (
    process.env.PIKO_RESEARCH_PM_CONFIRM_MODEL
    || process.env.PIKO_LEGATE_MODEL
    || process.env.PIKO_UNDERSTAND_MODEL
    || 'qwen3.6:27b'
  );
}

function pmPath() {
  return path.join(culturesDataRoot(), 'research_pm.json');
}

function defaultState() {
  return {
    enabled: false,
    paused: false,
    topic: '',
    interval_minutes: Math.max(5, Math.min(180, Number(process.env.PIKO_RESEARCH_PM_INTERVAL_MIN || 5) || 5)),
    last_pm_at: null,
    seeker_running: false,
    seeker_started_at: null,
    pending_confirms: [],
    history: [],
    stats: {
      deployed: 0,
      confirmed_keep: 0,
      recrawl: 0,
      drop: 0,
      ask_operator: 0,
      spine_keeps: {},
      supporting_keeps: {},
    },
    dead_urls: {},
    created_at: null,
    updated_at: null,
  };
}

function loadState() {
  try {
    if (!fs.existsSync(pmPath())) return defaultState();
    const raw = JSON.parse(fs.readFileSync(pmPath(), 'utf8'));
    return { ...defaultState(), ...raw, stats: { ...defaultState().stats, ...(raw.stats || {}) } };
  } catch (_) {
    return defaultState();
  }
}

function saveState(state) {
  const next = { ...defaultState(), ...state, updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(pmPath()), { recursive: true });
  fs.writeFileSync(pmPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function isPmManaging(state) {
  const s = state || loadState();
  return !!(s.enabled && !s.paused);
}

function newPacketId() {
  if (typeof crypto.randomUUID === 'function') return `rpc_${crypto.randomUUID()}`;
  return `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function campaignApi() {
  return require('./eiResearchCampaign');
}

function coverageState() {
  try {
    return campaignApi().loadState();
  } catch (_) {
    return { thread_coverage: {} };
  }
}

function threadKeeps(covState, tid) {
  const cov = (covState && covState.thread_coverage) || {};
  return Number((cov[tid] && cov[tid].keeps) || 0) || 0;
}

function harvestRowByUrl(url) {
  try {
    const Database = require('better-sqlite3');
    const { dbFile } = require('./culturesCorpusApi');
    const db = new Database(dbFile(), { readonly: true });
    try {
      const raw = String(url || '').trim();
      if (!raw) return null;
      let iaId = null;
      try {
        const norm = campaignApi().normalizeSourceUrl(raw) || raw;
        const m = String(norm).match(/archive\.org\/(?:details|stream|download)\/([^/?#]+)/i);
        if (m) iaId = decodeURIComponent(m[1]);
      } catch (_) { /* optional */ }
      const row = iaId
        ? db.prepare(
          `SELECT id, title, official_text, meta_json, source_url FROM harvest_items
           WHERE source_url = ? OR instr(source_url, ?) > 0
           ORDER BY id DESC LIMIT 1`,
        ).get(raw, iaId)
        : db.prepare(
          'SELECT id, title, official_text, meta_json, source_url FROM harvest_items WHERE source_url = ? ORDER BY id DESC LIMIT 1',
        ).get(raw);
      return row || null;
    } finally { db.close(); }
  } catch (_) {
    return null;
  }
}

const DEAD_URL_CAP = 250;

function normalizeUrlKey(url) {
  return toLowerAsciiish(String(url || '').trim().replace(/\/+$/, ''));
}

/** Alias forms that must share one dead/kept fate (Perseus text↔dltext, IA path variants). */
function urlDeadAliases(url) {
  const raw = String(url || '').trim();
  if (!raw) return [];
  const out = new Set();
  const add = (u) => {
    const k = normalizeUrlKey(u);
    if (k) out.add(k);
  };
  add(raw);
  try {
    const { rewriteEditionUrl, iaDjvuTxtUrl } = require('./eiSeeker');
    add(rewriteEditionUrl(raw));
    const dj = iaDjvuTxtUrl(raw);
    if (dj) add(dj);
  } catch (_) { /* optional */ }
  const m = raw.match(/archive\.org\/(?:details|download|stream)\/([^/?#]+)/i);
  if (m) {
    try {
      const id = decodeURIComponent(m[1]).replace(/\/+$/, '');
      if (id) {
        add(`https://archive.org/details/${id}`);
        add(`https://archive.org/stream/${id}/${id}_djvu.txt`);
        add(`https://archive.org/download/${id}/${id}_djvu.txt`);
        add(`https://archive.org/download/${id}/${id}.pdf`);
      }
    } catch (_) { /* ok */ }
  }
  const low = normalizeUrlKey(raw);
  if (low.includes('perseus.tufts.edu/hopper/dltext?')) {
    add(raw.replace(/\/hopper\/dltext\?/i, '/hopper/text?'));
  }
  if (low.includes('perseus.tufts.edu/hopper/text?')) {
    add(raw.replace(/\/hopper\/text\?/i, '/hopper/dltext?'));
  }
  return [...out];
}

function rememberFailedUrl(state, url, reason) {
  if (!state || typeof state !== 'object') return state;
  const map = { ...(state.dead_urls || {}) };
  const at = new Date().toISOString();
  const why = String(reason || 'ingest_failed').slice(0, 160);
  for (const key of urlDeadAliases(url)) {
    map[key] = { at, reason: why };
  }
  const keys = Object.keys(map);
  if (keys.length > DEAD_URL_CAP) {
    keys.sort((a, b) => String((map[a] && map[a].at) || '').localeCompare(String((map[b] && map[b].at) || '')));
    for (const k of keys.slice(0, keys.length - DEAD_URL_CAP)) delete map[k];
  }
  state.dead_urls = map;
  return state;
}

function isRememberedDeadUrl(url, state) {
  const s = state || (() => { try { return loadState(); } catch (_) { return null; } })();
  if (!s || !s.dead_urls) return false;
  return urlDeadAliases(url).some((key) => !!s.dead_urls[key]);
}

function seedUrlStatus(url, state) {
  try {
    if (isRememberedDeadUrl(url, state)) return 'dead';
    let hit = null;
    try { hit = campaignApi().findKeptItemByUrl(url); } catch (_) { /* fall through */ }
    if (!hit) {
      const row = harvestRowByUrl(url);
      if (row) {
        let meta = {};
        try { meta = JSON.parse(row.meta_json || '{}'); } catch (_) { /* ok */ }
        hit = {
          harvest_id: row.id,
          title: row.title,
          meta,
          item: { official_text: row.official_text, meta, flag: null },
          is_thin_stub: String(row.official_text || '').length > 0 && String(row.official_text || '').length < 400,
        };
      }
    }
    if (!hit) return 'open';
    let flag = hit.item && hit.item.flag;
    if (flag == null && hit.harvest_id) {
      try {
        const f = require('./eiCorpusFlags').getFlag(hit.harvest_id);
        flag = f && f.flag;
      } catch (_) { /* optional */ }
    }
    const fl = String(flag || '').toLowerCase();
    let chars = Number((hit.meta && hit.meta.text_chars_total) || 0)
      || String((hit.item && hit.item.official_text) || '').length;
    if (!chars && hit.harvest_id) {
      try {
        const wrap = require('./culturesCorpusApi').getItem(hit.harvest_id);
        const it = wrap && wrap.item ? wrap.item : wrap;
        chars = String((it && it.official_text) || '').length;
      } catch (_) { /* optional */ }
    }
    if (fl === 'drop' || hit.is_thin_stub || (chars > 0 && chars < 400)) return 'dead';
    if (fl === 'keep' || fl === 'kept' || fl === 'accept' || chars >= 400) return 'kept';
    return 'open';
  } catch (_) {
    return 'open';
  }
}

function urlAlreadyKept(url) {
  return seedUrlStatus(url) === 'kept';
}

function seedToWork(seed, why) {
  const authors = Array.isArray(seed.authors) ? seed.authors.filter(Boolean) : [];
  const hints = Array.isArray(seed.title_hints) ? seed.title_hints.filter(Boolean) : [];
  const urls = Array.isArray(seed.urls) ? seed.urls.filter(Boolean) : [];
  const ia = Array.isArray(seed.ia_ids) ? seed.ia_ids.filter(Boolean) : [];
  return {
    title: hints[0] || authors[0] || 'unnamed work',
    author: authors[0] || '',
    thread: String(seed.thread || 'self-view').toLowerCase(),
    seed_urls: urls,
    ia_ids: ia,
    why: why || seed.note || '',
  };
}

function workKey(w) {
  return `${String(w.thread || '').toLowerCase()}|${toLowerAsciiish(w.title)}|${toLowerAsciiish(w.author)}`;
}

function recentlyProposedKeys(state) {
  const keys = new Set();
  for (const p of (state.pending_confirms || [])) {
    if (p && (p.status === 'pending_confirm' || p.status === 'approved')) {
      keys.add(workKey(p.work || p));
    }
  }
  for (const h of (state.history || []).slice(-20)) {
    if (h && h.work && h.status === 'approved') keys.add(workKey(h.work));
  }
  return keys;
}

/**
 * Phase A: Piko proposes one named spine work from gaps + seed pack.
 */
function proposeNextWork(opts = {}) {
  const state = opts.state || loadState();
  const cov = opts.coverage || coverageState();
  const statusOf = typeof opts.urlStatus === 'function'
    ? opts.urlStatus
    : (typeof opts.urlKept === 'function'
      ? (u) => (opts.urlKept(u) ? 'kept' : (isRememberedDeadUrl(u, state) ? 'dead' : 'open'))
      : (u) => seedUrlStatus(u, state));
  const selfView = threadKeeps(cov, 'self-view');
  const seen = recentlyProposedKeys(state);
  const seeds = getSeeds().filter((s) => s && s.thread && ((s.urls && s.urls.length) || (s.ia_ids && s.ia_ids.length)));

  const candidates = [];
  for (const seed of seeds) {
    const work = seedToWork(seed);
    if (SUPPORTING_THREADS.has(work.thread) && selfView < SELF_VIEW_GATE) continue;
    const urls = [];
    for (const u of [
      ...(work.seed_urls || []),
      ...(work.ia_ids || []).map((id) => `https://archive.org/details/${id}`),
    ]) {
      const s = String(u || '').trim();
      if (s && !urls.includes(s)) urls.push(s);
    }
    let anyKept = false;
    const open = [];
    for (const u of urls) {
      const st = statusOf(u);
      if (st === 'kept') { anyKept = true; break; }
      if (st === 'open') open.push(u);
    }
    if (anyKept || !open.length) continue;
    const { urlQualityRank } = require('./eiSeeker');
    const fresh = open.sort((a, b) => urlQualityRank(a) - urlQualityRank(b));
    if (!fresh.length) continue;
    if (seen.has(workKey({ ...work, title: work.title }))) continue;
    const keeps = threadKeeps(cov, work.thread);
    const dead = keeps < DEAD_FLOOR;
    const spine = SPINE_THREADS.includes(work.thread);
    const rank = SEEK_THREAD_ORDER.indexOf(work.thread);
    candidates.push({
      ...work,
      seed_urls: fresh,
      why: dead
        ? `${work.thread} is under the keep floor (${keeps}<${DEAD_FLOOR}); this edition fills the spine.`
        : (spine
          ? `Next spine edition for ${work.thread} (${keeps} keeps).`
          : `Supporting evidence for ${work.thread} after self-view solvent.`),
      _dead: dead,
      _spine: spine,
      _rank: rank < 0 ? 99 : rank,
      _keeps: keeps,
    });
  }

  candidates.sort((a, b) => {
    if (a._dead !== b._dead) return a._dead ? -1 : 1;
    if (a._spine !== b._spine) return a._spine ? -1 : 1;
    if (a._rank !== b._rank) return a._rank - b._rank;
    return a._keeps - b._keeps;
  });

  const pick = candidates[0] || null;
  if (!pick) {
    return {
      ok: false,
      error: 'no_named_work',
      reason: selfView < SELF_VIEW_GATE
        ? 'No unused spine seed URLs (supporting gated until self-view ≥ 10).'
        : 'No unused seed editions left to propose.',
    };
  }
  delete pick._dead;
  delete pick._spine;
  delete pick._rank;
  delete pick._keeps;
  return { ok: true, work: pick };
}

function acceptSeekerPacket(raw) {
  const state = loadState();
  const packet = { ...(raw || {}) };
  if (!packet.id) packet.id = newPacketId();
  packet.status = packet.status || 'pending_confirm';
  packet.created_at = packet.created_at || new Date().toISOString();
  packet.work = packet.work || {
    title: packet.title,
    author: packet.author,
    thread: packet.thread,
    seed_urls: packet.seed_urls_considered || [],
    why: packet.why || '',
  };
  const row = {
    id: packet.id,
    status: 'pending_confirm',
    work: packet.work,
    seeker: {
      url: packet.url || '',
      edition_note: packet.edition_note || '',
      is_stub_risk: !!packet.is_stub_risk,
      stub_reason: packet.stub_reason || '',
      confidence: packet.confidence,
      reasoning: packet.reasoning || '',
      recommend: packet.recommend || '',
      connector_hint: packet.connector_hint || '',
      seed_urls_considered: packet.seed_urls_considered || [],
      llm: !!packet.llm,
    },
    harvest_id: null,
    created_at: packet.created_at,
    confirmed_at: null,
    confirmed_by: null,
    piko_verdict: null,
    piko_why: '',
  };
  state.pending_confirms = (state.pending_confirms || []).filter((p) => p && p.id !== row.id);
  state.pending_confirms.push(row);
  state.stats.deployed = Number(state.stats.deployed || 0) + 1;
  saveState(state);
  return { ...packet, id: row.id, status: row.status };
}

function findPending(id, state) {
  const s = state || loadState();
  return (s.pending_confirms || []).find((p) => p && p.id === id) || null;
}

function rulesConfirm(row) {
  const sk = (row && row.seeker) || {};
  const work = (row && row.work) || {};
  const url = rewriteEditionUrl(sk.url || '');
  const stub = stubRiskForUrl(url);
  const thread = String(work.thread || sk.thread || '').toLowerCase();
  const cov = coverageState();
  const selfView = threadKeeps(cov, 'self-view');

  if (!url) {
    return { verdict: 'recrawl', thread, why: 'Seeker returned no URL — try next open edition.', url: '' };
  }
  if (!packetIsThinking({ reasoning: sk.reasoning })) {
    return { verdict: 'recrawl', thread, why: 'Seeker packet has no reasoning — redeploy thinking seeker.', url };
  }
  if (SUPPORTING_THREADS.has(thread) && selfView < SELF_VIEW_GATE) {
    return {
      verdict: 'drop',
      thread,
      why: `Supporting thread ${thread} blocked until self-view ≥ ${SELF_VIEW_GATE} (now ${selfView}).`,
      url,
    };
  }
  if (stub.is_stub_risk && stub.rewrite) {
    return {
      verdict: 'recrawl',
      thread,
      why: stub.reason,
      url: stub.rewrite,
    };
  }
  if (stub.is_stub_risk) {
    return { verdict: 'recrawl', thread, why: stub.reason || 'Stub risk — find a full-text edition.', url };
  }
  if (sk.recommend === 'skip') {
    return { verdict: 'drop', thread, why: 'Seeker recommended skip.', url };
  }
  if (Number(sk.confidence) < 0.45) {
    return { verdict: 'recrawl', thread, why: `Low seeker confidence (${sk.confidence}) — try another edition.`, url };
  }
  return {
    verdict: 'keep',
    thread: SPINE_THREADS.includes(thread) || SUPPORTING_THREADS.has(thread) ? thread : 'self-view',
    why: sk.edition_note || 'Open edition URL matches the named work.',
    url,
  };
}

async function llmConfirm(row, floor) {
  if (!envOn('PIKO_RESEARCH_PM_CONFIRM_LLM', false)) return null;
  const sk = (row && row.seeker) || {};
  const work = (row && row.work) || {};
  const sys = `You are Piko, Egyptian Insights research PM (qwen 27b).
You confirm or correct the seeker, then ingest. Do not wait for the operator.
Thesis is a research frame, not a closed verdict.
Return JSON only:
{"verdict":"keep|recrawl|drop|retag","thread":"self-view|heliopolis|premodern-reception|abydos|giza|...","why":"1-3 sentences","url":"https://..."}
Keep a real open full-text edition. Recrawl viewer/stub/404 URLs. Drop off-goal or supporting-while-gated. Never ask the operator.`;
  const user = [
    `Work: ${work.title || '?'} (${work.author || '?'})`,
    `Proposed thread: ${work.thread || '?'}`,
    `URL: ${sk.url || '(none)'}`,
    `Edition: ${sk.edition_note || '—'}`,
    `Stub: ${sk.is_stub_risk ? sk.stub_reason : 'no'}`,
    `Seeker reasoning: ${sk.reasoning || '—'}`,
    `Rules floor: ${floor.verdict} — ${floor.why}`,
  ].join('\n');
  try {
    const raw = await ollamaNativeChat(confirmModel(), [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { temperature: 0.1, max_tokens: 500, lane: 'user' });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const verdict = String(parsed.verdict || '').toLowerCase();
    if (verdict === 'ask_operator') verdict = 'recrawl';
    if (!['keep', 'recrawl', 'drop', 'retag'].includes(verdict)) return null;
    return {
      verdict,
      thread: String(parsed.thread || floor.thread || work.thread || '').toLowerCase(),
      why: String(parsed.why || floor.why || '').slice(0, 600),
      url: rewriteEditionUrl(String(parsed.url || floor.url || sk.url || '').trim()),
      llm: true,
    };
  } catch (_) {
    return null;
  }
}

function harvestIdFromIngest(out) {
  const r = (out && out.result) || {};
  const hid = Number(r.harvest_id || r.existing_harvest_id || 0);
  if (hid > 0) return hid;
  for (const it of r.items || []) {
    const id = Number(it && (it.harvest_id || it.id));
    if (id > 0) return id;
  }
  const js = (r.mission_fit && r.mission_fit.judgments)
    || (out && out.mission_fit && out.mission_fit.judgments)
    || [];
  for (const j of js) {
    const id = Number(j && j.harvest_id);
    if (id > 0) return id;
  }
  return null;
}

/** Scorecard keep: hid + ≥400 chars. Never scrape `out.ok` / mission-fit kept. */
function substantiveIngest(hid, chars) {
  const id = Number(hid) || 0;
  const n = Number(chars) || 0;
  if (!(id > 0)) return { ok: false, reason: 'no_harvest_id', chars: n };
  if (n > 0 && n < 400) return { ok: false, reason: 'thin_extract', chars: n };
  if (n >= 400) return { ok: true, reason: 'substantive', chars: n };
  return { ok: false, reason: 'unknown_chars', chars: n };
}

async function ingestApproved(row, verdict) {
  if (!envOn('PIKO_RESEARCH_PM_INGEST', true)) {
    return { ok: true, skipped: 'ingest_disabled', harvest_id: null };
  }
  const url = verdict.url || (row.seeker && row.seeker.url);
  if (!url) return { ok: false, error: 'no_url' };
  try {
    const { probeUrlLive } = require('./eiSeeker');
    const probe = await probeUrlLive(url);
    if (!probe.ok) {
      return { ok: false, error: 'url_unreachable', status: probe.status, url };
    }
  } catch (_) { /* probe best-effort; still try ingest */ }
  const { runTool } = require('./eiAgentTools');
  const note = [
    `PM-confirmed ${row.work && row.work.title} (${row.work && row.work.author})`,
    `thread=${verdict.thread}`,
    verdict.why || '',
  ].filter(Boolean).join(' — ').slice(0, 800);
  const out = await runTool('ingest_url', {
    url,
    note,
    title: (row.work && row.work.title) || '',
    recrawl: verdict.verdict === 'recrawl',
    thread: verdict.thread,
    focus: verdict.thread,
  }, { goal: note, thread: verdict.thread });
  const hid = harvestIdFromIngest(out);
  let chars = 0;
  if (hid) {
    try {
      const wrap = require('./culturesCorpusApi').getItem(hid);
      const it = wrap && wrap.item ? wrap.item : wrap;
      const meta = (it && it.meta) || {};
      chars = Math.max(
        String((it && it.official_text) || '').length,
        Number(meta.text_chars_total || 0) || 0,
      );
    } catch (_) { /* optional */ }
  }
  const scored = substantiveIngest(hid, chars);
  if (hid && scored.reason === 'thin_extract') {
    try {
      const { setFlag } = require('./eiCorpusFlags');
      setFlag(hid, { flag: 'drop', reason: 'thin_extract', reviewer: 'piko-pm' });
    } catch (_) { /* optional */ }
    return { ok: false, error: 'thin_extract', harvest_id: hid, chars, ingest: out };
  }
  if (scored.ok) {
    try {
      const { patchItemMeta } = require('./culturesCorpusApi');
      patchItemMeta(hid, {
        thread: verdict.thread,
        pm_confirmed: true,
        pm_confirm_id: row.id,
        site: verdict.thread,
      });
    } catch (_) { /* sqlite optional in tests */ }
    try {
      const { setFlag } = require('./eiCorpusFlags');
      setFlag(hid, {
        flag: 'keep',
        reason: `pm_confirm:${row.id}`,
        reviewer: 'piko-pm',
      });
    } catch (_) { /* optional */ }
    if (envOn('PIKO_RESEARCH_PM_DIGEST', true)) {
      try {
        const { digestItem } = require('./eiCorpusNotes');
        await digestItem(hid);
      } catch (_) { /* digest is best-effort; ingest still counts */ }
    }
  }
  return { ok: scored.ok, harvest_id: hid, chars, ingest: out, score_reason: scored.reason };
}

function archiveRow(state, row) {
  state.history = [...(state.history || []), {
    id: row.id,
    status: row.status,
    work: row.work,
    url: row.seeker && row.seeker.url,
    thread: (row.piko_verdict && row.piko_verdict.thread) || (row.work && row.work.thread),
    verdict: row.piko_verdict && row.piko_verdict.verdict,
    harvest_id: row.harvest_id,
    confirmed_at: row.confirmed_at,
    confirmed_by: row.confirmed_by,
  }].slice(-HISTORY_CAP);
  state.pending_confirms = (state.pending_confirms || []).filter((p) => p && p.id !== row.id);
}

/**
 * Phase A/B: Piko (or operator) confirms a seeker packet, then ingest+digest.
 */
async function confirmPacket(id, explicitVerdict = null, opts = {}) {
  const state = loadState();
  const row = findPending(id, state);
  if (!row) return { ok: false, error: 'not_found', id };
  if (row.status !== 'pending_confirm' && !opts.force) {
    return { ok: false, error: 'not_pending', id, status: row.status };
  }

  const floor = rulesConfirm(row);
  let verdict = explicitVerdict && typeof explicitVerdict === 'object'
    ? {
      verdict: String(explicitVerdict.verdict || floor.verdict).toLowerCase(),
      thread: String(explicitVerdict.thread || floor.thread || '').toLowerCase(),
      why: String(explicitVerdict.why || floor.why || '').slice(0, 600),
      url: rewriteEditionUrl(String(explicitVerdict.url || floor.url || '').trim()),
    }
    : floor;
  if (!explicitVerdict) {
    const llm = await llmConfirm(row, floor);
    if (llm) verdict = llm;
  }

  row.piko_verdict = verdict;
  row.piko_why = verdict.why;
  row.confirmed_at = new Date().toISOString();
  row.confirmed_by = opts.by || (explicitVerdict ? 'operator' : 'piko');

  if (verdict.verdict === 'ask_operator') {
    verdict = { ...verdict, verdict: 'recrawl', why: verdict.why || 'Piko recrawls instead of waiting on the operator.' };
  }

  if (verdict.verdict === 'drop') {
    row.status = 'rejected';
    state.stats.drop = Number(state.stats.drop || 0) + 1;
    archiveRow(state, row);
    saveState(state);
    return { ok: true, packet: row, verdict };
  }

  if (verdict.verdict === 'retag') {
    row.work = { ...(row.work || {}), thread: verdict.thread };
    row.status = 'pending_confirm';
    saveState(state);
    return { ok: true, retagged: true, packet: row, verdict };
  }

  if (verdict.verdict === 'recrawl' && verdict.url && verdict.url !== (row.seeker && row.seeker.url)) {
    row.seeker = { ...(row.seeker || {}), url: verdict.url, edition_note: verdict.why };
  }

  const ingest = (verdict.verdict === 'keep' || verdict.verdict === 'recrawl')
    ? await ingestApproved(row, verdict)
    : { ok: true, skipped: true };
  row.harvest_id = ingest.harvest_id || null;
  const ingestOk = !!(ingest.ok || ingest.skipped);
  const usedUrl = verdict.url || (row.seeker && row.seeker.url) || '';
  if (!ingestOk && usedUrl) {
    rememberFailedUrl(state, usedUrl, ingest.error || 'ingest_failed');
    saveState(state);
  }
  if (!ingestOk && !opts.noAltRetry) {
    const used = usedUrl;
    const { urlQualityRank, iaDjvuTxtUrl } = require('./eiSeeker');
    const iaIds = [
      ...((row.work && row.work.ia_ids) || []),
      ...((row.seeker && row.seeker.ia_ids) || []),
    ].filter(Boolean);
    const fromIa = iaIds.flatMap((id) => ([
      `https://archive.org/stream/${id}/${id}_djvu.txt`,
      `https://archive.org/details/${id}`,
      `https://archive.org/download/${id}/${id}.pdf`,
    ]));
    const seeds = [
      ...((row.work && row.work.seed_urls) || []),
      ...((row.seeker && row.seeker.seed_urls_considered) || []),
      iaDjvuTxtUrl(used),
      ...fromIa,
    ].filter(Boolean);
    const alt = [...new Set(seeds.map(String).filter(Boolean))]
      .filter((u) => toLowerAsciiish(u) !== toLowerAsciiish(used) && seedUrlStatus(u, state) === 'open')
      .sort((a, b) => urlQualityRank(a) - urlQualityRank(b))[0];
    if (alt) {
      row.seeker = { ...(row.seeker || {}), url: alt, edition_note: `Retry after failed ingest: ${alt}` };
      row.status = 'pending_confirm';
      saveState(state);
      return confirmPacket(row.id, {
        verdict: 'keep',
        thread: verdict.thread,
        why: `First URL failed ingest; trying ${alt}`,
        url: alt,
      }, { ...opts, by: 'piko', noAltRetry: true, force: true });
    }
  }
  row.status = ingestOk ? 'approved' : 'ingest_failed';
  if (ingestOk && (verdict.verdict === 'keep' || verdict.verdict === 'recrawl')) {
    if (verdict.verdict === 'recrawl') state.stats.recrawl = Number(state.stats.recrawl || 0) + 1;
    else state.stats.confirmed_keep = Number(state.stats.confirmed_keep || 0) + 1;
    const bucket = SPINE_THREADS.includes(verdict.thread) ? 'spine_keeps' : 'supporting_keeps';
    state.stats[bucket] = state.stats[bucket] || {};
    state.stats[bucket][verdict.thread] = Number(state.stats[bucket][verdict.thread] || 0) + 1;
  }
  archiveRow(state, row);
  saveState(state);
  return { ok: !!ingest.ok || !!ingest.skipped, packet: row, verdict, ingest };
}

async function deploySeeker(work, opts = {}) {
  const state = loadState();
  if (state.seeker_running && state.seeker_started_at
    && Date.now() - new Date(state.seeker_started_at).getTime() < SEEKER_STALE_MS) {
    return { ok: false, error: 'seeker_busy' };
  }
  state.seeker_running = true;
  state.seeker_started_at = new Date().toISOString();
  saveState(state);
  try {
    const { runEiSeeker } = require('./eiSeeker');
    const out = await runEiSeeker(work, { rootDir: opts.rootDir });
    const packet = (out.result && out.result.packet) || heuristicPacket(work);
    let confirm = null;
    if (opts.autoConfirm !== false && packet && packet.id) {
      confirm = await confirmPacket(packet.id, null, { by: 'piko' });
    }
    return {
      ok: true,
      seeker: out,
      packet: (confirm && confirm.packet) || packet,
      confirm,
    };
  } finally {
    const s = loadState();
    s.seeker_running = false;
    s.seeker_started_at = null;
    s.last_pm_at = new Date().toISOString();
    saveState(s);
  }
}

function pauseCampaignDaemon() {
  try { campaignApi().stopCampaign({ pm_owns: true }); } catch (_) {
    try { campaignApi().pauseCampaign(); } catch (_) { /* optional */ }
  }
  try { campaignApi().clearRunningLockAtBoot(); } catch (_) { /* optional */ }
}

const SPINE_RETAG_IDS = [
  { harvest_id: 620, thread: 'self-view', reason: 'Mercer Pyramid Texts' },
  { harvest_id: 2337, thread: 'self-view', reason: 'Budge Book of the Dead' },
  { harvest_id: 2401, thread: 'self-view', reason: 'Sethe Pyramidentexte OCR' },
  { harvest_id: 2403, thread: 'self-view', reason: 'Knudtzon Amarna OCR' },
];

function titleLooksSelfView(title) {
  const t = toLowerAsciiish(title);
  return ['pyramid texts', 'pyramidentexte', 'book of the dead', 'coming forth by day',
    'ptahhotep', 'ptah-hotep', 'westcar', 'amarna', 'wisdom of the egyptians'].some((n) => t.includes(n));
}

function titleLooksHeliopolis(title) {
  const t = toLowerAsciiish(title);
  if (!['heliopolis', 'kafr ammar', 'iunu', 'matariyeh', 'matarieh'].some((n) => t.includes(n))) return false;
  if (t.includes('pyramids and temples of gizeh') && !t.includes('heliopolis')) return false;
  // Site/edition cue — not biblical "of Heliopolis" (Asenath etc.).
  return ['kafr ammar', 'shurafa', 'petrie', 'iunu', 'matariyeh', 'matarieh'].some((n) => t.includes(n));
}

function unwrapCorpusItem(raw) {
  if (!raw || raw.ok === false) return null;
  return raw.item || raw;
}

/**
 * Retag known spine keeps stolen onto giza; recount coverage.
 */
function retagMisthreadedSpineKeeps(opts = {}) {
  const { patchItemMeta, getItem, listItems } = require('./culturesCorpusApi');
  const patched = [];
  const ids = [...SPINE_RETAG_IDS, ...((opts.extra || []).map((e) => ({
    harvest_id: e.harvest_id, thread: e.thread, reason: e.reason || 'operator',
  })))];
  for (const rule of ids) {
    try {
      const item = unwrapCorpusItem(getItem(rule.harvest_id));
      if (!item) continue;
      const cur = String((item.meta && item.meta.thread) || item.thread || item.site || '').toLowerCase();
      if (cur === rule.thread) continue;
      patchItemMeta(rule.harvest_id, { thread: rule.thread, site: rule.thread, spine_retag: rule.reason });
      patched.push({ harvest_id: rule.harvest_id, from: cur || 'other', to: rule.thread, reason: rule.reason });
    } catch (_) { /* no sqlite in unit tests */ }
  }
  if (opts.scan !== false) {
    try {
      let offset = 0;
      for (let g = 0; g < 40; g += 1) {
        const out = listItems({ limit: 100, offset, include_meta: true, exclude_candidates: true });
        const items = (out && out.items) || [];
        if (!items.length) break;
        for (const it of items) {
          const hid = Number(it.id || it.harvest_id);
          const title = String(it.title || '');
          const cur = String((it.meta && it.meta.thread) || it.thread || '').toLowerCase();
          let want = null;
          if (titleLooksSelfView(title) && cur !== 'self-view') want = 'self-view';
          else if (titleLooksHeliopolis(title) && cur !== 'heliopolis') want = 'heliopolis';
          if (!want || !hid) continue;
          if (patched.some((p) => p.harvest_id === hid)) continue;
          try {
            patchItemMeta(hid, { thread: want, site: want, spine_retag: 'title_scan' });
            patched.push({ harvest_id: hid, from: cur || 'other', to: want, reason: 'title_scan', title: title.slice(0, 80) });
          } catch (_) { /* skip */ }
        }
        offset += items.length;
        if (items.length < 100) break;
      }
    } catch (_) { /* optional */ }
  }
  let coverage = null;
  try {
    const camp = campaignApi();
    const state = camp.loadState();
    coverage = camp.recomputeThreadCoverageKeeps(state);
    camp.saveState(state);
  } catch (_) { /* optional */ }
  return { ok: true, patched, coverage: coverage && coverage.by_thread ? coverage.by_thread : null };
}

function startPm(opts = {}) {
  const state = loadState();
  state.enabled = true;
  state.paused = false;
  const topic = String(opts.topic || state.topic || '').trim();
  if (topic) state.topic = topic.slice(0, 1200);
  if (opts.interval_minutes != null) {
    state.interval_minutes = Math.max(5, Math.min(180, Number(opts.interval_minutes) || 5));
  }
  if (!state.created_at) state.created_at = new Date().toISOString();
  saveState(state);
  pauseCampaignDaemon();
  let retag = null;
  try { retag = retagMisthreadedSpineKeeps(); } catch (_) { /* optional */ }
  return { ok: true, mode: 'research_pm', status: summarize(loadState()), retag };
}

function pausePm() {
  const state = loadState();
  state.paused = true;
  saveState(state);
  pauseCampaignDaemon();
  return { ok: true, mode: 'research_pm', status: summarize(loadState()) };
}

function resumePm() {
  const state = loadState();
  if (!state.enabled) return startPm();
  state.paused = false;
  pauseCampaignDaemon();
  saveState(state);
  return { ok: true, mode: 'research_pm', status: summarize(loadState()) };
}

function stopPm() {
  const state = loadState();
  state.enabled = false;
  state.paused = true;
  state.seeker_running = false;
  saveState(state);
  pauseCampaignDaemon();
  return { ok: true, mode: 'research_pm', status: summarize(loadState()) };
}

function pendingCount(state) {
  return (state.pending_confirms || []).filter((p) => p && p.status === 'pending_confirm').length;
}

function dueForPmTick(state) {
  const s = state || loadState();
  if (!s.enabled || s.paused) return false;
  if (pendingCount(s) >= PENDING_CAP) return false;
  // Confirm queue must wake even if a seeker latch is stuck/in-flight.
  if (pendingCount(s) > 0) return true;
  if (s.seeker_running && s.seeker_started_at
    && Date.now() - new Date(s.seeker_started_at).getTime() < SEEKER_STALE_MS) {
    return false;
  }
  if (!s.last_pm_at) return true;
  const intervalMin = Math.max(5, Number(s.interval_minutes) || 5);
  return Date.now() - new Date(s.last_pm_at).getTime() >= intervalMin * 60 * 1000;
}

/** Restart leftover: in-flight seeker lock is stale by definition. */
function clearSeekerLockAtBoot() {
  if (!fs.existsSync(pmPath())) return { cleared: false };
  const s = loadState();
  if (!s.seeker_running) return { cleared: false };
  s.seeker_running = false;
  s.seeker_started_at = null;
  saveState(s);
  return { cleared: true };
}

/**
 * Phase C: standing PM wake — one seeker, then confirm queue.
 */
async function tickPm(opts = {}) {
  const state = loadState();
  if (!state.enabled) return { ok: true, skipped: 'disabled' };
  if (state.paused && !opts.force) return { ok: true, skipped: 'paused' };
  if (state.seeker_running && state.seeker_started_at
    && Date.now() - new Date(state.seeker_started_at).getTime() >= SEEKER_STALE_MS) {
    state.seeker_running = false;
    state.seeker_started_at = null;
    saveState(state);
  }
  const pending = (loadState().pending_confirms || []).filter((p) => p && p.status === 'pending_confirm');
  if (pending.length && opts.autoConfirm !== false) {
    return confirmPacket(pending[0].id, null, { by: 'piko' });
  }
  if (!opts.force && !dueForPmTick(loadState())) return { ok: true, skipped: 'not_due' };
  if (pendingCount(loadState()) >= PENDING_CAP && !opts.force) {
    return { ok: true, skipped: 'confirm_backlog', pending: pendingCount(loadState()) };
  }
  const proposed = proposeNextWork({ state: loadState() });
  if (!proposed.ok) return { ok: true, skipped: 'no_work', reason: proposed.reason };
  return deploySeeker(proposed.work, { autoConfirm: opts.autoConfirm !== false, rootDir: opts.rootDir });
}

function summarize(state) {
  const s = state || loadState();
  const pending = (s.pending_confirms || []).filter((p) => p && p.status === 'pending_confirm');
  return {
    mode: 'research_pm',
    enabled: !!s.enabled,
    paused: !!s.paused,
    topic: s.topic || '',
    interval_minutes: s.interval_minutes,
    last_pm_at: s.last_pm_at,
    seeker_running: !!s.seeker_running,
    pending_confirms: pending.length,
    pending: pending.map((p) => ({
      id: p.id,
      title: p.work && p.work.title,
      author: p.work && p.work.author,
      thread: p.work && p.work.thread,
      url: p.seeker && p.seeker.url,
      stub: !!(p.seeker && p.seeker.is_stub_risk),
    })),
    stats: s.stats,
    next_due: s.enabled && !s.paused,
  };
}

function formatPmStatus(status) {
  const s = status && status.mode ? status : summarize();
  const lines = [
    `Research PM: ${s.enabled ? (s.paused ? 'paused' : 'on') : 'off'}`
      + (s.topic ? ` — ${String(s.topic).slice(0, 80)}` : ''),
    `Seeker: ${s.seeker_running ? 'running (cap 1)' : 'idle'} · confirm queue: ${s.pending_confirms || 0}`,
    `Confirmed spine keeps: ${JSON.stringify((s.stats && s.stats.spine_keeps) || {})}`,
    `Supporting keeps: ${JSON.stringify((s.stats && s.stats.supporting_keeps) || {})}`,
  ];
  for (const p of (s.pending || []).slice(0, 5)) {
    lines.push(`  CONFIRM ${p.id}: ${p.title || '?'} (${p.author || '?'}) [${p.thread}] ${p.url || '(no url)'}${p.stub ? ' STUB' : ''}`);
  }
  return lines.join('\n');
}

function formatConfirmCard(row) {
  if (!row) return 'No pending confirm.';
  const sk = row.seeker || {};
  const w = row.work || {};
  return [
    `CONFIRM CARD ${row.id}`,
    `Work: ${w.title || '?'} — ${w.author || '?'}`,
    `Thread: ${w.thread || '?'}`,
    `URL: ${sk.url || '(none)'}`,
    `Edition: ${sk.edition_note || '—'}`,
    `Stub risk: ${sk.is_stub_risk ? sk.stub_reason : 'no'}`,
    `Seeker reasoning: ${sk.reasoning || '—'}`,
    `Piko verdict: ${(row.piko_verdict && row.piko_verdict.verdict) || 'awaiting'} ${(row.piko_why && `— ${row.piko_why}`) || ''}`,
    row.harvest_id ? `Ingested #${row.harvest_id}` : (row.status === 'ingest_failed' ? 'Ingest failed — Piko will try another edition.' : 'Piko confirms and ingests; operator is not in the loop.'),
  ].join('\n');
}

/**
 * Phase D: scorecard = confirmed spine keeps, not `other` volume.
 */
function pmScorecard(state) {
  const s = state || loadState();
  const spine = { ...(s.stats && s.stats.spine_keeps) || {} };
  const supporting = { ...(s.stats && s.stats.supporting_keeps) || {} };
  const spineTotal = Object.values(spine).reduce((a, n) => a + Number(n || 0), 0);
  const supportingTotal = Object.values(supporting).reduce((a, n) => a + Number(n || 0), 0);
  return {
    ok: true,
    mode: 'research_pm',
    confirmed_spine_keeps: spine,
    confirmed_spine_total: spineTotal,
    confirmed_supporting_keeps: supporting,
    confirmed_supporting_total: supportingTotal,
    deployed: Number(s.stats && s.stats.deployed) || 0,
    confirmed_keep: Number(s.stats && s.stats.confirmed_keep) || 0,
    recrawl: Number(s.stats && s.stats.recrawl) || 0,
    drop: Number(s.stats && s.stats.drop) || 0,
    ask_operator: Number(s.stats && s.stats.ask_operator) || 0,
    pending_confirms: pendingCount(s),
    other_volume_ignored: true,
    notes: 'Scorecard counts Piko-confirmed spine keeps only — not campaign `other` volume.',
  };
}

function getPmStatus() {
  return { ok: true, status: summarize() };
}

async function runPmTool(args = {}, opts = {}) {
  const action = String(args.action || 'status').toLowerCase();
  if (action === 'start') return startPm({ topic: args.topic || opts.goal, interval_minutes: args.interval_minutes });
  if (action === 'pause') return pausePm();
  if (action === 'resume') return resumePm();
  if (action === 'stop') return stopPm();
  if (action === 'propose') return proposeNextWork();
  if (action === 'deploy' || action === 'deploy_seeker') {
    let work = args.work || null;
    if (!work && (args.title || args.url)) {
      work = {
        title: args.title,
        author: args.author,
        thread: args.thread || 'self-view',
        seed_urls: args.url ? [args.url] : (args.seed_urls || []),
        why: args.why || args.note || '',
      };
    }
    if (!work) {
      const proposed = proposeNextWork();
      if (!proposed.ok) return proposed;
      work = proposed.work;
    }
    return deploySeeker(work, { autoConfirm: args.auto_confirm !== false, rootDir: opts.rootDir });
  }
  if (action === 'confirm') {
    const id = String(args.id || args.packet_id || '').trim();
    if (!id) {
      const pending = (loadState().pending_confirms || []).filter((p) => p && p.status === 'pending_confirm');
      if (pending.length === 1) {
        return confirmPacket(pending[0].id, args.verdict ? { verdict: args.verdict, thread: args.thread, why: args.why, url: args.url } : null, { by: 'operator' });
      }
      return { ok: false, error: 'id_required', pending: pending.map((p) => p.id) };
    }
    const explicit = args.verdict
      ? { verdict: args.verdict, thread: args.thread, why: args.why, url: args.url }
      : null;
    return confirmPacket(id, explicit, { by: args.by || 'operator' });
  }
  if (action === 'tick' || action === 'run_now') return tickPm({ force: true, rootDir: opts.rootDir });
  if (action === 'scorecard') return pmScorecard();
  if (action === 'retag') return retagMisthreadedSpineKeeps({ extra: args.extra });
  return getPmStatus();
}

function formatPmToolArtifact(action, out) {
  if (!out) return 'Research PM: no result';
  if (action === 'scorecard') {
    return `PM scorecard: spine_keeps=${out.confirmed_spine_total || 0} ${JSON.stringify(out.confirmed_spine_keeps || {})}`
      + ` · supporting=${out.confirmed_supporting_total || 0}`
      + ` · pending=${out.pending_confirms || 0}`
      + ` · (other volume ignored)`;
  }
  if (out.packet && (action === 'deploy' || action === 'deploy_seeker' || action === 'confirm' || action === 'tick' || action === 'run_now')) {
    const card = formatConfirmCard(out.packet);
    const extra = out.verdict ? `\nVerdict: ${out.verdict.verdict} — ${out.verdict.why}` : '';
    const hid = out.packet.harvest_id ? `\nIngested #${out.packet.harvest_id}` : '';
    const seekerArt = out.seeker && out.seeker.artifact_text ? `\n\n${out.seeker.artifact_text}` : '';
    return `${card}${extra}${hid}${seekerArt}`;
  }
  if (out.work && action === 'propose') {
    return `PM proposes: ${out.work.title} (${out.work.author || '?'}) [${out.work.thread}]\nWhy: ${out.work.why || ''}\nSeeds: ${(out.work.seed_urls || []).slice(0, 3).join(' · ')}`;
  }
  if (out.status) return formatPmStatus(out.status);
  if (out.error) return `Research PM: ${out.error}${out.reason ? ` — ${out.reason}` : ''}`;
  return formatPmStatus();
}

module.exports = {
  pmPath,
  loadState,
  saveState,
  isPmManaging,
  pmModeDefaultOn,
  startPm,
  pausePm,
  resumePm,
  stopPm,
  proposeNextWork,
  acceptSeekerPacket,
  confirmPacket,
  rulesConfirm,
  deploySeeker,
  tickPm,
  dueForPmTick,
  clearSeekerLockAtBoot,
  summarize,
  formatPmStatus,
  formatConfirmCard,
  formatPmToolArtifact,
  pmScorecard,
  getPmStatus,
  runPmTool,
  seedUrlStatus,
  rememberFailedUrl,
  isRememberedDeadUrl,
  normalizeUrlKey,
  urlDeadAliases,
  harvestIdFromIngest,
  substantiveIngest,
  retagMisthreadedSpineKeeps,
  titleLooksSelfView,
  titleLooksHeliopolis,
  SPINE_THREADS,
  SUPPORTING_THREADS,
  DEAD_FLOOR,
  SELF_VIEW_GATE,
};
