#!/usr/bin/env node
/**
 * Piko Slack adapter — receives messages, POSTs to Piko WebChat /api/chat, sends reply.
 * Uses Socket Mode (no public URL). Env: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, PIKO_WEBCHAT_URL.
 */
const { App } = require('@slack/bolt');
const { postToPiko } = require('../shared/pikoClient');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_USER_OAUTH_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || process.env.SLACK_APP_LEVEL_TOKEN;
const PIKO_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error('Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN (Socket Mode requires app-level token).');
  process.exit(1);
}

async function postChat(message, sessionId) {
  const json = await postToPiko(PIKO_URL, message, sessionId || 'slack-default');
  return json.reply || json.error || 'No reply.';
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
});

app.message(async ({ message, say, client }) => {
  if (message.subtype || !message.text) return;
  const text = message.text.trim();
  if (!text) return;

  const sessionId = 'slack-' + (message.channel || 'dm');
  try {
    const reply = await postChat(text, sessionId);
    const out = (reply && reply.length > 4000) ? reply.slice(0, 3997) + '…' : reply;
    await say(out || '(no reply)');
  } catch (e) {
    console.error('[slack]', e.message);
    await say('Piko error: ' + e.message).catch(() => {});
  }
});

(async () => {
  await app.start();
  console.log('Piko Slack adapter (Socket Mode) ready. PIKO_WEBCHAT_URL=', PIKO_URL);
})();
