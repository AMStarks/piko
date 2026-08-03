/**
 * Hybrid Memory — Semantic Subconscious (LanceDB vector store).
 * Uses Xenova/transformers for local embeddings; no external API.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'piko_memory');
const TABLE_NAME = 'piko_memory';

let _db = null;
let _table = null;
let _embedder = null;

async function getDb() {
  if (_db) return _db;
  const lancedb = require('@lancedb/lancedb');
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  _db = await lancedb.connect(MEMORY_DIR);
  return _db;
}

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
  const db = await getDb();
  const names = await db.tableNames();
  if (names.includes(TABLE_NAME)) {
    _table = await db.openTable(TABLE_NAME);
  } else {
    const vec = await embed('placeholder');
    _table = await db.createTable(TABLE_NAME, [
      {
        text: 'placeholder',
        vector: vec,
        sessionId: '',
        timestamp: Date.now(),
      },
    ]);
    try {
      await _table.delete("text = 'placeholder'");
    } catch (_) {}
  }
  return _table;
}

/**
 * Search the vector store for past context matching the query.
 * @param {string} query - Natural language query
 * @param {{ limit?: number }} [opts] - limit (default 5)
 * @returns {Promise<Array<{ text: string, sessionId?: string, timestamp?: number }>>}
 */
async function search(query, opts = {}) {
  const limit = Math.min(20, Math.max(1, opts.limit || 5));
  try {
    const vec = await embed(query);
    const tbl = await getTable();
    const results = await tbl.vectorSearch(vec).limit(limit).toArray();
    return (results || []).map((r) => ({
      text: r.text != null ? String(r.text) : '',
      sessionId: r.sessionId,
      timestamp: r.timestamp,
    })).filter((r) => r.text);
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[vectorMemory] search:', e.message);
    return [];
  }
}

/**
 * Add a text entry to the vector store.
 * @param {string} text - Content to embed and store
 * @param {{ sessionId?: string }} [metadata] - Optional metadata
 */
async function add(text, metadata = {}) {
  if (!text || !String(text).trim()) return;
  try {
    const vec = await embed(text);
    const tbl = await getTable();
    await tbl.add([
      {
        text: String(text).slice(0, 4000),
        vector: vec,
        sessionId: String(metadata.sessionId || ''),
        timestamp: metadata.timestamp ?? Date.now(),
      },
    ]);
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[vectorMemory] add:', e.message);
  }
}

const DATA_SOUL_PATH = path.join(DATA_DIR, 'SOUL.md');
const IDLE_FLUSH_MS = Math.max(60000, parseInt(process.env.PIKO_MEMORY_IDLE_FLUSH_MS, 10) || 5 * 60 * 1000);

/** Per-session idle timers for flushing to vector memory. */
const idleTimers = new Map();

function appendToDataSoul(text) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const existing = fs.existsSync(DATA_SOUL_PATH)
      ? fs.readFileSync(DATA_SOUL_PATH, 'utf8').trim()
      : '';
    const line = `\n- ${String(text).trim().slice(0, 500)}`;
    fs.writeFileSync(DATA_SOUL_PATH, (existing + line).trim() + '\n', 'utf8');
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[vectorMemory] appendToDataSoul:', e.message);
  }
}

/**
 * Flush session history to vector memory. Gets history, summarizes via LLM, embeds and adds.
 * Call before session clear or on idle.
 * @param {string} sessionKey
 * @param {{ summarize: (history) => Promise<string> }} [opts] - Optional summarizer; defaults to LLM.
 */
async function flushSessionToVectorMemory(sessionKey, opts = {}) {
  const sessionStore = require('./sessionStore');
  const history = sessionStore.getHistory(sessionKey);
  if (!history || history.length < 2) return;
  let summary;
  if (opts.summarize) {
    summary = await opts.summarize(history);
  } else {
    try {
      const { ollamaNativeChat } = require('./llm');
      const convText = history.map((m) => `${m.role}: ${(m.content || '').slice(0, 300)}`).join('\n');
      const prompt = `Summarize this conversation in 2-4 sentences. Capture key topics, decisions, and outcomes. Be concise.\n\n${convText.slice(0, 2000)}`;
      summary = await ollamaNativeChat(process.env.OLLAMA_MODEL || 'llama3.1:latest', [{ role: 'user', content: prompt }], { temperature: 0.3, max_tokens: 150 });
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[vectorMemory] flush summarize:', e.message);
      summary = history.map((m) => `${m.role}: ${(m.content || '').slice(0, 100)}`).join(' | ').slice(0, 500);
    }
  }
  if (summary && String(summary).trim()) {
    await add(String(summary).trim(), { sessionId: sessionKey, timestamp: Date.now() });
  }
}

/**
 * Schedule an idle flush for this session. Resets any existing timer.
 * @param {string} sessionKey
 */
function scheduleIdleFlush(sessionKey) {
  if (idleTimers.has(sessionKey)) {
    clearTimeout(idleTimers.get(sessionKey));
  }
  const timer = setTimeout(() => {
    idleTimers.delete(sessionKey);
    flushSessionToVectorMemory(sessionKey).catch((e) => {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[vectorMemory] idle flush:', e.message);
    });
  }, IDLE_FLUSH_MS);
  idleTimers.set(sessionKey, timer);
}

module.exports = {
  search,
  add,
  embed,
  appendToDataSoul,
  flushSessionToVectorMemory,
  scheduleIdleFlush,
};
