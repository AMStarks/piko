/**
 * Gmail context for chat: fetch unread summary for conversational understanding.
 * Reuses token refresh logic; full access via /gmail commands in server.js.
 */
const https = require('https');
const { collapseWhitespace } = require('./text');

async function getGmailAccessToken() {
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) return null;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }).toString();
    const opts = { hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
    const { data } = await new Promise((resolve, reject) => {
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', (ch) => (d += ch));
        res.on('end', () => resolve({ statusCode: res.statusCode, data: d }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (!data) return null;
    const json = JSON.parse(data);
    return json.access_token || null;
  } catch (_) {
    return null;
  }
}

async function fetchUnreadEmails(options = {}) {
  const { maxResults = 8, includeBody = false } = options;
  const token = await getGmailAccessToken();
  if (!token) return { ok: false, emails: [] };
  try {
    const listPath = '/gmail/v1/users/me/messages?maxResults=' + maxResults + '&q=is:unread';
    const { statusCode, data: listData } = await new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'gmail.googleapis.com', port: 443, path: listPath, method: 'GET', headers: { Authorization: 'Bearer ' + token } },
        (res) => { let d = ''; res.on('data', (ch) => (d += ch)); res.on('end', () => resolve({ statusCode: res.statusCode, data: d })); }
      );
      req.on('error', reject);
      req.end();
    });
    if (statusCode !== 200) return { ok: false, emails: [] };
    const list = JSON.parse(listData);
    const ids = (list.messages || []).map((m) => m.id);
    const emails = [];
    const format = includeBody ? 'full' : 'metadata';
    const metaHeaders = '&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date';
    for (const id of ids) {
      const { data: msgData } = await new Promise((resolve, reject) => {
        const path = '/gmail/v1/users/me/messages/' + id + '?format=' + format + metaHeaders;
        const req = https.request(
          { hostname: 'gmail.googleapis.com', port: 443, path, method: 'GET', headers: { Authorization: 'Bearer ' + token } },
          (res) => { let d = ''; res.on('data', (ch) => (d += ch)); res.on('end', () => resolve({ data: d })); }
        );
        req.on('error', reject);
        req.end();
      });
      const msg = JSON.parse(msgData);
      const headers = (msg.payload && msg.payload.headers) || [];
      const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
      let body = '';
      if (includeBody && msg.payload) {
        if (msg.payload.body && msg.payload.body.data) {
          try {
            body = collapseWhitespace(Buffer.from(msg.payload.body.data, 'base64').toString('utf8').slice(0, 400));
          } catch (_) {}
        } else if (msg.payload.parts && msg.payload.parts.length) {
          const part = msg.payload.parts.find((p) => p.mimeType === 'text/plain') || msg.payload.parts[0];
          if (part && part.body && part.body.data) {
            try {
              body = collapseWhitespace(Buffer.from(part.body.data, 'base64').toString('utf8').slice(0, 400));
            } catch (_) {}
          }
        }
      }
      emails.push({
        id,
        from: getH('From'),
        subject: getH('Subject') || '(no subject)',
        date: getH('Date'),
        snippet: (msg.snippet || '').slice(0, 150),
        body: body || (msg.snippet || '').slice(0, 150),
      });
    }
    return { ok: true, emails };
  } catch (_) {
    return { ok: false, emails: [] };
  }
}

