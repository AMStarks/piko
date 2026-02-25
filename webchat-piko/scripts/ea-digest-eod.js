#!/usr/bin/env node
/**
 * Phase 5: End-of-day digest. Run on cron (e.g. 18:00). Sends one Telegram message:
 * Yesterday's summary (daily memory), look-in alerts count today, next reminder.
 * Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Optional: PIKO_EA_EOD_SESSION=main for daily memory session.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const EA_ALERTS_FILE = path.join(DATA_DIR, 'ea-alerts.json');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');
const EOD_SESSION = process.env.PIKO_EA_EOD_SESSION || 'main';

function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.resolve({ statusCode: 0 });
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

function getYesterdaySummary() {
  try {
    const dm = require(path.join(ROOT, 'lib', 'dailyMemory.js'));
    const summaries = dm.getSummaries(EOD_SESSION, 3);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const row = summaries.find((s) => s.date === yesterdayStr);
    return row ? row.summary_text : null;
  } catch (_) {
    return null;
  }
}

function getTodayAlertsCount() {
  try {
    if (!fs.existsSync(EA_ALERTS_FILE)) return 0;
    const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoff = todayStart.getTime();
    return list.filter((a) => (a.at || 0) >= cutoff).length;
  } catch (_) {
    return 0;
  }
}

function getNextReminder() {
  try {
    const raw = fs.readFileSync(INTENTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    const now = new Date();
    const reminders = (Array.isArray(arr) ? arr : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
    const dueAt = (r) => r.dueAt || r.time;
    const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
    if (next) return (next.title || next.message || next.text || '').slice(0, 80);
  } catch (_) {}
  return null;
}

async function main() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.log('[ea-digest-eod] TELEGRAM_CHAT_ID not set');
    return;
  }

  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const summary = getYesterdaySummary();
  const alertsToday = getTodayAlertsCount();
  const nextRem = getNextReminder();

  const parts = ['📋 End of day.'];
  if (summary) parts.push(`Yesterday (${yesterdayStr}): ${summary.slice(0, 400)}${summary.length > 400 ? '…' : ''}`);
  parts.push(`Look-in alerts today: ${alertsToday}`);
  if (nextRem) parts.push(`Next reminder: ${nextRem}`);

  const message = parts.join('\n\n');
  const res = await telegramSend(chatId, message);
  if (res.statusCode === 200) console.log('[ea-digest-eod] Sent');
  else console.error('[ea-digest-eod] Telegram', res.statusCode);
}

main().catch((e) => console.error('[ea-digest-eod]', e.message));
