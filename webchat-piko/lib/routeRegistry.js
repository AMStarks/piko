/**
 * Route registry for Phase 3 server.js decomposition (P3.1).
 * Handlers return true if they handled the request (response already sent).
 */
function createRouteRegistry() {
  /** @type {{ method: string, path: string, match: 'exact'|'prefix', group: string, handler: Function }[]} */
  const routes = [];

  function add(method, path, handler, opts = {}) {
    if (typeof handler !== 'function') {
      throw new Error(`routeRegistry.add: handler required for ${method} ${path}`);
    }
    routes.push({
      method: String(method || '').toUpperCase(),
      path: String(path || ''),
      match: opts.match === 'prefix' ? 'prefix' : 'exact',
      group: opts.group || 'other',
      auth: opts.auth || null,
      handler,
    });
  }

  function list() {
    return routes.map((r) => ({
      method: r.method,
      path: r.path,
      match: r.match,
      group: r.group,
      auth: r.auth,
    }));
  }

  function find(method, pathname) {
    const m = String(method || '').toUpperCase();
    const p = String(pathname || '');
    for (const r of routes) {
      if (r.method !== m) continue;
      if (r.match === 'exact' && r.path === p) return r;
      if (r.match === 'prefix' && (p === r.path || p.startsWith(r.path))) return r;
    }
    return null;
  }

  /**
   * Try registered handlers. Returns true if one handled the request.
   */
  async function dispatch(req, res, ctx = {}) {
    const method = req.method;
    const pathname = ctx.pathname || (req.url && String(req.url).split('?')[0]) || '';
    const hit = find(method, pathname);
    if (!hit) return false;
    const out = await hit.handler(req, res, { ...ctx, pathname, route: hit });
    return out !== false;
  }

  return { add, list, find, dispatch, _routes: routes };
}

module.exports = {
  createRouteRegistry,
};
