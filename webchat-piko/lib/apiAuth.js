/**
 * Network-trust gate for /api/* — fail-closed against raw WAN access.
 *
 * Trust order:
 *   1. valid admin session cookie
 *   2. shared API key (`X-Piko-Key` / Bearer / `?piko_key=`)
 *   3. direct (unproxied) private socket IP — only in `lan` mode
 *
 * Proxied requests (X-Forwarded-For / X-Forwarded-Prefix / X-Forwarded-Proto)
 * never get LAN trust from the socket address: same-host reverse proxies
 * present 127.0.0.1 for every public request, which would otherwise bypass
 * the gate. X-Forwarded-For alone also never grants trust (client-spoofable).
 *
 * Modes (PIKO_API_AUTH): `strict` (default — never grant IP trust)
 * · `lan` (direct private socket IP trust) · `off` (legacy, no gate).
 */
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/ping',
  '/api/admin/login',
  '/api/admin/me',
  '/api/admin/logout',
]);

function isPrivateIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return false;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.') || ip.toLowerCase().startsWith('fe80:')) return true;
  // 172.16.0.0/12 — octet parse, no regex
  if (ip.startsWith('172.')) {
    const rest = ip.slice(4);
    const dot = rest.indexOf('.');
    const second = Number(dot >= 0 ? rest.slice(0, dot) : rest);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
  }
  if (ip.toLowerCase().startsWith('fd') || ip.toLowerCase().startsWith('fc')) return true;
  return false;
}

function presentedKey(req, query) {
  const h = req.headers || {};
  if (h['x-piko-key']) return String(h['x-piko-key']);
  const auth = String(h.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (query && query.piko_key) return String(query.piko_key);
  return '';
}

/**
 * Match presented key to shared or named client key (P5.1c).
 * @returns {{ name: string } | null} name is `shared` or client id
 */
function matchApiKey(presented) {
  if (!presented) return null;
  try {
    const { matchNamedApiKey } = require('./secretsStore');
    return matchNamedApiKey(presented);
  } catch (_) {
    return null;
  }
}

function keyMatches(presented) {
  return !!matchApiKey(presented);
}

function hasAdminSession(req, dataDir) {
  if (!dataDir) return false;
  try {
    const adminAuth = require('./adminAuth');
    if (!adminAuth.isEnabled()) return false;
    return !!adminAuth.getSessionFromRequest(req, dataDir);
  } catch (_) {
    return false;
  }
}

/** True when the request arrived via a reverse proxy (do not trust socket IP). */
function cameThroughProxy(req) {
  const h = (req && req.headers) || {};
  return !!(
    h['x-forwarded-for']
    || h['x-forwarded-prefix']
    || h['x-forwarded-proto']
    || h['x-real-ip']
  );
}

/**
 * Returns null when the request may proceed, or { status, body } to reject.
 * opts.dataDir enables admin-session cookie acceptance.
 */
function checkApiAuth(req, pathname, query, opts = {}) {
  const mode = String(process.env.PIKO_API_AUTH || 'strict').toLowerCase();
  if (mode === 'off') return null;
  if (!String(pathname || '').startsWith('/api/')) return null;
  if (OPEN_PATHS.has(pathname)) return null;

  if (hasAdminSession(req, opts.dataDir)) return null;
  if (keyMatches(presentedKey(req, query))) return null;

  if (mode !== 'strict' && !cameThroughProxy(req)) {
    const sockIp = req.socket && req.socket.remoteAddress;
    if (isPrivateIp(sockIp)) return null;
  }

  return {
    status: 401,
    body: JSON.stringify({ ok: false, error: 'unauthorized' }),
  };
}

module.exports = {
  checkApiAuth,
  isPrivateIp,
  keyMatches,
  matchApiKey,
  presentedKey,
  cameThroughProxy,
};
