#!/usr/bin/env node
/**
 * EA Phase 1+2: Look-in on calendar, intents, pending notifications, Gmail. Rule-based.
 * Phase 3: PIKO_EA_USE_LLM_SYNTHESIS=1 — use LLM to synthesize "what needs attention?"; fallback to rule-based on failure.
 * Phase 4: Respect quiet hours from data/ea-preferences.json (quietStart, quietEnd); skip sending during window.
 * Sends one Telegram message "🔔 Look-in: • ..." when there's something to say.
 * Run on cron (e.g. every 30 min). Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 * Phase 2: Set GMAIL_ACCESS_TOKEN or GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET for unread alert. Optional: PIKO_EA_GMAIL_MIN_UNREAD=5.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const {
  stripTrailingSlash,
  parseHhMm,
  stripAngleBrackets,
  replaceAllLiteral,
  stripHtmlTags,
  splitLines,
  stripListPrefixLoose,
  collapseNewlinesToSpace,
  toLowerAsciiish,
} = require('../lib/text');

const ROOT = path.resolve(__dirname, '..');
const USE_LLM_SYNTHESIS = process.env.PIKO_EA_USE_LLM_SYNTHESIS === '1' || process.env.PIKO_EA_USE_LLM_SYNTHESIS === 'true';
const USE_PREP_MEETING = process.env.PIKO_EA_PREP_MEETING === '1' || process.env.PIKO_EA_PREP_MEETING === 'true';
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending-notifications.txt');
const CALENDAR_SNAPSHOT = path.join(DATA_DIR, 'calendar-snapshot.json');
const EA_ALERTS_FILE = path.join(DATA_DIR, 'ea-alerts.json');
const EA_PREFERENCES_FILE = path.join(DATA_DIR, 'ea-preferences.json');

const WINDOW_REMINDER_MS = 15 * 60 * 1000;   // reminder due in next 15 min
const WINDOW_CALENDAR_MS = 30 * 60 * 1000;   // event starting in next 30 min
const MAX_BULLETS = 4;
const GMAIL_MIN_UNREAD = Math.max(0, parseInt(process.env.PIKO_EA_GMAIL_MIN_UNREAD || '1', 10));
const GMAIL_READ_BODY = process.env.PIKO_EA_GMAIL_READ_BODY === '1' || process.env.PIKO_EA_GMAIL_READ_BODY === 'true';

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (!token) return Promise.resolve({ ok: false });
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

const http = require('http');
/** Send same look-in message to iMessage via BlueBubbles (Phase 4 optional). */
function sendToiMessage(chatGuid, text) {
  const baseUrl = stripTrailingSlash(process.env.BLUEBUBBLES_URL || '');
  const apiKey = process.env.BLUEBUBBLES_API_KEY;
  if (!baseUrl || !apiKey || !chatGuid) return Promise.resolve({ ok: false });
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + '/api/v1/message/send');
    const body = JSON.stringify({ chatGuid, message: String(text).slice(0, 4096) });
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ statusCode: res.statusCode })); }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function loadIntents() {
  try {
    if (!fs.existsSync(INTENTS_FILE)) return [];
    const raw = fs.readFileSync(INTENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function getNextCalendarAlert() {
  const sum = getCalendarSummary();
  return sum ? sum.alertLine : null;
}

/** Phase 5: Richer calendar. Returns { alertLine, nextEvent } or null. alertLine can be "Meeting in 15 min: X. Attendees: A, B" or "No meetings until 14:00". */
function getCalendarSummary() {
  try {
    if (!fs.existsSync(CALENDAR_SNAPSHOT)) return null;
    const data = JSON.parse(fs.readFileSync(CALENDAR_SNAPSHOT, 'utf8'));
    const events = Array.isArray(data.events) ? data.events : [];
    const now = Date.now();
    const end = now + WINDOW_CALENDAR_MS;
    let nextInWindow = null;
    let firstAfter = null;
    for (const e of events) {
      const start = e.start ? new Date(e.start).getTime() : 0;
      if (start < now) continue;
      if (start <= end) {
        if (!nextInWindow) nextInWindow = e;
      } else if (!firstAfter) firstAfter = e;
    }
    if (nextInWindow) {
      const start = nextInWindow.start ? new Date(nextInWindow.start).getTime() : 0;
      const mins = Math.round((start - now) / 60000);
      const title = (nextInWindow.title || nextInWindow.summary || 'Event').slice(0, 50);
      let line = mins <= 0 ? `Meeting now: ${title}` : `Meeting in ${mins} min: ${title}`;
      const attendees = nextInWindow.attendees || nextInWindow.attendeeNames;
      const names = Array.isArray(attendees)
        ? attendees.map((a) => (typeof a === 'string' ? a : (a.displayName || a.email || a.name || '')).trim()).filter(Boolean).slice(0, 5)
        : [];
      if (names.length) line += '. Attendees: ' + names.join(', ');
      return { alertLine: line, nextEvent: nextInWindow };
    }
    if (firstAfter && firstAfter.start) {
      const t = new Date(firstAfter.start);
      const until = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { alertLine: `No meetings until ${until}`, nextEvent: null };
    }
    return { alertLine: 'No meetings scheduled', nextEvent: null };
  } catch (_) {}
  return null;
}

/** Events for a given day (0=today, 1=tomorrow). Returns string like "9:00 X; 14:00 Y" or "No events". */
function getCalendarForDay(dayOffset) {
  try {
    if (!fs.existsSync(CALENDAR_SNAPSHOT)) return 'No calendar data';
    const data = JSON.parse(fs.readFileSync(CALENDAR_SNAPSHOT, 'utf8'));
    const events = Array.isArray(data.events) ? data.events : [];
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const dayStr = d.toISOString().slice(0, 10);
    const dayEvents = events
      .filter((e) => (e.start || '').toString().slice(0, 10) === dayStr)
      .map((e) => {
        const t = e.start ? new Date(e.start) : null;
        const time = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?';
        const title = (e.title || e.summary || 'Event').slice(0, 40);
        return time + ' ' + title;
      })
      .sort();
    return dayEvents.length ? dayEvents.join('; ') : 'No events';
  } catch (_) {
    return 'No calendar data';
  }
}

function getReminderAlerts() {
  const intents = loadIntents();
  const now = new Date();
  const dueEnd = new Date(now.getTime() + WINDOW_REMINDER_MS);
  const alerts = [];
  for (const i of intents) {
    if (i.type !== 'reminder' || (i.status && i.status !== 'pending')) continue;
    if (i.snoozedUntil && new Date(i.snoozedUntil) > now) continue;
    const dueAt = i.dueAt || i.time || i.run;
    if (!dueAt) continue;
    const d = new Date(dueAt);
    if (d > dueEnd) continue;
    const text = (i.title || i.message || i.text || 'Reminder').slice(0, 60);
    alerts.push(d <= now ? `Reminder: ${text}` : `Reminder in ${Math.round((d - now) / 60000)} min: ${text}`);
  }
  return alerts.slice(0, 2);
}

function getPendingNotifications() {
  try {
    if (!fs.existsSync(PENDING_FILE)) return [];
    const raw = fs.readFileSync(PENDING_FILE, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines;
  } catch (_) {
    return [];
  }
}

function clearPendingNotifications() {
  try {
    fs.writeFileSync(PENDING_FILE, '', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/** Parse "HH:MM" or "H:MM" to minutes since midnight; return null if invalid. */
function parseTimeToMinutes(str) {
  if (!str || typeof str !== 'string') return null;
  const parsed = parseHhMm(str.trim());
  if (!parsed) return null;
  return parsed.h * 60 + parsed.m;
}

/** Phase 4: true if current time is inside quiet window (e.g. 22:00–07:00). Uses server local time. */
function isInQuietHours() {
  try {
    if (!fs.existsSync(EA_PREFERENCES_FILE)) return false;
    const raw = fs.readFileSync(EA_PREFERENCES_FILE, 'utf8');
    const prefs = JSON.parse(raw);
    const start = parseTimeToMinutes(prefs.quietStart);
    const end = parseTimeToMinutes(prefs.quietEnd);
    if (start == null && end == null) return false;
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    if (start != null && end != null) {
      if (start > end) return nowM >= start || nowM < end;
      return nowM >= start && nowM < end;
    }
    if (start != null) return nowM >= start;
    return nowM < end;
  } catch (_) {
    return false;
  }
}

function appendEaAlert(text) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let list = [];
    if (fs.existsSync(EA_ALERTS_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(EA_ALERTS_FILE, 'utf8'));
      } catch (_) {}
    }
    if (!Array.isArray(list)) list = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    list = list.filter((a) => (a.at || 0) > cutoff);
    list.push({ at: Date.now(), text });
    fs.writeFileSync(EA_ALERTS_FILE, JSON.stringify(list.slice(-50), null, 2), 'utf8');
  } catch (_) {}
}

/** Phase 2: Gmail unread. Returns one bullet string or null. */
async function getGmailUnreadAlert() {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!token && !(refreshToken && clientId && clientSecret)) return null;

  let accessToken = token;
  if (!accessToken && refreshToken) {
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString();
      const opts = { hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
      const { statusCode, data } = await httpsRequest(opts, body);
      if (statusCode !== 200) return null;
      const json = JSON.parse(data);
      accessToken = json.access_token;
    } catch (_) {
      return null;
    }
  }
  if (!accessToken) return null;

  try {
    const listOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages?maxResults=10&q=is:unread', method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken } };
    const { statusCode, data: listData } = await httpsRequest(listOpts);
    if (statusCode !== 200) return null;
    const list = JSON.parse(listData);
    const messages = list.messages || [];
    const count = messages.length;
    if (count < GMAIL_MIN_UNREAD) return null;

    let suggestion = '';
    const ids = messages.slice(0, 2);
    for (const m of ids) {
      const msgOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From', method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken } };
      const { data: msgData } = await httpsRequest(msgOpts);
      const msg = JSON.parse(msgData);
      const headers = (msg.payload && msg.payload.headers) || [];
      const subj = (headers.find((h) => h.name === 'Subject') || {}).value || '(no subject)';
      const from = (headers.find((h) => h.name === 'From') || {}).value || '';
      const fromShort = stripAngleBrackets(from).trim().slice(0, 30);
      if (suggestion) suggestion += '; ';
      suggestion += `"${subj.slice(0, 40)}" from ${fromShort}`;
    }
    if (count === 0) return null;
    return suggestion ? `${count} unread. Possible reply: ${suggestion}` : `${count} unread.`;
  } catch (_) {
    return null;
  }
}

function decodeBase64Url(data) {
  const b64 = replaceAllLiteral(replaceAllLiteral(data, '-', '+'), '_', '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Decode Gmail message body from payload (base64url). Returns plain text snippet. */
function decodeBody(payload) {
  if (!payload) return '';
  let text = '';
  if (payload.body && payload.body.data) {
    try {
      text = decodeBase64Url(payload.body.data);
    } catch (_) {}
  }
  if (!text && payload.parts && Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body && p.body.data) {
        try {
          text = decodeBase64Url(p.body.data);
          break;
        } catch (_) {}
      }
    }
    if (!text && payload.parts.length) {
      const p = payload.parts.find((x) => x.body && x.body.data);
      if (p) try { text = decodeBase64Url(p.body.data); } catch (_) {}
    }
  }
  return stripHtmlTags(text || '').slice(0, 400);
}

/** Phase 2 extended: when PIKO_EA_GMAIL_READ_BODY=1, fetch body snippets and return string for LLM (find what is important). */
async function getGmailUnreadEnriched() {
  if (!GMAIL_READ_BODY) return null;
  const token = process.env.GMAIL_ACCESS_TOKEN;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!token && !(refreshToken && clientId && clientSecret)) return null;
  let accessToken = token;
  if (!accessToken && refreshToken) {
    try {
      const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString();
      const opts = { hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
      const { statusCode, data } = await httpsRequest(opts, body);
      if (statusCode !== 200) return null;
      accessToken = JSON.parse(data).access_token;
    } catch (_) { return null; }
  }
  if (!accessToken) return null;
  try {
    const listOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages?maxResults=5&q=is:unread', method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken } };
    const { statusCode, data: listData } = await httpsRequest(listOpts);
    if (statusCode !== 200) return null;
    const list = JSON.parse(listData);
    const messages = list.messages || [];
    if (messages.length < GMAIL_MIN_UNREAD) return null;
    const lines = [];
    for (let i = 0; i < Math.min(3, messages.length); i++) {
      const m = messages[i];
      const msgOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages/' + m.id + '?format=full', method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken } };
      const { data: msgData } = await httpsRequest(msgOpts);
      const msg = JSON.parse(msgData);
      const headers = (msg.payload && msg.payload.headers) || [];
      const subj = (headers.find((h) => h.name === 'Subject') || {}).value || '(no subject)';
      const from = (headers.find((h) => h.name === 'From') || {}).value || '';
      const fromShort = stripAngleBrackets(from).trim().slice(0, 40);
      const snippet = decodeBody(msg.payload);
      lines.push(`${i + 1}. Subject: ${subj.slice(0, 60)}\n   From: ${fromShort}\n   Snippet: ${snippet || '(no body)'}`);
    }
    return `Unread (${messages.length}):\n` + lines.join('\n\n');
  } catch (_) {
    return null;
  }
}

function buildContextString(cal, reminders, pending, gmailLine, calendarToday, calendarTomorrow) {
  const parts = [];
  if (cal) parts.push('Calendar (next 30 min): ' + cal);
  if (calendarToday != null) parts.push('Calendar today: ' + calendarToday);
  if (calendarTomorrow != null) parts.push('Calendar tomorrow: ' + calendarTomorrow);
  if (reminders.length) parts.push('Reminders (next 15 min): ' + reminders.join('; '));
  if (pending.length) parts.push('Pending notifications: ' + pending.join('; '));
  if (gmailLine) parts.push('Gmail: ' + gmailLine);
  return parts.length ? parts.join('\n') : 'No calendar, reminders, pending, or Gmail items.';
}

/** Phase 3: Ask LLM for 0–3 alert lines. Returns array of lines, or [] if NONE/nothing, or null on failure. */
async function synthesizeWithLlm(contextStr) {
  let ai;
  try {
    ai = require(path.join(ROOT, 'lib', 'llm.js')).ai;
  } catch (e) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.error('[ea-lookin] LLM require', e.message);
    return null;
  }
  const prompt = `You are an executive assistant. Given this context about the person's calendar, reminders, pending notifications, and email, list 0–3 things they should be alerted to right now. One short line per item. If nothing needs attention, output exactly: NONE.

Important: Check if the person may have double-booked or made plans (in reminders or pending) for a day they already have a meeting. If so, alert them (e.g. "Possible conflict: you have X on your calendar and a reminder for Y that day").

Context:
${contextStr}`;
  try {
    const out = await ai(prompt, { temperature: 0.3, max_tokens: 300 });
    const trimmed = (out && String(out).trim()) || '';
    if (toLowerAsciiish(trimmed) === 'none') return [];
    const lines = splitLines(trimmed).map((l) => stripListPrefixLoose(l)).filter(Boolean);
    return lines.slice(0, MAX_BULLETS);
  } catch (e) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.error('[ea-lookin] LLM', e.message);
    return null;
  }
}

/** Phase 5: Optional prep for next meeting. Returns one bullet line or null. */
async function getMeetingPrepBullet(nextEvent) {
  if (!nextEvent || !USE_PREP_MEETING) return null;
  let ai;
  try {
    ai = require(path.join(ROOT, 'lib', 'llm.js')).ai;
  } catch (_) {
    return null;
  }
  const title = (nextEvent.title || nextEvent.summary || 'Meeting').slice(0, 80);
  const attendees = nextEvent.attendees || nextEvent.attendeeNames || [];
  const names = Array.isArray(attendees) ? attendees.map((a) => (typeof a === 'string' ? a : (a.displayName || a.email || a.name || '')).trim()).filter(Boolean).join(', ') : '';
  const prompt = `Next meeting: "${title}"${names ? '. Attendees: ' + names : ''}. Suggest 2–3 short talking points (one line total, semicolon-separated). No preamble.`;
  try {
    const out = await ai(prompt, { temperature: 0.4, max_tokens: 150 });
    const line = (out && String(out).trim()) || '';
    if (!line) return null;
    return 'Prep: ' + collapseNewlinesToSpace(line).slice(0, 120);
  } catch (_) {
    return null;
  }
}

async function main() {
  const calSum = getCalendarSummary();
  const cal = calSum ? calSum.alertLine : null;
  const reminders = getReminderAlerts();
  const pending = getPendingNotifications();
  const gmail = await getGmailUnreadAlert();

  const ruleBased = [];
  if (cal) ruleBased.push(cal);
  const prepLine = USE_PREP_MEETING && calSum && calSum.nextEvent ? await getMeetingPrepBullet(calSum.nextEvent) : null;
  if (prepLine) ruleBased.push(prepLine);
  for (const r of reminders) ruleBased.push(r);
  if (pending.length > 0) {
    ruleBased.push(pending[0]);
    if (pending.length > 1) ruleBased.push(`+ ${pending.length - 1} more in pending`);
  }
  if (gmail) ruleBased.push(gmail);
  const ruleBasedFinal = ruleBased.slice(0, MAX_BULLETS);

  let final = ruleBasedFinal;
  if (USE_LLM_SYNTHESIS) {
    const calendarToday = getCalendarForDay(0);
    const calendarTomorrow = getCalendarForDay(1);
    const gmailForContext = (await getGmailUnreadEnriched()) || gmail;
    const contextStr = buildContextString(cal, reminders, pending, gmailForContext, calendarToday, calendarTomorrow);
    const llmBullets = await synthesizeWithLlm(contextStr);
    if (llmBullets !== null) {
      final = llmBullets;
    }
  }

  if (final.length === 0) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.log('[ea-lookin] Nothing to report');
    return;
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.log('[ea-lookin] TELEGRAM_CHAT_ID not set');
    return;
  }

  if (isInQuietHours()) {
    if (process.env.PIKO_EA_LOOKIN_DEBUG) console.log('[ea-lookin] Quiet hours — skipping send');
    return;
  }

  if (pending.length > 0) clearPendingNotifications();

  const message = '🔔 Look-in:\n• ' + final.join('\n• ');
  const imessageGuid = process.env.PIKO_EA_IMESSAGE_CHAT_GUID || '';
  telegramSend(chatId, message)
    .then((res) => {
      if (res.statusCode === 200) {
        appendEaAlert(message);
        console.log('[ea-lookin] Sent', final.length, 'item(s)');
        if (imessageGuid.trim()) {
          sendToiMessage(imessageGuid.trim(), message)
            .then((r) => { if (r.statusCode === 200) console.log('[ea-lookin] iMessage sent'); else console.error('[ea-lookin] iMessage', r.statusCode); })
            .catch((e) => console.error('[ea-lookin] iMessage', e.message));
        }
      } else {
        console.error('[ea-lookin] Telegram', res.statusCode);
      }
    })
    .catch((e) => console.error('[ea-lookin]', e.message));
}

main().catch((e) => console.error('[ea-lookin]', e.message));
