/**
 * Observe / mgmt / HQ tenant routes (P4.2).
 */

const path = require('path');

function checkHqApiAuth(req) {
  const keyEnv = (process.env.PIKO_HQ_API_KEY || process.env.PIKO_HEALTH_API_KEY || '').trim();
  if (!keyEnv) return false;
  const authHeader = (req.headers.authorization || '').trim();
  const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return (bearer || apiKeyHeader) === keyEnv;
}

/** HQ/operator actions: API key OR an active admin session (browser HQ). */
function checkMgmtOperatorAuth(req, ctx = {}) {
  if (typeof ctx.checkYoloApiAuth === 'function' && ctx.checkYoloApiAuth(req)) return true;
  try {
    const adminAuth = require('../lib/adminAuth');
    if (!adminAuth.isEnabled()) return false;
    return !!adminAuth.getSessionFromRequest(req, ctx.dataDir);
  } catch (_) {
    return false;
  }
}

function registerHqRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/observe/summary', wrap(handleObserveSummary), { group: 'hq', auth: 'open' });
  registry.add('GET', '/api/mgmt/config', wrap(handleMgmtConfig), { group: 'hq', auth: 'mgmt' });
  registry.add('POST', '/api/mgmt/deploy/trigger', wrap(handleMgmtDeployTrigger), { group: 'hq', auth: 'mgmt' });
  registry.add('GET', '/api/hq/status', wrap(handleHqStatus), { group: 'hq', auth: 'open' });
  registry.add('GET', '/api/hq/registry', wrap(handleHqRegistry), { group: 'hq', auth: 'hq_api' });
  registry.add('POST', '/api/hq/tenants', wrap(handleHqTenantsCreate), { group: 'hq', auth: 'hq_api' });
}

function isHqPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/observe/summary'
    || p === '/api/mgmt/config'
    || p === '/api/mgmt/deploy/trigger'
    || p === '/api/hq/status'
    || p === '/api/hq/registry'
    || p === '/api/hq/tenants'
    || p.startsWith('/api/hq/tenants/');
}

async function tryHandleHq(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isHqPath(pathname)) return false;

  // Keep method/path checks spaced so routeParity discovery windows do not cross-associate.
  if (req.method === 'GET' && pathname === '/api/observe/summary') {
    return handleObserveSummary(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/mgmt/config') {
    return handleMgmtConfig(req, res, ctx);
  }

  if (req.method === 'POST' && pathname === '/api/mgmt/deploy/trigger') {
    return handleMgmtDeployTrigger(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/hq/status') {
    return handleHqStatus(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/hq/registry') {
    return handleHqRegistry(req, res, ctx);
  }

  if (req.method === 'POST' && pathname === '/api/hq/tenants') {
    return handleHqTenantsCreate(req, res, ctx);
  }

  const { matchPath } = ctx;
  if (!matchPath) return false;

  const hqConfigMatch = matchPath(pathname, '/api/hq/tenants/:id/config-push');
  if (req.method === 'POST' && hqConfigMatch) {
    return handleHqConfigPush(req, res, ctx, hqConfigMatch);
  }

  const hqReleaseMatch = matchPath(pathname, '/api/hq/tenants/:id/release');
  if (req.method === 'POST' && hqReleaseMatch) {
    return handleHqRelease(req, res, ctx, hqReleaseMatch);
  }

  const hqTenantSetupMatch = matchPath(pathname, '/api/hq/tenants/:id/setup');
  if (req.method === 'POST' && hqTenantSetupMatch) {
    return handleHqTenantSetup(req, res, ctx, hqTenantSetupMatch);
  }

  return false;
}

async function handleObserveSummary(req, res, ctx) {
  const { send, dataDir, rootDir, legionAdapterBase, loadIntents } = ctx;
  try {
    const { buildObserveSummary } = require('../lib/observeApi');
    const { checkLegionAdapterHealth } = require('../lib/legionAdapterHealth');
    const summary = await buildObserveSummary({
      dataDir,
      rootDir,
      legionAdapterBase,
      checkAdapterHealth: checkLegionAdapterHealth,
      loadIntents,
    });
    send(res, 200, JSON.stringify(summary));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'observe summary failed' }));
  }
  return true;
}

