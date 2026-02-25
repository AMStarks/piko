#!/usr/bin/env node
/**
 * Piko Discord adapter — receives messages, POSTs to Piko WebChat /api/chat, sends reply.
 * Env: DISCORD_TOKEN (bot token), PIKO_WEBCHAT_URL (e.g. http://localhost:3000).
 */
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';

if (!DISCORD_TOKEN) {
  console.error('Set DISCORD_TOKEN (or DISCORD_BOT_TOKEN).');
  process.exit(1);
}

function postChat(message, sessionId) {
  return new Promise((resolve, reject) => {
    const u = new URL(PIKO_URL + '/api/chat');
    const body = JSON.stringify({ message, sessionId: sessionId || 'discord-default' });
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', () => {
  console.log('Piko Discord adapter ready. PIKO_WEBCHAT_URL=', PIKO_URL);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const text = (msg.content || '').trim();
  if (!text) return;

  const sessionId = 'discord-' + (msg.channel?.id || msg.guild?.id || 'dm');
  try {
    const reply = await postChat(text, sessionId);
    const out = (reply && reply.length > 2000) ? reply.slice(0, 1997) + '…' : reply;
    await msg.channel.send(out || '(no reply)');
  } catch (e) {
    console.error('[discord]', e.message);
    await msg.channel.send('Piko error: ' + e.message).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
