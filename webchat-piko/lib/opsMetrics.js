/**
 * In-process ops metrics for /api/ops/metrics (P2.4 + P4.6).
 * Rolling windows — not a full Prometheus exporter.
 */
const fs = require('fs');
const path = require('path');

const WINDOW = Math.max(50, Number(process.env.PIKO_OPS_METRICS_WINDOW || 200) || 200);

const chatLatencies = [];
let chatTurns = 0;
let chatErrors = 0;
let ollamaErrors = 0;
let unhandledRejections = 0;
let uncaughtExceptions = 0;
let planeDenied = 0;
let sessionForbidden = 0;
const jobTransitions = []; // { at, status, error }
const schedulerRuns = []; // { at, id, ok, error }

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function recordChatTurn(sample = {}) {
  chatTurns += 1;
  const ms = Number(sample.latency_ms);
  if (Number.isFinite(ms) && ms >= 0) {
    chatLatencies.push(ms);
    if (chatLatencies.length > WINDOW) chatLatencies.splice(0, chatLatencies.length - WINDOW);
  }
  if (sample.ok === false) chatErrors += 1;
}

function recordOllamaError() {
  ollamaErrors += 1;
}

function recordUnhandledRejection() {
  unhandledRejections += 1;
}

function recordUncaughtException() {
  uncaughtExceptions += 1;
}

function recordPlaneDenied() {
  planeDenied += 1;
}

function recordSessionForbidden() {
  sessionForbidden += 1;
}

function recordJobTransition(job = {}) {
  jobTransitions.push({
    at: Date.now(),
    status: String(job.status || ''),
    error: job.error || null,
    id: job.id || null,
  });
  if (jobTransitions.length > WINDOW * 2) {
    jobTransitions.splice(0, jobTransitions.length - WINDOW * 2);
  }
}

function recordSchedulerRun(sample = {}) {
  schedulerRuns.push({
    at: Date.now(),
    id: String(sample.id || ''),
    ok: sample.ok !== false,
    error: sample.error || null,
    latency_ms: Number(sample.latency_ms) || 0,
  });
  if (schedulerRuns.length > WINDOW * 2) {
    schedulerRuns.splice(0, schedulerRuns.length - WINDOW * 2);
  }
}

function queueDepth() {
  try {
    const q = require('./ollamaQueue');
    if (typeof q.getQueueDepth === 'function') return q.getQueueDepth();
  } catch (_) { /* optional */ }
  return { enabled: false, user: 0, background: 0, processing: false };
}

function jobFailureRateLastHour() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = jobTransitions.filter((t) => t.at >= cutoff && t.status === 'done');
  if (!recent.length) return { samples: 0, failures: 0, rate: 0 };
  const failures = recent.filter((t) => t.error).length;
  return { samples: recent.length, failures, rate: failures / recent.length };
}

function schedulerFailuresById() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const byId = {};
  for (const r of schedulerRuns) {
    if (r.at < cutoff || r.ok) continue;
    const id = r.id || 'unknown';
    byId[id] = (byId[id] || 0) + 1;
  }
  return byId;
}

function workerQueueSnapshot(rootDir) {
  const out = {
    pending: 0,
    running: 0,
    oldest_pending_age_s: null,
    drain: false,
  };
  try {
    const { jobCounts } = require('./agentJobs');
    const c = jobCounts() || {};
    out.pending = Number(c.pending) || 0;
    out.running = Number(c.running) || 0;
  } catch (_) { /* ok */ }
  try {
    const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
      || path.join(rootDir || path.join(__dirname, '..'), 'data');
    const pendingDir = path.join(dataDir, 'agent-jobs', 'pending');
    if (fs.existsSync(pendingDir)) {
      let oldest = null;
      for (const name of fs.readdirSync(pendingDir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const st = fs.statSync(path.join(pendingDir, name));
          if (!oldest || st.mtimeMs < oldest) oldest = st.mtimeMs;
        } catch (_) { /* ok */ }
      }
      if (oldest != null) out.oldest_pending_age_s = Math.max(0, Math.floor((Date.now() - oldest) / 1000));
    }
  } catch (_) { /* ok */ }
  try {
    const { isDrainActive } = require('./agentWorker');
    out.drain = !!isDrainActive(rootDir || path.join(__dirname, '..'));
  } catch (_) { /* ok */ }
  return out;
}

