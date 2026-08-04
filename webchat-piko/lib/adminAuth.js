/**
 * Admin panel auth — session cookie gates dashboards and operator APIs.
 *
 * Two kinds of account:
 *   - The super user from .env (PIKO_ADMIN_USER/PIKO_ADMIN_PASSWORD) — role
 *     "operator", full access. This is the platform owner.
 *   - Client users stored in <dataDir>/dashboard-users.json — role "client",
 *     scoped to the customer-facing dashboard of THIS tenant instance only.
 *     Managed from the /admin screen.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isAsciiDigit, isAsciiLetter, stripTrailingSlash, isSafePathPrefix } = require('./text');

const SESSION_COOKIE = 'piko_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

const DASHBOARDS = [
  {
    id: 'legion-hq',
    title: 'Legion HQ',
    path: '/hq-dashboard',
    description: 'Tenant registry, observe rollup, release checks.',
    group: 'Operator',
  },
  {
    id: 'control',
    title: 'Control panel',
    path: '/control',
    description: 'Policies, proactive engine, learning, channels, integrations.',
    group: 'Operator',
  },
  {
    id: 'legacy-dashboard',
    title: 'Piko dashboard',
    path: '/piko-dashboard',
    description: 'Legacy web dashboard.',
    group: 'Legacy',
  },
];

function getConfig() {
  const user = String(process.env.PIKO_ADMIN_USER || 'admin').trim() || 'admin';
  const password = String(process.env.PIKO_ADMIN_PASSWORD || '').trim();
  return { user, password, enabled: password.length > 0 };
}

function isEnabled() {
  return getConfig().enabled;
}

function envStrict() {
  const v = String(process.env.PIKO_ENV_STRICT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Admin gate is configured when env super-user password is set, or a
 * dashboard-users.json store has at least one user (P4.1).
 */
