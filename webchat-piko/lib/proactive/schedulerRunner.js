function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function makeTimeoutError(source, timeoutMs) {
  const err = new Error(`Proactive cycle timed out after ${timeoutMs}ms (source=${source})`);
  err.code = 'PROACTIVE_CYCLE_TIMEOUT';
  return err;
}

function createProactiveCycleRunner(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const runCycle = opts.runCycle;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const defaultTimeoutMs = clamp(Number(opts.defaultTimeoutMs || 60000), 1000, 300000);
  if (typeof runCycle !== 'function') {
    throw new Error('createProactiveCycleRunner requires runCycle function');
  }

  let inFlight = false;
  let activeSource = '';
  let activeStartedAt = 0;

  function getState() {
    return {
      inFlight,
      activeSource: inFlight ? activeSource : '',
      activeForMs: inFlight ? Date.now() - activeStartedAt : 0,
    };
  }

  async function run(source, runOptions) {
    const src = String(source || 'unknown');
    const ro = runOptions && typeof runOptions === 'object' ? runOptions : {};
    const skipIfBusy = ro.skipIfBusy !== false;
    const timeoutMs = clamp(Number(ro.timeoutMs || defaultTimeoutMs), 1000, 300000);

    if (inFlight) {
      const activeForMs = Date.now() - activeStartedAt;
      log('warn', 'proactive_cycle_skipped', { source: src, reason: 'busy', activeSource, activeForMs });
      if (skipIfBusy) {
        return { ok: false, skipped: true, reason: 'busy', source: src, activeSource, activeForMs };
      }
      const busyErr = new Error(`Proactive cycle already running (activeSource=${activeSource})`);
      busyErr.code = 'PROACTIVE_CYCLE_BUSY';
      throw busyErr;
    }

    inFlight = true;
    activeSource = src;
    activeStartedAt = Date.now();

    let timer = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(makeTimeoutError(src, timeoutMs)), timeoutMs);
      });
      const summary = await Promise.race([
        runCycle({ source: src }),
        timeoutPromise,
      ]);
      const durationMs = Date.now() - activeStartedAt;
      log('info', 'proactive_cycle_finished', { source: src, durationMs, timeoutMs });
      return { ok: true, source: src, durationMs, summary };
    } catch (e) {
      const durationMs = Date.now() - activeStartedAt;
      log('error', 'proactive_cycle_failed', {
        source: src,
        durationMs,
        timeoutMs,
        code: e && e.code ? e.code : '',
        message: e && e.message ? e.message : 'Unknown proactive cycle error',
      });
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      inFlight = false;
      activeSource = '';
      activeStartedAt = 0;
    }
  }

  return {
    run,
    getState,
  };
}

module.exports = {
  createProactiveCycleRunner,
};
