const { readJsonFile, writeJsonFile, resolveDataPath } = require('./utils');

async function status(ctx) {
  const env = ctx.env || {};
  return {
    connected: !!(env.WHATSAPP_SESSION_NAME || env.WHATSAPP_AUTH_STATE || env.WHATSAPP_TOKEN),
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
    note: 'Bridge connector placeholder',
  };
}

async function list() {
  return { items: [], source: 'none' };
}

async function pull(_ctx, _params) {
  return { item: null, source: 'none' };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (action !== 'send_message') {
    const err = new Error(`Unsupported whatsapp action: ${action}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const text = String((params && (params.text || params.message)) || '').trim();
  if (!text) {
    const err = new Error('send_message requires text');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const target = String((params && (params.target || params.phone || params.to)) || '').trim();
  const filePath = resolveDataPath(ctx, 'whatsapp-outbox.json');
  const parsed = readJsonFile(filePath, {});
  const outbox = Array.isArray(parsed.items) ? parsed.items.slice() : [];
  const nowIso = new Date().toISOString();
  const item = {
    id: `whatsapp_out_${Date.now()}`,
    createdAt: nowIso,
    target: target || null,
    text: text.slice(0, 1000),
    source: 'connector_act',
    status: 'queued',
  };
  outbox.unshift(item);
  writeJsonFile(filePath, {
    updatedAt: nowIso,
    items: outbox.slice(0, 1000),
  });
  return {
    ok: true,
    action,
    item,
    message: 'whatsapp message queued in outbox',
    transport: 'local_outbox',
  };
}

async function disconnect() {
  return {
    ok: true,
    disconnected: true,
    message: 'WhatsApp bridge disconnect acknowledged',
  };
}

module.exports = {
  id: 'whatsapp',
  status,
  list,
  pull,
  act,
  disconnect,
};
