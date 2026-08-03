#!/usr/bin/env node
/**
 * Monthly topic suggestions: from sticky ideas and tensions, suggest 2–3 topics for topics.txt.
 * Appends to data/learning/topic-suggestions.md. You approve and add to topics.txt manually.
 * Run from app root: node scripts/learning-topic-suggestions.js
 * Cron (e.g. 1st of month): 0 11 1 * * cd /root/webchat-piko && node scripts/learning-topic-suggestions.js >> logs/learning-topic-suggestions.log 2>&1
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const LEARNING_DIR = path.join(ROOT, 'data', 'learning');
const STICKY_IDEAS_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const TENSIONS_FILE = path.join(LEARNING_DIR, 'tensions.md');
const META_REFLECTIONS_FILE = path.join(LEARNING_DIR, 'meta-reflections.md');
const TOPIC_SUGGESTIONS_FILE = path.join(LEARNING_DIR, 'topic-suggestions.md');
const LOGS_DIR = path.join(ROOT, 'logs');
const { ai } = require('../lib/llm');
const { splitLines, splitMarkdownH2, stripListPrefixLoose, stripListMarker } = require('../lib/text');

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const lib = (opts.port === 443 || opts.protocol === 'https:') ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function readStickyIdeas() {
  try {
    if (!fs.existsSync(STICKY_IDEAS_FILE)) return '(No sticky ideas yet.)';
    const raw = fs.readFileSync(STICKY_IDEAS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const ideas = lines.map((l) => stripListPrefixLoose(l)).filter((l) => l.length >= 5);
    return ideas.length ? ideas.join('\n') : '(None.)';
  } catch (_) {
    return '(None.)';
  }
}

function readTensions() {
  try {
    if (!fs.existsSync(TENSIONS_FILE)) return '(No tensions yet.)';
    const raw = fs.readFileSync(TENSIONS_FILE, 'utf8');
    const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const list = lines.map((l) => stripListPrefixLoose(l)).filter((l) => l.length >= 10);
    return list.length ? list.join('\n') : '(None.)';
  } catch (_) {
    return '(None.)';
  }
}

function readLastMetaReflection() {
  try {
    if (!fs.existsSync(META_REFLECTIONS_FILE)) return '';
    const raw = fs.readFileSync(META_REFLECTIONS_FILE, 'utf8');
    const blocks = splitMarkdownH2(raw).filter(Boolean);
    return blocks.length ? blocks[blocks.length - 1].trim().slice(-2000) : '';
  } catch (_) {
    return '';
  }
}

async function main() {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const sticky = readStickyIdeas();
  const tensions = readTensions();
  const lastMeta = readLastMetaReflection();
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are Piko. Based on your sticky ideas (themes you keep returning to) and current tensions (unresolved friction), suggest 2–3 exploration topics that would fit data/learning/topics.txt (one short phrase per topic, e.g. "Agent coordination", "Ancient Sumeria"). Do not suggest topics that are already clearly covered by the sticky ideas as single words. Output only the suggested topics, one per line, numbered 1. 2. 3. No other text.

--- Sticky ideas ---
${sticky}

--- Tensions ---
${tensions}
${lastMeta ? `\n--- Last meta-reflection (excerpt) ---\n${lastMeta}` : ''}

--- Suggested topics (one per line, numbered) ---`;

  let reply = '';
  try {
    reply = await ai(prompt);
  } catch (e) {
    console.error('[learning-topic-suggestions] Ollama error:', e.message);
    process.exitCode = 1;
    return;
  }

  const lines = splitLines(reply || '').map((l) => l.trim()).filter(Boolean);
  const suggestions = lines.map((l) => stripListMarker(l)).filter((l) => l.length >= 2 && l.length <= 80).slice(0, 3);
  if (!suggestions.length) {
    console.error('[learning-topic-suggestions] No suggestions parsed from reply');
    process.exitCode = 1;
    return;
  }

  let existing = '';
  try {
    if (fs.existsSync(TOPIC_SUGGESTIONS_FILE)) existing = fs.readFileSync(TOPIC_SUGGESTIONS_FILE, 'utf8');
  } catch (_) {}
  if (!existing.trim()) existing = '# Piko topic suggestions (add to topics.txt if you approve)\n\n';

  const block = `\n## ${today}\n\n${suggestions.map((s) => `- ${s}`).join('\n')}\n`;
  fs.writeFileSync(TOPIC_SUGGESTIONS_FILE, existing + block, 'utf8');
  console.log('[learning-topic-suggestions] Appended', suggestions.length, 'suggestions to', TOPIC_SUGGESTIONS_FILE);
}

main().catch((e) => {
  console.error('[learning-topic-suggestions]', e.message);
  process.exitCode = 1;
});
