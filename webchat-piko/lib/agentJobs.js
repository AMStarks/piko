/**
 * Agent job queue — Phase E async independence (EI trial).
 * Jobs live under PIKO_DATA_DIR/agent-jobs/{pending,running,done}/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./agentRegistry');

const MAX_DONE = Math.max(50, Number(process.env.PIKO_AGENT_JOBS_MAX || 300));
/** Cap pending jobs per type (WP5.3). */
const PENDING_CAP_PER_TYPE = Math.max(1, Number(process.env.PIKO_AGENT_PENDING_CAP || 25) || 25);
/** Wall-clock timeout for a single running job (WP5.2). */
const JOB_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.PIKO_AGENT_JOB_TIMEOUT_MS || 20 * 60 * 1000) || (20 * 60 * 1000),
);
const STALE_GRACE_MS = Math.max(0, Number(process.env.PIKO_AGENT_JOB_STALE_GRACE_MS || 60_000) || 60_000);

function jobsRoot() {
  return path.join(dataDir(), 'agent-jobs');
}

function dirFor(status) {
  return path.join(jobsRoot(), status);
}

function newJobId() {
  if (typeof crypto.randomUUID === 'function') return `job_${crypto.randomUUID()}`;
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDirs() {
  for (const s of ['pending', 'running', 'done']) {
    fs.mkdirSync(dirFor(s), { recursive: true });
  }
}

function jobPath(status, id) {
  return path.join(dirFor(status), `${id}.json`);
}

function writeJob(job, status) {
  ensureDirs();
  const st = status || job.status || 'pending';
  const entry = {
    ...job,
    status: st,
    updated_at: new Date().toISOString(),
  };
  // Remove from other buckets
  for (const s of ['pending', 'running', 'done']) {
    const p = jobPath(s, entry.id);
    if (s !== st && fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
  fs.writeFileSync(jobPath(st, entry.id), JSON.stringify(entry, null, 2), 'utf8');
  if (st === 'done') trimDone();
  return entry;
}

function trimDone() {
  try {
    const dir = dirFor('done');
    // Oldest-first by mtime — filename sort on UUIDs pruned records near-randomly,
    // letting minute-cadence campaign cycles delete fresh operator job records.
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        let mtime = 0;
        try { mtime = fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) {}
        return { f, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);
    if (files.length <= MAX_DONE) return;
    for (const { f } of files.slice(0, files.length - MAX_DONE)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
    }
  } catch (_) {}
}

function countPendingOfType(type) {
  ensureDirs();
  let n = 0;
  try {
    const dir = dirFor('pending');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j && j.type === type) n += 1;
      } catch (_) { /* skip */ }
    }
  } catch (_) { /* empty */ }
  return n;
}

function enqueueJob(input = {}) {
  const type = String(input.type || '').trim();
  if (!['agent_run', 'mission_plan', 'mission_execute', 'mission', 'ei_platform_eval', 'campaign_cycle', 'article_write'].includes(type)) {
    return { ok: false, error: `unsupported job type: ${type}` };
  }
  const pendingOfType = countPendingOfType(type);
  if (pendingOfType >= PENDING_CAP_PER_TYPE) {
    return {
      ok: false,
      error: `pending_cap: already ${pendingOfType} ${type} jobs waiting (cap ${PENDING_CAP_PER_TYPE}). Let some finish, or cancel one, then try again.`,
      pending_cap: true,
      pending_of_type: pendingOfType,
      cap: PENDING_CAP_PER_TYPE,
    };
  }
  const id = newJobId();
  const job = writeJob({
    id,
    type,
    tenant_id: input.tenant_id || null,
    profile: input.profile || null,
    payload: input.payload || {},
    created_at: new Date().toISOString(),
    result: null,
    error: null,
  }, 'pending');
  return { ok: true, job };
}

function readJob(id) {
  const jid = String(id || '').trim();
  if (!jid || jid.includes('..')) return null;
  for (const s of ['pending', 'running', 'done']) {
    const p = jobPath(s, jid);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
    }
  }
  return null;
}

function listJobs(limit = 30) {
  ensureDirs();
  const rows = [];
  for (const s of ['running', 'pending', 'done']) {
    const dir = dirFor(s);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        rows.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch (_) {}
    }
  }
  rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return rows.slice(0, Math.max(1, limit));
}

function claimNextPending() {
  ensureDirs();
  const dir = dirFor('pending');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const p = path.join(dir, f);
    let job;
    try { job = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
    if (job.cancel_requested || job.cancelled) {
      writeJob({
        ...job,
        cancelled: true,
        result: { ok: false, cancelled: true },
        error: 'cancelled',
        finished_at: new Date().toISOString(),
      }, 'done');
      continue;
    }
    // naive claim: move to running
    try {
      fs.renameSync(p, jobPath('running', job.id));
    } catch (_) {
      continue; // raced
    }
    job.status = 'running';
    job.started_at = new Date().toISOString();
    fs.writeFileSync(jobPath('running', job.id), JSON.stringify({ ...job, updated_at: new Date().toISOString() }, null, 2), 'utf8');
    return job;
  }
  return null;
}

