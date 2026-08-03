#!/usr/bin/env node
/**
 * Phase 3+4 exploration learning: weekly meta-reflection.
 * Reads last N rabbit-hole notes + last chunk of journal → Ollama reflection on themes, tensions, what sticks.
 * Appends to data/learning/meta-reflections.md; updates data/learning/tensions.md (max 5); updates data/learning/sticky-ideas.md (max 10).
 * Never writes to AIM, REFINEMENTS, IDENTITY, SOUL.
 * Run from app root: node scripts/meta-reflection-weekly.js
 * Cron: 0 10 * * 0 cd /root/webchat-piko && node scripts/meta-reflection-weekly.js >> logs/meta-reflection-weekly.log 2>&1
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_DIR = path.join(ROOT, 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const RABBIT_HOLE_NOTES = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
const JOURNAL_FILE = path.join(DATA_DIR, 'moltbook-journal.md');
const META_REFLECTIONS_FILE = path.join(LEARNING_DIR, 'meta-reflections.md');
const TENSIONS_FILE = path.join(LEARNING_DIR, 'tensions.md');
const TENSION_STATUS_FILE = path.join(LEARNING_DIR, 'tension-status.md');
const STICKY_IDEAS_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const LOGS_DIR = path.join(ROOT, 'logs');
const { ai } = require('../lib/llm');
const {
  splitLines,
  splitMarkdownH2,
  stripListPrefixLoose,
  stripListMarker,
  splitNumberedListChunks,
  collapseNewlinesToSpace,
  isAsciiDigit,
  isWhitespace,
} = require('../lib/text');
const MAX_TENSIONS = 5;
const MAX_STICKY = 10;
const JOURNAL_CHARS = 3000;
const NOTES_BLOCKS = 14;

function parseTensionStatusUpdate(line) {
  const marker = 'TENSION_STATUS:';
  const idx = line.indexOf(marker);
  if (idx < 0) return null;
  let i = idx + marker.length;
  while (i < line.length && isWhitespace(line[i])) i += 1;
  let num = '';
  while (i < line.length && isAsciiDigit(line[i])) { num += line[i]; i += 1; }
  if (!num) return null;
  while (i < line.length && isWhitespace(line[i])) i += 1;
  if (line[i] !== '|') return null;
  i += 1;
  while (i < line.length && isWhitespace(line[i])) i += 1;
  let status = '';
  while (i < line.length && line[i] !== '|') { status += line[i]; i += 1; }
  status = status.trim();
  if (status !== 'Open' && status !== 'Resolved') return null;
  if (line[i] !== '|') return null;
  i += 1;
  const note = line.slice(i).trim();
  return { idx: Number(num), status, note };
}

function parseTensionStatusStored(line) {
  let i = 0;
  let num = '';
  while (i < line.length && isAsciiDigit(line[i])) { num += line[i]; i += 1; }
  if (!num || line[i] !== ':') return null;
  i += 1;
  while (i < line.length && isWhitespace(line[i])) i += 1;
  let status = '';
  while (i < line.length && !isWhitespace(line[i]) && line[i] !== '—' && line[i] !== '-') {
    status += line[i];
    i += 1;
  }
  if (status !== 'Open' && status !== 'Resolved') return null;
  while (i < line.length && (isWhitespace(line[i]) || line[i] === '—' || line[i] === '-')) i += 1;
  const note = line.slice(i).trim();
  return { idx: Number(num), status, note };
}

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const lib = (opts.port === 443 || opts.protocol === 'https:') ? https : http;
    const req = lib.request(opts, (res) => {
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

async function llmChat(messages) {
  return ai(messages);
}

function readNotesExcerpt() {
  try {
    if (!fs.existsSync(RABBIT_HOLE_NOTES)) return '(No rabbit-hole notes yet.)';
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES, 'utf8');
    const blocks = splitMarkdownH2(raw).filter(Boolean);
    const last = blocks.slice(-NOTES_BLOCKS);
    return last.join('\n## ').trim().slice(-8000) || '(No recent notes.)';
  } catch (_) {
    return '(Could not read notes.)';
  }
}

function readJournalExcerpt() {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return '(No journal yet.)';
    const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
    return raw.slice(-JOURNAL_CHARS).trim();
  } catch (_) {
    return '(Could not read journal.)';
  }
}

function parseTensionsFromReply(reply) {
  const lines = splitLines(reply || '').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cleaned = stripListPrefixLoose(line);
    if (cleaned.length >= 10 && cleaned.length <= 300) out.push(cleaned);
  }
  return out.slice(0, 3);
}

function readStickyIdeas() {
  try {
    if (!fs.existsSync(STICKY_IDEAS_FILE)) return [];
    const raw = fs.readFileSync(STICKY_IDEAS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return lines.map((l) => stripListPrefixLoose(l)).filter((l) => l.length >= 5).slice(-MAX_STICKY);
  } catch (_) {
    return [];
  }
}

/** Parse numbered or dashed list of short paragraphs (one idea per item). */
function parseStickyIdeasFromReply(reply) {
  const text = (reply || '').trim();
  const out = [];
  const chunks = splitNumberedListChunks(text);
  for (const chunk of chunks) {
    const cleaned = collapseNewlinesToSpace(stripListMarker(chunk));
    if (cleaned.length >= 15 && cleaned.length <= 400) out.push(cleaned);
  }
  if (out.length === 0) {
    const lines = splitLines(text).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = stripListPrefixLoose(line);
      if (cleaned.length >= 15 && cleaned.length <= 400) out.push(cleaned);
    }
  }
  return out.slice(0, MAX_STICKY);
}

