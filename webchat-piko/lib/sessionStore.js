/**
 * SQLite-backed conversation store. Replaces in-memory sessions Map so history survives restarts.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'conversations.db');
const MAX_HISTORY = Math.max(
  50,
  Math.min(2000, Number(process.env.PIKO_CHAT_HISTORY_MAX || 500) || 500),
);

let db = null;

function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation (
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation(session_id);
    `);
    return db;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore]', e.message);
    return null;
  }
}

function getHistory(sessionId) {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database.prepare(
      'SELECT role, content, created_at FROM conversation WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId);
    const last = rows.slice(-MAX_HISTORY);
    return last.map((r) => ({
      role: r.role,
      content: r.content || '',
      created_at: r.created_at || null,
    }));
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] getHistory', e.message);
    return [];
  }
}

function append(sessionId, role, content) {
  const database = getDb();
  if (!database) return false;
  try {
    let text = String(content);
    if (role === 'assistant') {
      try {
        text = require('./operatorVoice').polishOutbound(text);
      } catch (_) {}
    }
    const created = new Date().toISOString();
    database.prepare(
      'INSERT INTO conversation (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, text.slice(0, 100000), created);
    try {
      require('./transcriptCapture').captureTurn(sessionId, role, text);
    } catch (_) {}

    database.prepare(`
      DELETE FROM conversation WHERE session_id = ? AND rowid NOT IN (
        SELECT rowid FROM conversation WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
      )
    `).run(sessionId, sessionId, MAX_HISTORY);
    if (role === 'assistant') {
      setImmediate(() => {
        try {
          require('./vectorMemory').scheduleIdleFlush(sessionId);
        } catch (_) {}
      });
    }
    return true;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] append', e.message);
    return false;
  }
}

function clear(sessionId) {
  const database = getDb();
  if (!database) return false;
  try {
    database.prepare('DELETE FROM conversation WHERE session_id = ?').run(sessionId);
    return true;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] clear', e.message);
    return false;
  }
}

function getSessionCount() {
  const database = getDb();
  if (!database) return 0;
  try {
    const row = database.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM conversation').get();
    return row && typeof row.n === 'number' ? row.n : 0;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] getSessionCount', e.message);
    return 0;
  }
}

/** Distinct session ids (for nightly history dump). */
function listSessionIds(limit = 5000) {
  const database = getDb();
  if (!database) return [];
  try {
    const lim = Math.max(1, Math.min(50_000, Number(limit) || 5000));
    const rows = database.prepare(
      'SELECT DISTINCT session_id AS id FROM conversation ORDER BY session_id ASC LIMIT ?',
    ).all(lim);
    return rows.map((r) => r.id).filter(Boolean);
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] listSessionIds', e.message);
    return [];
  }
}

module.exports = {
  getHistory,
  append,
  clear,
  getSessionCount,
  listSessionIds,
  MAX_HISTORY,
  DB_PATH,
};
