/**
 * Create a Legion ledger row (numeric task id) from Node — same path as ios-hub legion_task_create.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveRepoRoot() {
  const webchatRoot = path.join(__dirname, '..');
  const candidates = [];
  const fromEnv = String(process.env.PIKO_REPO_ROOT || '').trim();
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(path.join(webchatRoot, '..', 'piko-os'));
  candidates.push('/home/chief/piko-os');
  candidates.push(webchatRoot);
  candidates.push(path.join(webchatRoot, '..'));
  for (const repo of candidates) {
    if (repo && fs.existsSync(path.join(repo, 'piko_core.py'))) return repo;
  }
  return fromEnv || webchatRoot;
}

function resolvePythonBin(repo) {
  const fromEnv = String(process.env.PIKO_PYTHON || '').trim();
  if (fromEnv) return fromEnv;
  const venv = path.join(repo, '.venv-os', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  const venv2 = path.join(repo, '.venv', 'bin', 'python');
  if (fs.existsSync(venv2)) return venv2;
  return 'python3';
}

/**
 * @param {{ title: string, description?: string, business_unit?: string, denarii?: number, parent_id?: number, status?: string }} opts
 * @returns {{ ok: boolean, task_id?: number, error?: string, dispatch?: object }}
 */
function createLegionTaskRowSync(opts) {
  const title = String(opts.title || '').trim();
  if (!title) {
    return { ok: false, error: 'title is required' };
  }
  const repo = resolveRepoRoot();
  const pyBin = resolvePythonBin(repo);
  const description = String(opts.description || '').trim().slice(0, 8000);
  const denarii = Number.isFinite(Number(opts.denarii)) ? Math.max(0, Math.floor(Number(opts.denarii))) : 0;
  const parentId = Number.isFinite(Number(opts.parent_id)) ? Math.max(0, Math.floor(Number(opts.parent_id))) : 0;
  const businessUnit = String(
    opts.business_unit || opts.businessUnit
    || process.env.PIKO_ACTIVE_BU
    || process.env.PIKO_LEGION_BUSINESS_UNIT_DEFAULT
    || '',
  ).trim();
  const spec = JSON.stringify({
    title: title.slice(0, 500),
    description,
    denarii,
    parent_id: parentId,
    status: String(opts.status || 'pending').trim() || 'pending',
    ...(businessUnit ? { business_unit: businessUnit } : {}),
  });
  let out = '';
  let execErr = null;
  try {
    const py = `import piko_core as c; print(c.create_legion_task_atomic(${JSON.stringify(spec)}))`;
    out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 60000, env: process.env }).trim();
  } catch (e) {
    execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
  }
  if (execErr) {
    return { ok: false, error: execErr };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    return { ok: false, error: out || 'Legion task create returned non-JSON' };
  }
  if (!parsed || parsed.ok !== true) {
    return { ok: false, error: (parsed && parsed.error) || out || 'Legion task create failed', dispatch: parsed && parsed.dispatch };
  }
  const tid = Number(parsed.dispatch && parsed.dispatch.id);
  if (!Number.isFinite(tid) || tid < 1) {
    return { ok: false, error: 'Legion dispatch did not return a task id', dispatch: parsed.dispatch };
  }
  return { ok: true, task_id: tid, dispatch: parsed.dispatch };
}

/** User-facing reference string for chat and dashboards. */
function formatTaskRef(taskId) {
  const n = Number(taskId);
  if (Number.isFinite(n) && n > 0) return `Task #${n}`;
  return 'Task #?';
}

module.exports = { createLegionTaskRowSync, formatTaskRef, resolveRepoRoot };
