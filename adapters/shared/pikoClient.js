/**
 * Shared Piko API client for adapters. POSTs to /api/chat with exponential backoff.
 * Use when Optimus may be rebooting or Ollama loading a model (cold start).
 * Sends X-Piko-Key when PIKO_API_KEY is set (required once spine auth is tightened).
 *
 * WP6.3: per-session in-flight mutex (drop rapid repeats) + error-reply rate limit.
 */
const http = require('http');
const https = require('https');

const DEFAULT_RETRIES = 3;
const BACKOFF_MS = [2000, 4000, 8000];
const DEFAULT_TIMEOUT_MS = 60000;
const ERROR_REPLY_TTL_MS = 60 * 1000;

/** sessionId → true while a request is in flight */
const inflight = new Map();
/** sessionId → last error-reply timestamp */
const lastErrorReplyAt = new Map();

function buildAuthHeaders(env = process.env) {
  const headers = { 'Content-Type': 'application/json' };
  const key = String((env && env.PIKO_API_KEY) || '').trim();
  if (key) headers['X-Piko-Key'] = key;
  return headers;
}

/**
 * Rate-limit error replies to one per chat per minute.
 */
function shouldSendErrorReply(sessionId, now = Date.now()) {
  const key = String(sessionId || 'adapter-default');
  const prev = lastErrorReplyAt.get(key) || 0;
  if (now - prev < ERROR_REPLY_TTL_MS) return false;
  lastErrorReplyAt.set(key, now);
  return true;
}

function clearFloodState() {
  inflight.clear();
  lastErrorReplyAt.clear();
}

/**
 * POST message to Piko /api/chat. Retries with exponential backoff on failure.
 * Rapid repeats for the same sessionId while in-flight are dropped.
 * @param {string} pikoUrl - Base URL (e.g. http://localhost:3000)
 * @param {string} message - User message
 * @param {string} [sessionId] - Session ID (e.g. discord-123)
 * @param {{ retries?: number, timeoutMs?: number, bypassFlood?: boolean }} [options]
 * @returns {Promise<{ reply?: string, error?: string, dropped?: boolean }>}
 */
async function postToPiko(pikoUrl, message, sessionId, options = {}) {
  const sid = String(sessionId || 'adapter-default');
  if (!options.bypassFlood && inflight.get(sid)) {
    return { dropped: true, error: 'in_flight', reply: '' };
  }
  if (!options.bypassFlood) inflight.set(sid, true);

  try {
    const retries = options.retries ?? DEFAULT_RETRIES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    function attempt(attemptIndex) {
      return new Promise((resolve, reject) => {
        const u = new URL((pikoUrl || '').replace(/\/$/, '') + '/api/chat');
        const body = JSON.stringify({ message, sessionId: sid });
        const isHttps = u.protocol === 'https:';
        const opts = {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname,
          method: 'POST',
          headers: buildAuthHeaders(),
        };
        const lib = isHttps ? https : http;
        const req = lib.request(opts, (res) => {
          let data = '';
          res.on('data', (ch) => (data += ch));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else if (attemptIndex < retries - 1) {
                reject(new Error(`HTTP ${res.statusCode}: ${(json.error || data).slice(0, 100)}`));
              } else {
                resolve(json);
              }
            } catch (_) {
              if (attemptIndex < retries - 1) reject(new Error('Invalid JSON response'));
              else resolve({ reply: '', error: data.slice(0, 200) });
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.write(body);
        req.end();
      });
    }

    let lastError;
    for (let i = 0; i < retries; i++) {
      try {
        const result = await attempt(i);
        return result;
      } catch (e) {
        lastError = e;
        if (i < retries - 1 && BACKOFF_MS[i] != null) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
        }
      }
    }
    throw lastError || new Error('postToPiko failed');
  } finally {
    if (!options.bypassFlood) inflight.delete(sid);
  }
}

module.exports = {
  postToPiko,
  buildAuthHeaders,
  shouldSendErrorReply,
  clearFloodState,
  ERROR_REPLY_TTL_MS,
  _inflight: inflight,
};
