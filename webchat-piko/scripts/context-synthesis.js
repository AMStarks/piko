#!/usr/bin/env node
/**
 * Context synthesis — run with proactive-patterns (e.g. daily). Uses calendar-snapshot + learning:
 * - Busy day (e.g. >3 events today) + open tensions → Telegram: "Focus on Tension #1 (free 2–2:30PM)"
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const CALENDAR_PATH = path.join(DATA_DIR, 'calendar-snapshot.json');
const TENSIONS_FILE = path.join(LEARNING_DIR, 'tensions.md');
const BUSY_THRESHOLD = Number(process.env.PIKO_CONTEXT_BUSY_THRESHOLD) || 3;
const MIN_TENSIONS = 1;

function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.resolve();
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ statusCode: res.statusCode })); }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function readTensions() {
  if (!fs.existsSync(TENSIONS_FILE)) return [];
  const raw = fs.readFileSync(TENSIONS_FILE, 'utf8');
  return raw.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#') && !l.toLowerCase().startsWith('- max ')).map((l) => l.slice(2).trim());
}

function getTodayEvents() {
  try {
    if (!fs.existsSync(CALENDAR_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
    const events = Array.isArray(data.events) ? data.events : [];
    const today = new Date().toISOString().slice(0, 10);
    return events.filter((e) => (e.start || '').toString().slice(0, 10) === today);
  } catch (_) {
    return [];
  }
}

function findFirstFree30Min(todayEvents) {
  const withStart = todayEvents
    .map((e) => ({ start: e.start ? new Date(e.start).getTime() : 0, end: e.end ? new Date(e.end).getTime() : (e.start ? new Date(e.start).getTime() + 3600000 : 0) }))
    .filter((e) => e.start > 0)
    .sort((a, b) => a.start - b.start);
  const dayStart = new Date();
  dayStart.setHours(9, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(18, 0, 0, 0);
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();
  for (let t = startMs; t < endMs; t += 30 * 60 * 1000) {
    const blockEnd = t + 30 * 60 * 1000;
    const overlaps = withStart.some((e) => e.start < blockEnd && e.end > t);
    if (!overlaps && blockEnd <= endMs) {
      return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '–' + new Date(blockEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }
  return null;
}

function main() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.log('[context-synthesis] TELEGRAM_CHAT_ID not set; skipping');
    return;
  }
  const tensions = readTensions();
  const todayEvents = getTodayEvents();
  if (todayEvents.length < BUSY_THRESHOLD || tensions.length < MIN_TENSIONS) return;
  const freeSlot = findFirstFree30Min(todayEvents);
  const firstTension = tensions[0].slice(0, 50) + (tensions[0].length > 50 ? '…' : '');
  const slotText = freeSlot ? ` Free: ${freeSlot}.` : '';
  const msg = `Busy day (${todayEvents.length} events). Tension #1: "${firstTension}" needs ~30min.${slotText}`;
  telegramSend(chatId, msg)
    .then(() => console.log('[context-synthesis] Sent'))
    .catch((e) => console.error('[context-synthesis]', e.message));
}

if (require.main === module) main();
module.exports = { main };