function isConfigured(dataDir) {
  if (isEnabled()) return true;
  if (!dataDir) return false;
  try {
    const users = loadUsers(dataDir);
    return Array.isArray(users) && users.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Under PIKO_ENV_STRICT, an unconfigured admin gate must fail closed on
 * protected paths (not silently skip). Dev (strict off) keeps legacy open.
 */
function mustFailClosed(dataDir) {
  return envStrict() && !isConfigured(dataDir);
}

let _unconfiguredLogged = false;

function logUnconfiguredOnce() {
  if (_unconfiguredLogged) return;
  _unconfiguredLogged = true;
  const msg = 'admin_auth_unconfigured: PIKO_ENV_STRICT=1 but no PIKO_ADMIN_PASSWORD and no dashboard users — protected paths return 503';
  try {
    require('./logger').log('error', 'admin_auth_unconfigured', {
      tag: 'admin_auth_unconfigured',
      msg,
    });
  } catch (_) {
    console.error('[adminAuth] ERROR', msg);
  }
}

/**
 * @returns {null | { status: number, body: string }}
 */
function denyIfUnconfigured(pathname, method, dataDir) {
  if (!mustFailClosed(dataDir)) return null;
  if (!isProtectedApiPath(pathname, method) && !(String(method || '').toUpperCase() === 'GET' && isProtectedPagePath(pathname))) {
    return null;
  }
  logUnconfiguredOnce();
  return {
    status: 503,
    body: JSON.stringify({
      ok: false,
      error: 'admin_auth_unconfigured',
      message: 'Admin auth is required under PIKO_ENV_STRICT but is not configured',
    }),
  };
}

function sessionsPath(dataDir) {
  return path.join(dataDir, 'admin-sessions.json');
}

function loadSessions(dataDir) {
  const p = sessionsPath(dataDir);
  if (!fs.existsSync(p)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function saveSessions(dataDir, sessions) {
  const p = sessionsPath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(sessions, null, 2));
}

function pruneSessions(sessions) {
  const now = Date.now();
  const out = {};
  for (const [token, row] of Object.entries(sessions)) {
    if (row && row.expiresAt > now) out[token] = row;
  }
  return out;
}

function safeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function validateCredentials(username, password) {
  const c = getConfig();
  if (!c.enabled) return false;
  const u = String(username || '');
  const p = String(password || '');
  return safeEq(u, c.user) && safeEq(p, c.password);
}

// ---------------------------------------------------------------------------
// Client users (per-tenant, file-backed, scrypt-hashed)
// ---------------------------------------------------------------------------

function usersPath(dataDir) {
  return path.join(dataDir, 'dashboard-users.json');
}

function loadUsers(dataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(usersPath(dataDir), 'utf8'));
    return Array.isArray(data.users) ? data.users : [];
  } catch (_) {
    return [];
  }
}

function saveUsers(dataDir, users) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersPath(dataDir), JSON.stringify({ users }, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT_OPTS).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const candidate = crypto.scryptSync(String(password), rec.salt, 32, SCRYPT_OPTS).toString('hex');
  return safeEq(candidate, rec.hash);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function isValidUsername(u) {
  if (!u || u.length < 2 || u.length > 41) return false;
  const first = u[0];
  if (!(isAsciiLetter(first) || isAsciiDigit(first))) return false;
  for (let i = 1; i < u.length; i++) {
    const ch = u[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '.' || ch === '_' || ch === '-') continue;
    return false;
  }
  return true;
}

function findUser(dataDir, username) {
  const u = normalizeUsername(username);
  return loadUsers(dataDir).find((row) => row.username === u) || null;
}

function createUser(dataDir, { username, password, createdBy }) {
  const u = normalizeUsername(username);
  if (!isValidUsername(u)) {
    throw new Error('Username must be 2–40 characters: letters, numbers, dots, dashes.');
  }
  const c = getConfig();
  if (u === c.user.toLowerCase()) throw new Error('That username is reserved.');
  const users = loadUsers(dataDir);
  if (users.some((row) => row.username === u)) throw new Error('That username already exists.');
  if (String(password || '').length < 10) throw new Error('Password must be at least 10 characters.');
  users.push({
    username: u,
    role: 'client',
    password: hashPassword(password),
    created_at: new Date().toISOString(),
    created_by: String(createdBy || 'operator'),
  });
  saveUsers(dataDir, users);
  return { username: u, role: 'client' };
}

function deleteUser(dataDir, username) {
  const u = normalizeUsername(username);
  const users = loadUsers(dataDir);
  const next = users.filter((row) => row.username !== u);
  if (next.length === users.length) return false;
  saveUsers(dataDir, next);
  // Kill any live sessions for the removed user.
  const sessions = loadSessions(dataDir);
  for (const [token, row] of Object.entries(sessions)) {
    if (row && normalizeUsername(row.username) === u) delete sessions[token];
  }
  saveSessions(dataDir, pruneSessions(sessions));
  return true;
}

function resetUserPassword(dataDir, username, newPassword) {
  const u = normalizeUsername(username);
  if (String(newPassword || '').length < 10) throw new Error('Password must be at least 10 characters.');
  const users = loadUsers(dataDir);
  const row = users.find((r) => r.username === u);
  if (!row) return false;
  row.password = hashPassword(newPassword);
  row.password_reset_at = new Date().toISOString();
  saveUsers(dataDir, users);
  return true;
}

function listUsers(dataDir) {
  return loadUsers(dataDir).map((row) => ({
    username: row.username,
    role: row.role || 'client',
    created_at: row.created_at || null,
    last_login_at: row.last_login_at || null,
  }));
}

/**
 * Check credentials against the env super user first, then client users.
 * Returns { username, role } or null.
 */
function authenticate(dataDir, username, password) {
  if (validateCredentials(username, password)) {
    return { username: getConfig().user, role: 'operator' };
  }
  const row = findUser(dataDir, username);
  if (row && verifyPassword(password, row.password)) {
    try {
      const users = loadUsers(dataDir);
      const target = users.find((r) => r.username === row.username);
      if (target) {
        target.last_login_at = new Date().toISOString();
        saveUsers(dataDir, users);
      }
    } catch (_) {}
    return { username: row.username, role: row.role || 'client' };
  }
  return null;
}

function createSession(dataDir, username, role = 'operator') {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = pruneSessions(loadSessions(dataDir));
  const now = Date.now();
  sessions[token] = {
    username,
    role,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_TTL_MS,
  };
  saveSessions(dataDir, sessions);
  return token;
}

function getSession(dataDir, token) {
  if (!token) return null;
  const sessions = pruneSessions(loadSessions(dataDir));
  const row = sessions[token];
  if (!row) return null;
  // Sessions minted before roles existed belong to the env super user.
  return { username: row.username, role: row.role || 'operator', token };
}

function destroySession(dataDir, token) {
  if (!token) return;
  const sessions = loadSessions(dataDir);
  delete sessions[token];
  saveSessions(dataDir, pruneSessions(sessions));
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** All values for one cookie name, in browser order (most specific path first).
 *  Browsers may send several piko_admin_session cookies at once — e.g. a stale
 *  Path=/ cookie from an old deploy alongside the fresh prefix-scoped one, or
 *  sibling-tenant cookies on a shared hostname. */
function cookieValues(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const values = [];
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      values.push(decodeURIComponent(part.slice(idx + 1).trim()));
    } catch (_) {
      values.push(part.slice(idx + 1).trim());
    }
  }
  return values;
}

