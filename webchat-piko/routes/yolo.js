/**
 * YOLO / HITL / tool-audit / upload routes (P4.2).
 */

function registerYoloRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('POST', '/api/yolo-tool', wrap(handleYoloTool), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('GET', '/api/yolo-tools/registry', wrap(handleYoloRegistry), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('GET', '/api/tool-audit/recent', wrap(handleToolAuditRecent), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('GET', '/api/hitl/pending', wrap(handleHitlPending), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('POST', '/api/hitl/approve', wrap(handleHitlApprove), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('POST', '/api/hitl/reject', wrap(handleHitlReject), { group: 'yolo', auth: 'yolo_or_session' });
  registry.add('POST', '/api/piko/upload', wrap(handleUpload), { group: 'yolo', auth: 'yolo_or_session' });
}

function isYoloPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/yolo-tool'
    || p === '/api/yolo-tools/registry'
    || p === '/api/tool-audit/recent'
    || p === '/api/hitl/pending'
    || p === '/api/hitl/approve'
    || p === '/api/hitl/reject'
    || p === '/api/piko/upload';
}

async function tryHandleYolo(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isYoloPath(pathname)) return false;
  if (req.method === 'POST' && pathname === '/api/yolo-tool') return handleYoloTool(req, res, ctx);
  if (req.method === 'GET' && pathname === '/api/yolo-tools/registry') return handleYoloRegistry(req, res, ctx);
  if (req.method === 'GET' && pathname === '/api/tool-audit/recent') return handleToolAuditRecent(req, res, ctx);
  if (req.method === 'GET' && pathname === '/api/hitl/pending') return handleHitlPending(req, res, ctx);
  if (req.method === 'POST' && pathname === '/api/hitl/approve') return handleHitlAction(req, res, ctx, 'approve');
  if (req.method === 'POST' && pathname === '/api/hitl/reject') return handleHitlAction(req, res, ctx, 'reject');
  if (req.method === 'POST' && pathname === '/api/piko/upload') return handleUpload(req, res, ctx);
  return false;
}

async function handleYoloTool(req, res, ctx) {
  const { send, readBody, checkYoloOrSessionAuth, yoloBridge, toLowerAsciiish } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({
      ok: false,
      error: 'Unauthorized',
      message: 'Set Authorization: Bearer <PIKO_YOLO_API_KEY or PIKO_HEALTH_API_KEY>',
    }));
    return true;
  }
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (err) {
    void err;
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    return true;
  }
  const { gateMoneyHttp } = require('../lib/moneyPlaneGate');
  if (!gateMoneyHttp(req, res, send, {
    body,
    action: 'yolo_tool',
    pathname: '/api/yolo-tool',
    dataDir: ctx.dataDir || process.env.PIKO_DATA_DIR,
  })) {
    return true;
  }
  const toolName = String(body.name || body.tool_name || body.toolName || '').trim();
  if (!toolName) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Missing name (tool name)' }));
    return true;
  }
  const args = body.arguments && typeof body.arguments === 'object'
    ? body.arguments
    : (body.args && typeof body.args === 'object' ? body.args : {});
  const channel = String(body.channel || 'ios').trim() || 'ios';
  try {
    const result = yoloBridge.runYoloTool(toolName, args, { channel });
    const pending = toLowerAsciiish(result).includes('pending human approval');
    send(res, 200, JSON.stringify({
      ok: true,
      tool: toolName,
      channel,
      pending_approval: pending,
      result,
    }));
  } catch (e) {
    const msg = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    send(res, 502, JSON.stringify({ ok: false, error: msg, tool: toolName }));
  }
  return true;
}

async function handleYoloRegistry(req, res, ctx) {
  const { send, checkYoloOrSessionAuth, yoloBridge } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  try {
    const registry = yoloBridge.getYoloToolRegistry();
    send(res, 200, JSON.stringify({ ok: true, tools: registry }));
  } catch (e) {
    send(res, 502, JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
  return true;
}

async function handleToolAuditRecent(req, res, ctx) {
  const { send, parseUrl, checkYoloOrSessionAuth, opsMonitor } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  const { query } = parseUrl(req.url);
  const limit = query && query.limit ? Number(query.limit) : 50;
  try {
    const { path: logPath, entries } = opsMonitor.getToolAuditRecent(limit);
    send(res, 200, JSON.stringify({ ok: true, path: logPath, entries }));
  } catch (e) {
    send(res, 502, JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
  return true;
}

async function handleHitlPending(req, res, ctx) {
  const { send, checkYoloOrSessionAuth, opsMonitor } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  try {
    const pending = opsMonitor.listHitlPending();
    send(res, 200, JSON.stringify({ ok: true, pending, count: pending.length }));
  } catch (e) {
    send(res, 502, JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
  return true;
}

async function handleHitlApprove(req, res, ctx) {
  return handleHitlAction(req, res, ctx, 'approve');
}

async function handleHitlReject(req, res, ctx) {
  return handleHitlAction(req, res, ctx, 'reject');
}

async function handleHitlAction(req, res, ctx, action) {
  const { send, readBody, checkYoloOrSessionAuth, opsMonitor } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (err) {
    void err;
    send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    return true;
  }
  // Approve executes queued dangerous/money tools — money plane + dual-confirm.
  // Reject is not money-moving; leave ungated.
  if (action === 'approve') {
    const { gateMoneyHttp } = require('../lib/moneyPlaneGate');
    if (!gateMoneyHttp(req, res, send, {
      body,
      action: 'hitl_approve',
      pathname: '/api/hitl/approve',
      dataDir: ctx.dataDir || process.env.PIKO_DATA_DIR,
    })) {
      return true;
    }
  }
  const requestId = String(body.id || body.request_id || body.requestId || '').trim();
  if (!requestId) {
    send(res, 400, JSON.stringify({ ok: false, error: 'Missing id (request UUID)' }));
    return true;
  }
  try {
    const result = action === 'approve'
      ? opsMonitor.approveHitl(requestId)
      : opsMonitor.rejectHitl(requestId);
    send(res, 200, JSON.stringify({ ok: true, action, id: requestId, result }));
  } catch (e) {
    const msg = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    send(res, 502, JSON.stringify({ ok: false, error: msg, id: requestId }));
  }
  return true;
}

async function handleUpload(req, res, ctx) {
  const { send, readBody, checkYoloOrSessionAuth, pikoUpload } = ctx;
  if (!checkYoloOrSessionAuth(req)) {
    send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return true;
  }
  try {
    const body = await readBody(req);
    let json;
    try {
      json = JSON.parse(body || '{}');
    } catch (_) {
      send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      return true;
    }
    const out = pikoUpload.saveUpload({
      filename: json.filename || json.name,
      content_base64: json.content_base64 || json.base64,
      subdir: json.subdir || 'inbox',
    });
    send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    send(res, 400, JSON.stringify({ ok: false, error: e.message || String(e) }));
  }
  return true;
}

module.exports = {
  tryHandleYolo,
  registerYoloRoutes,
  isYoloPath,
};
