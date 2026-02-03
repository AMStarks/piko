#!/usr/bin/env node
/**
 * Piko Heartbeat — run on a schedule (e.g. cron daily).
 * 1. Reads yesterday's history dump (if any), asks Ollama for one suggested MEMORY line; writes to suggestions/.
 * 2. Optionally sends a short proactive Telegram nudge if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SCRIPT_DIR = path.resolve(__dirname);
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const PROMPTS_DIR = process.env.PIKO_PROMPTS_DIR || path.join(ROOT_DIR, 'prompts');
const HISTORY_DIR = process.env.PIKO_HISTORY_DIR || path.join(ROOT_DIR, 'history');
const SUGGESTIONS_DIR = process.env.PIKO_SUGGESTIONS_DIR || path.join(ROOT_DIR, 'memory', 'suggestions');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function ollamaChat(messages) {
  const u = new URL(OLLAMA_URL);
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    messages,
    stream: false,
  });
  const opts = {
    hostname: u.hostname,
    port: u.port || 80,
    path: (u.pathname || '') + '/api/chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  const { statusCode, data } = await httpRequest(opts, body);
  const json = JSON.parse(data);
  const reply = (json.message && json.message.content) || (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  return String(reply).trim();
}

async function suggestMemoryLine(historyPath) {
  let raw = '';
  try {
    raw = fs.readFileSync(historyPath, 'utf8').trim();
  } catch (_) {
    return null;
  }
  if (!raw || raw.length < 50) return null;
  const prompt = `From this conversation log, suggest ONE short line the user could add to MEMORY.md (durable fact or preference only). One line only. If nothing durable, reply exactly: NONE\n\n---\n${raw.slice(0, 3000)}\n---`;
  try {
    const reply = await ollamaChat([{ role: 'user', content: prompt }]);
    if (!reply || reply.toUpperCase() === 'NONE') return null;
    return reply;
  } catch (e) {
    console.error('[heartbeat] Ollama suggest failed:', e.message);
    return null;
  }
}

function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.resolve();
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        family: 4,
      },
      (res) => {
        let data = '';
        res.on('data', (ch) => (data += ch));
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function getProactiveNudge() {
  let memory = '';
  try {
    memory = fs.readFileSync(path.join(PROMPTS_DIR, 'MEMORY.md'), 'utf8').trim().slice(0, 800);
  } catch (_) {}
  const prompt = `You are Piko, a concise assistant. Based on this context, write ONE short, friendly sentence as a nudge to the user for today (e.g. something to pick up, or a brief check-in). No meta-commentary. One sentence only.\n\nContext:\n${memory}`;
  try {
    const reply = await ollamaChat([{ role: 'user', content: prompt }]);
    return reply ? reply.split('\n')[0].trim().slice(0, 200) : null;
  } catch (e) {
    console.error('[heartbeat] Ollama nudge failed:', e.message);
    return null;
  }
}

async function main() {
  const date = yesterday();
  console.log('[heartbeat] Running for', date);

  // 1. Suggest MEMORY line from yesterday's history
  const historyPath = path.join(HISTORY_DIR, `${date}.txt`);
  const suggestion = await suggestMemoryLine(historyPath);
  if (suggestion) {
    fs.mkdirSync(SUGGESTIONS_DIR, { recursive: true });
    const outPath = path.join(SUGGESTIONS_DIR, `${date}.txt`);
    fs.writeFileSync(outPath, suggestion, 'utf8');
    console.log('[heartbeat] Suggested MEMORY line written to', outPath);
  } else {
    console.log('[heartbeat] No MEMORY suggestion for', date);
  }

  // 2. Proactive Telegram nudge (if configured)
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (chatId) {
    const nudge = await getProactiveNudge() || 'Piko here—anything you want to pick up today?';
    try {
      await telegramSend(chatId, nudge);
      console.log('[heartbeat] Telegram nudge sent');
    } catch (e) {
      console.error('[heartbeat] Telegram send failed:', e.message);
    }
  } else {
    console.log('[heartbeat] TELEGRAM_CHAT_ID not set; skipping nudge');
  }
}

main().catch((e) => {
  console.error('[heartbeat] Error:', e.message);
  process.exitCode = 1;
});
