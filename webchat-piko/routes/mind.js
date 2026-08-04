/**
 * Mind / corpus / wisdom routes (P4.2).
 */

const fs = require('fs');
const path = require('path');

/** Corpus edit lock: if PIKO_CORPUS_EDIT_ALLOWED_IP or PIKO_CORPUS_EDIT_HEADER is set, require match. */
function canEditCorpus(req) {
  const allowedIps = (process.env.PIKO_CORPUS_EDIT_ALLOWED_IP || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headerName = (process.env.PIKO_CORPUS_EDIT_HEADER || '').trim().toLowerCase();
  if (allowedIps.length === 0 && !headerName) return true;
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  if (allowedIps.length && allowedIps.some((ip) => clientIp === ip || clientIp === `::ffff:${ip}`)) return true;
  if (headerName && req.headers[headerName] !== undefined && req.headers[headerName] !== '') return true;
  return false;
}

function registerMindRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/mind', wrap(handleMindGet), { group: 'mind', auth: 'open' });
  registry.add('POST', '/api/mind/primary-human', wrap(handleMindWrite), { group: 'mind', auth: 'open' });
  registry.add('POST', '/api/mind', wrap(handleMindWrite), { group: 'mind', auth: 'open' });
  registry.add('PUT', '/api/mind', wrap(handleMindWrite), { group: 'mind', auth: 'open' });
  registry.add('GET', '/api/corpus', wrap(handleCorpusGet), { group: 'mind', auth: 'open' });
  registry.add('POST', '/api/corpus/regenerate-summary', wrap(handleCorpusRegenerate), { group: 'mind', auth: 'open' });
  registry.add('GET', '/api/wisdom/truth-stats', wrap(handleWisdomTruthStats), { group: 'mind', auth: 'open' });
  registry.add('POST', '/api/wisdom/run-nightly', wrap(handleWisdomRunNightly), { group: 'mind', auth: 'open' });
}

function isMindPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/mind'
    || p === '/api/mind/primary-human'
    || p === '/api/corpus'
    || p === '/api/corpus/regenerate-summary'
    || p.startsWith('/api/corpus/documents/')
    || p === '/api/wisdom/truth-stats'
    || p === '/api/wisdom/run-nightly';
}

async function tryHandleMind(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isMindPath(pathname)) return false;

  // Keep method/path checks spaced so routeParity discovery windows do not cross-associate.
  if (req.method === 'GET' && pathname === '/api/mind') {
    return handleMindGet(req, res, ctx);
  }

  if (req.method === 'POST' && pathname === '/api/mind/primary-human') {
    return handleMindWrite(req, res, ctx);
  }

  if (req.method === 'PUT' && pathname === '/api/mind') {
    return handleMindWrite(req, res, ctx);
  }

  if (req.method === 'GET' && pathname === '/api/corpus') {
    return handleCorpusGet(req, res, ctx);
  }

  if (req.method === 'POST' && pathname === '/api/corpus/regenerate-summary') {
    return handleCorpusRegenerate(req, res, ctx);
  }

  const { matchPath } = ctx;
  const corpusDocMatch = pathname && matchPath && matchPath(pathname, '/api/corpus/documents/*');
  if (req.method === 'PUT' && corpusDocMatch) {
    return handleCorpusDocPut(req, res, ctx, corpusDocMatch);
  }

  if (req.method === 'GET' && pathname === '/api/wisdom/truth-stats') {
    return handleWisdomTruthStats(req, res, ctx);
  }

  if (req.method === 'POST' && pathname === '/api/wisdom/run-nightly') {
    return handleWisdomRunNightly(req, res, ctx);
  }

  return false;
}

