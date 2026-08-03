/**
 * Ops monitoring: tool audit tail + HITL queue (Python hitl_manager).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getPikoRepoRoot, getPythonBin } = require('./yoloBridge');

function getToolAuditLogPath() {
  const raw = String(process.env.PIKO_TOOL_AUDIT_LOG || '').trim();
  if (raw) return path.resolve(raw);
  return path.join(getPikoRepoRoot(), 'wiki', 'tool_audit.jsonl');
}

function getToolAuditRecent(limit = 50) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const logPath = getToolAuditLogPath();
  if (!fs.existsSync(logPath)) {
    return { path: logPath, entries: [] };
  }
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-n);
  const entries = [];
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    try {
      entries.push(JSON.parse(tail[i]));
    } catch (_) {
      entries.push({ ts: null, tool: '(parse error)', raw: tail[i].slice(0, 200) });
    }
  }
  return { path: logPath, entries };
}

function runHitlPython(snippet) {
  const repo = getPikoRepoRoot();
  const pyBin = getPythonBin();
  const py = `${snippet}`;
  const out = execFileSync(pyBin, ['-c', py], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PYTHONPATH: repo },
    maxBuffer: 4 * 1024 * 1024,
  });
  return (out || '').trim();
}

function listHitlPending() {
  const out = runHitlPython(
    'import json\nfrom hitl_manager import list_pending\nprint(json.dumps(list_pending()))',
  );
  const parsed = JSON.parse(out || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function approveHitl(requestId) {
  const rid = JSON.stringify(String(requestId || '').trim().toLowerCase());
  return runHitlPython(
    `from hitl_manager import approve_hitl\nprint(approve_hitl(${rid}))`,
  );
}

function rejectHitl(requestId) {
  const rid = JSON.stringify(String(requestId || '').trim().toLowerCase());
  return runHitlPython(
    `from hitl_manager import reject_hitl\nprint(reject_hitl(${rid}))`,
  );
}

module.exports = {
  getToolAuditLogPath,
  getToolAuditRecent,
  listHitlPending,
  approveHitl,
  rejectHitl,
};
