/**
 * Thinking EI seeker — reasons about edition / URL / stub risk.
 * Does not ingest. Seed URLs are suggestions. Packet goes to Piko confirm.
 */
const { extractJsonObject } = require('./routingParse');
const { ollamaNativeChat } = require('./llm');
const { toLowerAsciiish, includesAny } = require('./text');

const SPINE_THREADS = [
  'self-view', 'heliopolis', 'premodern-reception', 'abydos', 'giza',
];

function envOn(name, fallback = false) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function seekerModel() {
  return (
    process.env.PIKO_EI_SEEKER_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.PIKO_UNDERSTAND_MODEL
    || process.env.PIKO_LEGATE_MODEL
    || 'qwen3:14b'
  );
}

function parseWork(brief) {
  if (brief && typeof brief === 'object' && !Array.isArray(brief)) {
    return normalizeWork(brief);
  }
  const raw = String(brief || '').trim();
  if (raw.startsWith('{')) {
    try {
      return normalizeWork(JSON.parse(raw));
    } catch (_) { /* fall through */ }
    const extracted = extractJsonObject(raw);
    if (extracted && typeof extracted === 'object') return normalizeWork(extracted);
  }
  return normalizeWork({ title: raw.slice(0, 200), note: raw.slice(0, 800) });
}

function normalizeWork(w) {
  const urls = [];
  const add = (u) => {
    const s = String(u || '').trim();
    if (/^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s);
  };
  for (const u of (w.seed_urls || w.urls || w.seedUrls || [])) add(u);
  if (w.url) add(w.url);
  const ia = w.ia_ids || w.iaIds || [];
  for (const id of ia) {
    const ident = String(id || '').trim();
    if (ident) add(`https://archive.org/details/${ident}`);
  }
  return {
    title: String(w.title || (w.title_hints && w.title_hints[0]) || '').trim().slice(0, 240),
    author: String(w.author || (w.authors && w.authors[0]) || '').trim().slice(0, 160),
    thread: String(w.thread || 'self-view').trim().toLowerCase() || 'self-view',
    why: String(w.why || w.note || '').trim().slice(0, 800),
    seed_urls: urls,
    recrawl_note: String(w.recrawl_note || '').trim().slice(0, 400),
  };
}

/**
 * Perseus hopper viewer → TEI dltext. Archive.org /details is a real edition page.
 */
function iaDjvuTxtUrl(url) {
  const m = String(url || '').match(/archive\.org\/(?:details|download|stream)\/([^/?#]+)/i);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]).replace(/\/+$/, '');
    if (!id) return null;
    return `https://archive.org/stream/${id}/${id}_djvu.txt`;
  } catch (_) {
    return null;
  }
}

function rewriteEditionUrl(url) {
  const u = String(url || '').trim();
  if (!u) return u;
  const low = toLowerAsciiish(u);
  if (low.includes('perseus.tufts.edu/hopper/text?') && !low.includes('/hopper/dltext')) {
    return u.replace(/\/hopper\/text\?/i, '/hopper/dltext?');
  }
  return u;
}

function stubRiskForUrl(url) {
  const u = String(url || '').trim();
  const low = toLowerAsciiish(u);
  if (!u) return { is_stub_risk: true, reason: 'no url' };
  if (low.includes('perseus.tufts.edu/hopper/text?') && !low.includes('/hopper/dltext')) {
    return {
      is_stub_risk: true,
      reason: 'Perseus hopper viewer (not TEI dltext) — recrawl via /hopper/dltext',
      rewrite: rewriteEditionUrl(u),
    };
  }
  if (low.includes('search?') || low.includes('?q=') || low.includes('/search/')) {
    return { is_stub_risk: true, reason: 'search/index URL, not a named edition' };
  }
  if (includesAny(low, ['tripadvisor', 'amazon.com', 'goodreads', 'wikipedia.org/wiki/'])) {
    return { is_stub_risk: true, reason: 'commerce or encyclopedia page, not a primary edition' };
  }
  if (includesAny(low, ['_archive_marc', '_meta.xml', '_files.xml', '_marc.xml'])) {
    return { is_stub_risk: true, reason: 'Archive.org catalog/sidecar XML, not the book' };
  }
  return { is_stub_risk: false, reason: '' };
}

async function probeUrlLive(url, timeoutMs = 10000) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, status: 0 };
  const headers = { 'User-Agent': 'PikoEI/1.0' };
  async function once(method) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(u, { method, redirect: 'follow', signal: ac.signal, headers });
      clearTimeout(t);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, error: String(e && e.message || e).slice(0, 120) };
    }
  }
  let out = await once('HEAD');
  if (!out.ok && (out.status === 0 || out.status === 405 || out.status === 501 || out.status === 403)) {
    out = await once('GET');
  }
  return out;
}

