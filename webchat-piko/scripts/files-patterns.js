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
  const sections = raw.split(/\n(?=##\s+\d{4}-\d{2}-\d{2})/);
  const out = [];
  for (const block of sections) {
    const dateMatch = block.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const d = new Date(dateMatch[1]);
    if (d >= weekAgo && d <= now) out.push(block);
  }
  return out.join('\n');
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
  const pdfCount = (thisWeek.match(/\.pdf/gi) || []).length;
  const agentMentions = (thisWeek.match(/\bagent\b|coordination|distributed\b/gi) || []).length;

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
