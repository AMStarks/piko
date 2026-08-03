const gmailConnector = require('./gmailConnector');
const calendarConnector = require('./calendarConnector');
const notionConnector = require('./notionConnector');
const slackConnector = require('./slackConnector');
const discordConnector = require('./discordConnector');
const imessageConnector = require('./imessageConnector');
const whatsappConnector = require('./whatsappConnector');

const connectors = {
  gmail: gmailConnector,
  calendar: calendarConnector,
  notion: notionConnector,
  slack: slackConnector,
  discord: discordConnector,
  imessage: imessageConnector,
  whatsapp: whatsappConnector,
};

function getConnector(id) {
  return connectors[id] || null;
}

function listConnectors() {
  return Object.keys(connectors);
}

async function safeCall(connector, op, ctx, params) {
  try {
    if (!connector || typeof connector[op] !== 'function') {
      return { ok: false, error: `${op} not available` };
    }
    const result = await connector[op](ctx, params);
    return { ok: true, result };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'connector call failed',
      code: e.code || 'CONNECTOR_ERROR',
    };
  }
}

async function getConnectorHealth(ctx) {
  const ids = listConnectors();
  const out = {};
  for (const id of ids) {
    const connector = getConnector(id);
    const status = await safeCall(connector, 'status', ctx, {});
    out[id] = {
      id,
      connected: !!(status.ok && status.result && status.result.connected),
      ok: status.ok,
      error: status.ok ? null : status.error,
      status: status.ok ? status.result : null,
    };
  }
  return out;
}

async function invokeConnector(id, op, ctx, params) {
  const connector = getConnector(id);
  if (!connector) return { ok: false, error: `Unknown connector: ${id}`, code: 'UNKNOWN_CONNECTOR' };
  return safeCall(connector, op, ctx, params);
}

module.exports = {
  connectors,
  getConnector,
  listConnectors,
  getConnectorHealth,
  invokeConnector,
};
