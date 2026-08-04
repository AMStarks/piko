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

function currentTenantId() {
  return String(process.env.PIKO_TENANT_ID || '').trim() || null;
}

function migrateSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation (
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation(session_id);
    CREATE TABLE IF NOT EXISTS session_meta (
      session_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      tenant_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // P3.3d: additive tenant_id on conversation (ignore if already present).
  try {
    database.exec('ALTER TABLE conversation ADD COLUMN tenant_id TEXT');
  } catch (_) { /* column exists */ }
  try {
    const tid = currentTenantId();
    if (tid) {
      database.prepare(
        'UPDATE conversation SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = \'\'',
      ).run(tid);
    }
  } catch (_) { /* ok */ }
}

function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    migrateSchema(db);
    return db;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore]', e.message);
    return null;
  }
}

/**
 * Stamp owner on first sight; never overwrite an existing owner.
 * @returns {{ session_id: string, owner: string, tenant_id: string|null }}
 */
function ensureSessionMeta(sessionId, ownerPrincipal) {
  const database = getDb();
  const sid = String(sessionId || '').trim();
  const owner = String(ownerPrincipal || 'operator:operator').trim() || 'operator:operator';
  const tid = currentTenantId();
  if (!database || !sid) {
    return { session_id: sid, owner, tenant_id: tid };
  }
  try {
    const existing = database.prepare(
      'SELECT session_id, owner, tenant_id FROM session_meta WHERE session_id = ?',
    ).get(sid);
    if (existing) {
      if (tid && !existing.tenant_id) {
        database.prepare('UPDATE session_meta SET tenant_id = ? WHERE session_id = ?').run(tid, sid);
        existing.tenant_id = tid;
      }
      return existing;
    }
    database.prepare(
      'INSERT INTO session_meta (session_id, owner, tenant_id) VALUES (?, ?, ?)',
    ).run(sid, owner, tid);
    return { session_id: sid, owner, tenant_id: tid };
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[sessionStore] ensureSessionMeta', e.message);
    return { session_id: sid, owner, tenant_id: tid };
  }
}

function getSessionMeta(sessionId) {
  const database = getDb();
  if (!database) return null;
  try {
    return database.prepare(
      'SELECT session_id, owner, tenant_id, created_at FROM session_meta WHERE session_id = ?',
    ).get(String(sessionId || '').trim()) || null;
  } catch (_) {
    return null;
  }
}

function getHistory(sessionId) {
  const database = getDb();
  if (!database) return [];
  try {
    const tid = currentTenantId();
    let rows;
    if (tid) {
      rows = database.prepare(
        `SELECT role, content, created_at FROM conversation
         WHERE session_id = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
         ORDER BY created_at ASC`,
      ).all(sessionId, tid);
    } else {
      rows = database.prepare(
        'SELECT role, content, created_at FROM conversation WHERE session_id = ? ORDER BY created_at ASC',
      ).all(sessionId);
    }
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

function append(sessionId, role, content, opts = {}) {
  const database = getDb();
  if (!database) return false;
  try {
    if (opts.owner) ensureSessionMeta(sessionId, opts.owner);
    else ensureSessionMeta(sessionId, 'operator:operator');
    let text = String(content);
    if (role === 'assistant') {
      try {
        text = require('./operatorVoice').polishOutbound(text);
      } catch (_) {}
    }
    const created = new Date().toISOString();
    const tid = currentTenantId();
    database.prepare(
      'INSERT INTO conversation (session_id, role, content, created_at, tenant_id) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionId, role, text.slice(0, 100000), created, tid);
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
  ensureSessionMeta,
  getSessionMeta,
  currentTenantId,
  MAX_HISTORY,
  DB_PATH,
};
