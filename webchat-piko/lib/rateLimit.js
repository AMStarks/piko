/**
 * In-memory rate limiter for /api/chat. Per-key (e.g. IP or session); resets after window.
 */
const WINDOW_MS = Number.parseInt(process.env.PIKO_RATE_LIMIT_WINDOW_MS || '', 10) || (60 * 1000);
const MAX_PER_WINDOW = Number.parseInt(process.env.PIKO_RATE_LIMIT_MAX_PER_WINDOW || '', 10) || 60;

const store = new Map();

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.resetAt < now) store.delete(k);
  }
}

function check(key) {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: MAX_PER_WINDOW - 1 };
  }
  if (now >= entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + WINDOW_MS;
    return { ok: true, remaining: MAX_PER_WINDOW - 1 };
  }
  entry.count++;
  if (entry.count > MAX_PER_WINDOW) {
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: MAX_PER_WINDOW - entry.count };
}

module.exports = {
  check,
  WINDOW_MS,
  MAX_PER_WINDOW,
};
