/**
 * SQLite-backed conversation store. Replaces in-memory sessions Map so history survives restarts.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'conversations.db');
const MAX_HISTORY = 30;

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
      'SELECT role, content FROM conversation WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId);
    const last = rows.slice(-MAX_HISTORY);
    return last.map((r) => ({ role: r.role, content: r.content || '' }));
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] getHistory', e.message);
    return [];
  }
}

function append(sessionId, role, content) {
  const database = getDb();
  if (!database) return false;
  try {
    const created = new Date().toISOString();
    database.prepare(
      'INSERT INTO conversation (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, String(content).slice(0, 100000), created);

    database.prepare(`
      DELETE FROM conversation WHERE session_id = ? AND rowid NOT IN (
        SELECT rowid FROM conversation WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
      )
    `).run(sessionId, sessionId, MAX_HISTORY);
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

module.exports = {
  getHistory,
  append,
  clear,
  getSessionCount,
  MAX_HISTORY,
  DB_PATH,
};
