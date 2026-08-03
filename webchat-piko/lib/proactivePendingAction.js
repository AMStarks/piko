/**
 * Proactive pending action — conversational follow-up state.
 * When proactive sends "Want me to draft the PO?", we store the suggested action.
 * When user replies "Yes" / "Do it", we trigger and clear.
 */
const path = require('path');
const fs = require('fs');

const PENDING_FILE = 'proactive-pending-action.json';
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — avoids "stale Yes" trap (user meant different action)

function getMaxAgeMs() {
  const env = process.env.PIKO_PENDING_ACTION_TTL_MS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n > 0) return Math.min(n, 24 * 60 * 60 * 1000);
  }
  return DEFAULT_MAX_AGE_MS;
}

function getPendingPath(dataDir) {
  return path.join(dataDir || path.join(__dirname, '..', 'data'), PENDING_FILE);
}

function loadPending(dataDir) {
  const p = getPendingPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt).getTime() : 0;
    const maxAge = getMaxAgeMs();
    if (Date.now() - createdAt > maxAge) {
      try { fs.unlinkSync(p); } catch (_) { /* file may already be gone */ }
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function savePending(dataDir, action, context) {
  const p = getPendingPath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    action: String(action || ''),
    context: context && typeof context === 'object' ? context : {},
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function clearPending(dataDir) {
  const p = getPendingPath(dataDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Affirmative phrases that trigger the pending action. */
const AFFIRMATIVE_REPLIES = ['yes','yep','yeah','y','do it','draft it','go ahead','sure','please','ok','okay','confirm'];

function isAffirmativeReply(message) {
  return AFFIRMATIVE_REPLIES.includes(String(message || '').trim().toLowerCase());
}

module.exports = {
  loadPending,
  savePending,
  clearPending,
  isAffirmativeReply,
  PENDING_FILE,
};
