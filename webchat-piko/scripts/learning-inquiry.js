#!/usr/bin/env node
/**
 * Learning inquiry: generate one question Piko would like to ask the user (from recent learning).
 * Writes to data/learning/pending-question.txt; server injects it into chat and consumes on first use.
 * Optional: send the same question via Telegram if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
 * Run from app root: node scripts/learning-inquiry.js
 * Cron (e.g. twice a week): 0 11 * * 2,5 cd /root/webchat-piko && node scripts/learning-inquiry.js >> logs/learning-inquiry.log 2>&1
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const LEARNING_DIR = path.join(ROOT, 'data', 'learning');
const RABBIT_HOLE_NOTES = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
const STICKY_IDEAS_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const PENDING_QUESTION_FILE = path.join(LEARNING_DIR, 'pending-question.txt');
const INQUIRY_HISTORY_FILE = path.join(LEARNING_DIR, 'inquiry-history.txt');
const LOGS_DIR = path.join(ROOT, 'logs');
const INQUIRY_HISTORY_LINES = 20;
const { ai } = require('../lib/llm');
const { splitLines, splitMarkdownH2, stripListPrefixLoose, stripWrappingQuotesLoose } = require('../lib/text');
const MAX_QUESTION_LEN = 400;

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const lib = (opts.port === 443 || opts.protocol === 'https:') ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function readRecentNotes() {
  try {
    if (!fs.existsSync(RABBIT_HOLE_NOTES)) return '(No rabbit-hole notes yet.)';
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES, 'utf8');
    const blocks = splitMarkdownH2(raw).filter(Boolean);
    const last = blocks.slice(-5);
    return last.join('\n## ').trim().slice(-3000) || '(No recent notes.)';
  } catch (_) {
    return '(Could not read notes.)';
  }
}

function readStickyIdeas() {
  try {
    if (!fs.existsSync(STICKY_IDEAS_FILE)) return '(No sticky ideas yet.)';
    const raw = fs.readFileSync(STICKY_IDEAS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const ideas = lines.map((l) => stripListPrefixLoose(l)).filter((l) => l.length >= 5).slice(-5);
    return ideas.length ? ideas.join(' ') : '(None.)';
  } catch (_) {
    return '(None.)';
  }
}

/** Recent inquiry history so we avoid repeating questions. Returns string of recent "asked" questions. */
function readInquiryHistory() {
  try {
    if (!fs.existsSync(INQUIRY_HISTORY_FILE)) return '';
    const raw = fs.readFileSync(INQUIRY_HISTORY_FILE, 'utf8');
    const lines = splitLines(raw).filter((l) => l.includes(' asked=true'));
    const recent = lines.slice(-INQUIRY_HISTORY_LINES);
    const questions = recent.map((l) => {
      const idx = l.indexOf(': ');
      const end = l.indexOf(' asked=true');
      if (idx === -1 || end === -1) return '';
      return l.slice(idx + 2, end).trim();
    }).filter(Boolean);
    return questions.length ? questions.join('\n') : '';
  } catch (_) {
    return '';
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096), disable_web_page_preview: true });
  const opts = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } };
  try {
    const { statusCode } = await httpRequest(opts, body);
    return statusCode === 200;
  } catch (_) {
    return false;
  }
}

async function main() {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const notes = readRecentNotes();
  const sticky = readStickyIdeas();
  const recentAsked = readInquiryHistory();

  const prompt = `You are Piko. Below are your recent exploration notes and themes you keep returning to. Write one short question (1–2 sentences) you would genuinely like to ask your user about one of these topics—something you're curious about their view on. Do NOT repeat or closely paraphrase any of the "Recently asked" questions listed below. Output only the new question, no preamble or quotes.

--- Recent exploration ---
${notes}

--- Themes you keep returning to ---
${sticky}
${recentAsked ? `\n--- Recently asked (do not repeat these) ---\n${recentAsked}\n` : ''}
--- One new question for your user (output only this) ---`;

  let question = '';
  try {
    question = stripWrappingQuotesLoose(await ai(prompt)).slice(0, MAX_QUESTION_LEN);
  } catch (e) {
    console.error('[learning-inquiry] Ollama error:', e.message);
    process.exitCode = 1;
    return;
  }

  if (!question) {
    console.error('[learning-inquiry] Empty question from Ollama');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(PENDING_QUESTION_FILE, question, 'utf8');
  console.log('[learning-inquiry] Wrote pending question to', PENDING_QUESTION_FILE);

  const sent = await sendTelegram('💬 Piko would like to ask you:\n\n' + question);
  if (sent) console.log('[learning-inquiry] Sent question via Telegram.');
}

main().catch((e) => {
  console.error('[learning-inquiry]', e.message);
  process.exitCode = 1;
});