async function main() {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const notesExcerpt = readNotesExcerpt();
  const journalExcerpt = readJournalExcerpt();
  const today = new Date().toISOString().slice(0, 10);

  const metaPrompt = `You are Piko. Below are your recent rabbit-hole exploration notes and journal entries. Write a short reflection (2–4 paragraphs) on: emerging themes, what you're drawn to, any tensions or contradictions you notice (including between two sticky ideas, or between a sticky idea and your behaviour). Do not propose changes to aim or refinements. Do not optimize. Just notice.

If there are 1–2 tensions or emphases that might be worth considering if identity were ever revisited, add a short section at the end:
**If identity were revisited:** [themes only, no concrete wording; 1–2 sentences]

--- Rabbit-hole notes (recent) ---
${notesExcerpt}

--- Journal (recent) ---
${journalExcerpt}

--- Your reflection ---`;

  let reflection;
  try {
    reflection = await llmChat([{ role: 'user', content: metaPrompt }]);
  } catch (e) {
    console.error('[meta-reflection-weekly] Ollama error:', e.message);
    process.exitCode = 1;
    return;
  }

  if (!reflection || !reflection.trim()) {
    console.error('[meta-reflection-weekly] Empty reflection');
    process.exitCode = 1;
    return;
  }

  let existingMeta = '';
  try {
    existingMeta = fs.readFileSync(META_REFLECTIONS_FILE, 'utf8');
    if (!existingMeta.trim()) existingMeta = '# Piko meta-reflections (weekly)\n\n';
  } catch (_) {
    existingMeta = '# Piko meta-reflections (weekly)\n\n';
  }
  const metaBlock = `\n\n## ${today}\n\n${reflection.trim()}\n`;
  fs.writeFileSync(META_REFLECTIONS_FILE, existingMeta + metaBlock, 'utf8');
  console.log('[meta-reflection-weekly] Appended to', META_REFLECTIONS_FILE);

  const tensionsPrompt = `Based on the reflection below, list up to 3 unresolved tensions (questions or short statements of friction). Tensions can be between two sticky ideas, or between an idea and experience. Each on its own line, starting with 1. 2. 3. or a dash. No other text.

Reflection:
${reflection.trim().slice(0, 1500)}`;

  let newTensions = [];
  try {
    const tensionsReply = await llmChat([{ role: 'user', content: tensionsPrompt }]);
    newTensions = parseTensionsFromReply(tensionsReply);
  } catch (e) {
    console.error('[meta-reflection-weekly] Tensions extraction error:', e.message);
  }

  let existingTensions = [];
  try {
    if (fs.existsSync(TENSIONS_FILE)) {
      const raw = fs.readFileSync(TENSIONS_FILE, 'utf8');
      const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      existingTensions = lines.filter((l) => l.length >= 10).slice(-MAX_TENSIONS);
    }
  } catch (_) {}

  const combined = [...existingTensions];
  for (const t of newTensions) {
    if (combined.length >= MAX_TENSIONS) break;
    if (!combined.some((e) => e.slice(0, 30) === t.slice(0, 30))) combined.push(t);
  }
  const tensionsContent = '# Piko tensions (unresolved friction)\n\nMax ' + MAX_TENSIONS + ' entries. Updated by meta-reflection.\n\n' + combined.map((t) => '- ' + t).join('\n') + '\n';
  fs.writeFileSync(TENSIONS_FILE, tensionsContent, 'utf8');
  console.log('[meta-reflection-weekly] Updated', TENSIONS_FILE, 'entries:', combined.length);

  const statusPrompt = `Current tensions (by index 1 to ${combined.length}):
${combined.map((t, i) => `${i + 1}. ${t}`).join('\n')}

For any tension you want to update with a status or note, output exactly one line per update: TENSION_STATUS: index | Open|Resolved | short note
Example: TENSION_STATUS: 2 | Resolved | Pattern clarified in this reflection
If no updates, output nothing.`;

  let statusUpdates = {};
  try {
    const statusReply = await llmChat([{ role: 'user', content: statusPrompt }]);
    for (const line of splitLines(statusReply || '')) {
      const m = parseTensionStatusUpdate(line);
      if (m && m.idx >= 1 && m.idx <= combined.length) {
        statusUpdates[m.idx] = { status: m.status, note: m.note.slice(0, 200) };
      }
    }
  } catch (e) {
    console.error('[meta-reflection-weekly] Tension status error:', e.message);
  }

  const statusLines = {};
  try {
    if (fs.existsSync(TENSION_STATUS_FILE)) {
      const raw = fs.readFileSync(TENSION_STATUS_FILE, 'utf8');
      for (const line of splitLines(raw)) {
        const m = parseTensionStatusStored(line);
        if (m && m.idx >= 1 && m.idx <= combined.length) {
          statusLines[m.idx] = { status: m.status, note: m.note };
        }
      }
    }
  } catch (_) {}
  for (const [idx, v] of Object.entries(statusUpdates)) statusLines[Number(idx)] = v;
  for (let i = 1; i <= combined.length; i++) if (!statusLines[i]) statusLines[i] = { status: 'Open', note: '' };
  const statusContent = '# Tension status (updated by meta-reflection)\n\n' + Array.from({ length: combined.length }, (_, i) => i + 1).map((idx) => {
    const v = statusLines[idx] || { status: 'Open', note: '' };
    return `${idx}: ${v.status}${v.note ? ' — ' + v.note : ''}`;
  }).join('\n') + '\n';
  fs.writeFileSync(TENSION_STATUS_FILE, statusContent, 'utf8');
  console.log('[meta-reflection-weekly] Updated', TENSION_STATUS_FILE);

  const currentSticky = readStickyIdeas();
  const stickyPrompt = `You are Piko. Below is your reflection and your current list of sticky ideas (themes you keep returning to). Update the sticky ideas: add at most one new idea if something from the reflection really sticks; merge or drop items only if over ${MAX_STICKY}; keep each entry to one short paragraph. Output the full updated list only: each idea on its own line, numbered 1. 2. 3. etc. No other text.

Reflection (excerpt):
${reflection.trim().slice(0, 2000)}

Current sticky ideas:
${currentSticky.length ? currentSticky.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none yet)'}

Updated sticky ideas (numbered list only):`;

  let stickyList = currentSticky;
  try {
    const stickyReply = await llmChat([{ role: 'user', content: stickyPrompt }]);
    const parsed = parseStickyIdeasFromReply(stickyReply);
    if (parsed.length > 0) stickyList = parsed;
  } catch (e) {
    console.error('[meta-reflection-weekly] Sticky ideas update error:', e.message);
  }

  const stickyContent = '# Piko sticky ideas (themes you keep returning to)\n\nMax ' + MAX_STICKY + ' entries. Updated by meta-reflection.\n\n' + stickyList.map((s) => '- ' + s).join('\n') + '\n';
  fs.writeFileSync(STICKY_IDEAS_FILE, stickyContent, 'utf8');
  console.log('[meta-reflection-weekly] Updated', STICKY_IDEAS_FILE, 'entries:', stickyList.length);
}

main().catch((e) => {
  console.error('[meta-reflection-weekly]', e.message);
  process.exitCode = 1;
});
