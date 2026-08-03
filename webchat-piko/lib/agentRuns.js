/**
 * Agent run records — Phase A evidence store under PIKO_DATA_DIR/agent-runs/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./agentRegistry');

const MAX_RUNS = Math.max(50, Number(process.env.PIKO_AGENT_RUNS_MAX || 400));

function runsDir() {
  return path.join(dataDir(), 'agent-runs');
}

function newRunId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDir() {
  fs.mkdirSync(runsDir(), { recursive: true });
}

function indexPath() {
  return path.join(runsDir(), 'index.jsonl');
}

function writeRun(record) {
  ensureDir();
  const id = record.id || newRunId();
  const entry = {
    ...record,
    id,
    ts: record.ts || new Date().toISOString(),
  };
  const file = path.join(runsDir(), `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
  fs.appendFileSync(indexPath(), JSON.stringify({
    id,
    ts: entry.ts,
    agent_id: entry.agent_id,
    tenant_id: entry.tenant_id,
    status: entry.status,
    review_verdict: entry.review && entry.review.verdict,
  }) + '\n', 'utf8');
  trimIndex();
  return entry;
}

function trimIndex() {
  try {
    const p = indexPath();
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length <= MAX_RUNS) return;
    fs.writeFileSync(p, lines.slice(-MAX_RUNS).join('\n') + '\n', 'utf8');
  } catch (_) {}
}

function readRun(id) {
  try {
    const file = path.join(runsDir(), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listRuns(limit = 20) {
  try {
    const p = indexPath();
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    const rows = lines.slice(-Math.max(1, limit)).reverse().map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
    return rows;
  } catch (_) {
    return [];
  }
}

module.exports = {
  newRunId,
  writeRun,
  readRun,
  listRuns,
  runsDir,
};
