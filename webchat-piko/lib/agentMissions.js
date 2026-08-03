/**
 * Tenant-local mission ledger (parent + children with agent assignments).
 * Phase C — EI trial; does not require Legion SQLite.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./agentRegistry');

const MAX_MISSIONS = Math.max(20, Number(process.env.PIKO_AGENT_MISSIONS_MAX || 200));

function missionsDir() {
  return path.join(dataDir(), 'missions');
}

function newMissionId() {
  if (typeof crypto.randomUUID === 'function') return `m_${crypto.randomUUID()}`;
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDir() {
  fs.mkdirSync(missionsDir(), { recursive: true });
}

function indexPath() {
  return path.join(missionsDir(), 'index.jsonl');
}

function writeMission(mission) {
  ensureDir();
  const id = mission.id || newMissionId();
  const entry = {
    ...mission,
    id,
    updated_at: new Date().toISOString(),
    created_at: mission.created_at || new Date().toISOString(),
  };
  fs.writeFileSync(path.join(missionsDir(), `${id}.json`), JSON.stringify(entry, null, 2), 'utf8');

  const p = indexPath();
  let lines = [];
  if (fs.existsSync(p)) {
    lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  }
  const summary = JSON.stringify({
    id,
    ts: entry.updated_at,
    tenant_id: entry.tenant_id,
    status: entry.status,
    goal: String(entry.goal || '').slice(0, 120),
    child_count: Array.isArray(entry.children) ? entry.children.length : 0,
  });
  lines = lines.filter((line) => {
    try { return JSON.parse(line).id !== id; } catch (_) { return true; }
  });
  lines.push(summary);
  if (lines.length > MAX_MISSIONS) lines = lines.slice(-MAX_MISSIONS);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return entry;
}

function readMission(id) {
  try {
    const file = path.join(missionsDir(), `${String(id)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listMissions(limit = 20) {
  try {
    const p = indexPath();
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, limit)).reverse().map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = {
  newMissionId,
  writeMission,
  readMission,
  listMissions,
  missionsDir,
};
