function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Dispatch timed out after ${timeoutMs}ms`);
        err.code = 'DISPATCH_TIMEOUT';
        reject(err);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeChannelConfig(channel, input, fallbackRetry, fallbackTimeoutMs) {
  const cfg = input && typeof input === 'object' ? input : {};
  return {
    enabled: cfg.enabled !== false,
    retryMax: clamp(parseInt(cfg.retryMax != null ? cfg.retryMax : fallbackRetry, 10) || 0, 0, 10),
    timeoutMs: clamp(parseInt(cfg.timeoutMs != null ? cfg.timeoutMs : fallbackTimeoutMs, 10) || 1000, 500, 120000),
    channel,
  };
}

function toErrorInfo(err) {
  return {
    code: err && err.code ? String(err.code) : 'DISPATCH_ERROR',
    message: err && err.message ? String(err.message) : 'dispatch failed',
  };
}

function createDispatcher(options) {
  const {
    sendTelegram,
    appendPending,
    sendWebhook,
    retryMax = Number(process.env.PIKO_PROACTIVE_RETRY_MAX || 2),
    retryBaseMs = Number(process.env.PIKO_PROACTIVE_RETRY_BASE_MS || 1500),
    jitterRatio = Number(process.env.PIKO_PROACTIVE_RETRY_JITTER_RATIO || 0.2),
    random = Math.random,
  } = options || {};

  async function sendToChannel(channel, message, meta) {
    if (channel === 'telegram') {
      await sendTelegram(message);
      return { channel, status: 'sent' };
    }
    if (channel === 'pending_file') {
      appendPending(message);
      return { channel, status: 'queued' };
    }
    if (channel === 'webhook' || channel === 'whatsapp_bridge' || channel === 'imessage_bridge' || String(channel).startsWith('webhook:')) {
      if (typeof sendWebhook !== 'function') return { channel, status: 'ignored' };
      const target = String(channel).startsWith('webhook:') ? String(channel).slice('webhook:'.length) : channel;
      await sendWebhook(message, {
        channel,
        target,
        urgency: meta && meta.urgency ? meta.urgency : 'normal',
      });
      return { channel, status: 'sent' };
    }
    return { channel, status: 'ignored' };
  }

  async function dispatchWithRetry(input) {
    const {
      channels = [],
      message,
      urgency = 'normal',
      channelConfig = {},
      fallbackToPending = true,
    } = input || {};
    const attempts = [];
    const results = [];

    for (const channel of channels) {
      const cfg = normalizeChannelConfig(channel, channelConfig[channel], retryMax, channel === 'pending_file' ? 1000 : 8000);
      if (!cfg.enabled) {
        results.push({ channel, status: 'disabled' });
        continue;
      }
      let success = false;
      let lastError = null;
      const maxAttempts = Math.max(1, cfg.retryMax + 1);
      for (let i = 0; i < maxAttempts; i += 1) {
        const attemptNo = i + 1;
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        try {
          const result = await withTimeout(
            Promise.resolve(sendToChannel(channel, message, { urgency })),
            cfg.timeoutMs,
          );
          const finished = Date.now();
          attempts.push({
            channel,
            attempt: attemptNo,
            startedAt,
            finishedAt: new Date(finished).toISOString(),
            durationMs: finished - started,
            ok: result.status === 'sent' || result.status === 'queued',
            status: result.status,
          });
          results.push(result);
          success = result.status === 'sent' || result.status === 'queued';
          if (success) break;
        } catch (e) {
          const err = toErrorInfo(e);
          const finished = Date.now();
          attempts.push({
            channel,
            attempt: attemptNo,
            startedAt,
            finishedAt: new Date(finished).toISOString(),
            durationMs: finished - started,
            ok: false,
            status: 'error',
            error: err.message,
            errorCode: err.code,
          });
          lastError = err;
          if (attemptNo < maxAttempts) {
            const urgencyMultiplier = urgency === 'high' ? 0.6 : urgency === 'low' ? 1.4 : 1;
            const base = Math.max(100, Math.round(retryBaseMs * Math.pow(2, i) * urgencyMultiplier));
            const jitter = Math.round(base * clamp(jitterRatio, 0, 1) * (typeof random === 'function' ? random() : 0));
            await sleep(base + jitter);
          }
        }
      }
      if (!success && lastError) {
        results.push({
          channel,
          status: 'error',
          error: lastError.message,
          errorCode: lastError.code,
        });
      }
    }

    const hasSuccessBeforeFallback = results.some((r) => r.status === 'sent' || r.status === 'queued');
    const pendingAlreadyAttempted = attempts.some((a) => a.channel === 'pending_file');
    if (!hasSuccessBeforeFallback && fallbackToPending && !pendingAlreadyAttempted) {
      const pendingCfg = normalizeChannelConfig('pending_file', channelConfig.pending_file, 0, 1000);
      if (pendingCfg.enabled) {
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        try {
          const pendingResult = await withTimeout(
            Promise.resolve(sendToChannel('pending_file', message, { urgency })),
            pendingCfg.timeoutMs,
          );
          const finished = Date.now();
          attempts.push({
            channel: 'pending_file',
            attempt: 1,
            startedAt,
            finishedAt: new Date(finished).toISOString(),
            durationMs: finished - started,
            ok: pendingResult.status === 'sent' || pendingResult.status === 'queued',
            status: pendingResult.status,
            fallback: true,
          });
          results.push({
            ...pendingResult,
            fallback: true,
          });
        } catch (e) {
          const err = toErrorInfo(e);
          const finished = Date.now();
          attempts.push({
            channel: 'pending_file',
            attempt: 1,
            startedAt,
            finishedAt: new Date(finished).toISOString(),
            durationMs: finished - started,
            ok: false,
            status: 'error',
            error: err.message,
            errorCode: err.code,
            fallback: true,
          });
          results.push({
            channel: 'pending_file',
            status: 'error',
            error: err.message,
            errorCode: err.code,
            fallback: true,
          });
        }
      }
    }

    const ok = results.some((r) => r.status === 'sent' || r.status === 'queued');
    const failedChannels = results.filter((r) => r.status === 'error').map((r) => ({
      channel: r.channel,
      error: r.error || 'dispatch failed',
      errorCode: r.errorCode || 'DISPATCH_ERROR',
    }));
    return {
      ok,
      channels: results,
      attempts,
      retryUsed: attempts.some((a) => a.attempt > 1),
      failure: ok ? null : {
        code: 'DISPATCH_ALL_CHANNELS_FAILED',
        message: 'No configured channel accepted delivery',
        failedChannels,
      },
    };
  }

  return {
    dispatchWithRetry,
  };
}

module.exports = {
  createDispatcher,
};
