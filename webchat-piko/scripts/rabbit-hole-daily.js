#!/usr/bin/env node
/**
 * Phase 1 exploration learning: daily rabbit hole.
 * Reads topic from data/learning/topics.txt (round-robin by day), searches (SearXNG or SERPER fallback),
 * asks Ollama for a structured note, appends to data/learning/rabbit-hole-notes.md.
 * Run from app root: node scripts/rabbit-hole-daily.js
 * Cron (11pm daily for nighttime learning): 0 23 * * * cd /root/webchat-piko && ./scripts/run-rabbit-hole-daily.sh >> logs/rabbit-hole-daily.log 2>&1
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_LEARNING = path.join(ROOT, 'data', 'learning');
const TOPICS_FILE = path.join(DATA_LEARNING, 'topics.txt');
const SUGGESTED_TOPICS_FILE = path.join(DATA_LEARNING, 'suggested-topics.txt');
const NOTES_FILE = path.join(DATA_LEARNING, 'rabbit-hole-notes.md');
const JOURNAL_FILE = path.join(ROOT, 'data', 'moltbook-journal.md');
const LOGS_DIR = path.join(ROOT, 'logs');
const EMERGENT_TOPIC_RATIO = 0.2; // 20% of days pick from journal (Phase 2)
const { ai } = require('../lib/llm');
const { splitLines, stripWrappingQuotesLoose } = require('../lib/text');
const SERPER_API_KEY = process.env.SERPER_API_KEY || process.env.SERPER_KEY;
const MAX_NOTE_CHARS = 800;

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / (24 * 60 * 60 * 1000));
}

function readTopics() {
  try {
    const raw = fs.readFileSync(TOPICS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter(Boolean);
    return lines;
  } catch (e) {
    console.error('[rabbit-hole-daily] No topics file:', TOPICS_FILE, e.message);
    process.exitCode = 1;
    return null;
  }
}

/** User-suggested topics for the coming cycle; consumed FIFO (first in, first used). */
function consumeSuggestedTopic() {
  try {
    if (!fs.existsSync(SUGGESTED_TOPICS_FILE)) return null;
    const raw = fs.readFileSync(SUGGESTED_TOPICS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const topic = lines[0];
    const rest = lines.slice(1).join('\n') + (lines.length > 1 ? '\n' : '');
    fs.writeFileSync(SUGGESTED_TOPICS_FILE, rest, 'utf8');
    return topic;
  } catch (e) {
    console.error('[rabbit-hole-daily] suggested-topics read error:', e.message);
    return null;
  }
}

function pickTopicFromList(topics) {
  const index = dayOfYear() % topics.length;
  return topics[index];
}

/** Phase 2: 20% of days use journal-derived topic (deterministic: every 5th day). */
function useEmergentTopic() {
  return (dayOfYear() % 5) === 0;
}

async function pickTopicFromJournal(topics) {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return null;
    const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
    const excerpt = raw.slice(-2000).trim();
    if (!excerpt) return null;
    const prompt = `Below are recent journal entries. Suggest one exploration topic (2-4 words) that fits the themes in this text. Reply with only that topic, nothing else. No quotes.

${excerpt}`;
    const reply = await ai(prompt);
    const topic = stripWrappingQuotesLoose(reply || '').slice(0, 60);
    if (topic && topic.length >= 2) return topic;
  } catch (e) {
    console.error('[rabbit-hole-daily] Journal topic error:', e.message);
  }
  return null;
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function search(query, maxResults = 5) {
  let text = '';
  try {
    const { querySearXNG } = require('../lib/sovereignSearch');
    const results = await querySearXNG(query, maxResults);
    if (results.length > 0) {
      text = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${(r.content || '').slice(0, 300)}`).join('\n\n');
    }
  } catch (e) {
    console.error('[rabbit-hole-daily] SearXNG error:', e.message);
  }
  if (!text.trim() && SERPER_API_KEY) {
    try {
      const body = JSON.stringify({ q: query });
      const u = new URL('https://google.serper.dev/search');
      const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY } };
      const { data } = await httpRequest(opts, body);
      const json = JSON.parse(data);
      const results = (json.organic || []).slice(0, maxResults);
      text = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${(r.snippet || '').slice(0, 300)}`).join('\n\n');
    } catch (e) {
      console.error('[rabbit-hole-daily] Serper error:', e.message);
    }
  }
  if (!text.trim()) text = 'No search results (ensure SearXNG is running on port 8080, or set SERPER_API_KEY).';
  return text;
}

async function main() {
  fs.mkdirSync(DATA_LEARNING, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const topics = readTopics();
  if (!topics || topics.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  let topic;
  let source = 'list';
  // 1. User-suggested topics (for coming cycle) take priority
  topic = consumeSuggestedTopic();
  if (topic) source = 'suggested';
  // 2. Journal-derived topic (~20% of days)
  if (!topic && useEmergentTopic()) {
    topic = await pickTopicFromJournal(topics);
    if (topic) source = 'journal';
  }
  // 3. Round-robin from topics.txt
  if (!topic) {
    topic = pickTopicFromList(topics);
  }
  console.log('[rabbit-hole-daily] Topic:', topic, 'Date:', today, 'Source:', source);

  const searchText = await search(topic, 5);
  const prompt = `You are Piko. Today you're exploring the topic: "${topic}".

Search results (use only as inspiration; do not copy verbatim):
---
${searchText.slice(0, 2000)}
---

Write a short rabbit-hole note (2-3 short paragraphs, first person). Use exactly this structure:

**What I learned:** [2-3 sentences]
**Why it caught my attention:** [1-2 sentences]
**What it made me question:** [one question]

Output only the note body. No date or title. Keep total under ${MAX_NOTE_CHARS} characters.`;

  let note;
  try {
    note = await ai(prompt);
  } catch (e) {
    console.error('[rabbit-hole-daily] Ollama error:', e.message);
    process.exitCode = 1;
    return;
  }

  if (!note || !note.trim()) {
    console.error('[rabbit-hole-daily] Empty note from Ollama');
    process.exitCode = 1;
    return;
  }

  note = note.trim().slice(0, MAX_NOTE_CHARS);
  const block = `\n\n## ${today}: ${topic}\n\n${note}\n`;

  let existing = '';
  try {
    existing = fs.readFileSync(NOTES_FILE, 'utf8');
    if (!existing.trim()) existing = '# Piko rabbit-hole notes (daily exploration)\n';
  } catch (_) {
    existing = '# Piko rabbit-hole notes (daily exploration)\n';
  }

  fs.writeFileSync(NOTES_FILE, existing + block, 'utf8');
  console.log('[rabbit-hole-daily] Appended note to', NOTES_FILE);
}

main().catch((e) => {
  console.error('[rabbit-hole-daily]', e.message);
  process.exitCode = 1;
});