async function handleMgmtConfig(req, res, ctx) {
  const { send, rootDir, legionAdapterBase, ausmakerBaseUrl } = ctx;
  if (!checkMgmtOperatorAuth(req, ctx)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  try {
    const { loadSiteManifest } = require('../lib/siteManifest');
    const site = loadSiteManifest(rootDir);
    send(res, 200, JSON.stringify({
      ok: true,
      tenant_id: site.tenant_id,
      site,
      env: {
        legion_adapter: legionAdapterBase,
        ausmaker: ausmakerBaseUrl,
        public_url: process.env.PIKO_PUBLIC_BASE_URL || process.env.PIKO_IOS_PUBLIC_URL || site.public?.url || null,
      },
    }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mgmt config failed' }));
  }
  return true;
}

async function handleMgmtDeployTrigger(req, res, ctx) {
  const { send, readBody, rootDir } = ctx;
  if (!checkMgmtOperatorAuth(req, ctx)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized — log in at /admin/login or pass API key' }));
    return true;
  }
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    return true;
  }
  const action = String(body.action || 'api-ping').trim().toLowerCase();
  const force = body.force === true || body.force === 1 || body.force === '1';
  const allTenants = body.all_tenants === true || body.allTenants === true;
  const { execFile } = require('child_process');
  const scriptMap = {
    'api-ping': path.join(rootDir, 'scripts', 'api-ping-site.js'),
    watch: path.join(rootDir, 'scripts', 'legion-watch.js'),
    'context-refresh': path.join(rootDir, 'scripts', 'context-refresh.js'),
  };
  const script = scriptMap[action];
  if (!script) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Unknown action', allowed: Object.keys(scriptMap) }));
    return true;
  }
  return new Promise(async (resolve) => {
    const env = { ...process.env };
    if (action === 'context-refresh' && force) env.PIKO_CONTEXT_REFRESH_FORCE = '1';
    const runLocal = () => new Promise((resLocal) => {
      execFile(process.execPath, [script], { timeout: 120000, cwd: rootDir, env }, (err, stdout, stderr) => {
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '').trim().split('\n').pop()); } catch (_) { /* ignore */ }
        resLocal({
          ok: !err,
          stdout: String(stdout || '').slice(0, 2000),
          stderr: String(stderr || '').slice(0, 500),
          result: parsed,
          error: err ? (err.message || String(err)) : null,
        });
      });
    });

    const local = await runLocal();
    const peers = [];
    if (action === 'context-refresh' && allTenants) {
      try {
        const { loadRegistry } = require('../lib/tenantRegistry');
        const registry = loadRegistry(rootDir);
        const key = (process.env.PIKO_HQ_API_KEY || process.env.PIKO_HEALTH_API_KEY || '').trim();
        for (const t of (registry.tenants || [])) {
          if (!t || t.status !== 'live' || !t.observe_url) continue;
          let base = '';
          try {
            const u = new URL(t.observe_url);
            base = `${u.protocol}//${u.host}`;
          } catch (_) { continue; }
          // Skip self (same host:port as this process)
          const selfPort = String(process.env.PORT || 3000);
          if (base.includes(`127.0.0.1:${selfPort}`) || base.includes(`localhost:${selfPort}`)) continue;
          try {
            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['x-api-key'] = key;
            const resp = await fetch(`${base}/api/mgmt/deploy/trigger`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ action: 'context-refresh', force: true }),
              signal: AbortSignal.timeout(90000),
            });
            const data = await resp.json().catch(() => ({}));
            peers.push({
              tenant_id: t.tenant_id,
              ok: resp.ok && data.ok !== false,
              status: resp.status,
              result: data.result || data,
            });
          } catch (e) {
            peers.push({ tenant_id: t.tenant_id, ok: false, error: e.message || String(e) });
          }
        }
      } catch (e) {
        peers.push({ ok: false, error: `peer_fanout: ${e.message || e}` });
      }
    }

    const ok = local.ok && peers.every((p) => p.ok !== false || !p.tenant_id);
    send(res, ok ? 200 : 503, JSON.stringify({
      ok: local.ok,
      action,
      forced: force,
      stdout: local.stdout,
      stderr: local.stderr,
      result: local.result,
      peers,
    }));
    resolve(true);
  });
}

async function handleHqStatus(req, res, ctx) {
  const { send, rootDir, dataDir } = ctx;
  try {
    const { buildHqStatus } = require('../lib/tenantRegistry');
    const status = await buildHqStatus(rootDir, dataDir);
    send(res, 200, JSON.stringify(status));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'hq status failed' }));
  }
  return true;
}

async function handleHqRegistry(req, res, ctx) {
  const { send, rootDir } = ctx;
  if (!checkHqApiAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  try {
    const { loadRegistry } = require('../lib/tenantRegistry');
    const registry = loadRegistry(rootDir);
    send(res, 200, JSON.stringify({ ok: true, registry }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'hq registry failed' }));
  }
  return true;
}