function getSessionFromRequest(req, dataDir) {
  // Try every candidate: stale or foreign-tenant tokens simply miss and the
  // valid one (if any) wins, instead of a stale duplicate masking a fresh login.
  for (const token of cookieValues(req, SESSION_COOKIE)) {
    const session = getSession(dataDir, token);
    if (session) return session;
  }
  return null;
}

function cookieSecure(req) {
  if (process.env.PIKO_ADMIN_COOKIE_SECURE === '1') return true;
  const fwd = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return fwd === 'https';
}

/** Scope cookies to the public path prefix so /piko and /piko-ei on the
 *  same host don't share a session. Falls back to "/" when not proxied. */
function cookiePath(req) {
  const raw = String((req && req.headers && req.headers['x-forwarded-prefix']) || '').trim();
  if (isSafePathPrefix(raw)) {
    const cleaned = stripTrailingSlash(raw) || '/';
    return cleaned;
  }
  return '/';
}

function setSessionCookie(res, req, token) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=${cookiePath(req)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, req) {
  const path = cookiePath(req);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isPublicAdminPath(pathname) {
  const p = stripTrailingSlash(pathname) || '/';
  return p === '/admin/login' || p === '/api/admin/login';
}

function isProtectedPagePath(pathname) {
  if (!pathname) return false;
  const p = stripTrailingSlash(pathname) || '/';
  if (p === '/admin') return true;
  if (p === '/admin/login') return false;
  const exact = [
    '/ios-dashboard',
    '/iphone-dashboard',
    '/command-centre',
    '/hq-dashboard',
    '/piko-dashboard',
    '/dashboard',
    '/ei-eval',
    '/corpus',
  ];
  if (exact.includes(p)) return true;
  if (p === '/control' || p.startsWith('/control-')) return true;
  return false;
}

/** Pages a "client" role may never open — operator tooling. */
function isOperatorOnlyPagePath(pathname) {
  const p = stripTrailingSlash(pathname) || '/';
  if (p === '/admin') return true;
  if (p === '/hq-dashboard' || p === '/command-centre') return true;
  if (p === '/piko-dashboard' || p === '/dashboard') return true;
  if (p === '/ei-eval' || p === '/corpus') return true;
  if (p === '/control' || p.startsWith('/control-')) return true;
  return false;
}

/** Campaign POST actions that mutate state — operator only. */
const OPERATOR_ONLY_CAMPAIGN_ACTIONS = new Set([
  'start',
  'stop',
  'pause',
  'resume',
  'run_now',
  'flag_duplicate_urls',
  'add_leads',
  'backfill_learning',
]);

function isOperatorOnlyCampaignAction(action) {
  return OPERATOR_ONLY_CAMPAIGN_ACTIONS.has(String(action || '').toLowerCase());
}

/** APIs a "client" role may never call. The customer dashboard's own reads
 *  (spine health, notifications, agents, approvals, tools) stay available. */
function isOperatorOnlyApiPath(pathname) {
  const p = String(pathname || '');
  if (p === '/api/control/legion-adapter-health') return false; // dashboard spine card
  if (p === '/api/chat/inject' || p.startsWith('/api/chat/inject/')) return true;
  if (p.startsWith('/api/ei/engineering')) return true;
  const prefixes = ['/api/hq', '/api/mgmt', '/api/observe', '/api/control', '/api/admin/users'];
  return prefixes.some((pref) => p === pref || p.startsWith(`${pref}/`));
}

function isProtectedApiPath(pathname, method) {
  if (!pathname) return false;
  const p = String(pathname);
  if (p.startsWith('/api/admin/')) return false;
  if (p === '/api/health') return false;
  if (p === '/api/site-context') return false;
  if (p === '/api/command-centre/clients') return false;
  const prefixes = [
    '/api/control',
    '/api/hq',
    '/api/observe',
    '/api/mgmt',
    '/api/ops',
    '/api/agents',
    '/api/ios-dashboard',
    '/api/yolo-tool',
    '/api/yolo-tools',
    '/api/ios-hub',
    '/api/hitl',
    '/api/tool-audit',
    '/api/notifications',
    '/api/integrations',
    '/api/gmail',
    '/api/ei',
    '/api/cultures',
    '/api/chat/inject',
  ];
  if (prefixes.some((pref) => p === pref || p.startsWith(`${pref}/`))) return true;
  if (method === 'POST' && p === '/api/mgmt/deploy/trigger') return true;
  return false;
}

// Read-only monitoring endpoints that on-box tooling (smoke, legion-watch, api-ping,
// context-refresh) must reach without an admin session. Only honoured for GET requests
// originating from loopback — browser/WAN traffic still requires login.
const MONITOR_READONLY_PATHS = new Set([
  '/api/observe/summary',
  '/api/hq/status',
  '/api/hq/registry',
  '/api/control/legion-adapter-health',
  '/api/control/legion-runs',
  '/api/control/legion-scheduled',
]);

function isLoopbackAddress(addr) {
  const a = String(addr || '').trim();
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// True when this is a safe on-box read-only monitor request that may bypass admin auth.
// Uses the real socket peer only (never X-Forwarded-For) so a proxied external request
// cannot spoof loopback.
function isMonitorBypass(req, pathname, method) {
  if (String(method || '').toUpperCase() !== 'GET') return false;
  if (!MONITOR_READONLY_PATHS.has(String(pathname || ''))) return false;
  const peer = req && req.socket && req.socket.remoteAddress;
  if (isLoopbackAddress(peer)) return true;
  // Cross-host monitors (HQ registry poller) authenticate with the tenant's
  // API key instead of an admin session.
  try {
    const { keyMatches } = require('./apiAuth');
    const presented = String((req && req.headers && req.headers['x-piko-key']) || '').trim();
    if (presented && keyMatches(presented)) return true;
  } catch (_) {}
  return false;
}

function listDashboards() {
  return DASHBOARDS.slice();
}

module.exports = {
  SESSION_COOKIE,
  getConfig,
  isEnabled,
  isConfigured,
  mustFailClosed,
  denyIfUnconfigured,
  logUnconfiguredOnce,
  envStrict,
  validateCredentials,
  authenticate,
  createUser,
  deleteUser,
  resetUserPassword,
  listUsers,
  createSession,
  getSession,
  destroySession,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  isPublicAdminPath,
  isProtectedPagePath,
  isProtectedApiPath,
  isOperatorOnlyPagePath,
  isOperatorOnlyApiPath,
  isOperatorOnlyCampaignAction,
  isMonitorBypass,
  listDashboards,
};
