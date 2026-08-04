/**
 * EI corpus RAG — chunk kept harvest texts into LanceDB for chat retrieval.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot, getItem, listItems } = require('./culturesCorpusApi');
const { resolveReadableContent } = require('./eiCorpusContentReview');

const TABLE_NAME = 'ei_corpus_chunks';

const {
  collapseWhitespace,
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
} = require('./text');

function memoryDir() {
  const base = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(base, 'ei_corpus_memory');
}

let _db = null;
let _table = null;
let _embedder = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  const { pipeline } = require('@xenova/transformers');
  _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return _embedder;
}

async function embed(text) {
  const ext = await getEmbedder();
  const result = await ext(String(text || '').slice(0, 512), {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(result.data);
}

async function getTable() {
  if (_table) return _table;
  const lancedb = require('@lancedb/lancedb');
  const dir = memoryDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = await lancedb.connect(dir);
  const names = await _db.tableNames();
  if (names.includes(TABLE_NAME)) {
    _table = await _db.openTable(TABLE_NAME);
  } else {
    const vec = await embed('placeholder');
    _table = await _db.createTable(TABLE_NAME, [{
      text: 'placeholder',
      vector: vec,
      harvest_id: 0,
      title: '',
      author: '',
      chunk_i: 0,
    }]);
    try { await _table.delete('harvest_id = 0'); } catch (_) { /* ok */ }
  }
  return _table;
}

function chunkText(text, size = 900, overlap = 120) {
  const t = collapseWhitespace(text);
  if (!t) return [];
  const chunks = [];
  let i = 0;
  while (i < t.length && chunks.length < 40) {
    chunks.push(t.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

async function indexHarvest(harvestId, opts = {}) {
  if (process.env.PIKO_EI_CORPUS_RAG === 'off') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const hid = Number(harvestId);
  const got = getItem(hid);
  if (!got.ok || !got.item) return { ok: false, error: 'not_found' };
  const content = await resolveReadableContent(got.item);
  if (content.kind === 'none' || !content.text) {
    return { ok: false, error: 'no_text', harvest_id: hid };
  }
  const title = got.item.title || '';
  const author = (got.item.meta && (got.item.meta.author || got.item.meta.work_author)) || '';
  const chunks = chunkText(content.text, opts.chunkSize || 900);
  if (!chunks.length) return { ok: false, error: 'empty_chunks' };

  const tbl = await getTable();
  try {
    await tbl.delete(`harvest_id = ${hid}`);
  } catch (_) { /* first index */ }

  const rows = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const text = `Title: ${title}\nAuthor: ${author}\n\n${chunks[i]}`.slice(0, 4000);
    const vector = await embed(text);
    rows.push({
      text,
      vector,
      harvest_id: hid,
      title: String(title).slice(0, 200),
      author: String(author).slice(0, 120),
      chunk_i: i,
    });
  }
  await tbl.add(rows);
  return { ok: true, harvest_id: hid, chunks: rows.length, title };
}

async function indexKeptCorpus(opts = {}) {
  const limit = Math.max(1, Math.min(80, Number(opts.limit || 40)));
  let items = [];
  try {
    const listed = listItems({ limit, flag: 'keep' });
    items = listed.items || [];
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const results = [];
  for (const it of items) {
    try {
      results.push(await indexHarvest(it.id, opts));
    } catch (e) {
      results.push({ ok: false, harvest_id: it.id, error: String(e.message || e).slice(0, 120) });
    }
  }
  return {
    ok: true,
    indexed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

async function searchCorpus(query, opts = {}) {
  if (process.env.PIKO_EI_CORPUS_RAG === 'off') return [];
  const limit = Math.min(12, Math.max(1, opts.limit || 5));
  try {
    const vec = await embed(query);
    const tbl = await getTable();
    const results = await tbl.vectorSearch(vec).limit(limit).toArray();
    return (results || []).map((r) => ({
      text: String(r.text || ''),
      harvest_id: r.harvest_id,
      title: r.title || '',
      author: r.author || '',
    })).filter((r) => r.text);
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[eiCorpusRag] search:', e.message);
    return [];
  }
}

/**
 * Format RAG block for chat prompts with title citations (no file paths).
 */
function formatRagBlock(hits) {
  if (!hits || !hits.length) return '';
  const lines = ['Relevant passages from your research corpus (cite by title only):'];
  for (const h of hits.slice(0, 5)) {
    const cite = [h.title, h.author].filter(Boolean).join(' — ') || `item #${h.harvest_id}`;
    let body = String(h.text || '');
    if (body.startsWith('Title:')) {
      const aIdx = body.indexOf('\nAuthor:');
      if (aIdx >= 0) {
        const afterAuthor = body.indexOf('\n\n', aIdx);
        if (afterAuthor >= 0) body = body.slice(afterAuthor + 2);
      }
    }
    body = body.slice(0, 500);
    lines.push(`\n[${cite}]\n${body}`);
  }
  const { wrapQuotedMaterial, SYSTEM_INSTRUCTION } = require('./promptBoundary');
  return `${SYSTEM_INSTRUCTION}\n${wrapQuotedMaterial(lines.join('\n'), { source: 'corpus_rag', maxChars: 4000 })}`;
}

async function getCorpusRagContext(query) {
  if (!query || typeof query !== 'string') return '';
  // Only inject for research-shaped questions
  const q = toLowerAsciiish(query);
  const researchHints = ['schoch','petrie','dunn','hancock','west','sphinx','pyramid','egypt','corpus','labyrinth','mariette','lepsius','what does','according to','in the book','in the text','in the volume','tell me about','summarise','summarize','compare'];
  const questionWords = ['who','what','why','how','when','where'];
  if (!includesAny(q, researchHints) && !hasAnyWord(q, questionWords)) return '';
  try {
    const hits = await searchCorpus(query, { limit: 5 });
    return formatRagBlock(hits);
  } catch (_) {
    return '';
  }
}

/** Remove all RAG chunks for a harvest id (used by quarantine/hard-delete). */
async function removeHarvestChunks(harvestId) {
  const hid = Number(harvestId);
  if (!Number.isFinite(hid) || hid <= 0) return { ok: false, error: 'invalid id' };
  try {
    const tbl = await getTable();
    await tbl.delete(`harvest_id = ${hid}`);
    return { ok: true, harvest_id: hid };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}

module.exports = {
  indexHarvest,
  indexKeptCorpus,
  searchCorpus,
  formatRagBlock,
  getCorpusRagContext,
  removeHarvestChunks,
  memoryDir,
  chunkText,
};