function completeJob(job, result, error) {
  // Guard: timeout/orphan races must not overwrite a finished disposition.
  if (job && job.id) {
    const fresh = readJob(job.id);
    if (fresh && fresh.status === 'done') return fresh;
  }
  const entry = {
    ...job,
    result: result || null,
    error: error || null,
    finished_at: new Date().toISOString(),
  };
  return writeJob(entry, 'done');
}

/**
 * Patch a running (or pending) job in place — used for progress breadcrumbs.
 */
function updateJobFields(id, fields = {}) {
  const job = readJob(id);
  if (!job) return null;
  if (job.status === 'done') {
    return writeJob({ ...job, ...fields }, 'done');
  }
  const st = job.status === 'pending' ? 'pending' : 'running';
  return writeJob({ ...job, ...fields }, st);
}

function appendJobProgress(id, entry) {
  const job = readJob(id);
  if (!job) return null;
  const log = Array.isArray(job.progress) ? job.progress.slice() : [];
  const row = {
    at: new Date().toISOString(),
    stage: entry.stage || 'step',
    message: String(entry.message || '').slice(0, 400),
    tool: entry.tool || null,
    ok: entry.ok == null ? null : !!entry.ok,
  };
  log.push(row);
  // Cap so job JSON stays light
  const trimmed = log.slice(-40);
  return updateJobFields(id, {
    progress: trimmed,
    progress_latest: row,
  });
}

/**
 * Cancel a job. Pending → done/cancelled immediately.
 * Running → cancel_requested; worker finishes as cancelled when it notices.
 */
function cancelJob(id) {
  const job = readJob(id);
  if (!job) return { ok: false, error: 'job not found' };
  if (job.status === 'done') {
    if (job.cancelled || (job.result && job.result.cancelled)) {
      return { ok: true, job, already: true };
    }
    return { ok: false, error: 'job already finished', job };
  }
  if (job.status === 'pending') {
    const done = writeJob({
      ...job,
      cancelled: true,
      cancel_requested: true,
      result: { ok: false, cancelled: true },
      error: 'cancelled',
      finished_at: new Date().toISOString(),
    }, 'done');
    return { ok: true, job: done, immediate: true };
  }
  // running
  const updated = writeJob({
    ...job,
    cancel_requested: true,
  }, 'running');
  return { ok: true, job: updated, pending_cancel: true };
}

/**
 * Close out jobs stranded in running/ by a process restart. The worker loop
 * is in-process, so at boot anything "running" belongs to a dead process and
 * would otherwise show as running forever.
 */
function reapOrphanedRunning() {
  ensureDirs();
  const reaped = [];
  try {
    const dir = dirFor('running');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let job;
      try { job = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
      const cancelled = !!(job.cancel_requested || job.cancelled);
      reaped.push(writeJob({
        ...job,
        cancelled,
        result: { ok: false, cancelled, orphaned: !cancelled },
        error: cancelled ? 'cancelled' : 'orphaned_by_restart',
        finished_at: new Date().toISOString(),
      }, 'done'));
    }
  } catch (_) {}
  return reaped;
}

/**
 * Close running jobs whose started_at is older than timeout+grace (interval reaper).
 */
function reapStaleRunning(opts = {}) {
  ensureDirs();
  const timeoutMs = opts.timeoutMs != null ? Number(opts.timeoutMs) : JOB_TIMEOUT_MS;
  const graceMs = opts.graceMs != null ? Number(opts.graceMs) : STALE_GRACE_MS;
  const cutoff = Date.now() - (timeoutMs + graceMs);
  const reaped = [];
  try {
    const dir = dirFor('running');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let job;
      try { job = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
      const started = Date.parse(job.started_at || '') || 0;
      if (!started || started > cutoff) continue;
      reaped.push(writeJob({
        ...job,
        result: { ok: false, timeout: true, orphaned: true },
        error: 'orphaned_timeout',
        finished_at: new Date().toISOString(),
      }, 'done'));
    }
  } catch (_) {}
  return reaped;
}

function countInDir(status) {
  try {
    return fs.readdirSync(dirFor(status)).filter((f) => f.endsWith('.json')).length;
  } catch (_) {
    return 0;
  }
}

function jobCounts() {
  ensureDirs();
  let cancelRequested = 0;
  try {
    const dir = dirFor('running');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j.cancel_requested) cancelRequested += 1;
      } catch (_) {}
    }
  } catch (_) {}
  return {
    pending: countInDir('pending'),
    running: countInDir('running'),
    done: countInDir('done'),
    cancel_requested: cancelRequested,
    working: countInDir('pending') + countInDir('running'),
  };
}

module.exports = {
  enqueueJob,
  readJob,
  listJobs,
  claimNextPending,
  completeJob,
  cancelJob,
  jobCounts,
  writeJob,
  updateJobFields,
  appendJobProgress,
  reapOrphanedRunning,
  reapStaleRunning,
  countPendingOfType,
  PENDING_CAP_PER_TYPE,
  JOB_TIMEOUT_MS,
  STALE_GRACE_MS,
  jobsRoot,
  newJobId,
};