async function handleHqConfigPush(req, res, ctx, hqConfigMatch) {
  const { send, readBody, dataDir } = ctx;
  if (!checkHqApiAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    return true;
  }
  try {
    const { appendAuditLog } = require('../lib/tenantRegistry');
    appendAuditLog(dataDir, {
      action: 'config-push',
      tenant_id: hqConfigMatch.id,
      key: body.key || null,
      value: body.value != null ? String(body.value).slice(0, 500) : null,
      actor: req.headers['x-actor'] || 'hq',
    });
    send(res, 200, JSON.stringify({ ok: true, tenant_id: hqConfigMatch.id, logged: true }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'config-push failed' }));
  }
  return true;
}

async function handleHqRelease(req, res, ctx, hqReleaseMatch) {
  const { send, readBody, rootDir, dataDir } = ctx;
  if (!checkHqApiAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    return true;
  }
  const tenantId = hqReleaseMatch.id;
  const action = String(body.action || 'api-ping').trim().toLowerCase();
  const { execFile } = require('child_process');
  const scriptMap = {
    'api-ping': path.join(rootDir, 'scripts', 'api-ping-site.js'),
    'context-refresh': path.join(rootDir, 'scripts', 'context-refresh.js'),
  };
  const script = scriptMap[action];
  if (!script) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Unknown action', allowed: Object.keys(scriptMap) }));
    return true;
  }
  return new Promise((resolve) => {
    execFile(process.execPath, [script], { timeout: 300000, cwd: rootDir }, async (err, stdout, stderr) => {
      let parsed = null;
      try { parsed = JSON.parse(String(stdout || '').trim().split('\n').pop()); } catch (_) { /* ignore */ }
      const ok = !err;
      try {
        const { appendReleaseLog, updateTenantFields } = require('../lib/tenantRegistry');
        appendReleaseLog(dataDir, { tenant_id: tenantId, action, ok, actor: req.headers['x-actor'] || 'hq' });
        updateTenantFields(rootDir, tenantId, {
          last_release: new Date().toISOString(),
          last_release_action: action,
          last_release_ok: ok,
        });
      } catch (_) { /* ignore */ }
      send(res, ok ? 200 : 503, JSON.stringify({
        ok,
        tenant_id: tenantId,
        action,
        result: parsed,
        stdout: String(stdout || '').slice(0, 2000),
        stderr: String(stderr || '').slice(0, 500),
      }));
      resolve(true);
    });
  });
}

async function handleHqTenantsCreate(req, res, ctx) {
  const { send, readBody, rootDir, dataDir } = ctx;
  if (!checkHqApiAuth(req) && !checkMgmtOperatorAuth(req, ctx)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    return true;
  }
  try {
    const { provisionTenant, appendAuditLog } = require('../lib/tenantRegistry');
    const result = provisionTenant(rootDir, {
      tenant_id: body.tenant_id,
      display_name: body.display_name,
      adapter_id: body.adapter_id,
      node_host: body.node_host,
      piko_port: body.piko_port,
      observe_lan_ip: body.observe_lan_ip,
    });
    try {
      appendAuditLog(dataDir, {
        action: 'tenant-provision',
        tenant_id: result.tenant_id,
        adapter_id: result.row.adapter_id,
        node_host: result.row.node_host,
        actor: req.headers['x-actor'] || 'hq',
      });
    } catch (_) { /* ignore */ }
    send(res, 200, JSON.stringify({ ok: true, ...result }));
  } catch (e) {
    send(res, 400, JSON.stringify({ ok: false, error: e.message || 'provision failed' }));
  }
  return true;
}

async function handleHqTenantSetup(req, res, ctx, hqTenantSetupMatch) {
  const { send, readBody, rootDir, dataDir } = ctx;
  if (!checkHqApiAuth(req) && !checkMgmtOperatorAuth(req, ctx)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    return true;
  }
  try {
    const { updateTenantSetup, appendAuditLog } = require('../lib/tenantRegistry');
    const row = updateTenantSetup(rootDir, hqTenantSetupMatch.id, body);
    try {
      appendAuditLog(dataDir, {
        action: 'tenant-setup-update',
        tenant_id: hqTenantSetupMatch.id,
        fields: Object.keys(body || {}),
        actor: req.headers['x-actor'] || 'hq',
      });
    } catch (_) { /* ignore */ }
    send(res, 200, JSON.stringify({ ok: true, tenant: row }));
  } catch (e) {
    send(res, 400, JSON.stringify({ ok: false, error: e.message || 'setup update failed' }));
  }
  return true;
}

module.exports = {
  tryHandleHq,
  registerHqRoutes,
  isHqPath,
  checkHqApiAuth,
  checkMgmtOperatorAuth,
};
