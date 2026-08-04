/**
 * Background job scheduler registry (P3.1d).
 * Each entry: { id, tenantGate, intervalMs|cronExpr, fn }
 * tenantGate(profile) → false skips the tick (fixes ungated cron finding).
 */
const cron = require('node-cron');

function createScheduler(opts = {}) {
  const log = opts.log || ((level, msg, meta) => {
    try {
      require('./logger').log(level, msg, meta || {});
    } catch (_) {
      if (level === 'error') console.error('[scheduler]', msg, meta || '');
    }
  });
  const getProfile = opts.getTenantProfile
    || (() => {
      try {
        return require('./tenantBackgroundJobs').getTenantBackgroundProfile(
          opts.rootDir || require('path').join(__dirname, '..'),
        );
      } catch (_) {
        return { profileId: null, tenant_id: null, isCulture: false };
      }
    });

  /** @type {object[]} */
  const registry = [];
  const handles = [];

  function register(entry) {
    if (!entry || !entry.id || typeof entry.fn !== 'function') {
      throw new Error('scheduler.register: id and fn required');
    }
    if (!entry.intervalMs && !entry.cronExpr) {
      throw new Error(`scheduler.register: ${entry.id} needs intervalMs or cronExpr`);
    }
    registry.push({
      id: String(entry.id),
      tenantGate: typeof entry.tenantGate === 'function' ? entry.tenantGate : () => true,
      intervalMs: entry.intervalMs != null ? Number(entry.intervalMs) : null,
      cronExpr: entry.cronExpr || null,
      fn: entry.fn,
      unref: entry.unref !== false,
    });
  }

  async function tick(entry) {
    const profile = getProfile();
    let allowed = true;
    try {
      allowed = entry.tenantGate(profile) !== false;
    } catch (e) {
      log('warn', 'scheduler_gate_error', { id: entry.id, error: String(e.message || e) });
      allowed = false;
    }
    if (!allowed) {
      log('debug', 'scheduler_skip', { id: entry.id, reason: 'tenant_gate' });
      return;
    }
    const t0 = Date.now();
    try {
      await entry.fn({ profile });
      log('info', 'scheduler_run', {
        tag: 'scheduler_run',
        id: entry.id,
        ok: true,
        latency_ms: Date.now() - t0,
      });
    } catch (e) {
      log('error', 'scheduler_run', {
        tag: 'scheduler_run',
        id: entry.id,
        ok: false,
        latency_ms: Date.now() - t0,
        error: String(e && e.message ? e.message : e).slice(0, 200),
      });
    }
  }

  function startAll() {
    for (const entry of registry) {
      if (entry.intervalMs != null && entry.intervalMs > 0) {
        const h = setInterval(() => { tick(entry); }, entry.intervalMs);
        if (entry.unref && typeof h.unref === 'function') h.unref();
        handles.push({ id: entry.id, kind: 'interval', handle: h });
      } else if (entry.cronExpr) {
        const task = cron.schedule(entry.cronExpr, () => { tick(entry); });
        handles.push({ id: entry.id, kind: 'cron', handle: task });
      }
    }
    return handles.length;
  }

  function stopAll() {
    for (const h of handles) {
      try {
        if (h.kind === 'interval') clearInterval(h.handle);
        else if (h.handle && typeof h.handle.stop === 'function') h.handle.stop();
      } catch (_) { /* ok */ }
    }
    handles.length = 0;
  }

  function list() {
    return registry.map((e) => ({
      id: e.id,
      intervalMs: e.intervalMs,
      cronExpr: e.cronExpr,
    }));
  }

  return {
    register,
    startAll,
    stopAll,
    list,
    _tick: tick,
    _registry: registry,
  };
}

/** Common gates */
function cultureOnly(profile) {
  return !!(profile && profile.isCulture);
}

function ausmakerOnly(profile) {
  return !!(profile && profile.isAusmaker);
}

function always() {
  return true;
}

/** Gate via JOB_DEFS + env disables (same semantics as isBackgroundJobEnabled). */
function jobEnabled(jobId, rootDir) {
  return () => {
    try {
      return require('./tenantBackgroundJobs').isBackgroundJobEnabled(jobId, rootDir) !== false;
    } catch (_) {
      return false;
    }
  };
}

module.exports = {
  createScheduler,
  cultureOnly,
  ausmakerOnly,
  always,
  jobEnabled,
};
