#!/usr/bin/env node
/**
 * Piko BlueBubbles (iMessage) adapter — receives webhooks from BlueBubbles server,
 * POSTs message to Piko /api/chat, sends reply via BlueBubbles REST API.
 * Env: PIKO_WEBCHAT_URL, BLUEBUBBLES_URL, BLUEBUBBLES_API_KEY. Webhook port: BLUEBUBBLES_WEBHOOK_PORT (default 3010).
 * Optional: PIKO_WEBHOOK_SECRET or BLUEBUBBLES_WEBHOOK_SECRET + signature header (e.g. x-webhook-signature) to verify webhooks.
 */
const http = require('http');
const https = require('https');
const path = require('path');

const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const BLUEBUBBLES_URL = (process.env.BLUEBUBBLES_URL || 'http://localhost:1234').replace(/\/$/, '');
const BLUEBUBBLES_API_KEY = process.env.BLUEBUBBLES_API_KEY;
const WEBHOOK_PORT = Number(process.env.BLUEBUBBLES_WEBHOOK_PORT) || 3010;
const WEBHOOK_SECRET = process.env.BLUEBUBBLES_WEBHOOK_SECRET || process.env.PIKO_WEBHOOK_SECRET;
const WEBHOOK_SIGNATURE_HEADER = (process.env.BLUEBUBBLES_WEBHOOK_SIGNATURE_HEADER || 'x-webhook-signature').toLowerCase();

let verifyHmac;
try {
  const webhookVerify = require(path.join(__dirname, '..', '..', 'webchat-piko', 'lib', 'webhookVerify.js'));
  verifyHmac = webhookVerify.verifyHmac;
} catch (_) {
  verifyHmac = () => true;
}

function postPiko(message, sessionId) {
  return new Promise((resolve, reject) => {
    const u = new URL(PIKO_URL + '/api/chat');
    const body = JSON.stringify({ message, sessionId: sessionId || 'imessage-default' });
    const isHttps = u.protocol === 'https:';
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => { try { resolve(JSON.parse(data).reply || ''); } catch (_) { resolve(''); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendBlueBubbles(chatGuid, text) {
  if (!BLUEBUBBLES_API_KEY) return Promise.reject(new Error('BLUEBUBBLES_API_KEY not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(BLUEBUBBLES_URL + '/api/v1/message/send');
    const body = JSON.stringify({ chatGuid, message: text });
    const isHttps = u.protocol === 'https:';
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + BLUEBUBBLES_API_KEY } };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (ch) => (body += ch));
  req.on('end', async () => {
    try {
      if (WEBHOOK_SECRET && verifyHmac) {
        const sig = req.headers[WEBHOOK_SIGNATURE_HEADER] || req.headers['x-signature'];
        if (!verifyHmac(body, sig, WEBHOOK_SECRET)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Webhook signature invalid' }));
          return;
        }
      }
      const payload = JSON.parse(body || '{}');
      const message = payload.message || payload.data?.message?.text || payload.text || '';
      const chatGuid = payload.chatGuid || payload.data?.chat?.guid || payload.chat || '';
      if (!message.trim()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No message' }));
        return;
      }
      const reply = await postPiko(message.trim(), 'imessage-' + (chatGuid || 'unknown'));
      if (chatGuid && reply) await sendBlueBubbles(chatGuid, reply).catch((e) => console.error('[bluebubbles] send failed:', e.message));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reply: reply ? reply.slice(0, 100) : '' }));
    } catch (e) {
      console.error('[bluebubbles]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

server.listen(WEBHOOK_PORT, '0.0.0.0', () => {
  console.log('Piko BlueBubbles webhook listening on port', WEBHOOK_PORT, 'PIKO_WEBCHAT_URL=', PIKO_URL);
  if (!BLUEBUBBLES_API_KEY) console.warn('BLUEBUBBLES_API_KEY not set — cannot send replies.');
});
