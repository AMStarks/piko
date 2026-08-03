/**
 * Bibliography extract + expand edges store.
 * Hybrid loop: auto-seek citations; keep strong matches; surface unsures.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot, getItem, listItems } = require('./culturesCorpusApi');
const { resolveReadableContent } = require('./eiCorpusContentReview');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { normalizeTitle, titleMatchScore, authorMatch } = require('./eiGoalParse');

function edgesPath() {
  return path.join(culturesDataRoot(), 'bibliography_edges.jsonl');
}

function notesDir() {
  return path.join(culturesDataRoot(), 'corpus_notes');
}

function appendEdge(edge) {
  const p = edgesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const line = JSON.stringify({ ...edge, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(p, line);
  return true;
}

function loadEdges(limit = 5000) {
  const p = edgesPath();
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-limit);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch (_) { /* skip */ }
  }
  return out;
}

function alreadyChased(fromId, author, title) {
  const key = `${normalizeTitle(author)}|${normalizeTitle(title)}`;
  return loadEdges().some((e) => {
    if (Number(e.from_id) !== Number(fromId)) return false;
    const k = `${normalizeTitle(e.candidate_author)}|${normalizeTitle(e.candidate_title)}`;
    return k === key && e.outcome && e.outcome !== 'queued';
  });
}

