/**
 * Piko activity log — append-only JSONL for audit and recall.
 * Schema: { ts, action, intentId?, type?, objective?, schedule?, source?, outcome? }
 * P3.2e: size-capped + tail-read on the hot path.
 */
const fs = require('fs');
const path = require('path');
const { appendJsonlBounded, readJsonlTail } = require('./jsonlBounded');

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
    const maxLines = Number(process.env.PIKO_ACTIVITY_JSONL_MAX || 2000) || 2000;
    appendJsonlBounded(logPath, entry, { maxLines });
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
    return readJsonlTail(getActivityLogPath(), lines);
  } catch (_) {
    return [];
  }
}

module.exports = { logActivity, readRecentActivity, getActivityLogPath };