function secretsRotationAge() {
  const out = { api_key_age_s: null, webhook_age_s: null };
  try {
    const { getSecret, secretFilePath } = require('./secretsStore');
    for (const name of ['api-key', 'webhook']) {
      const rec = getSecret(name);
      const key = name === 'api-key' ? 'api_key_age_s' : 'webhook_age_s';
      if (!rec) continue;
      const rotated = rec.rotation_at || rec.rotated_at || null;
      if (rotated) {
        const t = Date.parse(String(rotated));
        if (Number.isFinite(t)) out[key] = Math.max(0, Math.floor((Date.now() - t) / 1000));
      } else {
        try {
          const st = fs.statSync(secretFilePath(name));
          out[key] = Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 1000));
        } catch (_) { /* ok */ }
      }
    }
  } catch (_) { /* ok */ }
  return out;
}

function snapshot(opts = {}) {
  const sorted = chatLatencies.slice().sort((a, b) => a - b);
  let jobCounts = null;
  try {
    jobCounts = require('./agentJobs').jobCounts();
  } catch (_) {
    jobCounts = null;
  }
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  return {
    ok: true,
    ts: new Date().toISOString(),
    chat: {
      turns: chatTurns,
      errors: chatErrors,
      latency_samples: sorted.length,
      p50_ms: percentile(sorted, 50),
      p95_ms: percentile(sorted, 95),
    },
    ollama: {
      errors: ollamaErrors,
      queue: queueDepth(),
    },
    jobs: {
      counts: jobCounts,
      last_hour: jobFailureRateLastHour(),
    },
    scheduler: {
      failures_by_id: schedulerFailuresById(),
      runs_tracked: schedulerRuns.length,
    },
    worker: workerQueueSnapshot(rootDir),
    denials: {
      plane_denied: planeDenied,
      session_forbidden: sessionForbidden,
    },
    secrets: secretsRotationAge(),
    process: {
      unhandled_rejections: unhandledRejections,
      uncaught_exceptions: uncaughtExceptions,
      uptime_s: Math.floor(process.uptime()),
      pid: process.pid,
    },
  };
}

function installProcessHandlers() {
  if (global.__pikoOpsHandlersInstalled) return;
  global.__pikoOpsHandlersInstalled = true;
  process.on('unhandledRejection', (reason) => {
    recordUnhandledRejection();
    try {
      const { log } = require('./logger');
      log('error', 'unhandledRejection', {
        reason: String(reason && reason.message ? reason.message : reason).slice(0, 400),
      });
    } catch (_) {
      console.error('[ops] unhandledRejection', reason);
    }
  });
  process.on('uncaughtException', (err) => {
    recordUncaughtException();
    try {
      const { log, logger } = require('./logger');
      log('fatal', 'uncaughtException', {
        message: String(err && err.message ? err.message : err).slice(0, 400),
        stack: String(err && err.stack ? err.stack : '').slice(0, 800),
      });
      if (logger && typeof logger.flush === 'function') logger.flush();
    } catch (_) {
      console.error('[ops] uncaughtException', err);
    }
    setTimeout(() => process.exit(1), 200).unref?.();
  });
}

/** Test helper — reset counters between cases. */
function _resetForTests() {
  chatLatencies.length = 0;
  chatTurns = 0;
  chatErrors = 0;
  ollamaErrors = 0;
  unhandledRejections = 0;
  uncaughtExceptions = 0;
  planeDenied = 0;
  sessionForbidden = 0;
  jobTransitions.length = 0;
  schedulerRuns.length = 0;
}

module.exports = {
  recordChatTurn,
  recordOllamaError,
  recordUnhandledRejection,
  recordUncaughtException,
  recordJobTransition,
  recordSchedulerRun,
  recordPlaneDenied,
  recordSessionForbidden,
  snapshot,
  installProcessHandlers,
  queueDepth,
  _resetForTests,
};
