/**
 * Piko activity log — append-only JSONL for audit and recall.
 * Schema: { ts, action, intentId?, type?, objective?, schedule?, source?, outcome? }
 */
const fs = require('fs');
const path = require('path');

function getActivityLogPath() {
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'piko-activity.jsonl');
}

/**
 * Append an activity entry. Safe to call from any context.
 * @param {string} action - intent_created | intent_fired | intent_failed
 * @param {Object} data - { intentId, type, objective, schedule, source, outcome, ... }
 */
function logActivity(action, data = {}) {
  try {
    const logPath = getActivityLogPath();
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      action,
      ...data,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[activityLog]', e.message);
    }
  }
}

/**
 * Read recent activity entries (last N lines). For recall route.
 * @param {number} lines - Number of lines from end (default 50)
 * @returns {Array<Object>}
 */
function readRecentActivity(lines = 50) {
  try {
    const logPath = getActivityLogPath();
    if (!fs.existsSync(logPath)) return [];
    const raw = fs.readFileSync(logPath, 'utf8');
    const all = raw.trim().split('\n').filter(Boolean);
    const recent = all.slice(-Math.max(1, lines));
    return recent.map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { logActivity, readRecentActivity, getActivityLogPath };
