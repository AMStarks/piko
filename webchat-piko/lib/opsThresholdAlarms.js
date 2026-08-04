/**
 * P4.6b — simple threshold alarms → notification feed + Telegram (notifyAdmin).
 * Registered on the tenant-gated scheduler; no external SaaS.
 */
const path = require('path');

const DEFAULTS = {
  queueStuckSec: Number(process.env.PIKO_ALARM_QUEUE_STUCK_SEC || 30 * 60) || 30 * 60,
  jobFailureStreak: Number(process.env.PIKO_ALARM_JOB_FAIL_STREAK || 5) || 5,
  chatP95Ms: Number(process.env.PIKO_ALARM_CHAT_P95_MS || 120000) || 120000,
  cooldownMs: Number(process.env.PIKO_ALARM_COOLDOWN_MS || 30 * 60 * 1000) || 30 * 60 * 1000,
};

const lastFired = Object.create(null);

function shouldFire(key, cooldownMs) {
  const now = Date.now();
  const prev = lastFired[key] || 0;
  if (now - prev < cooldownMs) return false;
  lastFired[key] = now;
  return true;
}

async function evaluateAndNotify(opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const cfg = { ...DEFAULTS, ...(opts.thresholds || {}) };
  const { snapshot } = require('./opsMetrics');
  const snap = snapshot({ rootDir });
  const alarms = [];

  const age = snap.worker && snap.worker.oldest_pending_age_s;
  const pending = snap.worker && snap.worker.pending;
  if (pending > 0 && age != null && age >= cfg.queueStuckSec) {
    alarms.push({
      key: 'queue_stuck',
      severity: 'warn',
      text: `Worker queue stuck: ${pending} pending, oldest ${Math.floor(age / 60)}m (threshold ${Math.floor(cfg.queueStuckSec / 60)}m)`,
    });
  }

  const failRate = snap.jobs && snap.jobs.last_hour;
  if (failRate && failRate.failures >= cfg.jobFailureStreak && failRate.samples >= cfg.jobFailureStreak) {
    alarms.push({
      key: 'job_failure_streak',
      severity: 'error',
      text: `Job failure streak: ${failRate.failures}/${failRate.samples} in last hour`,
    });
  }

  const p95 = snap.chat && snap.chat.p95_ms;
  const samples = snap.chat && snap.chat.latency_samples;
  if (samples >= 5 && p95 >= cfg.chatP95Ms) {
    alarms.push({
      key: 'chat_p95',
      severity: 'warn',
      text: `Chat p95 ${p95}ms exceeds ${cfg.chatP95Ms}ms (${samples} samples)`,
    });
  }

  const fired = [];
  for (const a of alarms) {
    if (!shouldFire(a.key, cfg.cooldownMs)) continue;
    try {
      const { notifyAdmin } = require('./notifyAdmin');
      await notifyAdmin(a.text, {
        category: 'ops_alarm',
        title: `Piko alarm: ${a.key}`,
        severity: a.severity,
        source: 'opsThresholdAlarms',
        meta: { alarm: a.key },
      });
      fired.push(a.key);
    } catch (e) {
      try {
        require('./logger').log('error', 'ops_alarm_notify_failed', {
          tag: 'ops_alarm',
          key: a.key,
          error: String(e && e.message ? e.message : e).slice(0, 200),
        });
      } catch (_) { /* ok */ }
    }
  }
  return { ok: true, evaluated: alarms.length, fired };
}

function registerOpsThresholdAlarms(scheduler, opts = {}) {
  if (!scheduler || typeof scheduler.register !== 'function') return;
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const { always } = require('./scheduler');
  scheduler.register({
    id: 'ops_threshold_alarms',
    tenantGate: always,
    intervalMs: opts.intervalMs != null ? opts.intervalMs : 5 * 60 * 1000,
    fn: async () => evaluateAndNotify({ rootDir, thresholds: opts.thresholds }),
  });
}

module.exports = {
  evaluateAndNotify,
  registerOpsThresholdAlarms,
  DEFAULTS,
  _lastFired: lastFired,
};
