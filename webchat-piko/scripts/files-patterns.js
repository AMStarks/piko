#!/usr/bin/env node
/**
 * Files pattern detector — run daily (cron). Scans data/learning/notes-capture.md for:
 * - PDF count this week → "Weekly research pattern: N PDFs this week" + suggest sticky
 * - Agent/theme mentions → suggest rabbit-hole topics or add to topics.txt
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to send.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const {
  splitMarkdownDateSections,
  parseMarkdownDateH2,
  countOccurrencesIgnoreCase,
  toLowerAsciiish,
} = require('../lib/text');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const NOTES_CAPTURE = path.join(LEARNING_DIR, 'notes-capture.md');
const TOPICS_FILE = path.join(LEARNING_DIR, 'topics.txt');
const STICKY_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const MIN_PDFS_WEEKLY = Number(process.env.PIKO_FILES_MIN_PDFS_WEEKLY) || 3;
const MIN_AGENT_MENTIONS = Number(process.env.PIKO_FILES_MIN_AGENT_MENTIONS) || 5;

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

function getSectionsThisWeek(raw) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sections = splitMarkdownDateSections(raw);
  const out = [];
  for (const block of sections) {
    const dateStr = parseMarkdownDateH2(block);
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (d >= weekAgo && d <= now) out.push(block);
  }
  return out.join('\n');
}

function countAgentThemeMentions(text) {
  const low = toLowerAsciiish(text);
  let n = 0;
  // Approximate prior /\bagent\b|coordination|distributed\b/gi global match count
  let from = 0;
  while (from < low.length) {
    const a = low.indexOf('agent', from);
    const c = low.indexOf('coordination', from);
    const d = low.indexOf('distributed', from);
    let next = -1;
    let kind = '';
    if (a >= 0 && (next < 0 || a < next)) { next = a; kind = 'agent'; }
    if (c >= 0 && (next < 0 || c < next)) { next = c; kind = 'coordination'; }
    if (d >= 0 && (next < 0 || d < next)) { next = d; kind = 'distributed'; }
    if (next < 0) break;
    if (kind === 'agent') {
      const before = next === 0 ? ' ' : low[next - 1];
      const after = next + 5 >= low.length ? ' ' : low[next + 5];
      const beforeOk = !(before >= 'a' && before <= 'z') && !(before >= '0' && before <= '9');
      const afterOk = !(after >= 'a' && after <= 'z') && !(after >= '0' && after <= '9');
      if (beforeOk && afterOk) n += 1;
      from = next + 5;
    } else if (kind === 'coordination') {
      n += 1;
      from = next + 'coordination'.length;
    } else {
      const before = next === 0 ? ' ' : low[next - 1];
      const after = next + 'distributed'.length >= low.length ? ' ' : low[next + 'distributed'.length];
      const beforeOk = !(before >= 'a' && before <= 'z') && !(before >= '0' && before <= '9');
      const afterOk = !(after >= 'a' && after <= 'z') && !(after >= '0' && after <= '9');
      if (beforeOk && afterOk) n += 1;
      from = next + 'distributed'.length;
    }
  }
  return n;
}

function main() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.log('[files-patterns] TELEGRAM_CHAT_ID not set; skipping');
    return;
  }
  if (!fs.existsSync(NOTES_CAPTURE)) {
    console.log('[files-patterns] No notes-capture.md');
    return;
  }
  const raw = fs.readFileSync(NOTES_CAPTURE, 'utf8');
  const thisWeek = getSectionsThisWeek(raw);
  const pdfCount = countOccurrencesIgnoreCase(thisWeek, '.pdf');
  const agentMentions = countAgentThemeMentions(thisWeek);

  const promises = [];

  if (pdfCount >= MIN_PDFS_WEEKLY) {
    const msg = `Weekly research pattern: ${pdfCount} PDF(s) captured this week. Add "Weekly deep dives" as a sticky idea?`;
    promises.push(telegramSend(chatId, msg).then(() => console.log('[files-patterns] PDF pattern nudge sent')));
  }

  if (agentMentions >= MIN_AGENT_MENTIONS) {
    const msg = `Files/notes theme: ${agentMentions} mentions of agents/coordination this week. Want to explore "agent coordination" or "distributed systems" in rabbit-hole?`;
    promises.push(telegramSend(chatId, msg).then(() => console.log('[files-patterns] Theme nudge sent')));
    try {
      const existing = fs.existsSync(TOPICS_FILE) ? fs.readFileSync(TOPICS_FILE, 'utf8') : '';
      const toAdd = ['agent coordination', 'distributed systems'].filter((t) => !existing.toLowerCase().includes(t));
      if (toAdd.length > 0) {
        fs.mkdirSync(LEARNING_DIR, { recursive: true });
        fs.appendFileSync(TOPICS_FILE, (existing.trim() ? '\n' : '') + toAdd.join('\n') + '\n', 'utf8');
        console.log('[files-patterns] Added topics:', toAdd.join(', '));
      }
    } catch (e) {
      console.error('[files-patterns] topics.txt append failed:', e.message);
    }
  }

  Promise.all(promises).catch((e) => console.error('[files-patterns]', e.message));
}

main();