function getModel() {
  return (
    process.env.PIKO_EI_BIBLIO_MODEL
    || process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

/**
 * Extract cited works from a kept harvest item's readable text.
 */
async function extractBibliography(harvestId, opts = {}) {
  const hid = Number(harvestId);
  const got = getItem(hid);
  if (!got.ok || !got.item) {
    return { ok: false, error: 'item_not_found', harvest_id: hid, citations: [] };
  }
  const content = await resolveReadableContent(got.item);
  if (content.kind === 'none' || !content.text) {
    return { ok: false, error: 'no_readable_text', harvest_id: hid, citations: [] };
  }
  // Prefer the tail of the document (bibliographies) + a mid sample.
  const text = String(content.text);
  const charLimit = Number(opts.contentChars || process.env.PIKO_EI_BIBLIO_CHARS || 14000);
  const head = text.slice(0, Math.floor(charLimit * 0.25));
  const tail = text.slice(-Math.floor(charLimit * 0.75));
  const sample = head === tail ? text.slice(0, charLimit) : `${head}\n\n[…]\n\n${tail}`;

  const raw = await ollamaNativeChat(getModel(), [
    {
      role: 'system',
      content: `You extract bibliographic citations from scholarly / historical texts about Egypt or related topics.
Return JSON only: {"citations":[{"author":"...","title":"...","year":null,"why_cited":"short"}]}
Rules:
- Prefer works cited in a bibliography, footnotes, or "further reading".
- Max 12 citations. Skip URLs-only and publisher ads.
- author/title must be real work names, not chapter headings.`,
    },
    {
      role: 'user',
      content: [
        `SOURCE title: ${got.item.title || ''}`,
        `SOURCE id: #${hid}`,
        '',
        sample,
      ].join('\n'),
    },
  ], {
    format: 'json',
    temperature: 0.1,
    max_tokens: 900,
    num_ctx: Number(process.env.PIKO_EI_BIBLIO_NUM_CTX || 8192),
    timeoutMs: Math.max(15000, Number(process.env.PIKO_EI_BIBLIO_TIMEOUT_MS || 120000)),
    priority: 'background',
    lane: 'worker',
  });

  const parsed = extractJsonObject(raw) || {};
  const citations = [];
  const seen = new Set();
  for (const c of (parsed.citations || [])) {
    const author = String(c.author || '').trim().slice(0, 120);
    const title = String(c.title || '').trim().slice(0, 200);
    if (!title || title.length < 4) continue;
    const key = `${normalizeTitle(author)}|${normalizeTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      author: author || null,
      title,
      year: c.year != null ? Number(c.year) || null : null,
      why_cited: String(c.why_cited || '').slice(0, 200),
    });
  }

  // Dedupe against corpus titles
  let corpusTitles = [];
  try {
    const listed = listItems({ limit: 200, flag: 'keep' });
    corpusTitles = (listed.items || []).map((it) => ({
      id: it.id,
      title: it.title,
      author: (it.meta && (it.meta.author || it.meta.work_author)) || '',
    }));
  } catch (_) { /* ok */ }

  const enriched = citations.map((c) => {
    let inCorpus = null;
    for (const it of corpusTitles) {
      const score = titleMatchScore(c.title, it.title || '');
      const authOk = !c.author || !it.author || authorMatch(c.author, it.author);
      if (score >= 0.85 && authOk) {
        inCorpus = it.id;
        break;
      }
    }
    return { ...c, in_corpus_id: inCorpus, already_chased: alreadyChased(hid, c.author, c.title) };
  });

  return {
    ok: true,
    harvest_id: hid,
    source_title: got.item.title || '',
    citations: enriched,
    count: enriched.length,
  };
}

/**
 * Expand: extract citations → seek each (capped) → mission-fit.
 */
async function expandFromItem(harvestId, opts = {}) {
  const limit = Math.max(1, Math.min(10, Number(opts.limit || process.env.PIKO_EI_BIBLIO_EXPAND_LIMIT || 5)));
  const queueOnly = !!opts.queueOnly;
  const extracted = await extractBibliography(harvestId, opts);
  if (!extracted.ok) return { ...extracted, expanded: [], sought: 0, queued: 0 };

  const candidates = (extracted.citations || [])
    .filter((c) => !c.in_corpus_id && !c.already_chased)
    .slice(0, limit);

  // Campaign compounding path: persist queued edges for mineBibliographyLeads;
  // do not seek inline (avoids burning attempts before campaign reformulation).
  if (queueOnly) {
    let queued = 0;
    for (const c of candidates) {
      appendEdge({
        from_id: Number(harvestId),
        candidate_author: c.author,
        candidate_title: c.title,
        outcome: 'queued',
        why: c.why_cited,
      });
      queued += 1;
    }
    return {
      ok: true,
      harvest_id: Number(harvestId),
      source_title: extracted.source_title,
      extracted_count: extracted.count,
      sought: 0,
      queued,
      expanded: [],
      citations: extracted.citations,
      queue_only: true,
    };
  }

  const { runTool } = require('./eiAgentTools');
  const expanded = [];
  let sought = 0;

  for (const c of candidates) {
    const query = [c.title && `"${c.title}"`, c.author, 'PDF'].filter(Boolean).join(' ');
    const mission = c.author
      ? `Please find and add to Corpus ${c.author}'s ${c.title}`
      : `Please find and add to Corpus ${c.title}`;
    appendEdge({
      from_id: Number(harvestId),
      candidate_author: c.author,
      candidate_title: c.title,
      outcome: 'queued',
      why: c.why_cited,
    });
    sought += 1;
    let out;
    try {
      out = await runTool('seek_files', {
        query,
        limit: 8,
        max_keeps: 1,
      }, {
        goal: mission,
        rootDir: opts.rootDir,
        source: 'ei_biblio_expand',
        pikoUserId: opts.pikoUserId || 'agent:ei-biblio',
      });
    } catch (e) {
      appendEdge({
        from_id: Number(harvestId),
        candidate_author: c.author,
        candidate_title: c.title,
        outcome: 'error',
        error: String(e.message || e).slice(0, 160),
      });
      expanded.push({ ...c, outcome: 'error', error: String(e.message || e).slice(0, 120) });
      continue;
    }
    const mf = out.mission_fit || (out.result && out.result.mission_fit);
    const keeps = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'keep' && !j.purged);
    const unsures = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'unsure' && !j.purged);
    let outcome = 'empty';
    if (keeps.length) outcome = 'keep';
    else if (unsures.length) outcome = 'unsure';
    else if (mf && Number((mf.counts || {}).drop) > 0) outcome = 'drop';
    else if (!out.ok) outcome = 'seek_failed';

    appendEdge({
      from_id: Number(harvestId),
      candidate_author: c.author,
      candidate_title: c.title,
      outcome,
      keep_ids: keeps.map((j) => j.harvest_id),
      unsure_ids: unsures.map((j) => j.harvest_id),
      seek_coverage: out.seek_coverage || null,
    });
    expanded.push({
      ...c,
      outcome,
      keeps: keeps.map((j) => ({ id: j.harvest_id, title: j.work_title || j.title })),
      unsures: unsures.map((j) => ({ id: j.harvest_id, title: j.work_title || j.title, why: j.why })),
    });
  }

  return {
    ok: true,
    harvest_id: Number(harvestId),
    source_title: extracted.source_title,
    extracted_count: extracted.count,
    sought,
    expanded,
    citations: extracted.citations,
  };
}

function formatExpandReport(report) {
  if (!report || !report.ok) {
    return `Bibliography expand failed: ${(report && report.error) || 'unknown'}`;
  }
  const lines = [
    `Bibliography expand from #${report.harvest_id} (${(report.source_title || '').slice(0, 60)}):`,
    `  extracted=${report.extracted_count} · sought=${report.sought}`,
  ];
  for (const e of report.expanded || []) {
    lines.push(`  [${e.outcome}] ${(e.title || '').slice(0, 50)} — ${e.author || '?'}`);
  }
  const unsures = (report.expanded || []).flatMap((e) => e.unsures || []);
  if (unsures.length) {
    lines.push('  Unsure (needs your call):');
    for (const u of unsures.slice(0, 6)) {
      lines.push(`    #${u.id} ${(u.title || '').slice(0, 60)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  extractBibliography,
  expandFromItem,
  formatExpandReport,
  appendEdge,
  loadEdges,
  edgesPath,
  notesDir,
};
