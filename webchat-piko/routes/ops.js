/**
 * Ops / health / metrics / logs routes (P3.1b).
 */
function registerOpsRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/health', wrap(handleHealth), { group: 'ops', auth: 'public' });
  registry.add('GET', '/api/site-context', wrap(handleSiteContext), { group: 'ops', auth: 'public' });
  registry.add('GET', '/api/command-centre/clients', wrap(handleCommandCentre), { group: 'ops', auth: 'public' });
  registry.add('GET', '/api/metrics', wrap(handleLegacyMetrics), { group: 'ops', auth: 'api_auth' });
  registry.add('GET', '/api/ops/metrics', wrap(handleOpsMetrics), { group: 'ops', auth: 'admin_session' });
  registry.add('GET', '/api/logs', wrap(handleLogs), { group: 'ops', auth: 'api_auth' });
}

async function tryHandleOps(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'GET') return false;
  if (pathname === '/api/health') return handleHealth(req, res, ctx);
  if (pathname === '/api/site-context') return handleSiteContext(req, res, ctx);
  if (pathname === '/api/command-centre/clients') return handleCommandCentre(req, res, ctx);
  if (pathname === '/api/metrics') return handleLegacyMetrics(req, res, ctx);
  if (pathname === '/api/ops/metrics') return handleOpsMetrics(req, res, ctx);
  if (pathname === '/api/logs') return handleLogs(req, res, ctx);
  return false;
}

async function handleHealth(req, res, ctx) {
  const {
    send, healthApiKey, modelPrimary, ollamaModel, ai, healthTimeoutMs,
    ollamaSelfHealState, maybeTriggerOllamaSelfHeal,
  } = ctx;
  if (healthApiKey && String(healthApiKey).trim()) {
    const authHeader = (req.headers['authorization'] || '').trim();
    const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const key = bearer || apiKeyHeader;
    if (key !== String(healthApiKey).trim()) {
      send(res, 401, JSON.stringify({
        error: 'Unauthorized',
        message: 'Set Authorization: Bearer <key> or x-api-key',
      }));
      return true;
    }
  }
  const ok = { ok: true, llm: modelPrimary, model: ollamaModel };
  try {
    await Promise.race([
      ai('hi', { max_tokens: 2, priority: 'user' }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('llm_probe_timeout')),
        healthTimeoutMs,
      )),
    ]);
    if (ollamaSelfHealState) ollamaSelfHealState.consecutiveFailures = 0;
  } catch (_) {
    ok.ok = false;
    ok.llm = 'unreachable';
    if (ollamaSelfHealState) {
      ollamaSelfHealState.consecutiveFailures = Math.min(
        1000,
        (ollamaSelfHealState.consecutiveFailures || 0) + 1,
      );
    }
    if (typeof maybeTriggerOllamaSelfHeal === 'function') {
      maybeTriggerOllamaSelfHeal('health_probe_unreachable');
    }
  }
  send(res, 200, JSON.stringify(ok));
  return true;
}

async function handleSiteContext(req, res, ctx) {
  const { send, rootDir, legionAdapterBase } = ctx;
  try {
    const { buildSiteContext } = require('../lib/siteContext');
    const siteCtx = await buildSiteContext({
      rootDir,
      legionAdapterBase,
    });
    send(res, 200, JSON.stringify(siteCtx));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'site context failed' }));
  }
  return true;
}

async function handleCommandCentre(req, res, ctx) {
  const { send, rootDir } = ctx;
  try {
    const { buildCommandCentreClients } = require('../lib/commandCentre');
    const { loadSiteManifest } = require('../lib/siteManifest');
    const site = loadSiteManifest(rootDir);
    const out = buildCommandCentreClients(rootDir, {
      currentTenantId: site.tenant_id || process.env.PIKO_TENANT_ID,
    });
    send(res, 200, JSON.stringify(out));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'command centre failed' }));
  }
  return true;
}

async function handleLegacyMetrics(req, res, ctx) {
  const { send, startTime, metrics } = ctx;
  const uptimeMs = Date.now() - startTime;
  send(res, 200, JSON.stringify({
    requests: metrics.requests,
    errors: metrics.errors,
    chat: metrics.chat,
    commands: metrics.commands,
    conversation: metrics.conversation,
    uptimeMs,
    uptime: `${Math.floor(uptimeMs / 60000)}m`,
  }));
  return true;
}

async function handleOpsMetrics(req, res, ctx) {
  const { send } = ctx;
  try {
    const { snapshot } = require('../lib/opsMetrics');
    send(res, 200, JSON.stringify(snapshot()));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
  return true;
}

async function handleLogs(req, res, ctx) {
  const { send, parseUrl, logPath, fs } = ctx;
  const { query } = parseUrl(req.url);
  const tail = Math.min(100, Math.max(1, parseInt(query && query.tail, 10) || 20));
  let lines = [];
  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    lines = raw.split('\n').filter(Boolean).slice(-tail);
  } catch (_) { /* empty */ }
  send(res, 200, JSON.stringify({ logs: lines }));
  return true;
}

module.exports = {
  tryHandleOps,
  registerOpsRoutes,
  handleHealth,
  handleOpsMetrics,
};
