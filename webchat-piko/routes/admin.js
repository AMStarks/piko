/**
 * Admin auth / session routes (P3.1b).
 */
const crypto = require('crypto');

function registerAdminRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('POST', '/api/admin/login', wrap(handleLogin), { group: 'admin', auth: 'admin_auth' });
  registry.add('GET', '/api/admin/users', wrap(handleUsers), { group: 'admin', auth: 'admin_auth' });
  registry.add('POST', '/api/admin/users', wrap(handleUsers), { group: 'admin', auth: 'admin_auth' });
  registry.add('POST', '/api/admin/logout', wrap(handleLogout), { group: 'admin', auth: 'admin_auth' });
  registry.add('GET', '/api/admin/me', wrap(handleMe), { group: 'admin', auth: 'admin_auth' });
}

async function tryHandleAdmin(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    return handleLogin(req, res, ctx);
  }
  if (pathname === '/api/admin/users' || pathname.startsWith('/api/admin/users/')) {
    return handleUsers(req, res, ctx);
  }
  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    return handleLogout(req, res, ctx);
  }
  if (req.method === 'GET' && pathname === '/api/admin/me') {
    return handleMe(req, res, ctx);
  }
  return false;
}

async function handleLogin(req, res, ctx) {
  const { send, readBody, adminAuth, dataDir } = ctx;
  if (!adminAuth.isEnabled()) {
    send(res, 503, JSON.stringify({
      ok: false,
      error: 'Admin login not configured. Set PIKO_ADMIN_PASSWORD on the server.',
    }));
    return true;
  }
  try {
    const body = JSON.parse(await readBody(req) || '{}');
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const account = adminAuth.authenticate(dataDir, username, password);
    if (!account) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Invalid username or password' }));
      return true;
    }
    const token = adminAuth.createSession(dataDir, account.username, account.role);
    adminAuth.setSessionCookie(res, req, token);
    const next = String(body.next || '').trim();
    let redirect = next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : (account.role === 'client' ? '/ios-dashboard' : '/admin');
    if (account.role === 'client' && adminAuth.isOperatorOnlyPagePath(redirect)) {
      redirect = '/ios-dashboard';
    }
    send(res, 200, JSON.stringify({
      ok: true,
      user: account.username,
      role: account.role,
      redirect,
    }));
  } catch (e) {
    send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid request' }));
  }
  return true;
}

async function handleUsers(req, res, ctx) {
  const { send, readBody, adminAuth, dataDir, matchPath, pathname } = ctx;
  const session = adminAuth.getSessionFromRequest(req, dataDir);
  if (!session || session.role !== 'operator') {
    send(res, session ? 403 : 401, JSON.stringify({
      ok: false,
      error: session ? 'Operator access required' : 'Unauthorized',
    }));
    return true;
  }
  try {
    if (req.method === 'GET' && pathname === '/api/admin/users') {
      send(res, 200, JSON.stringify({ ok: true, users: adminAuth.listUsers(dataDir) }));
      return true;
    }
    if (req.method === 'POST' && pathname === '/api/admin/users') {
      const body = JSON.parse(await readBody(req) || '{}');
      const password = String(body.password || '') || crypto.randomBytes(12).toString('base64url');
      const user = adminAuth.createUser(dataDir, {
        username: body.username,
        password,
        createdBy: session.username,
      });
      send(res, 200, JSON.stringify({ ok: true, user, password }));
      return true;
    }
    const mReset = matchPath(pathname, '/api/admin/users/:username/reset');
    const mUser = matchPath(pathname, '/api/admin/users/:username');
    if (mReset && req.method === 'POST') {
      const password = crypto.randomBytes(12).toString('base64url');
      if (!adminAuth.resetUserPassword(dataDir, decodeURIComponent(mReset.username), password)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'No such user' }));
        return true;
      }
      send(res, 200, JSON.stringify({ ok: true, password }));
      return true;
    }
    if (mUser && req.method === 'DELETE') {
      if (!adminAuth.deleteUser(dataDir, decodeURIComponent(mUser.username))) {
        send(res, 404, JSON.stringify({ ok: false, error: 'No such user' }));
        return true;
      }
      send(res, 200, JSON.stringify({ ok: true }));
      return true;
    }
    send(res, 405, JSON.stringify({ ok: false, error: 'Method not allowed' }));
  } catch (e) {
    send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid request' }));
  }
  return true;
}

async function handleLogout(req, res, ctx) {
  const { send, adminAuth, dataDir } = ctx;
  const session = adminAuth.getSessionFromRequest(req, dataDir);
  if (session) adminAuth.destroySession(dataDir, session.token);
  adminAuth.clearSessionCookie(res, req);
  send(res, 200, JSON.stringify({ ok: true }));
  return true;
}

async function handleMe(req, res, ctx) {
  const { send, adminAuth, dataDir, rootDir } = ctx;
  const session = adminAuth.getSessionFromRequest(req, dataDir);
  const role = session ? session.role : null;
  let displayName = '';
  try {
    displayName = require('../lib/siteManifest').loadSiteManifest(rootDir).display_name || '';
  } catch (_) { /* ignore */ }
  let clients = [];
  let dashboards = [];
  if (role === 'operator') {
    dashboards = adminAuth.listDashboards();
    try {
      const { buildCommandCentreClients } = require('../lib/commandCentre');
      const { loadSiteManifest } = require('../lib/siteManifest');
      const site = loadSiteManifest(rootDir);
      clients = buildCommandCentreClients(rootDir, {
        currentTenantId: site.tenant_id || process.env.PIKO_TENANT_ID,
      }).clients || [];
    } catch (_) { /* ignore */ }
  }
  send(res, 200, JSON.stringify({
    ok: true,
    authEnabled: adminAuth.isEnabled(),
    authenticated: !!session,
    user: session ? session.username : null,
    role,
    display_name: displayName,
    dashboards,
    clients,
  }));
  return true;
}

module.exports = {
  tryHandleAdmin,
  registerAdminRoutes,
  handleLogin,
  handleUsers,
  handleLogout,
  handleMe,
};
