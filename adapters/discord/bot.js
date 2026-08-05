#!/usr/bin/env node
/**
 * Piko Discord adapter — receives messages, POSTs to Piko WebChat /api/chat, sends reply.
 * Env: DISCORD_TOKEN (bot token), PIKO_WEBCHAT_URL (e.g. http://localhost:3000).
 */
const { Client, GatewayIntentBits } = require('discord.js');
const { postToPiko } = require('../shared/pikoClient');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';

if (!DISCORD_TOKEN) {
  console.error('Set DISCORD_TOKEN (or DISCORD_BOT_TOKEN).');
  process.exit(1);
}

async function postChat(message, sessionId) {
  const json = await postToPiko(PIKO_URL, message, sessionId || 'discord-default');
  return json.reply || json.error || 'No reply.';
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