async function handleMindGet(req, res, ctx) {
  const { send, loadMind } = ctx;
  try {
    const mind = loadMind();
    const identity = mind.self_model.identity || {};
    const out = {
      primary_human: identity.primary_human || '',
      values: mind.self_model.values || [],
      constraints: mind.self_model.constraints || [],
      beliefs: mind.beliefs || [],
      goals: mind.goals || [],
      tensions: mind.tensions || [],
    };
    send(res, 200, JSON.stringify(out));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleMindWrite(req, res, ctx) {
  const { send, readBody, pathname, saveSelfModel, saveBeliefs } = ctx;
  try {
    const body = await readBody(req);
    let data = {};
    try {
      data = body ? JSON.parse(body) : {};
    } catch (_) {
      send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
      return true;
    }
    try {
      if (pathname === '/api/mind/primary-human' && data.primary_human !== undefined) {
        saveSelfModel({ primary_human: data.primary_human });
        send(res, 200, JSON.stringify({ ok: true }));
        return true;
      }
      if (pathname === '/api/mind' && req.method === 'PUT') {
        const selfUpdates = {};
        if (data.primary_human !== undefined) selfUpdates.primary_human = data.primary_human;
        if (data.values !== undefined) selfUpdates.values = data.values;
        if (data.constraints !== undefined) selfUpdates.constraints = data.constraints;
        if (Object.keys(selfUpdates).length) saveSelfModel(selfUpdates);
        if (data.beliefs !== undefined) saveBeliefs(data.beliefs);
        send(res, 200, JSON.stringify({ ok: true }));
        return true;
      }
      send(res, 400, JSON.stringify({ error: 'Missing body or path' }));
    } catch (e) {
      send(res, 500, JSON.stringify({ error: e.message }));
    }
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleCorpusGet(req, res, ctx) {
  const { send, loadCorpus } = ctx;
  try {
    const { index, docs } = loadCorpus();
    send(res, 200, JSON.stringify({ index, documents: docs }));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleCorpusRegenerate(req, res, ctx) {
  const { send, regenerateSummary } = ctx;
  if (!canEditCorpus(req)) {
    send(res, 403, JSON.stringify({ error: 'Corpus edit not allowed from this client' }));
    return true;
  }
  try {
    const result = await regenerateSummary();
    send(res, 200, JSON.stringify(result));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message }));
  }
  return true;
}

async function handleCorpusDocPut(req, res, ctx, corpusDocMatch) {
  const { send, readBody, regenerateSummary, corpusDocs, corpusDir } = ctx;
  if (!canEditCorpus(req)) {
    send(res, 403, JSON.stringify({ error: 'Corpus edit not allowed from this client' }));
    return true;
  }
  const docName = decodeURIComponent(corpusDocMatch.rest);
  if (!(corpusDocs || []).includes(docName)) {
    send(res, 400, JSON.stringify({ error: 'Invalid document name' }));
    return true;
  }
  try {
    const body = await readBody(req);
    let content = typeof body === 'string' ? body : '';
    try {
      const j = body ? JSON.parse(body) : null;
      if (j && j.content !== undefined) content = String(j.content);
    } catch (_) { /* empty */ }
    try {
      fs.mkdirSync(corpusDir, { recursive: true });
      fs.writeFileSync(path.join(corpusDir, docName), content, 'utf8');
    } catch (e) {
      send(res, 500, JSON.stringify({ error: e.message }));
      return true;
    }
    try {
      const result = await regenerateSummary();
      send(res, 200, JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message }));
    }
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleWisdomTruthStats(req, res, ctx) {
  const { send, getTruthStats } = ctx;
  try {
    const stats = getTruthStats();
    send(res, 200, JSON.stringify(stats));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
  return true;
}

async function handleWisdomRunNightly(req, res, ctx) {
  const { send } = ctx;
  try {
    const runNightly = require('../scripts/nightly_wisdom').runNightlyWisdom;
    const result = await runNightly();
    send(res, 200, JSON.stringify(result));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message }));
  }
  return true;
}

module.exports = {
  tryHandleMind,
  registerMindRoutes,
  isMindPath,
  canEditCorpus,
};
