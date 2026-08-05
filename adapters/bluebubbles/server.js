#!/usr/bin/env node
/**
 * Piko BlueBubbles (iMessage) adapter — receives webhooks from BlueBubbles server,
 * POSTs message to Piko /api/chat, sends reply via BlueBubbles REST API.
 * Env: PIKO_WEBCHAT_URL, BLUEBUBBLES_URL, BLUEBUBBLES_API_KEY.
 * Webhook port: BLUEBUBBLES_WEBHOOK_PORT (default 3010).
 * Bind: BLUEBUBBLES_WEBHOOK_BIND (default 127.0.0.1).
 * Secret: BLUEBUBBLES_WEBHOOK_SECRET (or PIKO_WEBHOOK_SECRET) required unless
 * BLUEBUBBLES_WEBHOOK_INSECURE=1.
 */
const http = require('http');
const https = require('https');
const path = require('path');
const { postToPiko } = require('../shared/pikoClient');

const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const BLUEBUBBLES_URL = (process.env.BLUEBUBBLES_URL || 'http://localhost:1234').replace(/\/$/, '');
const BLUEBUBBLES_API_KEY = process.env.BLUEBUBBLES_API_KEY;
const WEBHOOK_PORT = Number(process.env.BLUEBUBBLES_WEBHOOK_PORT) || 3010;
const WEBHOOK_SIGNATURE_HEADER = (process.env.BLUEBUBBLES_WEBHOOK_SIGNATURE_HEADER || 'x-webhook-signature').toLowerCase();

function resolveWebhookBind(env = process.env) {
  const bind = String((env && env.BLUEBUBBLES_WEBHOOK_BIND) || '').trim();
  return bind || '127.0.0.1';
}

function assertWebhookSecret(env = process.env) {
  const secret = String(
    (env && (env.BLUEBUBBLES_WEBHOOK_SECRET || env.PIKO_WEBHOOK_SECRET)) || '',
  ).trim();
  const insecure = String((env && env.BLUEBUBBLES_WEBHOOK_INSECURE) || '') === '1';
  if (!secret && !insecure) {
    throw new Error(
      'BLUEBUBBLES_WEBHOOK_SECRET (or PIKO_WEBHOOK_SECRET) is required. '
      + 'Set BLUEBUBBLES_WEBHOOK_INSECURE=1 only for local break-glass.',
    );
  }
  return secret;
}

let verifyHmac;
try {
  const webhookVerify = require(path.join(__dirname, '..', '..', 'webchat-piko', 'lib', 'webhookVerify.js'));
  verifyHmac = webhookVerify.verifyHmac;
} catch (_) {
  verifyHmac = () => true;
}

async function postPiko(message, sessionId) {
  const json = await postToPiko(PIKO_URL, message, sessionId || 'imessage-default');
  return json.reply || json.error || '';
}

function sendBlueBubbles(chatGuid, text) {
  if (!BLUEBUBBLES_API_KEY) return Promise.reject(new Error('BLUEBUBBLES_API_KEY not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(BLUEBUBBLES_URL + '/api/v1/message/send');
    const body = JSON.stringify({ chatGuid, message: text });
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + BLUEBUBBLES_API_KEY,
      },
    };
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

function createWebhookServer(webhookSecret) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (ch) => (body += ch));
    req.on('end', async () => {
      try {
        if (webhookSecret && verifyHmac) {
          const sig = req.headers[WEBHOOK_SIGNATURE_HEADER] || req.headers['x-signature'];
          if (!verifyHmac(body, sig, webhookSecret)) {
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
        if (chatGuid && reply) {
          await sendBlueBubbles(chatGuid, reply).catch((e) => console.error('[bluebubbles] send failed:', e.message));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reply: reply ? reply.slice(0, 100) : '' }));
      } catch (e) {
        console.error('[bluebubbles]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  });
}

function main() {
  const webhookSecret = assertWebhookSecret();
  const bind = resolveWebhookBind();
  const server = createWebhookServer(webhookSecret);
  server.listen(WEBHOOK_PORT, bind, () => {
    console.log('Piko BlueBubbles webhook listening on', `${bind}:${WEBHOOK_PORT}`, 'PIKO_WEBCHAT_URL=', PIKO_URL);
    if (!BLUEBUBBLES_API_KEY) console.warn('BLUEBUBBLES_API_KEY not set — cannot send replies.');
  });
  return server;
}

if (require.main === module) {
  main();
}

module.exports = {
  assertWebhookSecret,
  resolveWebhookBind,
  createWebhookServer,
  main,
};
