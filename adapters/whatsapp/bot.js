#!/usr/bin/env node
/**
 * Piko WhatsApp adapter — Baileys multi-device. Receives messages, POSTs to Piko WebChat /api/chat, sends reply.
 * Env: PIKO_WEBCHAT_URL (e.g. http://localhost:3000). Auth state in ./auth (scan QR on first run).
 */
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const { postToPiko, shouldSendErrorReply } = require('../shared/pikoClient');
const {
  nextReconnectDelayMs,
  decideReconnect,
  BACKOFF_CAP_MS,
} = require('./reconnect');

const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, 'auth');

async function postChat(message, sessionId) {
  const json = await postToPiko(PIKO_URL, message, sessionId || 'whatsapp-default');
  if (json && json.dropped) return null;
  return json.reply || json.error || 'No reply.';
}

function getMessageText(msg) {
  if (!msg) return '';
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
  return '';
}

async function connect(attempt = 0) {
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
      const decision = decideReconnect(lastDisconnect, attempt, DisconnectReason.loggedOut);
      if (decision.action === 'exit_reauth') {
        console.error('[whatsapp] Logged out. Delete auth/ and restart to re-pair (QR re-auth required).');
        process.exit(1);
        return;
      }
      const delayMs = decision.delayMs || nextReconnectDelayMs(attempt);
      console.error(`[whatsapp] Disconnected. Reconnecting in ${delayMs}ms (attempt ${attempt + 1})…`);
      setTimeout(() => {
        connect(attempt + 1).catch((e) => {
          console.error('[whatsapp] reconnect failed:', e.message || e);
          process.exit(1);
        });
      }, delayMs);
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
        if (reply == null) continue; // dropped (in-flight flood)
        const out = (reply && reply.length > 4096) ? reply.slice(0, 4093) + '…' : reply;
        await sock.sendMessage(jid, { text: out || '(no reply)' });
      } catch (e) {
        console.error('[whatsapp]', e.message);
        if (shouldSendErrorReply(sessionId)) {
          await sock.sendMessage(jid, { text: 'Piko error: ' + e.message }).catch(() => {});
        }
      }
    }
  });
}

async function main() {
  await connect(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  nextReconnectDelayMs,
  decideReconnect,
  BACKOFF_CAP_MS,
  connect,
};
