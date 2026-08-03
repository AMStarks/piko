const fs = require('fs');
const path = require('path');

const STAGES = ['shadow', 'canary', 'full'];

function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const envDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(__dirname, '..', '..', 'data');
}

function filePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-rollout.json');
}

function defaultRollout() {
  return {
    stage: 'shadow',
    trafficPercent: 0,
    emergencyRollback: false,
    rollbackReason: '',
    updatedAt: null,
  };
}

function normalize(input, stampNow) {
  const src = input && typeof input === 'object' ? input : {};
  const out = defaultRollout();
  const stage = String(src.stage || out.stage).trim().toLowerCase();
  out.stage = STAGES.includes(stage) ? stage : out.stage;
  out.trafficPercent = Math.max(0, Math.min(100, Number(src.trafficPercent != null ? src.trafficPercent : out.trafficPercent) || 0));
  out.emergencyRollback = src.emergencyRollback != null ? !!src.emergencyRollback : out.emergencyRollback;
  out.rollbackReason = String(src.rollbackReason || '').slice(0, 500);
  out.updatedAt = stampNow ? new Date().toISOString() : (src.updatedAt || null);
  return out;
}

function loadRollout(dataDir) {
  const p = filePath(dataDir);
  try {
    if (!fs.existsSync(p)) return defaultRollout();
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return normalize(parsed, false);
  } catch (_) {
    return defaultRollout();
  }
}

function saveRollout(dataDir, next, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const expectedUpdatedAt = String(opts.expectedUpdatedAt || '').trim();
  const current = loadRollout(dataDir);
  if (expectedUpdatedAt && current.updatedAt && expectedUpdatedAt !== current.updatedAt) {
    const err = new Error('Rollout version conflict');
    err.code = 'ROLLOUT_CONFLICT';
    err.current = current;
    throw err;
  }
  const normalized = normalize(next, true);
  const p = filePath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function canExecuteProductionAction(rollout) {
  const r = normalize(rollout || defaultRollout(), false);
  if (r.emergencyRollback) return { ok: false, reason: 'EMERGENCY_ROLLBACK' };
  if (r.stage === 'shadow') return { ok: false, reason: 'ROLLOUT_SHADOW' };
  if (r.trafficPercent <= 0) return { ok: false, reason: 'ROLLOUT_TRAFFIC_ZERO' };
  return { ok: true, reason: '' };
}

module.exports = {
  STAGES,
  loadRollout,
  saveRollout,
  canExecuteProductionAction,
};
