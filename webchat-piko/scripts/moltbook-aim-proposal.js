#!/usr/bin/env node
/**
 * Moltbook nightly aim refinement proposal (v1.1).
 * Reads aim + refinements + journal + state → LLM proposes 2–4 refinements (Verb + tactic + condition).
 * Writes proposal to data/moltbook-pending-proposal.txt and appends to data/pending-notifications.txt.
 * One pending proposal at a time (overwrites). Optional: send via Telegram if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set.
 * Run via cron at 02:00 on Optimus.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SCRIPT_DIR = path.resolve(__dirname);
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROMPTS_DIR = process.env.PIKO_PROMPTS_DIR || path.join(ROOT_DIR, 'prompts');
const AIM_PATH = process.env.PIKO_MOLTBOOK_AIM_PATH || path.join(PROMPTS_DIR, 'MOLTBOOK_AIM.md');
const REFINEMENTS_PATH = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');
const STATE_FILE = path.join(DATA_DIR, 'moltbook-state.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'moltbook-journal.md');
const PENDING_PROPOSAL_FILE = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
const PENDING_NOTIFICATIONS_FILE = path.join(DATA_DIR, 'pending-notifications.txt');
const { ai } = require('../lib/llm');
const JOURNAL_ENTRIES_READ = 10;

function readAim() {
  try {
    return fs.readFileSync(AIM_PATH, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function readRefinements() {
  try {
    return fs.readFileSync(REFINEMENTS_PATH, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { posts: [], newPostsContext: '' };
  }
}

function readLastJournalEntries(n) {
  try {
    const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
    const blocks = raw.split(/\n##\s+/);
    const entries = [];
    for (let i = blocks.length - 1; i >= 0 && entries.length < n; i--) {
      const block = blocks[i].trim();
      if (!block || block.startsWith('# Piko')) continue;
      const firstLine = block.indexOf('\n');
      const body = firstLine >= 0 ? block.slice(firstLine + 1).trim() : '';
      if (body) entries.unshift(body);
    }
    return entries.join('\n').slice(-2000);
  } catch (_) {
    return '';
  }
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
        res.on('end', () => resolve({ statusCode: res.statusCode, data: d }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const aim = readAim();
  const refinements = readRefinements();
  const fullAim = aim + (refinements ? '\n\n--- Approved refinements ---\n' + refinements : '');
  const state = readState();
  const journal = readLastJournalEntries(JOURNAL_ENTRIES_READ);
  const engagement = (state.posts || []).map((p) => `${p.title || p.id}: ${p.upvotes || 0} up, ${p.downvotes || 0} down`).join('\n') || 'No engagement yet.';

  const prompt = `You are Piko. Given this aim, your recent journal, and performance on Moltbook, suggest 2-4 concrete refinements that would improve your chances of achieving the aim.

Each refinement must be tactical and testable. Use the form: Verb + tactic + condition.
Examples: "Favor shorter posts when discussing abstractions." "Avoid reactive tone when responding to criticism."
Do NOT output vague advice like "Be more authentic" or "Improve clarity."

AIM (and current refinements):
---
${fullAim.slice(0, 2500)}
---

Recent journal:
---
${journal || '(None yet.)'}
---

Engagement:
${engagement}

Output only the bullet points, one per line. No preamble.`;

  let proposal;
  try {
    proposal = (await ai(prompt)).trim();
  } catch (e) {
    console.error('[moltbook-aim-proposal] Ollama failed:', e.message);
    process.exitCode = 1;
    return;
  }

  const bullets = proposal.split(/\n/).map((l) => l.trim()).filter((l) => l && /^[-*•]?\s*/.test(l) || l.length > 10).slice(0, 4);
  const text = bullets.length ? bullets.join('\n') : proposal.trim().slice(0, 500);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PENDING_PROPOSAL_FILE, text, 'utf8');

  const notification = '📋 Piko Moltbook aim proposal:\n\n' + text + '\n\nReply with /aim approve to add these, or /aim reject to dismiss.';
  try {
    fs.appendFileSync(PENDING_NOTIFICATIONS_FILE, notification + '\n', 'utf8');
  } catch (e) {
    console.error('[moltbook-aim-proposal] Append pending failed:', e.message);
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (chatId) {
    try {
      await telegramSend(chatId, notification);
    } catch (e) {
      console.error('[moltbook-aim-proposal] Telegram failed:', e.message);
    }
  }

  console.log('[moltbook-aim-proposal] Proposal written; pending + optional Telegram sent.');
}

main().catch((e) => {
  console.error('[moltbook-aim-proposal] Error:', e.message);
  process.exitCode = 1;
});
