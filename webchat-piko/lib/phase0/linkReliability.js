const fs = require('fs');
const path = require('path');

const DEFAULT_FAIL_THRESHOLD = 3;
const DEFAULT_COOLDOWN_SEC = 30;

function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const envDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(__dirname, '..', '..', 'data');
}

function filePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-link-reliability.json');
}

function defaultState() {
  return {
    consecutiveFailures: 0,
    circuitOpenUntilMs: 0,
    totalSuccess: 0,
    totalFailure: 0,
    lastSuccessAt: '',
    lastFailureAt: '',
    lastError: '',
  };
}

function loadState(dataDir) {
  const p = filePath(dataDir);
  try {
    if (!fs.existsSync(p)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...defaultState(), ...(parsed || {}) };
  } catch (_) {
    return defaultState();
  }
}

function saveState(dataDir, state) {
  const p = filePath(dataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

function getPolicy() {
  const failThreshold = Math.max(1, Number(process.env.LEGION_LINK_CIRCUIT_FAIL_THRESHOLD || DEFAULT_FAIL_THRESHOLD));
  const cooldownSec = Math.max(1, Number(process.env.LEGION_LINK_CIRCUIT_COOLDOWN_SEC || DEFAULT_COOLDOWN_SEC));
  return { failThreshold, cooldownSec };
}

function canSend(dataDir, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const state = loadState(dataDir);
  const openUntil = Number(state.circuitOpenUntilMs || 0);
  const open = openUntil > now;
  return {
    ok: !open,
    reason: open ? 'CIRCUIT_OPEN' : '',
    openUntilMs: openUntil,
    remainingMs: open ? openUntil - now : 0,
    state,
  };
}

function recordSuccess(dataDir, atMs) {
  const now = Number.isFinite(atMs) ? atMs : Date.now();
  const state = loadState(dataDir);
  state.consecutiveFailures = 0;
  state.circuitOpenUntilMs = 0;
  state.totalSuccess = Number(state.totalSuccess || 0) + 1;
  state.lastSuccessAt = new Date(now).toISOString();
  saveState(dataDir, state);
  return state;
}

function recordFailure(dataDir, errorMessage, atMs) {
  const now = Number.isFinite(atMs) ? atMs : Date.now();
  const state = loadState(dataDir);
  const policy = getPolicy();
  state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
  state.totalFailure = Number(state.totalFailure || 0) + 1;
  state.lastFailureAt = new Date(now).toISOString();
  state.lastError = String(errorMessage || 'UNKNOWN_ERROR').slice(0, 500);
  if (state.consecutiveFailures >= policy.failThreshold) {
    state.circuitOpenUntilMs = now + (policy.cooldownSec * 1000);
  }
  saveState(dataDir, state);
  return state;
}

function getSnapshot(dataDir, nowMs) {
  const check = canSend(dataDir, nowMs);
  const policy = getPolicy();
  return {
    ...check.state,
    circuitOpen: !check.ok,
    circuitReason: check.reason,
    circuitRemainingMs: check.remainingMs,
    policy,
  };
}

module.exports = {
  canSend,
  recordSuccess,
  recordFailure,
  getSnapshot,
};
