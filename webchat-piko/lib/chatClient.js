/**
 * Shared chat client: POST message to Piko /api/chat. Use from intent-poller, adapters, scripts.
 * Phase 4.2 — single place for base URL, timeout, and response handling.
 */
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * POST a message to Piko /api/chat.
 * @param {string} baseUrl - e.g. http://localhost:3000 or https://piko.example.com
 * @param {string} message - User message text
 * @param {string} [sessionId] - Session id (e.g. 'intent-poller', 'slack-default')
 * @param {{ timeout?: number }} [options] - Optional timeout in ms
 * @returns {Promise<{ statusCode: number, data: string, reply?: string }>}
 */
const {
  stripTrailingSlash,
} = require('./text');

function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const key = String(process.env.PIKO_API_KEY || '').trim();
  if (key) headers['X-Piko-Key'] = key;
  return headers;
}

function postChat(baseUrl, message, sessionId = 'default', options = {}) {
  const timeout = options.timeout != null ? options.timeout : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const u = new URL(stripTrailingSlash((baseUrl || '')) + '/api/chat');
    const body = JSON.stringify({ message: String(message), sessionId: String(sessionId || 'default') });
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: authHeaders(),
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        let reply;
        try {
          const json = JSON.parse(data);
          reply = json.reply != null ? json.reply : (json.error ? String(json.error) : '');
        } catch (_) {
          reply = data.slice(0, 500);
        }
        resolve({ statusCode: res.statusCode, data, reply });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = {
  postChat,
  authHeaders,
  DEFAULT_TIMEOUT_MS,
};