function urlQualityRank(url) {
  const low = toLowerAsciiish(url);
  if (low.includes('/hopper/dltext')) return 0;
  if (low.includes('_djvu.txt') || /\.txt(\?|$)/i.test(url)) return 1;
  if (low.includes('sacred-texts.com')) return 2;
  if (/\.pdf(\?|$)/i.test(url) || low.includes('archive.org/download/')) return 3;
  if (low.includes('perseus.tufts.edu')) return 4;
  if (low.includes('archive.org/details/')) return 5;
  return 6;
}

function heuristicPacket(work) {
  const w = normalizeWork(work);
  const seeds = [...(w.seed_urls || [])].sort((a, b) => urlQualityRank(a) - urlQualityRank(b));
  let chosen = seeds[0] || '';
  let rewrite = '';
  let stub = stubRiskForUrl(chosen);
  if (stub.rewrite) {
    rewrite = stub.rewrite;
    chosen = stub.rewrite;
    stub = stubRiskForUrl(chosen);
  }
  const reasoning = [
    w.author && w.title
      ? `Seeking ${w.title} (${w.author}) for thread ${w.thread}.`
      : `Seeking ${w.title || 'named spine work'} for thread ${w.thread}.`,
    chosen
      ? `Seed URL treated as a suggestion; selected ${chosen}${rewrite ? ' after rewriting the viewer URL to a full-text edition' : ''}.`
      : 'No seed URL on the brief — Piko should not ingest until a real edition URL is found.',
    stub.is_stub_risk
      ? `Stub risk: ${stub.reason}.`
      : 'URL looks like an open edition (Archive.org / TEI / sacred-texts), not a search stub.',
    w.why ? `PM why: ${w.why}` : '',
    w.recrawl_note ? `Recrawl note: ${w.recrawl_note}` : '',
    SPINE_THREADS.includes(w.thread)
      ? 'Spine thread — confirm should ingest only if the edition matches the named work.'
      : 'Supporting thread — only keep if Egyptian self-view spine is already solvent.',
  ].filter(Boolean).join(' ');

  return {
    title: w.title,
    author: w.author,
    thread: w.thread,
    url: chosen,
    edition_note: rewrite
      ? `Rewrote viewer → full-text edition (${rewrite}).`
      : (chosen.includes('archive.org/details/') ? 'Archive.org details page (open scan / OCR).'
        : chosen.includes('/hopper/dltext') ? 'Perseus TEI dltext.'
          : chosen ? 'Open URL from seed pack.' : 'No edition URL yet.'),
    is_stub_risk: !!stub.is_stub_risk,
    stub_reason: stub.reason || '',
    confidence: !chosen ? 0.15 : stub.is_stub_risk ? 0.35 : 0.78,
    reasoning,
    seed_urls_considered: seeds.slice(0, 8),
    recommend: !chosen ? 'ask_piko' : stub.is_stub_risk ? 'recrawl' : 'ingest',
    connector_hint: chosen.includes('/hopper/dltext') || chosen.includes('.xml')
      ? 'web_document'
      : (/\.pdf(\?|$)/i.test(chosen) ? 'web_pdf' : 'web_text'),
  };
}

