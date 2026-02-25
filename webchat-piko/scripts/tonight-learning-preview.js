#!/usr/bin/env node
/**
 * 9pm preview: tell the user what Piko will learn overnight, prompt for suggestions.
 * Peeks at tonight's topic (same logic as rabbit-hole-daily, without consuming).
 * Sends via Telegram if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set.
 * Cron: 0 21 * * * cd /root/webchat-piko && ./scripts/run-tonight-learning-preview.sh >> logs/tonight-learning-preview.log 2>&1
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_LEARNING = path.join(ROOT, 'data', 'learning');
const TOPICS_FILE = path.join(DATA_LEARNING, 'topics.txt');
const SUGGESTED_TOPICS_FILE = path.join(DATA_LEARNING, 'suggested-topics.txt');
const JOURNAL_FILE = path.join(ROOT, 'data', 'moltbook-journal.md');
const { ai } = require('../lib/llm');

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / (24 * 60 * 60 * 1000));
}

function peekSuggestedTopic() {
  try {
    if (!fs.existsSync(SUGGESTED_TOPICS_FILE)) return null;
    const raw = fs.readFileSync(SUGGESTED_TOPICS_FILE, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.length > 0 ? lines[0] : null;
  } catch (_) {
    return null;
  }
}

function readTopics() {
  try {
    const raw = fs.readFileSync(TOPICS_FILE, 'utf8');
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function useEmergentTopic() {
  return (dayOfYear() % 5) === 0;
}

async function pickTopicFromJournal(topics) {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return null;
    const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
    const excerpt = raw.slice(-2000).trim();
    if (!excerpt) return null;
    const prompt = `Below are recent journal entries. Suggest one exploration topic (2-4 words) that fits the themes in this text. Reply with only that topic, nothing else. No quotes.

${excerpt}`;
    const reply = await ai(prompt);
    const topic = (reply || '').trim().replace(/^["']|["']$/g, '').slice(0, 60);
    return topic && topic.length >= 2 ? topic : null;
  } catch (_) {
    return null;
  }
}

function pickTopicFromList(topics) {
  if (!topics || topics.length === 0) return null;
  const index = dayOfYear() % topics.length;
  return topics[index];
}

function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.resolve();
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let d = '';
        res.on('data', (ch) => (d += ch));
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  let topic = peekSuggestedTopic();
  let source = 'suggested';

  if (!topic) {
    const topics = readTopics();
    if (useEmergentTopic()) {
      topic = await pickTopicFromJournal(topics);
      if (topic) source = 'journal';
    }
    if (!topic) {
      topic = pickTopicFromList(topics);
      source = 'list';
    }
  }

  const msg = topic
    ? `🌙 Tonight I'll be exploring: ${topic}

Want me to look into something else instead? Add a topic to suggested-topics.txt (or use the Control panel) before 11pm.`
    : `🌙 Tonight's rabbit-hole run has no topic configured — add lines to topics.txt or suggested-topics.txt to queue one.`;

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (chatId) {
    try {
      await telegramSend(chatId, msg);
      console.log('[tonight-learning-preview] Sent to Telegram. Topic:', topic || '(none)', 'Source:', source);
    } catch (e) {
      console.error('[tonight-learning-preview] Telegram error:', e.message);
      process.exitCode = 1;
    }
  } else {
    console.log('[tonight-learning-preview] No TELEGRAM_CHAT_ID; would have sent:', msg.slice(0, 100) + '...');
  }
}

main().catch((e) => {
  console.error('[tonight-learning-preview]', e.message);
  process.exitCode = 1;
});
