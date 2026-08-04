/**
 * State API routes — read-only, localhost only (P4.2).
 */

function isLocal(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function registerStateRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/state/intents', wrap(handleStateIntents), { group: 'state', auth: 'localhost' });
  registry.add('GET', '/api/state/sessions', wrap(handleStateSessions), { group: 'state', auth: 'localhost' });
  registry.add('GET', '/api/state/allowlist', wrap(handleStateAllowlist), { group: 'state', auth: 'localhost' });
  registry.add('GET', '/api/state/skills', wrap(handleStateSkills), { group: 'state', auth: 'localhost' });
}

function isStatePath(pathname) {
  const p = String(pathname || '');
  return p === '/api/state/intents'
    || p === '/api/state/sessions'
    || p === '/api/state/allowlist'
    || p === '/api/state/skills';
}

async function tryHandleState(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'GET' || !isStatePath(pathname)) return false;
  if (pathname === '/api/state/intents') return handleStateIntents(req, res, ctx);
  if (pathname === '/api/state/sessions') return handleStateSessions(req, res, ctx);
  if (pathname === '/api/state/allowlist') return handleStateAllowlist(req, res, ctx);
  if (pathname === '/api/state/skills') return handleStateSkills(req, res, ctx);
  return false;
}

function denyUnlessLocal(req, res, ctx) {
  const { send } = ctx;
  if (!isLocal(req)) {
    send(res, 403, JSON.stringify({ error: 'State API is localhost only' }));
    return true;
  }
  return false;
}

async function handleStateIntents(req, res, ctx) {
  const { send, parseUrl, loadIntents } = ctx;
  if (denyUnlessLocal(req, res, ctx)) return true;
  const { query } = parseUrl(req.url);
  let intents = loadIntents();
  const statusFilter = query && query.status;
  if (statusFilter && statusFilter !== 'all') intents = intents.filter((i) => i.status === statusFilter);
  send(res, 200, JSON.stringify({ intents }));
  return true;
}

async function handleStateSessions(req, res, ctx) {
  const { send, loadSessionsConfig } = ctx;
  if (denyUnlessLocal(req, res, ctx)) return true;
  const sessions = loadSessionsConfig();
  send(res, 200, JSON.stringify({ sessions }));
  return true;
}

async function handleStateAllowlist(req, res, ctx) {
  const { send, loadAllowlist } = ctx;
  if (denyUnlessLocal(req, res, ctx)) return true;
  const allowlist = loadAllowlist();
  send(res, 200, JSON.stringify({ allowlist }));
  return true;
}

async function handleStateSkills(req, res, ctx) {
  const { send, loadedSkills } = ctx;
  if (denyUnlessLocal(req, res, ctx)) return true;
  const skills = (loadedSkills || []).map((s, i) => ({
    id: s.id || s.name || 'skill_' + i,
    pattern: typeof s.pattern === 'string' ? s.pattern : (s.pattern && s.pattern.toString ? s.pattern.toString() : ''),
  }));
  send(res, 200, JSON.stringify({ skills }));
  return true;
}

module.exports = {
  tryHandleState,
  registerStateRoutes,
  isStatePath,
  isLocal,
};
