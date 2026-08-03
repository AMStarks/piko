const fs = require('fs');
const path = require('path');
const {
  PENDING_TTL_MS,
  executeLegionScheduleMutation,
  formatLegionScheduleMutateSuccess,
} = require('./legionScheduleMutate');

const {
  stripTrailingSentencePunct,
} = require('./text');

function getPendingFile() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'pending-legion-schedule-mutations.json');
}

function loadPendingMap() {
  const map = new Map();
  try {
    const pendingFile = getPendingFile();
    if (!fs.existsSync(pendingFile)) return map;
    const raw = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && v.intent && v.expiresAt > now) map.set(k, v);
    }
  } catch (_) {}
  return map;
}

function savePendingMap(map) {
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  const pendingFile = getPendingFile();
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify(obj, null, 2), 'utf8');
}

function setPending(sessionKey, intent) {
  const map = loadPendingMap();
  map.set(sessionKey, {
    intent,
    expiresAt: Date.now() + PENDING_TTL_MS,
    createdAt: new Date().toISOString(),
  });
  savePendingMap(map);
  return map.get(sessionKey);
}

function clearPending(sessionKey) {
  const map = loadPendingMap();
  map.delete(sessionKey);
  savePendingMap(map);
}

function tryConfirm(sessionKey, message) {
  const trimmed = stripTrailingSentencePunct(message).toLowerCase();
  const map = loadPendingMap();
  const pending = map.get(sessionKey);
  if (!pending || pending.expiresAt <= Date.now()) {
    if (pending) {
      map.delete(sessionKey);
      savePendingMap(map);
    }
    return null;
  }

  if (['no', 'n', 'cancel', 'stop', 'nevermind', 'never mind'].includes(trimmed)) {
    clearPending(sessionKey);
    return { reply: 'Cancelled — no queue changes were made.', route: 'legion_schedule_mutate_cancelled' };
  }

  if (!['yes', 'y', 'confirm', 'ok', 'sure', 'yes please', 'do it'].includes(trimmed)) {
    return null;
  }

  clearPending(sessionKey);
  const result = executeLegionScheduleMutation(pending.intent);
  if (!result.ok) {
    return {
      reply: `Couldn't apply that change: ${result.error}.`,
      route: 'legion_schedule_mutate_failed',
    };
  }
  return {
    reply: formatLegionScheduleMutateSuccess(pending.intent),
    route: 'legion_schedule_mutate_applied',
    result,
  };
}

module.exports = { setPending, clearPending, tryConfirm };
