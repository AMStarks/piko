#!/usr/bin/env node
/**
 * Proactive pattern detector — run hourly (cron). Sends Telegram nudges when:
 * - Open tensions >= 2 and tensions.md unchanged for 7+ days → "Still thinking about …?"
 * - Moltbook: last 3 posts avg upvotes < 1 → "Last 3 posts underperformed. Try question titles?"
 * Set TELEGRAM_BOT_TOKEN (or TELEGRAM_TOKEN) and TELEGRAM_CHAT_ID to send.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const TENSIONS_FILE = path.join(LEARNING_DIR, 'tensions.md');
const MOLTBOOK_STATE_FILE = path.join(DATA_DIR, 'moltbook-state.json');
const CALENDAR_SNAPSHOT_FILE = path.join(DATA_DIR, 'calendar-snapshot.json');
const TENSION_STALE_DAYS = Number(process.env.PIKO_TENSION_STALE_DAYS) || 7;
const MIN_TENSIONS_FOR_NUDGE = 2;
const MOLTBOOK_LAST_N = 3;
const MOLTBOOK_MIN_AVG_UPVOTES = 1;
/** If an event starts within this many ms, skip proactive nudges (notification smartness). */
const BUSY_WINDOW_MS = 60 * 60 * 1000;

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
      },
      (res) => {
        let data = '';
        res.on('data', (ch) => (data += ch));
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function readTensions() {
  if (!fs.existsSync(TENSIONS_FILE)) return { items: [], mtime: null };
  const raw = fs.readFileSync(TENSIONS_FILE, 'utf8');
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
      items.push(line.slice(2).trim());
    }
  }
  const stat = fs.statSync(TENSIONS_FILE);
  return { items, mtime: stat.mtime };
}

function readMoltbookLastN() {
  if (!fs.existsSync(MOLTBOOK_STATE_FILE)) return [];
  try {
    const raw = fs.readFileSync(MOLTBOOK_STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    const posts = Array.isArray(data.posts) ? data.posts : [];
    return posts.slice(0, MOLTBOOK_LAST_N);
  } catch (_) {
    return [];
  }
}

/** True if calendar snapshot has an event starting in the next BUSY_WINDOW_MS (silence nudges during meetings). */
function isBusySoon() {
  try {
    if (!fs.existsSync(CALENDAR_SNAPSHOT_FILE)) return false;
    const raw = fs.readFileSync(CALENDAR_SNAPSHOT_FILE, 'utf8');
    const data = JSON.parse(raw);
    const events = Array.isArray(data.events) ? data.events : [];
    const now = Date.now();
    const end = now + BUSY_WINDOW_MS;
    for (const e of events) {
      const start = e.start ? new Date(e.start).getTime() : null;
      if (start != null && start >= now && start <= end) return true;
    }
  } catch (_) {}
  return false;
}

function runTensionNudge(chatId) {
  if (isBusySoon()) {
    console.log('[proactive-patterns] Skipping tension nudge (event in next hour)');
    return Promise.resolve(false);
  }
  const { items, mtime } = readTensions();
  if (items.length < MIN_TENSIONS_FOR_NUDGE) return false;
  if (!mtime) return false;
  const now = new Date();
  const ageDays = (now - mtime) / (24 * 60 * 60 * 1000);
  if (ageDays < TENSION_STALE_DAYS) return false;
  const first = items[0].slice(0, 60);
  const nudge = `Still thinking about "${items.length > 1 ? first + '…' : first}"? You've had ${items.length} tension(s) open for over ${Math.floor(ageDays)} days. Want to talk it through?`;
  return telegramSend(chatId, nudge).then(() => true);
}

function runMoltbookNudge(chatId) {
  if (isBusySoon()) {
    console.log('[proactive-patterns] Skipping Moltbook nudge (event in next hour)');
    return Promise.resolve(false);
  }
  const last = readMoltbookLastN();
  if (last.length < 2) return false;
  const upvotes = last.map((p) => (p.upvotes != null ? p.upvotes : 0));
  const avg = upvotes.reduce((a, b) => a + b, 0) / upvotes.length;
  if (avg >= MOLTBOOK_MIN_AVG_UPVOTES) return false;
  const nudge = `Last ${last.length} Moltbook posts averaged ${avg.toFixed(1)} upvotes. Try question titles or more concrete hooks?`;
  return telegramSend(chatId, nudge).then(() => true);
}

function main() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.log('[proactive-patterns] TELEGRAM_CHAT_ID not set; skipping');
    return;
  }

  Promise.all([
    runTensionNudge(chatId).then((sent) => sent && console.log('[proactive-patterns] Tension nudge sent')),
    runMoltbookNudge(chatId).then((sent) => sent && console.log('[proactive-patterns] Moltbook nudge sent')),
  ])
    .then(() => {
      try {
        require('./context-synthesis.js').main();
      } catch (e) {
        console.error('[proactive-patterns] context-synthesis:', e.message);
      }
    })
    .catch((e) => console.error('[proactive-patterns] Telegram failed:', e.message));
}

main();
