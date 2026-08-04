/**
 * In-process ops metrics for /api/ops/metrics (P2.4).
 * Rolling windows — not a full Prometheus exporter.
 */
const WINDOW = Math.max(50, Number(process.env.PIKO_OPS_METRICS_WINDOW || 200) || 200);

const chatLatencies = [];
let chatTurns = 0;
let chatErrors = 0;
let ollamaErrors = 0;
let unhandledRejections = 0;
let uncaughtExceptions = 0;
const jobTransitions = []; // { at, status, error }

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

function snapshot() {
  const sorted = chatLatencies.slice().sort((a, b) => a - b);
  let jobCounts = null;
  try {
    jobCounts = require('./agentJobs').jobCounts();
  } catch (_) {
    jobCounts = null;
  }
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
    // Let systemd restart — exit after a short flush window.
    setTimeout(() => process.exit(1), 200).unref?.();
  });
}

module.exports = {
  recordChatTurn,
  recordOllamaError,
  recordUnhandledRejection,
  recordUncaughtException,
  recordJobTransition,
  snapshot,
  installProcessHandlers,
  queueDepth,
};
