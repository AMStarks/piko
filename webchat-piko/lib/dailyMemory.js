/**
 * Daily memory: log every interaction, summarize by day, keep summaries indefinitely.
 * Data lives in Optimus data dir (same as rest of Piko). Date accompanies each summary (YYYY-MM-DD).
 * Raw interactions are discarded after the day is summarized; day_summary is retained as long as possible.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'daily_memory.db');

let db = null;

function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS interaction (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_interaction_session_created ON interaction(session_id, created_at);

      CREATE TABLE IF NOT EXISTS day_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(date, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_day_summary_session_date ON day_summary(session_id, date);
    `);
    return db;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory]', e.message);
    return null;
  }
}

/**
 * Append one message to the interaction log. Call twice per turn (user, then assistant).
 */
function append(sessionId, role, content) {
  const database = getDb();
  if (!database) return false;
  try {
    const created = new Date().toISOString();
    database.prepare(
      'INSERT INTO interaction (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, String(content).slice(0, 100000), created);
    return true;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] append', e.message);
    return false;
  }
}

/**
 * Get day summaries for the last N days (date in YYYY-MM-DD). Returns [{ date, summary_text }, ...] newest first.
 * Date accompanies each summary for display.
 */
function getSummaries(sessionId, days = 7) {
  const database = getDb();
  if (!database) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, days));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const rows = database.prepare(
      'SELECT date, summary_text FROM day_summary WHERE session_id = ? AND date >= ? ORDER BY date DESC LIMIT ?'
    ).all(sessionId, cutoffStr, days);
    return rows;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] getSummaries', e.message);
    return [];
  }
}

/**
 * Get all interactions for a given date (YYYY-MM-DD) and session for summarization.
 */
function getInteractionsForDate(sessionId, dateStr) {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database.prepare(
      `SELECT role, content, created_at FROM interaction
       WHERE session_id = ? AND date(created_at) = ?
       ORDER BY created_at ASC`
    ).all(sessionId, dateStr);
    return rows;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] getInteractionsForDate', e.message);
    return [];
  }
}

/**
 * Write a day summary. Date must be YYYY-MM-DD. Kept indefinitely (no automatic deletion).
 */
function writeDaySummary(sessionId, dateStr, summaryText) {
  const database = getDb();
  if (!database) return false;
  try {
    const created = new Date().toISOString();
    database.prepare(
      'INSERT OR REPLACE INTO day_summary (date, session_id, summary_text, created_at) VALUES (?, ?, ?, ?)'
    ).run(dateStr, sessionId, String(summaryText).slice(0, 50000), created);
    return true;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] writeDaySummary', e.message);
    return false;
  }
}

/**
 * Delete raw interactions for a given date and session (after summarization). Frees space; summaries kept.
 */
function deleteInteractionsForDate(sessionId, dateStr) {
  const database = getDb();
  if (!database) return false;
  try {
    database.prepare(
      'DELETE FROM interaction WHERE session_id = ? AND date(created_at) = ?'
    ).run(sessionId, dateStr);
    return true;
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] deleteInteractionsForDate', e.message);
    return false;
  }
}

/**
 * List session_ids that have interactions on a given date (for nightly job).
 */
function getSessionsWithInteractionsOnDate(dateStr) {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database.prepare(
      'SELECT DISTINCT session_id FROM interaction WHERE date(created_at) = ?'
    ).all(dateStr);
    return rows.map((r) => r.session_id);
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[dailyMemory] getSessionsWithInteractionsOnDate', e.message);
    return [];
  }
}

module.exports = {
  append,
  getSummaries,
  getInteractionsForDate,
  writeDaySummary,
  deleteInteractionsForDate,
  getSessionsWithInteractionsOnDate,
  DB_PATH,
};
