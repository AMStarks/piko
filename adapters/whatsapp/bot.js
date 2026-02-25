#!/usr/bin/env node
/**
 * Piko WhatsApp adapter — Baileys multi-device. Receives messages, POSTs to Piko WebChat /api/chat, sends reply.
 * Env: PIKO_WEBCHAT_URL (e.g. http://localhost:3000). Auth state in ./auth (scan QR on first run).
 */
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, 'auth');

function postChat(message, sessionId) {
  return new Promise((resolve, reject) => {
    const u = new URL(PIKO_URL + '/api/chat');
    const body = JSON.stringify({ message, sessionId: sessionId || 'whatsapp-default' });
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.reply || json.error || 'No reply.');
        } catch (_) {
          resolve(data.slice(0, 500));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function getMessageText(msg) {
  if (!msg) return '';
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
  return '';
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.error('[whatsapp] Logged out. Delete auth/ and restart to re-pair.');
        process.exit(1);
      }
      console.error('[whatsapp] Disconnected. Reconnecting...');
    } else if (connection === 'open') {
      console.log('Piko WhatsApp adapter ready. PIKO_WEBCHAT_URL=', PIKO_URL);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const jid = m.key.remoteJid;
      const text = getMessageText(m.message);
      if (!text || !text.trim()) continue;

      const sessionId = 'whatsapp-' + (jid || 'unknown').replace(/@.*/, '');
      try {
        const reply = await postChat(text.trim(), sessionId);
        const out = (reply && reply.length > 4096) ? reply.slice(0, 4093) + '…' : reply;
        await sock.sendMessage(jid, { text: out || '(no reply)' });
      } catch (e) {
        console.error('[whatsapp]', e.message);
        await sock.sendMessage(jid, { text: 'Piko error: ' + e.message }).catch(() => {});
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
