const { httpsJsonRequest, getGmailAccessToken } = require('./utils');

async function status(ctx) {
  const env = ctx.env || {};
  const linked = ctx.linkedAccounts || {};
  const connected = !!(env.GMAIL_ACCESS_TOKEN || (env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET));
  return {
    connected,
    provider: 'google',
    account: linked.gmail || null,
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
  };
}

async function list(ctx, params) {
  const limit = Math.max(1, Math.min(25, parseInt(params && params.limit, 10) || 10));
  const token = await getGmailAccessToken(ctx.env || {});
  if (!token) return { items: [], source: 'unconfigured' };
  const { statusCode, json } = await httpsJsonRequest({
    hostname: 'gmail.googleapis.com',
    path: `/gmail/v1/users/me/messages?maxResults=${limit}&q=is:unread`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (statusCode !== 200 || !json) return { items: [], source: 'gmail_api_error' };
  const messages = Array.isArray(json.messages) ? json.messages : [];
  return {
    items: messages.map((m) => ({ id: m.id, threadId: m.threadId })),
    source: 'gmail_api',
  };
}

async function pull(ctx, params) {
  const messageId = params && (params.id || params.messageId);
  if (!messageId) return { item: null, error: 'Missing id' };
  const token = await getGmailAccessToken(ctx.env || {});
  if (!token) return { item: null, error: 'Gmail not configured' };
  const { statusCode, json } = await httpsJsonRequest({
    hostname: 'gmail.googleapis.com',
    path: `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (statusCode !== 200 || !json) return { item: null, error: 'Gmail API failed' };
  const headers = (json.payload && Array.isArray(json.payload.headers)) ? json.payload.headers : [];
  const getHeader = (name) => {
    const match = headers.find((h) => String(h.name || '').toLowerCase() === name.toLowerCase());
    return match ? String(match.value || '') : '';
  };
  return {
    item: {
      id: json.id,
      threadId: json.threadId,
      from: getHeader('From'),
      subject: getHeader('Subject') || '(no subject)',
      date: getHeader('Date'),
      snippet: String(json.snippet || '').slice(0, 240),
    },
  };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  const messageId = String((params && (params.id || params.messageId)) || '').trim();
  if (!messageId) {
    const err = new Error('Missing message id');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const token = await getGmailAccessToken(ctx.env || {});
  if (!token) {
    const err = new Error('Gmail not configured');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  let body;
  if (action === 'mark_read') {
    body = JSON.stringify({ removeLabelIds: ['UNREAD'] });
  } else if (action === 'archive') {
    body = JSON.stringify({ removeLabelIds: ['INBOX'] });
  } else {
    const err = new Error(`Unsupported gmail action: ${action}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }

  const { statusCode, json } = await httpsJsonRequest({
    hostname: 'gmail.googleapis.com',
    path: `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, body);
  if (statusCode !== 200) {
    const err = new Error((json && json.error && json.error.message) || 'Gmail action failed');
    err.code = 'UPSTREAM_FAILURE';
    throw err;
  }
  return {
    ok: true,
    action,
    id: messageId,
    message: `gmail ${action} applied`,
  };
}

async function disconnect() {
  return {
    ok: true,
    disconnected: true,
    message: 'Gmail disconnect acknowledged (credentials remain env-managed)',
  };
}

module.exports = {
  id: 'gmail',
  status,
  list,
  pull,
  act,
  disconnect,
};