/** Search emails with Gmail query syntax. */
async function fetchSearchEmails(query, options = {}) {
  const { maxResults = 10, includeBody = false } = options;
  const token = await getGmailAccessToken();
  if (!token) return { ok: false, emails: [] };
  try {
    const q = encodeURIComponent(query);
    const listPath = '/gmail/v1/users/me/messages?maxResults=' + maxResults + '&q=' + q;
    const { statusCode, data: listData } = await new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'gmail.googleapis.com', port: 443, path: listPath, method: 'GET', headers: { Authorization: 'Bearer ' + token } },
        (res) => { let d = ''; res.on('data', (ch) => (d += ch)); res.on('end', () => resolve({ statusCode: res.statusCode, data: d })); }
      );
      req.on('error', reject);
      req.end();
    });
    if (statusCode !== 200) return { ok: false, emails: [] };
    const list = JSON.parse(listData);
    const ids = (list.messages || []).map((m) => m.id);
    const emails = [];
    const format = includeBody ? 'full' : 'metadata';
    const metaPart = includeBody ? '' : '&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date';
    for (const id of ids) {
      const path = '/gmail/v1/users/me/messages/' + id + '?format=' + format + metaPart;
      const { data: msgData } = await new Promise((resolve, reject) => {
        const req = https.request(
          { hostname: 'gmail.googleapis.com', port: 443, path, method: 'GET', headers: { Authorization: 'Bearer ' + token } },
          (res) => { let d = ''; res.on('data', (ch) => (d += ch)); res.on('end', () => resolve({ data: d })); }
        );
        req.on('error', reject);
        req.end();
      });
      const msg = JSON.parse(msgData);
      const headers = (msg.payload && msg.payload.headers) || [];
      const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
      let body = '';
      if (includeBody && msg.payload) {
        if (msg.payload.body && msg.payload.body.data) {
          try {
            body = collapseWhitespace(Buffer.from(msg.payload.body.data, 'base64').toString('utf8').slice(0, 1000));
          } catch (_) {}
        } else if (msg.payload.parts && msg.payload.parts.length) {
          const part = msg.payload.parts.find((p) => p.mimeType === 'text/plain') || msg.payload.parts[0];
          if (part && part.body && part.body.data) {
            try {
              body = collapseWhitespace(Buffer.from(part.body.data, 'base64').toString('utf8').slice(0, 1000));
            } catch (_) {}
          }
        }
      }
      emails.push({
        id,
        from: getH('From'),
        subject: getH('Subject') || '(no subject)',
        date: getH('Date'),
        snippet: (msg.snippet || '').slice(0, 200),
        body: body || (msg.snippet || ''),
      });
    }
    return { ok: true, emails };
  } catch (_) {
    return { ok: false, emails: [] };
  }
}

/** Fetch a single message by ID. */
async function fetchMessageById(id, includeBody = true) {
  const token = await getGmailAccessToken();
  if (!token) return { ok: false, email: null };
  try {
    const format = includeBody ? 'full' : 'metadata';
    const path = '/gmail/v1/users/me/messages/' + id + '?format=' + format + '&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To';
    const { statusCode, data } = await new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'gmail.googleapis.com', port: 443, path, method: 'GET', headers: { Authorization: 'Bearer ' + token } },
        (res) => { let d = ''; res.on('data', (ch) => (d += ch)); res.on('end', () => resolve({ statusCode: res.statusCode, data: d })); }
      );
      req.on('error', reject);
      req.end();
    });
    if (statusCode !== 200) return { ok: false, email: null };
    const msg = JSON.parse(data);
    const headers = (msg.payload && msg.payload.headers) || [];
    const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
    let body = '';
    if (includeBody && msg.payload) {
      if (msg.payload.body && msg.payload.body.data) {
        try {
          body = collapseWhitespace(Buffer.from(msg.payload.body.data, 'base64').toString('utf8'));
        } catch (_) {}
      } else if (msg.payload.parts && msg.payload.parts.length) {
        const part = msg.payload.parts.find((p) => p.mimeType === 'text/plain') || msg.payload.parts[0];
        if (part && part.body && part.body.data) {
          try {
            body = collapseWhitespace(Buffer.from(part.body.data, 'base64').toString('utf8'));
          } catch (_) {}
        }
      }
    }
    return {
      ok: true,
      email: {
        id,
        from: getH('From'),
        subject: getH('Subject') || '(no subject)',
        date: getH('Date'),
        to: getH('To'),
        snippet: msg.snippet || '',
        body: body || msg.snippet || '',
      },
    };
  } catch (_) {
    return { ok: false, email: null };
  }
}

/** Build a Gmail context block for the chat system prompt. Only when Gmail is configured. */
async function getGmailContextBlock() {
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!refresh) return '';
  const includeBody = process.env.PIKO_EA_GMAIL_READ_BODY === '1' || process.env.PIKO_EA_GMAIL_READ_BODY === 'true';
  const { ok, emails } = await fetchUnreadEmails({ maxResults: 6, includeBody });
  if (!ok || !emails.length) return '';
  const lines = emails.map((e, i) => {
    let line = `${i + 1}. From: ${e.from} | Subject: ${e.subject}`;
    if (e.body && e.body.trim()) line += ` | Snippet: ${e.body.trim().slice(0, 120)}`;
    else if (e.snippet) line += ` | Snippet: ${e.snippet.slice(0, 120)}`;
    return line;
  });
  return '\n\n**User\'s recent unread emails (use when they ask about emails, inbox, or messages):**\n' + lines.join('\n') + '\n\nReply in character; do not list instructions or say "From your emails".';
}

module.exports = { getGmailAccessToken, fetchUnreadEmails, fetchSearchEmails, fetchMessageById, getGmailContextBlock };
