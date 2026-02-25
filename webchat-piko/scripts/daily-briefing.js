#!/usr/bin/env node
/**
 * Daily briefing — run at 6 AM (cron). Sends one Telegram message:
 * "Good morning. Here's your day: [meetings/events], Learning: [tension or sticky], Moltbook: [last post], Action: [next reminder]. [Quick replies]"
 * Uses: data/learning/tensions.md, sticky-ideas.md, data/intents.json, data/moltbook-state.json.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');
const TENSIONS_FILE = path.join(LEARNING_DIR, 'tensions.md');
const STICKY_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const MOLTBOOK_STATE = path.join(DATA_DIR, 'moltbook-state.json');
const CALENDAR_SNAPSHOT = path.join(DATA_DIR, 'calendar-snapshot.json');

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

function readLinesFromFile(filePath, bulletOnly = true) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!bulletOnly) return lines;
  return lines.filter((l) => l.startsWith('- ') && !l.startsWith('#') && !l.toLowerCase().startsWith('- max ')).map((l) => l.slice(2).trim());
}

function getNextReminder() {
  try {
    const raw = fs.readFileSync(INTENTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    const now = new Date();
    const reminders = (Array.isArray(arr) ? arr : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
    const dueAt = (r) => r.dueAt || r.time;
    const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
    if (next) return (next.title || next.message || next.text || '').slice(0, 60);
  } catch (_) {}
  return null;
}

function getMoltbookLast() {
  try {
    if (!fs.existsSync(MOLTBOOK_STATE)) return null;
    const raw = fs.readFileSync(MOLTBOOK_STATE, 'utf8');
    const data = JSON.parse(raw);
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const last = posts[0];
    if (!last) return null;
    const up = last.upvotes != null ? last.upvotes : 0;
    const title = (last.title || 'Post').slice(0, 40);
    return { title, upvotes: up };
  } catch (_) {}
  return null;
}

function getCalendarContext() {
  try {
    if (!fs.existsSync(CALENDAR_SNAPSHOT)) return null;
    const data = JSON.parse(fs.readFileSync(CALENDAR_SNAPSHOT, 'utf8'));
    const events = Array.isArray(data.events) ? data.events : [];
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = events.filter((e) => (e.start || '').toString().slice(0, 10) === today);
    if (todayEvents.length === 0) return null;
    const withStart = todayEvents.map((e) => ({ start: e.start ? new Date(e.start).getTime() : 0, end: e.end ? new Date(e.end).getTime() : 0 })).filter((e) => e.start > 0).sort((a, b) => a.start - b.start);
    const dayStart = new Date().setHours(9, 0, 0, 0);
    const dayEnd = new Date().setHours(18, 0, 0, 0);
    for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000) {
      const blockEnd = t + 30 * 60 * 1000;
      const overlaps = withStart.some((e) => (e.start < blockEnd && (e.end || e.start + 3600000) > t));
      if (!overlaps && blockEnd <= dayEnd) {
        const slot = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '–' + new Date(blockEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return { eventCount: todayEvents.length, firstFreeSlot: slot };
      }
    }
    return { eventCount: todayEvents.length, firstFreeSlot: null };
  } catch (_) {}
  return null;
}

function buildBriefing() {
  const tensions = readLinesFromFile(TENSIONS_FILE);
  const sticky = readLinesFromFile(STICKY_FILE);
  const nextRem = getNextReminder();
  const molt = getMoltbookLast();
  const cal = getCalendarContext();

  const parts = ['Good morning. Here\'s your day:\n'];
  if (cal && cal.eventCount > 0) {
    parts.push('• Calendar: ' + cal.eventCount + ' event(s) today.' + (cal.firstFreeSlot ? ' Free: ' + cal.firstFreeSlot + '.' : ''));
  }
  if (tensions.length > 0) parts.push('• Learning: Tension — ' + (tensions[0].slice(0, 50) + (tensions[0].length > 50 ? '…' : '')));
  else if (sticky.length > 0) parts.push('• Learning: Sticky idea — ' + (sticky[0].slice(0, 50) + (sticky[0].length > 50 ? '…' : '')));
  else parts.push('• Learning: No open tensions or stickies.');
  if (molt) parts.push('• Moltbook: Last post "' + molt.title + '" — ' + molt.upvotes + ' upvote(s).');
  if (nextRem) parts.push('• Action: ' + nextRem);
  parts.push('\n[Reply in chat for prep summaries or to tweak the plan.]');
  return parts.join('\n');
}

function main() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.log('[daily-briefing] TELEGRAM_CHAT_ID not set; skipping');
    return;
  }
  const text = buildBriefing();
  telegramSend(chatId, text)
    .then(() => console.log('[daily-briefing] Sent'))
    .catch((e) => console.error('[daily-briefing]', e.message));
}

main();
