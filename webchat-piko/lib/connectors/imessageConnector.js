const { readJsonFile, writeJsonFile, resolveDataPath } = require('./utils');

function readImessageHints(ctx) {
  const alertsPath = resolveDataPath(ctx, 'ea-alerts.json');
  const alerts = readJsonFile(alertsPath, []);
  const list = Array.isArray(alerts) ? alerts : [];
  return list
    .filter((a) => String(a.category || '').toLowerCase().includes('imessage'))
    .slice(-50)
    .reverse()
    .map((a, idx) => ({
      id: String(a.id || `imessage_${idx}`),
      text: String(a.text || a.message || '').slice(0, 200),
      at: a.at || null,
    }));
}

async function status(ctx) {
  const env = ctx.env || {};
  return {
    connected: !!(env.PIKO_EA_IMESSAGE_CHAT_GUID && env.BLUEBUBBLES_URL && env.BLUEBUBBLES_API_KEY),
    cacheItems: readImessageHints(ctx).length,
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
  };
}

async function list(ctx, params) {
  const limit = Math.max(1, Math.min(50, parseInt(params && params.limit, 10) || 20));
  return { items: readImessageHints(ctx).slice(0, limit), source: 'ea_alerts' };
}

async function pull(ctx, params) {
  const id = String((params && params.id) || '').trim();
  if (!id) return { item: null, error: 'Missing id' };
  const item = readImessageHints(ctx).find((i) => i.id === id) || null;
  return { item, source: 'ea_alerts' };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (action !== 'send_message') {
    const err = new Error(`Unsupported imessage action: ${action}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const text = String((params && (params.text || params.message)) || '').trim();
  if (!text) {
    const err = new Error('send_message requires text');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const chatGuid = String((params && (params.chatGuid || params.threadId || params.target)) || '').trim();
  const filePath = resolveDataPath(ctx, 'ea-alerts.json');
  const alerts = readJsonFile(filePath, []);
  const list = Array.isArray(alerts) ? alerts.slice() : [];
  const nowTs = Date.now();
  const record = {
    id: `imessage_out_${nowTs}`,
    at: nowTs,
    category: 'imessage_outbox',
    text: text.slice(0, 1000),
    chatGuid: chatGuid || null,
    source: 'connector_act',
  };
  list.push(record);
  writeJsonFile(filePath, list.slice(-2000));
  return {
    ok: true,
    action,
    item: record,
    message: 'iMessage action recorded to outbox log',
    transport: 'local_outbox',
  };
}

async function disconnect(ctx) {
  const filePath = resolveDataPath(ctx, 'ea-alerts.json');
  const alerts = readJsonFile(filePath, []);
  const kept = (Array.isArray(alerts) ? alerts : [])
    .filter((a) => !String(a && a.category || '').toLowerCase().includes('imessage'));
  writeJsonFile(filePath, kept);
  return {
    ok: true,
    disconnected: true,
    message: 'iMessage hint cache entries cleared',
  };
}

module.exports = {
  id: 'imessage',
  status,
  list,
  pull,
  act,
  disconnect,
};
