/**
 * Misc routes: models, advice-followed, intents, chart, piko-state (P4.2).
 * Dead duplicate GET /api/metrics removed — handled by routes/ops.js.
 */

const fs = require('fs');

function registerMiscRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('POST', '/api/metrics/advice-followed', wrap(handleAdviceFollowed), { group: 'misc', auth: 'open' });
  registry.add('GET', '/api/models', wrap(handleModels), { group: 'misc', auth: 'open' });
  registry.add('GET', '/piko_state.json', wrap(handlePikoState), { group: 'misc', auth: 'open' });
  registry.add('GET', '/api/piko-state.json', wrap(handlePikoState), { group: 'misc', auth: 'open' });
  registry.add('GET', '/api/intents', wrap(handleIntents), { group: 'misc', auth: 'open' });
  registry.add('GET', '/api/chart', wrap(handleChart), { group: 'misc', auth: 'open' });
}

function isMiscPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/metrics/advice-followed'
    || p === '/api/models'
    || p === '/piko_state.json'
    || p === '/api/piko-state.json'
    || p === '/api/intents'
    || p === '/api/chart';
}

async function tryHandleMisc(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isMiscPath(pathname)) return false;

  if (req.method === 'POST' && pathname === '/api/metrics/advice-followed') {
    return handleAdviceFollowed(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    return handleModels(req, res, ctx);
  }

  if (req.method === 'GET' && (pathname === '/piko_state.json' || pathname === '/api/piko-state.json')) {
    return handlePikoState(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/intents') {
    return handleIntents(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/chart') {
    return handleChart(req, res, ctx);
  }

  return false;
}

async function handleAdviceFollowed(req, res, ctx) {
  const { send } = ctx;
  try {
    const { recordAdviceFollowed } = require('../lib/metrics');
    recordAdviceFollowed();
    send(res, 200, JSON.stringify({ ok: true }));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleModels(req, res, ctx) {
  const { send, loadRegistry, getCurrentModelOverride, ollamaModel } = ctx;
  const registry = loadRegistry();
  send(res, 200, JSON.stringify({
    primary: process.env.MODEL_PRIMARY || ollamaModel,
    currentOverride: getCurrentModelOverride(),
    registry: {
      updatedAt: registry.updatedAt,
      stages: registry.stages,
      lastStable: registry.lastStable,
    },
    available: [
      'ollama/llama3.1:latest',
      'ollama/llama3.2',
      'anthropic/claude-3-5-sonnet-20241022',
      'openai/gpt-4o-mini',
    ],
  }));
  return true;
}

async function handlePikoState(req, res, ctx) {
  const { send, pikoStateManifestPath } = ctx;
  try {
    if (!fs.existsSync(pikoStateManifestPath)) {
      send(res, 404, JSON.stringify({
        ok: false,
        error: 'Manifest not found',
        path: pikoStateManifestPath,
        hint: 'Run piko_core.generate_app_manifest() on the host that owns the Legion DB, or set PIKO_STATE_MANIFEST_PATH.',
      }));
      return true;
    }
    const raw = fs.readFileSync(pikoStateManifestPath, 'utf8');
    send(res, 200, raw, 'application/json; charset=utf-8');
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'read failed' }));
  }
  return true;
}

async function handleIntents(req, res, ctx) {
  const { send, loadIntents } = ctx;
  const intents = loadIntents();
  send(res, 200, JSON.stringify({ intents }));
  return true;
}

async function handleChart(req, res, ctx) {
  const { parseUrl, collapseWhitespace } = ctx;
  const { query } = parseUrl(req.url);
  const type = (query && query.type) || 'bar';
  const dataStr = (query && query.data) || '';
  const values = dataStr.split(',').flatMap((p) => p.split(';')).flatMap((p) => collapseWhitespace(p).split(' ')).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
  if (values.length === 0) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Usage: /api/chart?type=bar&data=10,20,30');
    return true;
  }
  const w = 400;
  const h = 200;
  const pad = 40;
  const max = Math.max(...values, 1);
  let svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += '<rect width="100%" height="100%" fill="#25262a"/>';
  const barW = (w - pad * 2) / values.length - 4;
  values.forEach((v, i) => {
    const x = pad + i * ((w - pad * 2) / values.length) + 2;
    const barH = Math.max(2, ((v / max) * (h - pad * 2)));
    const y = h - pad - barH;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#7c9cbf" rx="2"/>`;
  });
  svg += '</svg>';
  res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
  res.end(svg);
  return true;
}

module.exports = {
  tryHandleMisc,
  registerMiscRoutes,
  isMiscPath,
};
