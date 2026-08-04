/**
 * WP11 W3 — Stance synthesis: position papers per research thread/topic.
 * Stored under culturesDataRoot()/positions/<slug>.json
 * Worker-lane LLM only; cites corpus notes only (no outside claims).
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot } = require('./culturesCorpusApi');
const { THREAD_DEFS, notesForThread, matchThreadId, getThreadDef } = require('./eiThreadDossiers');
const { notesForQuery } = require('./eiCorpusNotes');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { slugify, includesAny } = require('./text');

const MIN_NOTES = 3;
const CONFIDENCE = new Set(['low', 'medium', 'high']);

function positionsDir() {
  return path.join(culturesDataRoot(), 'positions');
}

function positionPath(slug) {
  return path.join(positionsDir(), `${String(slug)}.json`);
}

function topicSlug(topic) {
  const thread = matchThreadId(topic);
  if (thread) return thread;
  return slugify(String(topic || '').slice(0, 80), { sep: '-' }) || 'unknown';
}

function loadPosition(slugOrTopic) {
  const slug = String(slugOrTopic || '').includes(' ')
    ? topicSlug(slugOrTopic)
    : String(slugOrTopic || '').trim();
  if (!slug) return null;
  const p = positionPath(slug);
  if (!fs.existsSync(p)) {
    // try topic → slug
    const alt = topicSlug(slugOrTopic);
    if (alt !== slug && fs.existsSync(positionPath(alt))) {
      try {
        return JSON.parse(fs.readFileSync(positionPath(alt), 'utf8'));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listPositions() {
  const dir = positionsDir();
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

function savePosition(pos) {
  fs.mkdirSync(positionsDir(), { recursive: true });
  const slug = String(pos.slug || topicSlug(pos.topic));
  const out = { ...pos, slug };
  fs.writeFileSync(positionPath(slug), JSON.stringify(out, null, 2));
  return out;
}

function formatPositionBlock(pos) {
  if (!pos) return '';
  const lines = [
    `STANCE (${pos.topic || pos.slug}): ${String(pos.stance || '').slice(0, 600)}`,
    `confidence: ${pos.confidence || 'low'}`,
  ];
  for (const r of (pos.reasons || []).slice(0, 5)) {
    const srcs = Array.isArray(r.sources) ? r.sources.slice(0, 4).join('; ') : '';
    lines.push(`- ${String(r.point || '').slice(0, 240)}${srcs ? ` [${srcs}]` : ''}`);
  }
  if (Array.isArray(pos.open_questions) && pos.open_questions.length) {
    lines.push(`Open: ${pos.open_questions.slice(0, 3).map(String).join('; ')}`);
  }
  return lines.join('\n').slice(0, 2000);
}

/**
 * Find the best position for a user message (thread match first, then slug scan).
 */