async function llmEnrich(work, base) {
  if (!envOn('PIKO_EI_SEEKER_LLM', false)) return null;
  const w = normalizeWork(work);
  const sys = `You are an Egyptian Insights research seeker (thinking agent).
Pick ONE open edition URL for the named work. Seed URLs are suggestions, not orders.
Prefer primary / pre-modern editions (TEI, Archive.org scans, sacred-texts books).
Never invent paywalled or hallucinated URLs. If seeds are wrong, say so.
Return JSON only:
{"url":"https://...","edition_note":"...","is_stub_risk":false,"confidence":0.0,"reasoning":"2-5 sentences","recommend":"ingest|skip|ask_piko|recrawl","connector_hint":"web_document|web_pdf|web_text"}`;
  const user = [
    `Work: ${w.title || '?'}`,
    `Author: ${w.author || '?'}`,
    `Thread: ${w.thread}`,
    w.why ? `Why: ${w.why}` : '',
    w.recrawl_note ? `Recrawl: ${w.recrawl_note}` : '',
    `Seed URLs:\n${(w.seed_urls || []).map((u) => `- ${u}`).join('\n') || '(none)'}`,
    `Heuristic draft URL: ${base.url || '(none)'}`,
  ].filter(Boolean).join('\n');
  try {
    const raw = await ollamaNativeChat(seekerModel(), [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], { temperature: 0.2, max_tokens: 700, lane: 'worker' });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const url = String(parsed.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) return null;
    const chosen = url ? rewriteEditionUrl(url) : base.url;
    const stub = stubRiskForUrl(chosen);
    return {
      ...base,
      url: chosen,
      edition_note: String(parsed.edition_note || base.edition_note || '').slice(0, 400),
      is_stub_risk: stub.is_stub_risk || !!parsed.is_stub_risk,
      stub_reason: stub.reason || base.stub_reason || '',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence != null ? parsed.confidence : base.confidence) || 0)),
      reasoning: String(parsed.reasoning || base.reasoning || '').slice(0, 1600),
      recommend: String(parsed.recommend || base.recommend || 'ask_piko').toLowerCase(),
      connector_hint: String(parsed.connector_hint || base.connector_hint || '').slice(0, 40),
      llm: true,
    };
  } catch (_) {
    return null;
  }
}

function formatPacketArtifact(packet) {
  const p = packet || {};
  return [
    `[ei-seeker / reasoning packet]`,
    `Work: ${p.title || '?'} — ${p.author || 'unknown author'}`,
    `Thread: ${p.thread || '?'}`,
    `URL: ${p.url || '(none)'}`,
    `Edition: ${p.edition_note || '—'}`,
    `Stub risk: ${p.is_stub_risk ? `yes (${p.stub_reason || 'unspecified'})` : 'no'}`,
    `Confidence: ${p.confidence != null ? p.confidence : '?'}`,
    `Recommend: ${p.recommend || '?'}`,
    `Reasoning: ${p.reasoning || '(missing — not a thinking seeker)'}`,
    p.seed_urls_considered && p.seed_urls_considered.length
      ? `Seeds considered: ${p.seed_urls_considered.slice(0, 4).join(' · ')}`
      : '',
  ].filter(Boolean).join('\n');
}

function packetIsThinking(packet) {
  const p = packet || {};
  const reason = String(p.reasoning || '').trim();
  return reason.length >= 40 && !/^kept:\s*\d+$/i.test(reason);
}

async function runEiSeeker(brief, ctx = {}) {
  if (typeof ctx.onProgress === 'function') {
    try { ctx.onProgress({ stage: 'running', message: 'Seeker reasoning about edition / URL…' }); } catch (_) { /* ok */ }
  }
  const work = parseWork(brief);
  let packet = heuristicPacket(work);
  const enriched = await llmEnrich(work, packet);
  if (enriched) packet = enriched;
  packet.work = work;
  try {
    const pm = require('./eiResearchPm');
    packet = pm.acceptSeekerPacket(packet);
  } catch (_) { /* PM optional when unit-testing seeker alone */ }
  const thinking = packetIsThinking(packet);
  return {
    status: thinking && packet.url ? 'ok' : (thinking ? 'needs_revision' : 'needs_revision'),
    artifact_text: formatPacketArtifact(packet),
    result: { packet, thinking, pass: !!(thinking && packet.url && !packet.is_stub_risk) },
  };
}

module.exports = {
  parseWork,
  normalizeWork,
  rewriteEditionUrl,
  iaDjvuTxtUrl,
  stubRiskForUrl,
  probeUrlLive,
  urlQualityRank,
  heuristicPacket,
  formatPacketArtifact,
  packetIsThinking,
  runEiSeeker,
  SPINE_THREADS,
};
