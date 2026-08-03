/**
 * Nightly conversation history dump (WP6.1).
 * Reads from sessionStore (SQLite), not the removed in-memory sessions Map.
 */
const fs = require('fs');
const path = require('path');

/**
 * Build dump text for a date label.
 * @param {string} forDate - YYYY-MM-DD
 * @param {{ listSessionIds?: Function, getHistory?: Function }} [store]
 */
const {
  replaceAllLiteral,
} = require('./text');

function buildHistoryDumpText(forDate, store = {}) {
  const listSessionIds = store.listSessionIds
    || (() => require('./sessionStore').listSessionIds());
  const getHistory = store.getHistory
    || ((id) => require('./sessionStore').getHistory(id));

  const lines = [];
  const dumpTime = new Date().toISOString();
  lines.push(`# Piko history dump for ${forDate} (written ${dumpTime})`);
  lines.push('');

  const ids = listSessionIds() || [];
  for (const key of ids) {
    const history = getHistory(key);
    if (!Array.isArray(history) || history.length === 0) continue;
    lines.push(`=== Session: ${key} ===`);
    for (const msg of history) {
      const role = msg.role === 'user' ? 'User' : 'Piko';
      const content = replaceAllLiteral(String(msg.content || ''), '\n', '\n  ');
      lines.push(`${role}: ${content}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Write dump file under historyDir.
 */
function dumpHistory(forDate, historyDir, store) {
  fs.mkdirSync(historyDir, { recursive: true });
  const text = buildHistoryDumpText(forDate, store);
  const filePath = path.join(historyDir, `${forDate}.txt`);
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

module.exports = {
  buildHistoryDumpText,
  dumpHistory,
};