function findPositionForQuery(query) {
  const thread = matchThreadId(query);
  if (thread) {
    const p = loadPosition(thread);
    if (p) return p;
  }
  const q = String(query || '').toLowerCase();
  const all = listPositions();
  let best = null;
  let bestScore = 0;
  for (const p of all) {
    const blob = `${p.topic || ''} ${p.slug || ''} ${p.stance || ''}`.toLowerCase();
    let score = 0;
    const toks = q.split(' ').filter((t) => t.length > 3);
    for (const t of toks) {
      if (blob.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore > 0 ? best : null;
}

function stanceModel() {
  return (
    process.env.PIKO_EI_WORK_PLANNER_MODEL
    || process.env.PIKO_HEAVY_MODEL
    || process.env.OLLAMA_MODEL
    || 'qwen3:14b'
  );
}

function normalizePosition(parsed, topic, slug, notes) {
  const allowedTitles = new Set(
    notes.map((n) => String(n.title || '').toLowerCase()).filter(Boolean),
  );
  const allowedAuthors = new Set(
    notes.map((n) => String(n.author || '').toLowerCase()).filter(Boolean),
  );
  const reasons = [];
  for (const r of Array.isArray(parsed.reasons) ? parsed.reasons : []) {
    if (!r || typeof r !== 'object') continue;
    const point = String(r.point || '').trim();
    if (!point) continue;
    const sources = (Array.isArray(r.sources) ? r.sources : [])
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    // Prefer sources that mention known titles/authors; keep others short if present
    const grounded = sources.filter((s) => {
      const low = s.toLowerCase();
      for (const t of allowedTitles) {
        if (t && includesAny(low, [t.slice(0, 24)])) return true;
      }
      for (const a of allowedAuthors) {
        if (a && includesAny(low, [a.slice(0, 16)])) return true;
      }
      return false;
    });
    reasons.push({
      point: point.slice(0, 400),
      sources: (grounded.length ? grounded : sources).slice(0, 4),
    });
    if (reasons.length >= 5) break;
  }
  let confidence = String(parsed.confidence || 'low').toLowerCase();
  if (!CONFIDENCE.has(confidence)) confidence = 'low';
  return {
    topic,
    slug,
    stance: String(parsed.stance || '').slice(0, 800),
    confidence,
    reasons,
    open_questions: (Array.isArray(parsed.open_questions) ? parsed.open_questions : [])
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6),
    updated_at: new Date().toISOString(),
    sources_count: notes.length,
  };
}

async function synthesizePositionForThread(threadId, opts = {}) {
  const def = getThreadDef(threadId);
  if (!def) return { ok: false, error: 'unknown_thread', thread: threadId };
  const notes = notesForThread(threadId, { limit: 100 }).slice(0, opts.maxNotes || 12);
  if (notes.length < (opts.minNotes != null ? opts.minNotes : MIN_NOTES)) {
    return { ok: false, error: 'insufficient_notes', thread: threadId, notes: notes.length };
  }
  const noteBlock = notes.map((n) => {
    return [
      `${n.title || 'untitled'}${n.author ? ` — ${n.author}` : ''}`,
      n.summary ? `  Summary: ${n.summary}` : '',
      (n.claims || []).length ? `  Claims: ${n.claims.slice(0, 5).join('; ')}` : '',
      (n.disagreements || []).length ? `  Disagreements: ${n.disagreements.slice(0, 2).join('; ')}` : '',
      (n.open_questions || []).length ? `  Open: ${n.open_questions.slice(0, 3).join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const chatFn = opts.chatFn || ollamaNativeChat;
  const model = opts.model || stanceModel();
  const raw = await chatFn(model, [
    {
      role: 'system',
      content: `You synthesize YOUR position paper from corpus notes only.
Return JSON only:
{"stance":"2-4 sentences stating where YOU land","confidence":"low|medium|high","reasons":[{"point":"...","sources":["Title — Author"]}],"open_questions":["..."]}
Rules:
- stance must take a clear position in the first sentence.
- reasons must cite titles/authors present in the NOTES below — never invent sources.
- Hedge only where notes genuinely conflict; say what conflicts.
- No claims from outside the notes.`,
    },
    {
      role: 'user',
      content: `TOPIC: ${def.label}\n\nNOTES:\n${noteBlock}`,
    },
  ], {
    format: 'json',
    temperature: 0.2,
    max_tokens: 900,
    num_ctx: Number(process.env.PIKO_EI_WORK_PLANNER_NUM_CTX || 8192),
    timeoutMs: Math.max(8000, Number(process.env.PIKO_EI_WORK_PLANNER_TIMEOUT_MS || 90000)),
    priority: 'background',
    lane: 'worker',
    tag: 'eiStanceSynthesis',
  });

  let parsed = {};
  try {
    parsed = extractJsonObject(raw) || {};
  } catch (_) {
    parsed = {};
  }
  if (!parsed.stance) {
    return { ok: false, error: 'empty_stance', thread: threadId };
  }
  const pos = normalizePosition(parsed, def.label, def.id, notes);
  savePosition(pos);
  return { ok: true, position: pos };
}

/**
 * Daily job: synthesize/update positions for all threads with enough notes.
 * Caps LLM calls per run (default 3) to bound cost.
 */
async function runStanceSynthesis(opts = {}) {
  const max = Math.max(1, Number(opts.maxThreads || process.env.PIKO_STANCE_SYNTHESIS_MAX || 3));
  const rebuilt = [];
  const skipped = [];
  for (const def of THREAD_DEFS) {
    if (rebuilt.length >= max) break;
    const notes = notesForThread(def.id, { limit: 100 });
    if (notes.length < MIN_NOTES) {
      skipped.push({ thread: def.id, reason: 'insufficient_notes', notes: notes.length });
      continue;
    }
    const existing = loadPosition(def.id);
    if (existing && Number(existing.sources_count || 0) === notes.length && !opts.force) {
      skipped.push({ thread: def.id, reason: 'up_to_date', notes: notes.length });
      continue;
    }
    try {
      const out = await synthesizePositionForThread(def.id, opts);
      if (out.ok) rebuilt.push(out.position);
      else skipped.push({ thread: def.id, reason: out.error, notes: notes.length });
    } catch (e) {
      skipped.push({ thread: def.id, reason: String(e && e.message ? e.message : e).slice(0, 160) });
    }
  }
  return { ok: true, rebuilt: rebuilt.length, positions: rebuilt, skipped };
}

/**
 * Topic-matched corpus material for opinion prompts (stance first, then notes).
 */
function gatherOpinionMaterial(query, opts = {}) {
  const top = opts.top || 6;
  const position = findPositionForQuery(query);
  let notes = [];
  try {
    notes = notesForQuery(query, { top, limit: 40 });
  } catch (_) {
    notes = [];
  }
  // If thread matched but notesForQuery thin, pull thread notes
  const thread = matchThreadId(query);
  if (thread && notes.length < 2) {
    try {
      notes = notesForThread(thread, { limit: 40 }).slice(0, top);
    } catch (_) { /* keep */ }
  }
  const parts = [];
  if (position) {
    parts.push(formatPositionBlock(position));
  }
  if (notes.length) {
    const noteLines = ['Corpus notes (cite by title/author):'];
    for (const n of notes.slice(0, top)) {
      noteLines.push(`• ${n.title || 'untitled'}${n.author ? ` — ${n.author}` : ''}`);
      if (n.summary) noteLines.push(`  ${String(n.summary).slice(0, 280)}`);
      if (n.claims && n.claims.length) {
        noteLines.push(`  Claims: ${n.claims.slice(0, 3).join('; ')}`);
      }
      if (n.disagreements && n.disagreements.length) {
        noteLines.push(`  Disagreements: ${n.disagreements.slice(0, 2).join('; ')}`);
      }
    }
    parts.push(noteLines.join('\n').slice(0, 3500));
  }
  return {
    position,
    notes,
    has_material: !!(position || notes.length),
    block: parts.join('\n\n').slice(0, 5000),
    thread: thread || null,
  };
}

module.exports = {
  positionsDir,
  positionPath,
  topicSlug,
  loadPosition,
  listPositions,
  savePosition,
  formatPositionBlock,
  findPositionForQuery,
  gatherOpinionMaterial,
  synthesizePositionForThread,
  runStanceSynthesis,
  MIN_NOTES,
};
