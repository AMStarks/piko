#!/usr/bin/env node
/**
 * Piko WebChat — serves chat UI and POST /api/chat → Ollama (Llama 3.1 8B).
 * Commands /cursor and /task run same logic as Telegram bot (parity). System prompt from prompts/IDENTITY.md + SOUL.md.
 * After /task, Piko uses discernment (Ollama) to decide if Cursor's result is satisfactory; if not, consults Grok (xAI) for a suggestion. Set GROK_API_KEY to enable.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { validate: validateConfig } = require('./lib/config');
try {
  validateConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const cron = require('node-cron');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
const { ai, aiStream, MODEL_PRIMARY } = require('./lib/llm');
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HISTORY_DIR = process.env.PIKO_HISTORY_DIR || path.join(__dirname, 'history');
// /cursor and /task (same as Telegram bot)
const MACBOOK_USER = process.env.MACBOOK_USER || 'starkers';
const MACBOOK_IP = process.env.MACBOOK_IP || '192.168.0.245';
const SSH_KEY = process.env.SSH_KEY || '/root/.ssh/id_optimus_to_macbook';
const CURSOR_WORKDIR = process.env.CURSOR_WORKDIR || '/Users/starkers/Projects';
const DEFAULT_PROJECT = process.env.PIKO_DEFAULT_PROJECT || process.env.DEFAULT_PROJECT || 'Piko';
const CURSOR_CLI = process.env.CURSOR_CLI || '/usr/local/bin/cursor';
const AGENT_CLI = process.env.AGENT_CLI || '/Users/starkers/.local/bin/agent';
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS) || 600000;
const PROJECTS_OPTIMUS = process.env.PROJECTS_OPTIMUS || '/root/projects';
const CURSOR_OPTIMUS_SCRIPT = process.env.CURSOR_OPTIMUS_SCRIPT || '/root/run-cursor-optimus.sh';
const AGENT_CLI_OPTIMUS = process.env.AGENT_CLI_OPTIMUS || 'agent';
// Optional: PIKO_OPTIMUS_PROJECT_PATHS=Legion:/opt/legion so /task Legion runs in /opt/legion when on Optimus
function getOptimusProjectDir(project) {
  const raw = process.env.PIKO_OPTIMUS_PROJECT_PATHS || '';
  const map = {};
  raw.split(',').forEach((pair) => {
    const [name, dir] = pair.trim().split(':').map((s) => s.trim());
    if (name && dir) map[name] = dir;
  });
  return map[project] || `${PROJECTS_OPTIMUS}/${project}`;
}
const TASK_OPTIMUS_ONLY = process.env.PIKO_TASK_OPTIMUS_ONLY === 'true' || process.env.PIKO_TASK_OPTIMUS_ONLY === '1';
// Phase 4: optional Docker sandbox for /task (run agent inside container)
const TASK_DOCKER = process.env.PIKO_TASK_DOCKER === 'true' || process.env.PIKO_TASK_DOCKER === '1';
const TASK_DOCKER_IMAGE = process.env.PIKO_TASK_DOCKER_IMAGE || process.env.TASK_DOCKER_IMAGE;
const CURSOR_OPTIMUS_ONLY = process.env.PIKO_CURSOR_OPTIMUS_ONLY === 'true' || process.env.PIKO_CURSOR_OPTIMUS_ONLY === '1';
const AGENT_ENV_OPTIMUS = {
  ...process.env,
  HOME: process.env.HOME || '/root',
  PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
};
// Grok (xAI) — optional second opinion when Piko isn't satisfied with Cursor's result
const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
const GROK_MODEL = process.env.GROK_MODEL || 'grok-4';
const GROK_URL = process.env.GROK_URL || 'https://api.x.ai/v1/chat/completions';

// Phase 1: sandbox for /read, /ls
const SANDBOX_DIR = process.env.PIKO_SANDBOX_DIR || path.join(__dirname, 'sandbox');
// Intent orders: single file data/intents.json (reminders, queue, scheduled)
const DATA_DIR = path.join(__dirname, 'data');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ALLOWLIST_FILE = path.join(DATA_DIR, 'allowlist.json');
const PENDING_NOTIFICATIONS_FILE = path.join(DATA_DIR, 'pending-notifications.txt');
const EA_ALERTS_FILE = path.join(DATA_DIR, 'ea-alerts.json');
const EA_PREFERENCES_FILE = path.join(DATA_DIR, 'ea-preferences.json');
const LINKED_ACCOUNTS_FILE = path.join(DATA_DIR, 'linked-accounts.json');
const CURRENT_MODEL_FILE = path.join(DATA_DIR, 'current_model.txt');

function loadLinkedAccounts() {
  try {
    if (fs.existsSync(LINKED_ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(LINKED_ACCOUNTS_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveLinkedAccounts(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LINKED_ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    log('warn', 'linked-accounts-save', { error: e.message });
    return false;
  }
}

function clearEnvVar(key) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  try {
    envContent = fs.readFileSync(envPath, 'utf8');
  } catch (_) {}
  const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
  if (!keyRegex.test(envContent)) {
    delete process.env[key];
    return true;
  }
  envContent = envContent.replace(keyRegex, '').replace(/\n\n+/g, '\n').trimEnd();
  try {
    fs.writeFileSync(envPath, envContent + (envContent ? '\n' : ''), 'utf8');
  } catch (e) {
    log('warn', 'clear-env', { key, error: e.message });
    return false;
  }
  delete process.env[key];
  return true;
}
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY || process.env.SERPER_KEY;
const MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY || process.env.MOLTBOOK_KEY;
// Phase 2: weather (Open-Meteo), news (RSS or NewsAPI), Gmail
const NEWS_API_KEY = process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY;
const GMAIL_ACCESS_TOKEN = process.env.GMAIL_ACCESS_TOKEN;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PIKO_BASE_URL = (process.env.PIKO_BASE_URL || '').replace(/\/$/, ''); // optional; e.g. https://piko.example.com for OAuth redirect
const gmailOAuthStateMap = new Map(); // state -> { createdAt } for CSRF
const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_OAUTH_SCOPES = 'app_mentions:read,chat:write,channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read';
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID || process.env.NOTION_OAUTH_CLIENT_ID;
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET || process.env.NOTION_OAUTH_CLIENT_SECRET;
const slackOAuthStateMap = new Map();
const notionOAuthStateMap = new Map();

function persistEnvVar(key, value) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  try {
    envContent = fs.readFileSync(envPath, 'utf8');
  } catch (_) {}
  const safeValue = String(value).replace(/\n/g, '').trim();
  const line = key + '=' + safeValue + '\n';
  const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
  if (keyRegex.test(envContent)) {
    envContent = envContent.replace(keyRegex, key + '=' + safeValue);
  } else {
    envContent = (envContent.trimEnd() ? envContent + '\n' : '') + line;
  }
  try {
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    log('warn', 'persist-env', { key, error: e.message });
    return false;
  }
  process.env[key] = safeValue;
  return true;
}

const DEFAULT_SYSTEM = 'You are ClawFriend (Piko), a witty, empathetic AI assistant. Respond naturally and concisely. No meta-commentary.';

// —— Logging & metrics ——
const LOG_PATH = process.env.PIKO_LOG_PATH || path.join(DATA_DIR, 'piko.log');
const LOG_CONSOLE = process.env.PIKO_LOG_CONSOLE === 'true' || process.env.PIKO_LOG_CONSOLE === '1';
const metrics = { requests: 0, errors: 0, chat: 0, commands: 0 };
const startTime = Date.now();
const { log: logStructured } = require('./lib/logger');
function log(level, msg, meta = {}, requestId) {
  if (LOG_CONSOLE) console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta, requestId }));
  logStructured(level, msg, meta, requestId);
}
const sessionStore = require('./lib/sessionStore');
const rateLimit = require('./lib/rateLimit');

function loadSystemPrompt() {
  let identity = '';
  let soul = '';
  let memory = '';
  let interests = '';
  try {
    identity = fs.readFileSync(path.join(PROMPTS_DIR, 'IDENTITY.md'), 'utf8').trim();
  } catch (_) {}
  try {
    soul = fs.readFileSync(path.join(PROMPTS_DIR, 'SOUL.md'), 'utf8').trim();
  } catch (_) {}
  try {
    memory = fs.readFileSync(path.join(PROMPTS_DIR, 'MEMORY.md'), 'utf8').trim();
  } catch (_) {}
  try {
    interests = fs.readFileSync(path.join(PROMPTS_DIR, 'INTERESTS.md'), 'utf8').trim();
  } catch (_) {}
  const parts = [identity, soul, memory, interests].filter(Boolean);
  if (parts.length) {
    return parts.join('\n\n').trim();
  }
  return DEFAULT_SYSTEM;
}

const SYSTEM_PROMPT = loadSystemPrompt();

const LEARNING_DIR = path.join(DATA_DIR, 'learning');
const RABBIT_HOLE_NOTES_FILE = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
const STICKY_IDEAS_FILE = path.join(LEARNING_DIR, 'sticky-ideas.md');
const PIKO_HEALTH_API_KEY = process.env.PIKO_HEALTH_API_KEY || process.env.HEALTH_API_KEY || '';
const PIKO_RAG_ENABLED = process.env.PIKO_RAG !== '0';
const RAG_MAX_CHARS = Math.min(2000, Math.max(500, parseInt(process.env.PIKO_RAG_MAX_CHARS, 10) || 1500));
const RAG_TOP_N = 3;
const RECENT_LEARNING_MAX_CHARS = 2500;
const RECENT_LEARNING_BLOCKS = 5;
const STICKY_SNIPPET_MAX_CHARS = 800;
const STICKY_SNIPPET_ITEMS = 3;

/** Phase 1 exploration: recent rabbit-hole notes for chat. Epistemic humility framing. */
function getRecentLearningBlock() {
  if (process.env.PIKO_LEARNING_CHAT_INJECT === '0') return '';
  try {
    if (!fs.existsSync(RABBIT_HOLE_NOTES_FILE)) return '';
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES_FILE, 'utf8');
    const blocks = raw.split(/\n## /).filter(Boolean);
    const last = blocks.slice(-RECENT_LEARNING_BLOCKS);
    const joined = last.join('\n## ').trim();
    const truncated = joined.slice(-RECENT_LEARNING_MAX_CHARS);
    const content = joined.length > RECENT_LEARNING_MAX_CHARS ? truncated : joined;
    if (!content.trim()) return '';
    return '\n\nRecent learning (from daily exploration; use with epistemic humility—e.g. "I\'ve been looking into…", not "I understand…"). Do not quote or repeat sentences from this block verbatim; only reference it briefly when the user asks what you\'ve been learning or when it\'s directly relevant. Reply only to the user\'s message; do not append a standalone sentence from this block.\n\n' + content;
  } catch (_) {
    return '';
  }
}

/** Phase 4: tone tilt + optional sticky-ideas snippet. Influences tone without dictating content. */
function getStickyIdeasBlock() {
  if (process.env.PIKO_LEARNING_CHAT_INJECT === '0') return '';
  try {
    if (!fs.existsSync(STICKY_IDEAS_FILE)) return '';
    const raw = fs.readFileSync(STICKY_IDEAS_FILE, 'utf8');
    const lines = raw.split(/\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const ideas = lines.map((l) => l.replace(/^[-*•]\s*\d+[.)]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()).filter((l) => l.length >= 5).slice(-STICKY_SNIPPET_ITEMS);
    if (ideas.length === 0) return '';
    const toneLine = "\n\nWhen responding, let your tone be gently influenced by the themes you keep returning to (below), without stating them explicitly.";
    const snippet = ideas.join(' ');
    const truncated = snippet.length > STICKY_SNIPPET_MAX_CHARS ? snippet.slice(-STICKY_SNIPPET_MAX_CHARS) : snippet;
    return toneLine + '\n\nThemes you keep returning to: ' + truncated;
  } catch (_) {
    return '';
  }
}

const PENDING_QUESTION_FILE = path.join(LEARNING_DIR, 'pending-question.txt');
const INQUIRY_HISTORY_FILE = path.join(LEARNING_DIR, 'inquiry-history.txt');
const PENDING_QUESTION_MAX_LEN = 400;

/** Optional: one question Piko would like to ask the user (from learning). Consumed after first use; logged to inquiry-history. */
function getAndConsumePendingQuestionBlock() {
  if (process.env.PIKO_LEARNING_CHAT_INJECT === '0') return '';
  try {
    if (!fs.existsSync(PENDING_QUESTION_FILE)) return '';
    const raw = fs.readFileSync(PENDING_QUESTION_FILE, 'utf8').trim().slice(0, PENDING_QUESTION_MAX_LEN);
    if (!raw) return '';
    try { fs.unlinkSync(PENDING_QUESTION_FILE); } catch (_) {}
    const today = new Date().toISOString().slice(0, 10);
    try {
      const oneLine = raw.replace(/\r?\n/g, ' ').trim();
      fs.appendFileSync(INQUIRY_HISTORY_FILE, `${today}: ${oneLine} asked=true\n`, 'utf8');
    } catch (_) {}
    return '\n\nYou have one question you\'d like to ask the user when it fits naturally (from your recent learning). Ask it at most once this conversation if the moment is right; don\'t force it every message. Question to consider asking: ' + raw;
  } catch (_) {
    return '';
  }
}

/** Daily memory: recent day summaries (date YYYY-MM-DD accompanies each). Kept indefinitely on Optimus. */
function getDailyMemoryBlock(sessionKey) {
  if (process.env.PIKO_DAILY_MEMORY_ENABLED !== '1' && process.env.PIKO_DAILY_MEMORY_ENABLED !== 'true') return '';
  try {
    const dailyMemory = require('./lib/dailyMemory');
    const days = Math.min(30, Math.max(1, parseInt(process.env.PIKO_DAILY_MEMORY_DAYS || '7', 10)));
    const summaries = dailyMemory.getSummaries(sessionKey, days);
    if (!summaries || summaries.length === 0) return '';
    const lines = summaries.map((s) => `${s.date}: ${(s.summary_text || '').trim().slice(0, 800)}`).filter(Boolean);
    if (lines.length === 0) return '';
    return '\n\n**Recent history (summaries, date first):**\n' + lines.join('\n\n') + '\n\n';
  } catch (_) {
    return '';
  }
}

/** Simple RAG: scan data/learning/*.md, score chunks by keyword overlap with query, return top N chunks. Disabled if PIKO_RAG=0. */
function getRagContext(query) {
  if (!PIKO_RAG_ENABLED || !query || typeof query !== 'string') return '';
  const q = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (q.length === 0) return '';
  try {
    if (!fs.existsSync(LEARNING_DIR)) return '';
    const files = fs.readdirSync(LEARNING_DIR).filter((f) => f.endsWith('.md'));
    const chunks = [];
    for (const file of files) {
      let raw;
      try {
        raw = fs.readFileSync(path.join(LEARNING_DIR, file), 'utf8');
      } catch (_) {
        continue;
      }
      const blocks = raw.split(/\n## |\n\n+/).filter((b) => b.trim().length >= 20);
      for (const block of blocks) {
        const text = block.trim().slice(0, 800);
        const lower = text.toLowerCase();
        let score = 0;
        for (const word of q) {
          if (lower.includes(word)) score += 1;
        }
        if (score > 0) chunks.push({ score, text });
      }
    }
    chunks.sort((a, b) => b.score - a.score);
    const top = chunks.slice(0, RAG_TOP_N).map((c) => c.text);
    const joined = top.join('\n\n---\n\n').trim();
    const out = joined.slice(0, RAG_MAX_CHARS);
    if (!out) return '';
    return '\n\nRelevant context from your learning (use only if it fits the conversation):\n' + out;
  } catch (_) {
    return '';
  }
}

// —— Intent orders: load/save/migrate via lib (persistent intents + state API) ——
const {
  loadIntents,
  saveIntents,
  createIntent,
  updateIntent,
  parseDuration,
} = require('./lib/intents.js');
const { updateMind, loadMind, saveSelfModel, saveBeliefs } = require('./lib/mind');
const { getCorpusBlockForPrompt, regenerateSummary, loadCorpus, DOCS: CORPUS_DOCS, readDoc, CORPUS_DIR } = require('./lib/corpus');
const { getTruthBlockForPrompt, appendCorrection, getTruthStats } = require('./lib/truth');
const beliefLoop = require('./lib/beliefLoop');
const memory = require('./lib/memory');
const { createResponsePlan, formatPlanForPrompt } = require('./lib/planner');
/** Resolve path under SANDBOX_DIR; return null if outside sandbox or invalid. */
function resolveSandboxPath(userPath) {
  if (!userPath || typeof userPath !== 'string') return null;
  const trimmed = userPath.trim().replace(/^\/+/, '');
  if (trimmed.includes('..')) return null;
  const fullPath = path.resolve(SANDBOX_DIR, trimmed);
  if (!fullPath.startsWith(path.resolve(SANDBOX_DIR))) return null;
  return fullPath;
}

// —— Phase 4: Multi-session config (per-user/channel profile) ——
function loadSessionsConfig() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null ? o : {};
  } catch (_) {
    return {};
  }
}
function saveSessionsConfig(config) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[sessions] save failed:', e.message);
    return false;
  }
}

/** Model override: data/current_model.txt holds an Ollama tag (e.g. qwen2.5:32b). Used when no per-session model is set. */
function getCurrentModelOverride() {
  try {
    if (fs.existsSync(CURRENT_MODEL_FILE)) {
      const tag = fs.readFileSync(CURRENT_MODEL_FILE, 'utf8').trim();
      if (tag.length > 0) return tag;
    }
  } catch (_) {}
  return null;
}

// —— Allowlist (per-channel DM pairing) ——
function loadAllowlist() {
  try {
    const raw = fs.readFileSync(ALLOWLIST_FILE, 'utf8');
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null ? o : {};
  } catch (_) {
    return {};
  }
}
function saveAllowlist(allowlist) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(allowlist, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[allowlist] save failed:', e.message);
    return false;
  }
}
/** Derive source and externalId from sessionId (e.g. "discord-123" -> { source: "discord", externalId: "123" }). */
function parseSessionSource(sessionId) {
  if (!sessionId || sessionId === 'default') return { source: 'webchat', externalId: null };
  const idx = sessionId.indexOf('-');
  if (idx <= 0) return { source: 'webchat', externalId: null };
  return { source: sessionId.slice(0, idx).toLowerCase(), externalId: sessionId.slice(idx + 1) };
}
function isAllowedByAllowlist(allowlist, source, externalId) {
  if (source === 'webchat') return true;
  const list = allowlist[source];
  if (!list || !Array.isArray(list)) return true;
  if (list.length === 0) return false;
  if (list.includes('*')) return true;
  return list.includes(String(externalId));
}

// Phase 4: Local skills/ dir (loadable handlers)
const SKILLS_DIR = path.join(__dirname, 'skills');
let loadedSkills = [];
try {
  const skillsIndex = path.join(SKILLS_DIR, 'index.js');
  if (fs.existsSync(skillsIndex)) {
    const mod = require(skillsIndex);
    loadedSkills = Array.isArray(mod.skills) ? mod.skills : [];
    if (loadedSkills.length) console.log('[skills] loaded', loadedSkills.length, 'skill(s)');
  }
} catch (e) {
  console.error('[skills] load failed:', e.message);
}

const MAX_HISTORY = sessionStore.MAX_HISTORY;
const SLICE_HISTORY = 30;

function parseUrl(u) {
  const parsed = url.parse(u, true);
  return { pathname: parsed.pathname || '/', query: parsed.query };
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/** Fetch Piko's Moltbook profile (GET /agents/me). Returns { name, karma, follower_count, stats } or null. */
async function fetchMoltbookProfile(key) {
  if (!key) return null;
  try {
    const opts = { hostname: 'www.moltbook.com', port: 443, path: '/api/v1/agents/me', method: 'GET', headers: { 'Authorization': 'Bearer ' + key } };
    const { statusCode, data } = await httpsRequest(opts);
    if (statusCode !== 200 || !data) return null;
    const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
    const agent = json.agent || json;
    return {
      name: agent.name || null,
      karma: agent.karma != null ? agent.karma : null,
      follower_count: agent.follower_count != null ? agent.follower_count : null,
      stats: agent.stats || null,
    };
  } catch (_) {
    return null;
  }
}

/** Strip Markdown bold/emphasis so titles display as plain text (Moltbook shows titles as plain; ** would show literally). */
function stripMarkdownFromText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

/** Remove one leading and one trailing double quote if the whole string is wrapped (not an actual quote inside). */
function stripWrappingQuotes(str) {
  if (typeof str !== 'string') return '';
  const s = str.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1).trim();
  return s;
}

/** Normalize a raw post object to { id, title, url, createdAt }. */
function normalizeMoltbookPost(p) {
  const id = typeof p === 'string' ? p : (p && p.id);
  if (!id) return null;
  let rawTitle = (p && (p.title || p.content)) ? String(p.title || p.content).slice(0, 80) : 'Post';
  rawTitle = stripMarkdownFromText(rawTitle) || rawTitle;
  const title = stripWrappingQuotes(rawTitle) || rawTitle;
  return {
    id: String(id),
    title,
    url: 'https://www.moltbook.com/post/' + id,
    createdAt: p && (p.created_at || p.createdAt) || null,
  };
}

/** Fetch all posts by Piko from Moltbook. Prefers global /posts filtered by agent (full list); else uses /agents/me recentPosts, then profile by name. Returns [{ id, title, url, createdAt }], newest first. */
const MOLTBOOK_POSTS_LIMIT = 200;

async function fetchMoltbookPostsByPiko(key) {
  if (!key) return [];
  const opts = (path) => ({ hostname: 'www.moltbook.com', port: 443, path: '/api/v1' + path, method: 'GET', headers: { 'Authorization': 'Bearer ' + key } });
  let agentId = null;
  let agentName = null;
  let meData = null;
  try {
    const { statusCode, data } = await httpsRequest(opts('/agents/me'));
    if (statusCode !== 200) return [];
    const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
    const agent = json.agent || json;
    agentId = agent.id || null;
    agentName = (agent.name || '').toString().trim();
    meData = agent;
    if (!agentId && !agentName) return [];
  } catch (_) {
    return [];
  }

  const resolveToPosts = (rawList) => {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];
    const list = rawList.slice(0, MOLTBOOK_POSTS_LIMIT);
    const hasFullPosts = list.some((p) => typeof p === 'object' && p && (p.title != null || p.content != null));
    if (hasFullPosts) return list.map((p) => normalizeMoltbookPost(p)).filter(Boolean);
    const ids = list.map((p) => (typeof p === 'string' ? p : (p && p.id))).filter(Boolean);
    return ids;
  };

  const fetchPostById = async (id) => {
    try {
      const { statusCode, data } = await httpsRequest(opts('/posts/' + encodeURIComponent(id)));
      if (statusCode !== 200 || !data) return null;
      const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
      const p = json.post || json;
      return normalizeMoltbookPost(p);
    } catch (_) { return null; }
  };

  const byId = new Map();
  const addPosts = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      if (p && p.id) byId.set(String(p.id), p);
    }
  };
  const sortNewestFirst = (list) => list.slice().sort((a, b) => {
    const ta = (a.createdAt && new Date(a.createdAt).getTime()) || 0;
    const tb = (b.createdAt && new Date(b.createdAt).getTime()) || 0;
    return tb - ta;
  });

  // 1) Global /posts filtered by agent (full list when API supports it).
  if (agentId) {
    try {
      const { statusCode, data } = await httpsRequest(opts('/posts?sort=new&limit=' + MOLTBOOK_POSTS_LIMIT));
      if (statusCode === 200 && data) {
        const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
        const raw = json.posts || json.data || (Array.isArray(json) ? json : []);
        const list = Array.isArray(raw) ? raw : (raw.posts || []);
        const byPiko = list.filter((p) => (p.author && p.author.id === agentId) || (p.agent_id === agentId));
        const normalized = byPiko.map((p) => normalizeMoltbookPost(p)).filter((p) => p && p.id);
        addPosts(normalized);
      }
    } catch (_) {}
  }

  // 2) recentPosts from /agents/me (IDs or full objects) and resolve IDs.
  const recentFromMe = meData.recentPosts || meData.recent_posts || meData.posts || [];
  const resolved = resolveToPosts(recentFromMe);
  if (Array.isArray(resolved) && resolved.length > 0) {
    if (resolved[0] && typeof resolved[0] === 'object' && resolved[0].id) {
      addPosts(resolved);
    } else {
      const ids = resolved.map((x) => (typeof x === 'string' ? x : (x && x.id))).filter(Boolean);
      for (const id of ids.slice(0, MOLTBOOK_POSTS_LIMIT)) {
        if (byId.has(id)) continue;
        const p = await fetchPostById(id);
        if (p) byId.set(String(p.id), p);
      }
    }
  }

  // 3) Profile by name (recent posts) and resolve IDs.
  if (agentName) {
    try {
      const enc = encodeURIComponent(agentName);
      const { statusCode, data } = await httpsRequest(opts('/agents/profile?name=' + enc));
      if (statusCode === 200 && data) {
        const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
        const profile = json.agent || json;
        const recent = profile.recentPosts || profile.recent_posts || profile.posts || [];
        const resolvedProfile = resolveToPosts(recent);
        if (resolvedProfile.length > 0) {
          if (resolvedProfile[0] && typeof resolvedProfile[0] === 'object' && resolvedProfile[0].id) {
            addPosts(resolvedProfile);
          } else {
            const ids = resolvedProfile.map((x) => (typeof x === 'string' ? x : (x && x.id))).filter(Boolean);
            for (const id of ids.slice(0, MOLTBOOK_POSTS_LIMIT)) {
              if (byId.has(id)) continue;
              const p = await fetchPostById(id);
              if (p) byId.set(String(p.id), p);
            }
          }
        }
      }
    } catch (_) {}
  }

  const merged = sortNewestFirst(Array.from(byId.values()));
  if (merged.length > 0) return merged;

  try {
    const { statusCode, data } = await httpsRequest(opts('/posts?sort=new&limit=' + MOLTBOOK_POSTS_LIMIT));
    if (statusCode !== 200) return [];
    const json = typeof data === 'string' && data.trim() ? JSON.parse(data) : {};
    const raw = json.posts || json.data || (Array.isArray(json) ? json : []);
    const list = Array.isArray(raw) ? raw : (raw.posts || []);
    const byPiko = list.filter((p) => (p.author && p.author.id === agentId) || (p.agent_id === agentId));
    return byPiko.map((p) => normalizeMoltbookPost(p)).filter((p) => p && p.id);
  } catch (_) {
    return [];
  }
}

/** LiteLLM-backed chat (with fallback). options.max_tokens overrides default 4000. */
async function ollamaChat(messages, model, options = {}) {
  const m = model || OLLAMA_MODEL;
  const normalized = (m && m.startsWith('ollama/')) ? m : `ollama/${m || OLLAMA_MODEL}`;
  return ai(messages, {
    model: normalized,
    max_tokens: options.max_tokens ?? 4000,
    temperature: options.temperature,
    repeat_penalty: options.repeat_penalty,
    presence_penalty: options.presence_penalty,
    frequency_penalty: options.frequency_penalty,
  });
}

/** Phase 3: stream via LiteLLM; onChunk(delta) for each piece; returns full reply. */
async function ollamaChatStream(messages, onChunk, model, options = {}) {
  const m = model || OLLAMA_MODEL;
  const normalized = (m && m.startsWith('ollama/')) ? m : `ollama/${m || OLLAMA_MODEL}`;
  return aiStream(messages, onChunk, normalized, options);
}

/** Call xAI Grok (OpenAI-compatible). Returns content string or null on missing key/error. */
async function grokChat(messages) {
  if (!GROK_API_KEY || !GROK_API_KEY.trim()) return null;
  const u = new URL(GROK_URL);
  const body = JSON.stringify({
    model: GROK_MODEL,
    messages,
    stream: false,
  });
  const opts = {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROK_API_KEY.trim(),
    },
  };
  try {
    const { statusCode, data } = await httpsRequest(opts, body);
    const json = JSON.parse(data);
    const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
    return content.trim() || null;
  } catch (e) {
    console.error('[grok]', e.message);
    return null;
  }
}

function send(res, statusCode, body, contentType = 'application/json') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// —— iOS hub: single endpoint for Shortcuts / Share / app (reminder, calendar, notes_capture, inquiry) ——
const TELEGRAM_BOT_TOKEN_HUB = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID_HUB = process.env.TELEGRAM_CHAT_ID;
function telegramNotify(text) {
  if (!TELEGRAM_BOT_TOKEN_HUB || !TELEGRAM_CHAT_ID_HUB) return Promise.resolve();
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID_HUB, text: String(text).slice(0, 4096) });
  const u = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_HUB}/sendMessage`);
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } },
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

/** Parse ACTIONS: 1. ... 2. ... from Ollama conversation summary reply. Returns [{ title }, ...]. */
function parseConversationActions(summaryReply) {
  if (!summaryReply || typeof summaryReply !== 'string') return [];
  const lines = summaryReply.split(/\n/);
  const actions = [];
  let inActions = false;
  for (const line of lines) {
    if (/^\s*ACTIONS:\s*$/i.test(line.trim())) {
      inActions = true;
      continue;
    }
    if (inActions) {
      const m = line.match(/^\s*\d+\.\s*(.+)$/);
      if (m) {
        const title = m[1].trim().slice(0, 200);
        if (title) actions.push({ title });
      }
    }
  }
  if (actions.length === 0) {
    const numbered = summaryReply.match(/^\s*\d+\.\s*(.+)$/gm);
    if (numbered) {
      for (const n of numbered) {
        const m = n.match(/^\s*\d+\.\s*(.+)$/);
        if (m && m[1].trim()) actions.push({ title: m[1].trim().slice(0, 200) });
      }
    }
  }
  return actions.slice(0, 5);
}

function parseIosHubDue(dueStr) {
  if (!dueStr || typeof dueStr !== 'string') return null;
  const s = dueStr.trim().toLowerCase();
  const now = new Date();
  if (s === 'tomorrow') {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d;
  }
  if (s === 'today') {
    const d = new Date(now); d.setHours(20, 0, 0, 0); return d <= now ? new Date(now.getTime() + 3600000) : d;
  }
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const at = new Date(now); at.setHours(h, m, 0, 0);
      if (at <= now) at.setDate(at.getDate() + 1);
      return at;
    }
  }
  try {
    const d = new Date(dueStr);
    if (!isNaN(d.getTime())) return d;
  } catch (_) {}
  return null;
}

async function handleIosHub(req, res) {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const action = (body.action || '').trim().toLowerCase();
  const source = body.source || 'ios-hub';
  const sessionId = body.sessionId || 'main';

  if (action === 'reminder') {
    const text = (body.text || body.title || '').trim();
    if (!text) return send(res, 400, JSON.stringify({ error: 'Missing text for reminder' }));
    const dueAt = parseIosHubDue(body.due || body.dueAt);
    const at = dueAt || new Date(Date.now() + 3600000);
    createIntent({ type: 'reminder', title: text, dueAt: at.toISOString(), source, sessionId });
    telegramNotify('🔔 Reminder set for ' + at.toLocaleString() + ': ' + text.slice(0, 80)).catch(() => {});
    return send(res, 200, JSON.stringify({ ok: true, action: 'reminder', dueAt: at.toISOString(), text: text.slice(0, 80) }));
  }

  if (action === 'calendar') {
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'calendar',
      message: 'Calendar events will be created when iOS EventKit or Google Calendar is connected. Use reminder for now.',
    }));
  }

  if (action === 'notes_capture') {
    const text = (body.text || body.payload || body.content || '').trim();
    if (!text) return send(res, 400, JSON.stringify({ error: 'Missing text for notes_capture' }));
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const capturePath = path.join(LEARNING_DIR, 'notes-capture.md');
      const dateLine = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const line = `\n## ${dateLine}\n${text.slice(0, 10000)}\n`;
      fs.appendFileSync(capturePath, line, 'utf8');
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'notes_capture' }));
  }

  if (action === 'inquiry') {
    const message = (body.text || body.message || '').trim();
    if (!message) return send(res, 400, JSON.stringify({ error: 'Missing text/message for inquiry' }));
    const chatBody = JSON.stringify({ message, sessionId });
    const host = '127.0.0.1';
    const port = PORT;
    return new Promise((resolve) => {
      const opts = { hostname: host, port, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } };
      const reqIn = http.request(opts, (resIn) => {
        let data = '';
        resIn.on('data', (ch) => (data += ch));
        resIn.on('end', () => {
          try {
            const out = JSON.parse(data || '{}');
            resolve(send(res, 200, JSON.stringify({ ok: true, action: 'inquiry', reply: out.reply || out.error || '' })));
          } catch (_) {
            resolve(send(res, 200, JSON.stringify({ ok: true, action: 'inquiry', reply: data || '' })));
          }
        });
      });
      reqIn.on('error', (e) => resolve(send(res, 502, JSON.stringify({ error: 'Chat request failed: ' + e.message }))));
      reqIn.setTimeout(60000, () => { reqIn.destroy(); resolve(send(res, 504, JSON.stringify({ error: 'Chat timeout' }))); });
      reqIn.write(chatBody);
      reqIn.end();
    });
  }

  if (action === 'file_capture') {
    const url = (body.url || '').trim();
    const text = (body.text || body.payload || body.content || '').trim();
    if (!url && !text) return send(res, 400, JSON.stringify({ error: 'Missing url or text for file_capture' }));
    const dateLine = new Date().toISOString().slice(0, 19).replace('T', ' ');
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const capturePath = path.join(LEARNING_DIR, 'notes-capture.md');
    const append = (content) => {
      const line = `\n## ${dateLine}${url ? ' — ' + url.slice(0, 80) : ''}\n${content.slice(0, 50000)}\n`;
      fs.appendFileSync(capturePath, line, 'utf8');
    };
    if (text) {
      append(text);
      const isConversation = text.length > 50 && (text.includes(':\n') || text.split('\n').length > 5);
      if (isConversation) {
        try {
          const prompt = `Summarize this conversation. Extract 1-3 actionable items.

${text.slice(0, 4000)}

Respond ONLY in this format:
SUMMARY: [one sentence]
ACTIONS:
1. [action item]
2. [action item]`;
          const summaryReply = await ollamaChat([{ role: 'user', content: prompt }]);
          const summaryMatch = summaryReply.match(/SUMMARY:\s*(.+?)(?=\n|ACTIONS:|$)/is);
          const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 200) : 'Conversation noted';
          const actions = parseConversationActions(summaryReply);
          return send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'text', type: 'conversation', summary, actions }));
        } catch (e) {
          log('warn', 'conversation summary failed', { error: e.message });
        }
      }
      return send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'text' }));
    }
    const lib = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET' };
    lib.request(opts, (resIn) => {
      const chunks = [];
      resIn.on('data', (ch) => chunks.push(ch));
      resIn.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = (resIn.headers['content-type'] || '').toLowerCase();
        const isPdf = ct.includes('pdf') || buf.slice(0, 5).toString() === '%PDF-';
        if (isPdf) {
          try {
            const pdfParse = require('pdf-parse');
            pdfParse(buf).then((data) => {
              append((data.text || '').trim() || '(no text extracted)');
              send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'pdf', pages: data.numpages }));
            }).catch((e) => send(res, 500, JSON.stringify({ error: 'PDF extract: ' + e.message })));
          } catch (e) {
            send(res, 500, JSON.stringify({ error: 'pdf-parse not installed: npm install pdf-parse' }));
          }
        } else {
          append(buf.toString('utf8').slice(0, 50000));
          send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'url' }));
        }
      });
    }).on('error', (e) => send(res, 502, JSON.stringify({ error: 'Fetch failed: ' + e.message }))).setTimeout(15000, function () { this.destroy(); send(res, 504, JSON.stringify({ error: 'Fetch timeout' })); }).end();
    return;
  }

  if (action === 'calendar_snapshot') {
    const events = body.events || body.eventsToday || [];
    if (!Array.isArray(events)) return send(res, 400, JSON.stringify({ error: 'events must be an array' }));
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const snapshotPath = path.join(DATA_DIR, 'calendar-snapshot.json');
      const payload = { updatedAt: new Date().toISOString(), source: body.source || source, events: events.slice(0, 100) };
      fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'calendar_snapshot', count: events.length }));
  }

  if (action === 'files_recent') {
    const fileNames = Array.isArray(body.fileNames) ? body.fileNames : (body.files && Array.isArray(body.files) ? body.files : []);
    const combined = fileNames.join(' ').toLowerCase();
    const suggestedTopics = [];
    const pdfCount = (combined.match(/\.pdf/g) || []).length;
    if (pdfCount >= 3) suggestedTopics.push('Weekly deep dives');
    if (/\bagent\b|coordination|distributed/.test(combined)) suggestedTopics.push('agent coordination', 'distributed systems');
    if (/research|paper|arxiv/.test(combined)) suggestedTopics.push('research synthesis');
    return send(res, 200, JSON.stringify({ ok: true, action: 'files_recent', suggestedTopics: [...new Set(suggestedTopics)] }));
  }

  return send(res, 400, JSON.stringify({ error: 'Unknown action. Use: reminder, calendar, notes_capture, inquiry, file_capture, calendar_snapshot, files_recent' }));
}

function parseCursorCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (t === '/cursor') return { command: '--version' };
  if (t.startsWith('/cursor ')) return { command: t.slice(8).trim() || '--version' };
  if (t.startsWith('/cursor')) return { command: t.slice(7).trim() || '--version' };
  return null;
}
function isValidProjectName(name) {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && name.length > 0 && !name.includes('..');
}
function parseTaskCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (!t.startsWith('/task ') || t === '/task') return null;
  const rest = t.slice(6).trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  let project = DEFAULT_PROJECT;
  let task = rest;
  if (parts.length >= 2 && isValidProjectName(parts[0])) {
    project = parts[0];
    task = parts.slice(1).join(' ').trim();
  }
  if (!task) return null;
  return { task, project };
}

async function runTaskCommand(taskCmd, options) {
  const apiKey = process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_BOT;
  if (!apiKey) return 'Task skipped: CURSOR_API_KEY not set on server. Add it to the WebChat service and restart.';
  const taskEsc = taskCmd.task.replace(/'/g, "'\"'\"'");
  const keyEsc = apiKey.replace(/'/g, "'\"'\"'");
  const workdir = `${CURSOR_WORKDIR}/${taskCmd.project}`;
  const optimusWorkdir = getOptimusProjectDir(taskCmd.project);
  const innerCmd = `cd ${optimusWorkdir} && ${AGENT_CLI_OPTIMUS} --api-key '${keyEsc}' --model auto -p --force '${taskEsc}'`;
  // Run agent under script (PTY) so stdout is line-flushed and Node receives output; without this, exec() gets empty stdout
  const localCmd = `script -q -c ${JSON.stringify(innerCmd)} /dev/null`;
  const execOpts = { timeout: TASK_TIMEOUT_MS, env: AGENT_ENV_OPTIMUS, maxBuffer: 4 * 1024 * 1024 };
  const runOnOptimus = () => new Promise((resolve) => {
    exec(localCmd, execOpts, (err, stdout, stderr) => {
      const outStr = (stdout && stdout.toString()) || '';
      const errStr = (stderr && stderr.toString()) || '';
      const output = (outStr || errStr || 'Done.').trim();
      const reply = output.length > 3800 ? output.slice(0, 3800) + '\n… (truncated)' : output;
      if (err) {
        console.error('[ERROR] /task Optimus failed:', err.message);
        const detail = (errStr || outStr || err.message || 'agent not installed or timed out').trim().slice(0, 800);
        resolve('Optimus task failed: ' + detail);
      } else {
        resolve(reply);
      }
    });
  });

  const useDocker = (options && options.sandbox === true) || (!options || options.sandbox !== false);
  // Phase 4: optional Docker sandbox — run agent inside container (or per-session sandbox: true)
  if (useDocker && TASK_DOCKER && TASK_DOCKER_IMAGE) {
    const dockerCmd = `docker run --rm -v ${optimusWorkdir}:/workspace -e CURSOR_API_KEY='${keyEsc}' -e HOME=/root ${TASK_DOCKER_IMAGE} sh -c "cd /workspace && ${AGENT_CLI_OPTIMUS} --api-key '${keyEsc}' --model auto -p --force '${taskEsc}'"`;
    return new Promise((resolve) => {
      exec(dockerCmd, { timeout: TASK_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const outStr = (stdout && stdout.toString()) || '';
        const errStr = (stderr && stderr.toString()) || '';
        const output = (outStr || errStr || 'Done.').trim();
        const reply = output.length > 3800 ? output.slice(0, 3800) + '\n… (truncated)' : output;
        if (err) resolve('Docker task failed: ' + (errStr || err.message || '').trim().slice(0, 500));
        else resolve(reply);
      });
    });
  }

  if (TASK_OPTIMUS_ONLY) {
    return await runOnOptimus();
  }

  const sshCmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${MACBOOK_USER}@${MACBOOK_IP} "cd ${workdir} && ${AGENT_CLI} --api-key '${keyEsc}' --model auto -p --force '${taskEsc}'"`;
  try {
    const { stdout, stderr } = await execAsync(sshCmd, { timeout: TASK_TIMEOUT_MS });
    const output = (stdout || stderr || 'Done.').trim();
    return output.length > 4000 ? output.slice(0, 4000) + '\n… (truncated)' : output;
  } catch (err) {
    console.error('[ERROR] /task (Mac) failed:', err.message);
    const output = await runOnOptimus();
    return 'Mac unreachable; ran on Optimus:\n' + output;
  }
}

async function runCursorCommand(cursor) {
  const cmdArg = cursor.command.replace(/"/g, '\\"').replace(/`/g, '\\`');
  const localCmd = `${CURSOR_OPTIMUS_SCRIPT} ${PROJECTS_OPTIMUS} ${cmdArg}`;
  const runOnOptimus = async () => {
    const { stdout, stderr } = await execAsync(localCmd, { timeout: 95000 });
    const output = (stdout || stderr || 'Done.').trim();
    return output.length > 3800 ? output.slice(0, 3800) + '\n… (truncated)' : output;
  };
  if (CURSOR_OPTIMUS_ONLY) {
    try {
      return await runOnOptimus();
    } catch (e2) {
      return 'Cursor (Optimus): ' + (e2.message || 'timed out or failed');
    }
  }
  const sshCmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${MACBOOK_USER}@${MACBOOK_IP} "cd ${CURSOR_WORKDIR} && ${CURSOR_CLI} ${cmdArg}"`;
  try {
    const { stdout, stderr } = await execAsync(sshCmd, { timeout: 120000 });
    const output = (stdout || stderr || 'Done.').trim();
    return output.length > 4000 ? output.slice(0, 4000) + '\n… (truncated)' : output;
  } catch (err) {
    console.error('[ERROR] /cursor (Mac) failed:', err.message);
    try {
      return 'Mac unreachable; ran on Optimus:\n' + await runOnOptimus();
    } catch (e2) {
      return 'Mac unreachable. Optimus fallback: ' + (e2.message || 'Cursor timed out or failed.');
    }
  }
}

async function handleApiChat(req, res) {
  metrics.requests++;
  const body = await readBody(req);
  let json;
  try {
    json = JSON.parse(body || '{}');
  } catch (_) {
    metrics.errors++;
    log('warn', 'Invalid JSON', {}, req.requestId);
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
  }
  const message = typeof json.message === 'string' ? json.message.trim() : '';
  if (!message) {
    metrics.errors++;
    return send(res, 400, JSON.stringify({ error: 'Missing message' }));
  }
  const streamReply = json.stream === true;
  const sessionId = typeof json.sessionId === 'string' ? json.sessionId : null;
  // Session key: PIKO_UNIFIED_SESSION_ID forces one shared conversation; otherwise use request's sessionId so app (main) and Telegram (telegram-<chatId>) have separate histories and no cross-channel meta replies.
  const key = process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main';
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const limit = rateLimit.check(clientIp);
  if (!limit.ok) return send(res, 429, JSON.stringify({ error: 'Too many requests' }));

  const sessionsConfig = loadSessionsConfig();
  const profile = (sessionsConfig[key] && sessionsConfig[key].profile) || 'main';
  const sessionModel = (sessionsConfig[key] && sessionsConfig[key].model) || getCurrentModelOverride() || OLLAMA_MODEL;

  const { source: reqSource, externalId: reqExternalId } = parseSessionSource(sessionId || 'default');
  const allowlist = loadAllowlist();
  if (!isAllowedByAllowlist(allowlist, reqSource, reqExternalId)) {
    const channelId = reqSource && reqExternalId != null ? `${reqSource}-${reqExternalId}` : (sessionId || 'unknown');
    log('warn', 'Allowlist denied: ' + channelId + ' not in allowlist', { source: reqSource, externalId: reqExternalId }, req.requestId);
    return send(res, 403, JSON.stringify({
      error: 'channel not allowed',
      channel: reqSource || 'unknown',
      id: reqExternalId != null ? String(reqExternalId) : undefined,
      hint: 'Add this channel via /allow <source> <id> from WebChat or update data/allowlist.json',
    }));
  }

  // Command vs chat for metrics
  const isCommand = message.startsWith('/') && !message.startsWith('//');
  if (isCommand) metrics.commands++; else metrics.chat++;

  // —— /allow, /block (only from WebChat) ——
  if ((message === '/allow' || message.startsWith('/allow ')) && reqSource === 'webchat') {
    const rest = message.slice(7).trim();
    const parts = rest.split(/\s+/);
    if (parts.length < 2) return send(res, 200, JSON.stringify({ reply: 'Usage: /allow <source> <id> e.g. /allow discord 123456' }));
    const [src, id] = [parts[0].toLowerCase(), parts[1]];
    if (!allowlist[src]) allowlist[src] = [];
    if (!allowlist[src].includes(id)) allowlist[src].push(id);
    saveAllowlist(allowlist);
    return send(res, 200, JSON.stringify({ reply: `Allowed ${src}: ${id}.` }));
  }
  if ((message === '/block' || message.startsWith('/block ')) && reqSource === 'webchat') {
    const rest = message.slice(6).trim();
    const parts = rest.split(/\s+/);
    if (parts.length < 2) return send(res, 200, JSON.stringify({ reply: 'Usage: /block <source> <id>' }));
    const [src, id] = [parts[0].toLowerCase(), parts[1]];
    if (Array.isArray(allowlist[src])) allowlist[src] = allowlist[src].filter((x) => x !== id);
    saveAllowlist(allowlist);
    return send(res, 200, JSON.stringify({ reply: `Blocked ${src}: ${id}.` }));
  }

  // —— Phase B: Moltbook feedback signals /++ and /-- ——
  const MOLTBOOK_FEEDBACK_WHITELIST = ['clarity', 'tooLong', 'goodQuestions', 'tooAbstract', 'moreExamples'];
  const MOLTBOOK_FEEDBACK_FILE = path.join(DATA_DIR, 'moltbook-feedback.json');
  const feedbackPlus = message.trim().match(/^\/\+\+\s+(\w+)$/);
  const feedbackMinus = message.trim().match(/^\/--\s+(\w+)$/);
  const feedbackQ = message.trim().match(/^\/\+\?\s+(\w+)$/);
  const feedbackMatch = feedbackPlus || feedbackMinus || feedbackQ;
  if (feedbackMatch) {
    const signal = feedbackMatch[1];
    if (!MOLTBOOK_FEEDBACK_WHITELIST.includes(signal)) {
      return send(res, 200, JSON.stringify({ reply: `Unknown signal. Use: ${MOLTBOOK_FEEDBACK_WHITELIST.join(', ')}.` }));
    }
    let data = { signals: {}, lastUpdated: null };
    try {
      if (fs.existsSync(MOLTBOOK_FEEDBACK_FILE)) {
        const raw = fs.readFileSync(MOLTBOOK_FEEDBACK_FILE, 'utf8');
        data = JSON.parse(raw);
        if (!data || typeof data.signals !== 'object') data = { signals: data?.signals || {}, lastUpdated: data?.lastUpdated || null };
      }
    } catch (_) {}
    data.signals[signal] = (data.signals[signal] || 0) + 1;
    data.lastUpdated = new Date().toISOString();
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(MOLTBOOK_FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to save feedback: ' + e.message }));
    }
    const total = data.signals[signal];
    return send(res, 200, JSON.stringify({ reply: `Feedback recorded: +1 ${signal} (total: ${total}). Next journal cycle will see this.` }));
  }

  // —— Per-session toolsAllowed (restrict commands to list if set) ——
  const toolsAllowed = sessionsConfig[key] && sessionsConfig[key].toolsAllowed;
  if (Array.isArray(toolsAllowed) && toolsAllowed.length > 0) {
    const allowed = ['/new', '/status', '/profile', '/model', '/allow', '/block'];
    const ok = allowed.some((a) => message === a || message.startsWith(a + ' ')) || toolsAllowed.some((p) => message === p || message.startsWith(p + ' '));
    if (!ok) return send(res, 200, JSON.stringify({ reply: 'Command not allowed in this session.' }));
  }

  // —— /new ——
  if (message === '/new') {
    sessionStore.clear(key);
    return send(res, 200, JSON.stringify({ reply: 'New session.' }));
  }

  // —— Phase 4: /profile (multi-session) ——
  if (message === '/profile' || message.startsWith('/profile ')) {
    const rest = message.slice(9).trim().toLowerCase();
    if (rest === '') {
      return send(res, 200, JSON.stringify({ reply: `Profile: ${profile}. Use /profile work or /profile main to set.` }));
    }
    if (rest === 'work' || rest === 'main') {
      sessionsConfig[key] = { ...(sessionsConfig[key] || {}), profile: rest, updatedAt: new Date().toISOString() };
      saveSessionsConfig(sessionsConfig);
      return send(res, 200, JSON.stringify({ reply: `Profile set to ${rest}.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /profile work | /profile main' }));
  }
  // —— /model (switch to 32B or back to default; no restart) ——
  if (message === '/model' || message.startsWith('/model ')) {
    const rest = message.slice(7).trim();
    if (rest === '') {
      const override = getCurrentModelOverride();
      const current = (sessionsConfig[key] && sessionsConfig[key].model) || override || OLLAMA_MODEL;
      return send(res, 200, JSON.stringify({ reply: `Model: ${current}. Use /model <ollama-tag> (e.g. gemma2:27b or qwen2.5:14b) or /model default to reset.` }));
    }
    if (rest.toLowerCase() === 'default' || rest.toLowerCase() === 'reset') {
      try {
        if (fs.existsSync(CURRENT_MODEL_FILE)) fs.unlinkSync(CURRENT_MODEL_FILE);
      } catch (_) {}
      if (sessionsConfig[key] && sessionsConfig[key].model) {
        const { model, ...restConfig } = sessionsConfig[key];
        sessionsConfig[key] = Object.keys(restConfig).length ? restConfig : undefined;
        if (!sessionsConfig[key]) delete sessionsConfig[key];
        saveSessionsConfig(sessionsConfig);
      }
      return send(res, 200, JSON.stringify({ reply: 'Model reset to default (' + OLLAMA_MODEL + ').' }));
    }
    // Ollama tags: alphanumeric, colon, hyphen, underscore, dot
    if (!/^[a-zA-Z0-9._:-]+$/.test(rest)) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid model tag. Use e.g. qwen2.5:32b or qwen2.5:14b.' }));
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CURRENT_MODEL_FILE, rest, 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to save model override: ' + e.message }));
    }
    return send(res, 200, JSON.stringify({ reply: `Model set to ${rest}. Next message will use it.` }));
  }
  // —— /status ——
  if (message === '/status') {
    const statusReply = (TASK_OPTIMUS_ONLY && CURSOR_OPTIMUS_ONLY)
      ? 'Piko is up. /cursor and /task on Optimus. Phase 4: /profile work|main, /model <tag>|default (32B when needed). WhatsApp+BlueBubbles adapters, CLI, optional Docker sandbox, Voice, local skills/. Tools, intent orders, /control, streaming.'
      : 'Piko is up. Phase 4: /profile work|main, /model <tag>|default (e.g. 32B when needed). WhatsApp+BlueBubbles adapters, CLI, optional Docker sandbox, Voice, local skills/. Tools, intent orders, /control, streaming. /doctor.';
    return send(res, 200, JSON.stringify({ reply: statusReply }));
  }

  // —— Phase 1: /calc ——
  if (message.startsWith('/calc ')) {
    const expr = message.slice(6).trim();
    if (/^[\d\s+\-*/().]+$/.test(expr)) {
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        return send(res, 200, JSON.stringify({ reply: String(result) }));
      } catch (_) {
        return send(res, 200, JSON.stringify({ reply: 'Invalid expression.' }));
      }
    }
    return send(res, 200, JSON.stringify({ reply: 'Only numbers and + - * / ( ) allowed.' }));
  }

  // —— /time ——
  if (message === '/time' || message.startsWith('/time ')) {
    const tz = message === '/time' ? (process.env.PIKO_DEFAULT_TZ || 'UTC') : message.slice(6).trim();
    try {
      const now = new Date().toLocaleString('en-GB', { timeZone: tz });
      return send(res, 200, JSON.stringify({ reply: `${tz}: ${now}` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid timezone.' }));
    }
  }

  // —— /read ——
  if (message.startsWith('/read ')) {
    const userPath = message.slice(6).trim();
    const fullPath = resolveSandboxPath(userPath);
    if (!fullPath) return send(res, 200, JSON.stringify({ reply: 'Path blocked or outside sandbox.' }));
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const out = content.length > 12000 ? content.slice(0, 12000) + '\n… (truncated)' : content;
      return send(res, 200, JSON.stringify({ reply: out }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: e.code === 'ENOENT' ? 'File not found.' : 'Read error: ' + e.message }));
    }
  }

  // —— /ls ——
  if (message === '/ls' || message.startsWith('/ls ')) {
    const userPath = message === '/ls' ? '.' : message.slice(4).trim();
    const fullPath = resolveSandboxPath(userPath);
    if (!fullPath) return send(res, 200, JSON.stringify({ reply: 'Path blocked or outside sandbox.' }));
    try {
      const names = fs.readdirSync(fullPath);
      const list = names.slice(0, 200).join('\n');
      return send(res, 200, JSON.stringify({ reply: list || '(empty)' }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: e.code === 'ENOENT' ? 'Not found.' : 'List error: ' + e.message }));
    }
  }

  // —— /search ——
  if (message.startsWith('/search ')) {
    const query = message.slice(8).trim();
    if (!query) return send(res, 200, JSON.stringify({ reply: 'Usage: /search "your query"' }));
    try {
      let reply = '';
      if (TAVILY_API_KEY) {
        const body = JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5 });
        const u = new URL('https://api.tavily.com/search');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const { statusCode, data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const results = (json.results || []).slice(0, 5);
        reply = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.url || ''}\n${(r.content || '').slice(0, 200)}…`).join('\n\n') || 'No results.';
      } else if (SERPER_API_KEY) {
        const body = JSON.stringify({ q: query });
        const u = new URL('https://google.serper.dev/search');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY } };
        const { data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const results = (json.organic || []).slice(0, 5);
        reply = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.link || ''}\n${(r.snippet || '').slice(0, 200)}…`).join('\n\n') || 'No results.';
      } else {
        reply = 'Set TAVILY_API_KEY or SERPER_API_KEY for web search.';
      }
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[search]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Search failed: ' + e.message }));
    }
  }

  // —— /moltbook (register does not require API key; feed/post do) ——
  if (message.startsWith('/moltbook ')) {
    const rest = message.slice(10).trim();
    if (rest.startsWith('register ')) {
      const args = rest.slice(9).trim();
      const firstSpace = args.indexOf(' ');
      const name = firstSpace >= 0 ? args.slice(0, firstSpace).trim() : args;
      const description = firstSpace >= 0 ? args.slice(firstSpace + 1).trim() : '';
      if (!name) return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [description]. Name: 3–30 chars, alphanumeric + underscores/hyphens.' }));
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(name)) return send(res, 200, JSON.stringify({ reply: 'Name must be 3–30 characters, alphanumeric with underscores or hyphens only.' }));
      try {
        const body = JSON.stringify({ name, description: (description || '').slice(0, 500) });
        const u = new URL('https://www.moltbook.com/api/v1/agents/register');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const { statusCode, data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const claimUrl = json.claim_url || json.agent?.claim_url;
        const apiKey = json.api_key || json.agent?.api_key;
        if (claimUrl) {
          let reply = 'Claim link: ' + claimUrl;
          if (apiKey) reply += '\n\nSave this API key and set MOLTBOOK_API_KEY on Optimus so Piko can post/feed:\n' + apiKey;
          return send(res, 200, JSON.stringify({ reply }));
        }
        const err = json.error || json.message || (statusCode !== 200 ? data : 'No claim_url in response.');
        return send(res, 200, JSON.stringify({ reply: 'Moltbook: ' + (typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 400) }));
      } catch (e) {
        console.error('[moltbook register]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Moltbook register failed: ' + e.message }));
      }
    }
    if (MOLTBOOK_API_KEY) {
      try {
        if (rest === 'feed' || rest.startsWith('feed ')) {
          const u = new URL('https://www.moltbook.com/api/v1/feed');
          u.searchParams.set('sort', 'hot');
          u.searchParams.set('limit', '10');
          const opts = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
          const { statusCode, data } = await httpsRequest(opts);
          const json = JSON.parse(data);
          if (statusCode === 401 || (json.success === false && (json.error || '').toLowerCase().includes('auth'))) {
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Invalid or expired API key. Set MOLTBOOK_API_KEY to a valid key from registration.' }));
          }
          const raw = json.data != null ? (Array.isArray(json.data) ? json.data : json.data.posts || json.data.items) : null;
          const items = (raw || json.posts || json.items || []).slice(0, 10);
          const reply = items.length ? items.map((p, i) => `${i + 1}. ${(p.title || p.content || '').toString().slice(0, 120)}`).join('\n') : 'Feed empty.';
          return send(res, 200, JSON.stringify({ reply }));
        }
        if (rest.startsWith('post ')) {
          const payload = rest.slice(5).trim();
          const pipe = payload.indexOf('|');
          let title = pipe >= 0 ? payload.slice(0, pipe).trim() : payload.slice(0, 80);
          let content = pipe >= 0 ? payload.slice(pipe + 1).trim() : payload;
          title = stripWrappingQuotes(stripMarkdownFromText(title) || title) || stripMarkdownFromText(title) || title;
          content = stripMarkdownFromText(content || title) || (content || title);
          const body = JSON.stringify({ submolt: 'general', title, content: content || title });
          const u = new URL('https://www.moltbook.com/api/v1/posts');
          const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
          const { statusCode, data: postData } = await httpsRequest(opts, body);
          const postJson = JSON.parse(postData);
          if (statusCode === 429) {
            const hint = postJson.retry_after_minutes != null ? ` Try again in ${postJson.retry_after_minutes} min.` : '';
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Rate limit (1 post per 30 min).' + hint }));
          }
          if (statusCode === 401 || (postJson.success === false && (postJson.error || '').toLowerCase().includes('auth'))) {
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Invalid API key. Set MOLTBOOK_API_KEY to a valid key.' }));
          }
          if (statusCode >= 400) {
            const err = postJson.error || postJson.hint || postData.slice(0, 200);
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: ' + (typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 300) }));
          }
          return send(res, 200, JSON.stringify({ reply: 'Posted to Moltbook.' }));
        }
        if (rest === 'list' || rest.startsWith('list')) {
          const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
          if (!posts.length) return send(res, 200, JSON.stringify({ reply: "I don't have any posts in my list right now — the Moltbook API may not be returning them in this view. You can check the Control panel to see my Moltbook activity and prune posts there: open the Control page and look at the Moltbook section." }));
          const lines = posts.map((p, i) => `${i + 1}. ${(p.title || 'Post').slice(0, 60)} — ${p.id} — ${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}`);
          return send(res, 200, JSON.stringify({ reply: 'Your recent posts (use /moltbook prune <number> or /moltbook prune <id>):\n' + lines.join('\n') }));
        }
        if (rest.startsWith('prune ')) {
          const arg = rest.slice(6).trim();
          if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook prune last | <number> | <post-id>' }));
          let toDelete = [];
          if (arg.toLowerCase() === 'last') {
            try {
              const lastId = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post-id.txt'), 'utf8').trim();
              if (lastId) toDelete = [lastId];
            } catch (_) {}
            if (!toDelete.length) {
              const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
              if (posts.length) toDelete = [posts[0].id];
            }
          } else if (/^\d+$/.test(arg)) {
            const n = parseInt(arg, 10);
            const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
            if (n >= 1 && n <= posts.length) toDelete = [posts[n - 1].id];
          } else if (/^[a-f0-9-]{36}$/i.test(arg)) {
            toDelete = [arg];
          }
          if (!toDelete.length) return send(res, 200, JSON.stringify({ reply: 'No post to prune. Use /moltbook list to see posts, then /moltbook prune <number> or prune last.' }));
          let pruned = 0;
          let failed = 0;
          for (const id of toDelete) {
            try {
              const opts = { hostname: 'www.moltbook.com', port: 443, path: '/api/v1/posts/' + encodeURIComponent(id), method: 'DELETE', headers: { 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
              const { statusCode } = await httpsRequest(opts);
              if (statusCode >= 200 && statusCode < 300) pruned++;
              else failed++;
            } catch (_) { failed++; }
          }
          const reply = pruned ? `Pruned ${pruned} post(s) from Moltbook.` + (failed ? ` ${failed} failed.` : '') : (failed ? 'Prune failed (not your post or already deleted?).' : 'Nothing pruned.');
          return send(res, 200, JSON.stringify({ reply }));
        }
        return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [desc] | feed | post <title> | <content> | list | prune last | prune <number> | prune <post-id>' }));
      } catch (e) {
        console.error('[moltbook]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Moltbook error: ' + e.message }));
      }
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [desc]. For feed/post/list/prune set MOLTBOOK_API_KEY.' }));
  }

  // —— Moltbook aim refinement: /aim approve | /aim reject ——
  const MOLTBOOK_PENDING_PROPOSAL_FILE = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
  const MOLTBOOK_REFINEMENTS_FILE = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');
  if (message === '/aim approve' || message === '/aim reject') {
    let proposal = '';
    try {
      proposal = fs.readFileSync(MOLTBOOK_PENDING_PROPOSAL_FILE, 'utf8').trim();
    } catch (_) {}
    if (!proposal) {
      return send(res, 200, JSON.stringify({ reply: 'No pending Moltbook aim proposal. Run the nightly proposal script or wait for the next run.' }));
    }
    if (message === '/aim reject') {
      try {
        fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
      } catch (_) {}
      return send(res, 200, JSON.stringify({ reply: 'Proposal rejected and discarded.' }));
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    const line = '- [' + dateStr + '] ' + proposal.split(/\n/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).join('; ') + '\n';
    try {
      fs.appendFileSync(MOLTBOOK_REFINEMENTS_FILE, line, 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to append to refinements file: ' + e.message }));
    }
    try {
      fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
    } catch (_) {}
    return send(res, 200, JSON.stringify({ reply: 'Refinements added to ' + MOLTBOOK_REFINEMENTS_FILE + '. Pending proposal cleared.' }));
  }

  // —— Moltbook goals (v2): /goals [set <horizon> "value"] ——
  const PIKO_MEMORY_FILE = path.join(DATA_DIR, 'piko-memory.json');
  if (message === '/goals' || message.startsWith('/goals ')) {
    const rest = message.slice(6).trim();
    if (rest.startsWith('set ')) {
      const afterSet = rest.slice(4).trim();
      const quoted = afterSet.match(/^(immediate|week|month)\s+"([^"]*)"\s*$/);
      const unquoted = afterSet.match(/^(immediate|week|month)\s+(.+)$/);
      const horizon = quoted ? quoted[1] : (unquoted ? unquoted[1] : null);
      const value = quoted ? quoted[2] : (unquoted ? unquoted[2].trim() : null);
      if (!horizon || value === null) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /goals set immediate "..." or /goals set week "..." or /goals set month "..."' }));
      }
      let memory;
      try {
        const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
        memory = JSON.parse(raw);
        if (!memory.goals) memory.goals = { immediate: [], week: [], month: [], aim: '' };
      } catch (_) {
        memory = { goals: { immediate: ['Write one post that advances the aim'], week: ['Get steady engagement'], month: ['Grow presence on Moltbook'], aim: 'Advance my Moltbook aim' }, metrics: { totalPosts: 0, avgUpvotes: 0, last10Avg: 0 }, lastCycle: null };
      }
      const arr = Array.isArray(memory.goals[horizon]) ? memory.goals[horizon] : [memory.goals[horizon]].filter(Boolean);
      memory.goals[horizon] = [value];
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PIKO_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
      } catch (e) {
        return send(res, 200, JSON.stringify({ reply: 'Failed to save goals: ' + e.message }));
      }
      return send(res, 200, JSON.stringify({ reply: 'Updated ' + horizon + ' goal to: ' + value }));
    }
    let memory;
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No goals file yet (piko-memory.json). Run the Moltbook poster once to create it, or use /goals set immediate "..." to create and set.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      memory = JSON.parse(raw);
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read goals: ' + e.message }));
    }
    const g = memory.goals || {};
    const m = memory.metrics || {};
    const im = Array.isArray(g.immediate) ? g.immediate[0] : g.immediate;
    const wk = Array.isArray(g.week) ? g.week[0] : g.week;
    const mo = Array.isArray(g.month) ? g.month[0] : g.month;
    const lines = [
      'Immediate: ' + (im || '—'),
      'Week: ' + (wk || '—'),
      'Month: ' + (mo || '—'),
      'Aim: ' + (g.aim || '—'),
      'Posts in state: ' + (m.totalPosts ?? '—'),
      'Avg upvotes: ' + (m.avgUpvotes != null ? m.avgUpvotes.toFixed(1) : '—'),
      'Last 10 avg: ' + (m.last10Avg != null ? m.last10Avg.toFixed(1) : '—'),
      memory.lastCycle ? 'Last cycle: ' + new Date(memory.lastCycle).toLocaleString() : '',
    ].filter(Boolean);
    return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
  }

  // —— v2.0: /memory (selfAssessment + cycleHistory) ——
  if (message === '/memory') {
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No memory file yet. Run the Moltbook poster to create it.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      const memory = JSON.parse(raw);
      const sa = memory.selfAssessment || {};
      const strengths = (sa.strengths || []).slice(0, 5);
      const weaknesses = (sa.weaknesses || []).slice(0, 5);
      const experiments = (sa.nextExperiments || []).slice(0, 5);
      const history = (memory.cycleHistory || []).slice(0, 5);
      const lines = [
        'Self-assessment:',
        strengths.length ? 'Strengths: ' + strengths.join('; ') : '',
        weaknesses.length ? 'Weaknesses: ' + weaknesses.join('; ') : '',
        experiments.length ? 'Next experiments: ' + experiments.join('; ') : 'Next experiments: (none)',
        '',
        'Last 5 cycles:',
        ...history.map((h) => `#${h.cycle} ${h.timestamp ? new Date(h.timestamp).toLocaleString() : ''} — ${(h.title || '').slice(0, 40)}${h.plannedForNext ? ' → ' + h.plannedForNext.slice(0, 40) : ''}`),
      ].filter(Boolean);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read memory: ' + e.message }));
    }
  }

  // —— v2.0: /experiments (nextExperiments list) ——
  if (message === '/experiments') {
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No memory file yet. Run the Moltbook poster to create it.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      const memory = JSON.parse(raw);
      const experiments = (memory.selfAssessment && memory.selfAssessment.nextExperiments) || [];
      if (experiments.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No experiments queued. The next poster run will add one from the critique step.' }));
      }
      const lines = experiments.map((e, i) => (i + 1) + '. ' + e);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read memory: ' + e.message }));
    }
  }

  // —— v2.0: /cycle (trigger full poster run) ——
  if (message === '/cycle') {
    const scriptPath = path.join(__dirname, 'scripts', 'moltbook-poster.js');
    const cwd = __dirname;
    exec('node scripts/moltbook-poster.js', { cwd, env: process.env, timeout: 90000 }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      const errOut = (stderr || '').trim();
      if (err) {
        return send(res, 200, JSON.stringify({ reply: 'Cycle failed: ' + (err.message || 'timeout') + (out ? '\n' + out.slice(-500) : '') + (errOut ? '\n' + errOut.slice(-300) : '') }));
      }
      return send(res, 200, JSON.stringify({ reply: 'Cycle done.\n' + (out ? out.slice(-600) : '') }));
    });
    return;
  }

  // —— Phase 2: /weather ——
  if (message.startsWith('/weather ')) {
    const city = message.slice(9).trim();
    if (!city) return send(res, 200, JSON.stringify({ reply: 'Usage: /weather <city>' }));
    try {
      const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1';
      const geoOpts = { hostname: 'geocoding-api.open-meteo.com', port: 443, path: '/v1/search?name=' + encodeURIComponent(city) + '&count=1', method: 'GET' };
      const { data: geoData } = await httpsRequest(geoOpts);
      const geo = JSON.parse(geoData);
      const loc = geo.results && geo.results[0];
      if (!loc) return send(res, 200, JSON.stringify({ reply: 'City not found.' }));
      const lat = loc.latitude;
      const lon = loc.longitude;
      const name = loc.name + (loc.country ? ', ' + loc.country : '');
      const weatherPath = '/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m';
      const wOpts = { hostname: 'api.open-meteo.com', port: 443, path: weatherPath, method: 'GET' };
      const { data: wData } = await httpsRequest(wOpts);
      const w = JSON.parse(wData);
      const cur = w.current;
      if (!cur) return send(res, 200, JSON.stringify({ reply: 'Weather unavailable.' }));
      const temp = cur.temperature_2m != null ? cur.temperature_2m + '°C' : '';
      const humidity = cur.relative_humidity_2m != null ? cur.relative_humidity_2m + '%' : '';
      const wind = cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '';
      const code = cur.weather_code;
      const codes = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm' };
      const desc = codes[code] || 'Code ' + code;
      const reply = `${name}: ${desc}. ${temp}${humidity ? ', ' + humidity + ' humidity' : ''}${wind ? ', wind ' + wind : ''}`;
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[weather]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Weather error: ' + e.message }));
    }
  }

  // —— Phase 2: /news ——
  if (message === '/news' || message.startsWith('/news ')) {
    const query = message === '/news' ? '' : message.slice(6).trim();
    try {
      if (NEWS_API_KEY && query) {
        const u = new URL('https://newsapi.org/v2/everything');
        u.searchParams.set('q', query);
        u.searchParams.set('pageSize', '5');
        u.searchParams.set('apiKey', NEWS_API_KEY);
        const opts = { hostname: 'newsapi.org', port: 443, path: u.pathname + '?' + u.searchParams.toString(), method: 'GET' };
        const { data } = await httpsRequest(opts);
        const json = JSON.parse(data);
        const articles = (json.articles || []).slice(0, 5);
        const reply = articles.length ? articles.map((a, i) => `${i + 1}. ${(a.title || '').slice(0, 80)}\n   ${(a.url || '')}`).join('\n') : 'No articles.';
        return send(res, 200, JSON.stringify({ reply }));
      }
      const rssUrl = process.env.PIKO_NEWS_RSS_URL || 'https://feeds.bbci.co.uk/news/rss.xml';
      const u = new URL(rssUrl);
      const opts = { hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''), method: 'GET' };
      const { data } = await httpsRequest(opts);
      const itemBlocks = (data.split(/<item[\s>]/i).slice(1)).slice(0, 5);
      const items = itemBlocks.map((block) => {
        const t = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const l = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || block.match(/<link[^>]*href="([^"]+)"/i);
        const title = (t && t[1] || '').replace(/<[^>]+>/g, '').replace(/^\s+|\s+$/g, '').slice(0, 80);
        const link = (l && l[1] || '').trim();
        return { title, link };
      });
      const reply = items.length ? items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.link}`).join('\n') : 'No items. Set PIKO_NEWS_RSS_URL or NEWS_API_KEY for /news <query>.';
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[news]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'News error: ' + e.message }));
    }
  }

  // —— Phase 2: /gmail ——
  const gmailRefreshLive = process.env.GMAIL_REFRESH_TOKEN || GMAIL_REFRESH_TOKEN;
  const gmailConfigured = GMAIL_ACCESS_TOKEN || (gmailRefreshLive && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET);
  if (message.startsWith('/gmail ') && gmailConfigured) {
    const rest = message.slice(7).trim();
    const parts = rest.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ');
    try {
      const { fetchUnreadEmails, fetchSearchEmails, fetchMessageById } = require('./lib/gmailContext');
      let lines = [];
      if (cmd === 'unread' || cmd === 'inbox') {
        const includeBody = arg.toLowerCase() === 'full';
        const { ok, emails } = await fetchUnreadEmails({ maxResults: 10, includeBody });
        if (!ok) return send(res, 200, JSON.stringify({ reply: 'Gmail: could not fetch unread.' }));
        lines = emails.map((e, i) => {
          let l = `${i + 1}. ${e.from || '(unknown)'} | ${(e.subject || '(no subject)').slice(0, 60)}`;
          if (includeBody && e.body && e.body.trim()) l += '\n   ' + e.body.trim().slice(0, 300);
          return l;
        });
      } else if (cmd === 'search') {
        if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail search <query>' }));
        const { ok, emails } = await fetchSearchEmails(arg, { maxResults: 8, includeBody: true });
        if (!ok) return send(res, 200, JSON.stringify({ reply: 'Gmail: search failed.' }));
        lines = emails.map((e, i) => {
          let l = `${i + 1}. ${e.from || '(unknown)'} | ${(e.subject || '(no subject)').slice(0, 60)}`;
          if (e.body && e.body.trim()) l += '\n   ' + e.body.trim().slice(0, 200);
          return l;
        });
      } else if (cmd === 'read') {
        if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail read <message-id>' }));
        const { ok, email } = await fetchMessageById(arg, true);
        if (!ok || !email) return send(res, 200, JSON.stringify({ reply: 'Gmail: could not fetch that message.' }));
        lines = [`From: ${email.from || '(unknown)'}`, `Subject: ${email.subject || '(no subject)'}`, `Date: ${email.date || ''}`, '', (email.body || email.snippet || '').slice(0, 2000)];
      } else {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail unread | unread full | search <query> | read <id>' }));
      }
      const reply = lines.length ? lines.join('\n') : 'No messages found.';
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[gmail]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Gmail error: ' + e.message }));
    }
  }
  if (message.startsWith('/gmail ') && !gmailConfigured) {
    return send(res, 200, JSON.stringify({ reply: 'Set GMAIL_ACCESS_TOKEN or GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET for /gmail.' }));
  }

  // —— Intent orders: /intents (list, show, done, snooze, add task) ——
  if (message === '/intents' || message.startsWith('/intents ')) {
    const rest = message.slice(8).trim();
    const intents = loadIntents();
    if (rest === 'list' || rest.startsWith('list')) {
      const statusPart = rest.slice(4).trim() || 'pending';
      const status = statusPart === 'all' ? null : statusPart;
      const filtered = status ? intents.filter((i) => i.status === status) : intents;
      if (!filtered.length) return send(res, 200, JSON.stringify({ reply: `No intents with status ${status || 'any'}.` }));
      const lines = filtered.map((i) => `${i.id}: [${i.type}/${i.status}] ${(i.title || i.description || i.task || i.message || '(no title)').slice(0, 60)}`);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    }
    if (rest.startsWith('show ')) {
      const id = rest.slice(5).trim();
      const intent = intents.find((i) => i.id === id || String(i.id) === id);
      if (!intent) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      const reply = [
        `id: ${intent.id}`,
        `type: ${intent.type}`,
        `status: ${intent.status}`,
        `title: ${intent.title || ''}`,
        `description: ${intent.description || ''}`,
        `dueAt: ${intent.dueAt || intent.time || intent.run || ''}`,
        `schedule: ${intent.schedule || ''}`,
        `command: ${intent.command || ''}`,
        `source: ${intent.source || ''}`,
        `sessionId: ${intent.sessionId || ''}`,
        `snoozedUntil: ${intent.snoozedUntil || ''}`,
        `lastFiredAt: ${intent.lastFiredAt || ''}`,
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (rest.startsWith('done ')) {
      const id = rest.slice(5).trim();
      const updated = updateIntent(id, { status: 'done' });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      return send(res, 200, JSON.stringify({ reply: `Marked ${id} as done.` }));
    }
    if (rest.startsWith('snooze ')) {
      const parts = rest.slice(7).trim().split(/\s+/);
      const id = parts[0];
      const durationStr = parts[1];
      const ms = parseDuration(durationStr);
      if (!ms) return send(res, 200, JSON.stringify({ reply: 'Invalid duration. Use 30m, 2h, 1d, 1w.' }));
      const until = new Date(Date.now() + ms).toISOString();
      const updated = updateIntent(id, { snoozedUntil: until });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      return send(res, 200, JSON.stringify({ reply: `Snoozed ${id} until ${until}.` }));
    }
    if (rest.startsWith('add task ')) {
      const taskRest = rest.slice(9).trim();
      const pipe = taskRest.indexOf('|');
      const title = (pipe >= 0 ? taskRest.slice(0, pipe).trim() : taskRest) || '';
      const description = pipe >= 0 ? taskRest.slice(pipe + 1).trim() : '';
      if (!title) return send(res, 200, JSON.stringify({ reply: 'Usage: /intents add task <title> [| description]' }));
      const intent = createIntent({ type: 'task', title, description, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Created task intent ${intent.id}.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /intents list [status] | show <id> | done <id> | snooze <id> <duration> | add task <title> [| description]' }));
  }

  // —— Intent orders: /queue ——
  if (message === '/queue' || message.startsWith('/queue ')) {
    const rest = message.slice(7).trim();
    const intents = loadIntents();
    const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
    if (rest === 'list') {
      const lines = queue.length ? queue.map((q, i) => `${i + 1}. ${q.title || q.task || q.message || ''}`).join('\n') : 'Queue is empty.';
      return send(res, 200, JSON.stringify({ reply: lines }));
    }
    if (rest === 'next') {
      const next = queue[0];
      if (!next) return send(res, 200, JSON.stringify({ reply: 'Queue is empty.' }));
      const taskMsg = (next.title || next.task || next.message || '').trim();
      updateIntent(next.id, { status: 'done' });
      const apiKey = process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_BOT;
      if (apiKey && taskMsg.toLowerCase().startsWith('/task')) {
        const taskCmd = parseTaskCommand(taskMsg);
        if (taskCmd && taskCmd.task) {
          const cursorOutput = await runTaskCommand(taskCmd, { sandbox: sessionsConfig[key] && sessionsConfig[key].sandbox });
          return send(res, 200, JSON.stringify({ reply: 'Queue item done:\n' + (cursorOutput.slice(0, 2000) + (cursorOutput.length > 2000 ? '…' : '')) }));
        }
      }
      return send(res, 200, JSON.stringify({ reply: 'Ran: ' + taskMsg.slice(0, 200) + (taskMsg.length > 200 ? '…' : '') }));
    }
    if (rest.startsWith('add ')) {
      const task = rest.slice(4).trim();
      if (!task) return send(res, 200, JSON.stringify({ reply: 'Usage: /queue add <task or /task ...>' }));
      createIntent({ type: 'task', title: task, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: 'Added to queue: ' + task.slice(0, 100) }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /queue add <task> | list | next' }));
  }

  // —— Intent orders: /remind ——
  if (message.startsWith('/remind ')) {
    const rest = message.slice(8).trim();
    if (rest === 'list') {
      const intents = loadIntents();
      const reminders = intents.filter((i) => i.type === 'reminder').sort((a, b) => new Date(a.dueAt || a.time || 0) - new Date(b.dueAt || b.time || 0));
      const lines = reminders.length ? reminders.map((r) => `${r.dueAt || r.time || ''} — ${(r.title || r.message || r.text || '').slice(0, 60)}`).join('\n') : 'No reminders.';
      return send(res, 200, JSON.stringify({ reply: lines }));
    }
    const space = rest.indexOf(' ');
    if (space <= 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /remind <time> <text> or /remind list' }));
    const timeStr = rest.slice(0, space).trim();
    const text = rest.slice(space + 1).trim();
    if (!text) return send(res, 200, JSON.stringify({ reply: 'Usage: /remind <time> <text>' }));
    let at;
    try {
      const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          at = new Date();
          at.setHours(h, m, 0, 0);
          if (at <= new Date()) at.setDate(at.getDate() + 1);
        }
      } else {
        at = new Date(timeStr);
      }
      if (!at || isNaN(at.getTime())) return send(res, 200, JSON.stringify({ reply: 'Invalid time. Use HH:MM or ISO date.' }));
      createIntent({ type: 'reminder', title: text, dueAt: at.toISOString(), source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Reminder set for ${at.toLocaleString()}: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid time.' }));
    }
  }

  // —— Intent orders: /schedule ——
  if (message.startsWith('/schedule ')) {
    const rest = message.slice(10).trim();
    const space = rest.indexOf(' ');
    if (space <= 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /schedule <time> <command> e.g. /schedule 09:00 /task Weekly report' }));
    const timeStr = rest.slice(0, space).trim();
    const command = rest.slice(space + 1).trim();
    if (!command) return send(res, 200, JSON.stringify({ reply: 'Usage: /schedule <time> <command>' }));
    try {
      let runAt = new Date(timeStr);
      if (isNaN(runAt.getTime())) {
        const [h, m] = timeStr.split(':').map(Number);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          runAt = new Date();
          runAt.setHours(h, m, 0, 0);
          if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);
        }
      }
      if (isNaN(runAt.getTime())) return send(res, 200, JSON.stringify({ reply: 'Invalid time. Use HH:MM or ISO.' }));
      createIntent({ type: 'scheduled', dueAt: runAt.toISOString(), command, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Scheduled for ${runAt.toLocaleString()}: ${command.slice(0, 60)}…` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid time.' }));
    }
  }

  // —— Phase 3: /chart ——
  if (message.startsWith('/chart ')) {
    const rest = message.slice(7).trim();
    const parts = rest.split(/\s+/);
    const type = (parts[0] || 'bar').toLowerCase();
    const dataStr = parts.slice(1).join(' ').replace(/\s+/g, ',') || '';
    const values = dataStr.split(/[,;\s]+/).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    if (values.length === 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /chart bar 10,20,30 or /chart line 1,2,3,4' }));
    const safe = values.map((v) => v).join(',');
    const url = `/api/chart?type=${encodeURIComponent(type)}&data=${encodeURIComponent(safe)}`;
    return send(res, 200, JSON.stringify({ reply: `${type} chart (${values.length} values): ${values.join(', ')}\nView: ${url}` }));
  }

  // —— /doctor ——
  if (message === '/doctor') {
    const lines = [];
    lines.push('Piko health:');
    lines.push('- Node: ' + process.version);
    lines.push('- Sandbox dir: ' + SANDBOX_DIR);
    try {
      fs.accessSync(SANDBOX_DIR, fs.constants.R_OK);
      lines.push('- Sandbox: readable');
    } catch (_) {
      lines.push('- Sandbox: not readable (mkdir or set PIKO_SANDBOX_DIR)');
    }
    try {
      const u = new URL(OLLAMA_URL);
      const opts = { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST' };
      const body = JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: 'user', content: 'hi' }], stream: false });
      await httpRequest(opts, body);
      lines.push('- Ollama: reachable');
    } catch (_) {
      lines.push('- Ollama: unreachable');
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const intents = loadIntents();
      lines.push('- Intents: ' + intents.length + ' stored');
    } catch (_) {
      lines.push('- Intents: storage error');
    }
    return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
  }

  // —— /task ——
  const taskCmd = parseTaskCommand(message);
  if (taskCmd && taskCmd.task) {
    const cursorOutput = await runTaskCommand(taskCmd, { sandbox: sessionsConfig[key] && sessionsConfig[key].sandbox });
    let reply = (cursorOutput.startsWith('Task skipped') || cursorOutput.startsWith('Task failed'))
      ? cursorOutput
      : 'Task finished:\n' + cursorOutput;

    // Discernment: Piko (Ollama) evaluates whether Cursor's result is satisfactory; if not, consult Grok.
    const discernmentSystem = 'You are Piko. Given a task and the result from Cursor, say whether the result fully addresses the task. Reply with exactly one line: SATISFIED or NOT_SATISFIED. Optionally add a short reason after a space or newline. Be concise.';
    const discernmentUser = `Task: ${taskCmd.task}\n\nCursor result:\n${cursorOutput.slice(0, 3000)}\n\nAre you satisfied that this result fully addresses the task? Reply SATISFIED or NOT_SATISFIED and optionally one short reason.`;
    try {
      const discernReply = await ollamaChat([
        { role: 'system', content: discernmentSystem },
        { role: 'user', content: discernmentUser },
      ], sessionModel);
      const notSatisfied = /NOT_SATISFIED|not\s+satisfied/i.test(discernReply || '');
      if (notSatisfied && GROK_API_KEY) {
        const grokSuggestion = await grokChat([
          { role: 'system', content: 'You are a neutral advisor. Give a brief, actionable suggestion only.' },
          { role: 'user', content: `Task sent to Cursor: "${taskCmd.task}"\n\nCursor result:\n${cursorOutput.slice(0, 2500)}\n\nWhat should we try next to get a better result from Cursor (e.g. how to re-prompt or what to clarify)? One short paragraph.` },
        ]);
        const reason = discernReply.replace(/NOT_SATISFIED|SATISFIED/gi, '').trim().slice(0, 200);
        reply += '\n\nPiko wasn\'t fully satisfied.';
        if (reason) reply += ' ' + reason;
        if (grokSuggestion) reply += '\n\nGrok suggests: ' + grokSuggestion.slice(0, 600);
      }
    } catch (e) {
      console.error('[discernment]', e.message);
    }

    return send(res, 200, JSON.stringify({ reply }));
  }
  // —— /cursor ——
  const cursor = parseCursorCommand(message);
  if (cursor) {
    const reply = await runCursorCommand(cursor);
    return send(res, 200, JSON.stringify({ reply }));
  }

  // —— Phase 4: Local skills (loadable from skills/index.js) ——
  for (const s of loadedSkills) {
    const match = typeof s.pattern === 'string' ? message.startsWith(s.pattern) : (s.pattern && s.pattern.test && s.pattern.test(message));
    if (match && typeof s.handler === 'function') {
      try {
        const reply = await Promise.resolve(s.handler(message));
        if (reply != null && reply !== '') return send(res, 200, JSON.stringify({ reply: typeof reply === 'string' ? reply : (reply.reply || '') }));
      } catch (e) {
        console.error('[skill]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Skill error: ' + e.message }));
      }
    }
  }

  // —— Chat (Ollama) ——
  if (profile === 'work') {
    return send(res, 200, JSON.stringify({ reply: 'Work session: use /task, /queue, /read, /ls, /status, /profile main for full chat.' }));
  }
  let history = sessionStore.getHistory(key) || [];
  history.push({ role: 'user', content: message });

  const correctionMatch = message.match(/^(?:actually|no,? it'?s?|that'?s wrong|correction:)\s*(.+)$/i);
  if (correctionMatch && history.length >= 2) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant && lastAssistant.content) {
      setImmediate(() => {
        try {
          appendCorrection(lastAssistant.content.slice(0, 400), correctionMatch[1].trim());
        } catch (_) {}
      });
    }
  }

  const wisdomAffirmMatch = message.match(/\b(w\d{3})\s*(?:is spot on|is right|that'?s right|affirm|confirmed|exactly|spot on)\b/i)
    || message.match(/(?:spot on|that'?s right|affirm|confirmed)[\s:,]*\s*(w\d{3})\b/i);
  if (wisdomAffirmMatch) {
    const wisdomId = (wisdomAffirmMatch[1] || wisdomAffirmMatch[2] || '').toLowerCase();
    if (wisdomId) {
      setImmediate(() => {
        try {
          const { wisdomConfirmed: metricsWisdomConfirmed } = require('./lib/metrics');
          metricsWisdomConfirmed(wisdomId);
        } catch (_) {}
      });
    }
  }

  const mind = loadMind();
  const primaryHuman = (mind.self_model.identity && mind.self_model.identity.primary_human) || process.env.PIKO_PRIMARY_HUMAN || '';
  const corpusBlock = getCorpusBlockForPrompt(primaryHuman);
  const truthBlock = getTruthBlockForPrompt();
  const userBeliefs = memory.getUserBeliefs();
  const plan = createResponsePlan({
    userBeliefs,
    mind,
    userMessage: message,
    recentEpisodic: memory.getEpisodic().slice(-3),
  });
  if (process.env.PIKO_PLANNER_DEBUG === '1' || process.env.PIKO_PLANNER_DEBUG === 'true') {
    log('info', 'planner', {
      beliefs_considered: userBeliefs.length,
      beliefs_summary: userBeliefs.slice(0, 5).map((b) => (b.proposition || '').slice(0, 50)),
      plan: { verbosity: plan.verbosity, tone: plan.tone, challenge_level: plan.challenge_level, follow_up_questions: plan.follow_up_questions },
      reason: plan.reason || null,
    }, {}, req.requestId);
  }
  const planLine = plan.capabilityQuestion
    ? '\n\n**This turn:** Capability question. Answer in one short line. Do not say "How can I assist you today?" or "I\'m Piko, a Christian AI...". Do not assume they are debugging. Just answer briefly.\n\n'
    : plan.casual
      ? ''
      : '\n\n' + formatPlanForPrompt(plan) + '\n\n';
  const noAssumeDebugLine = '\n\nDo not assume the user is debugging or has a bug unless they said so. Answer the question they actually asked.\n\n';
  const styleReminder = '\n\n**This turn:** Reply like a person. Never say "How can I assist you today?" or "ready to help." Never say "From corpus" or mention Piko as a project. One short line when that fits.';
  const leadingRule = '**You are Piko. Reply ONLY to the user\'s last message.** Never say "How can I assist you today?" or recite your role ("I\'m Piko, a Christian AI..."). Never say "From corpus" or mention Piko as a project. Never summarize, list, or describe the instructions or documents below. Never say you will review, incorporate, or restart anything. Never say "I\'m back online and ready to help" or "I\'m here to help." Answer the question they asked; do not assume they are debugging or have a bug unless they said so. Just reply naturally in character.\n\n';
  /** For casual turns: minimal prompt with small persona (no full identity / soul / memory). Phase 3.1.1 aligned with synthesis. */
  const CASUAL_SYSTEM_PROMPT = `You are Piko, a friendly, dry-humoured mate.

This is a casual greeting or small-talk turn.

Forbidden words: rain, rainy, spark, cozy, path, journey, forge, growth, reflect, ponder, quiet corner, clear the mind, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, perspective.

Use literal, concrete, everyday language only. No imagery, metaphor, abstraction, or reflective framing.

Rules:
- Reply with ONE short, natural sentence (under 12 words).
- Match the user's tone and energy.
- NEVER repeat or echo the user's exact words back as your reply.
- If they greet you, respond with a different short greeting or acknowledgment.
- If they say how they are and ask about you, answer briefly and optionally mirror in 1–3 words.
- Vary wording naturally; do not repeat the same phrases across replies.
- No themes, reflection, suggestions, projects, growth, or past topics.
- No questions unless they explicitly invite deeper talk.
- Do not provide advice, coping strategies, or suggestions unless explicitly requested.
- For emotional statements ("rough day", "feeling flat"), respond with empathy only. Do not offer advice, solutions, reframing, or worldview unless asked.
- Do NOT use: rainy days/mornings, quiet spots/corners, spark(ing) ideas, cozy, break free, grand visions, forging your own path, molds, authenticity, projects, theology, faith framing, corpus, truth block, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, clear the mind, sort thoughts. Do NOT say: "Morning there", "keeping dry as usual", "how are things shaping up", "stepping back", "anything new on that front".

Examples:
User: G'day Piko          You: G'day mate.
User: Hey Piko            You: Hey there — good to hear from you.
User: How are you going?  You: Doing alright — you?
User: It's going good. How about yourself?  You: Nice — same here.
User: Morning.            You: Morning — hope it's a smooth one.
User: That's short.       You: Keeping it brief and natural.
User: Cool.               You: Nice one.
User: I had a rough day.  You: Sorry to hear — you okay?
User: What do you think about coffee?  You: Good stuff — depends on the mood.`;
  const SOCIAL_CHAT_SYSTEM_PROMPT = `You are Piko, a friendly, grounded mate.

This is a normal social conversation turn (not deep worldview content).

Rules:
- Reply naturally in 1-2 short sentences.
- Keep it conversational and context-aware to the most recent exchange.
- If the user invites chat, accept directly and continue naturally.
- No theology/worldview themes unless the user explicitly asks for them.
- No reflective slogans, metaphors, or abstract framing.
- Avoid stock resets like "Hey — what's up?" when they already opened the topic.

Good examples:
User: Good, good. I'm just doing some work. Want to chat for a while?
You: Yeah, happy to chat — what's on your mind?

User: Keen for a yarn?
You: For sure — what do you feel like talking about?`;
  let systemContent;
  if (plan.casual) {
    systemContent = CASUAL_SYSTEM_PROMPT;
  } else if (plan.socialChat) {
    systemContent = SOCIAL_CHAT_SYSTEM_PROMPT;
  } else {
    let gmailContext = '';
    try {
      const { getGmailContextBlock } = require('./lib/gmailContext');
      gmailContext = await getGmailContextBlock();
    } catch (_) {}
    const ragContext = getRagContext(message);
    const recentLearningBlock = getRecentLearningBlock();
    const stickyIdeasBlock = getStickyIdeasBlock();
    const memoryBlock = memory.getMemoryBlockForPrompt(8, 3);
    const baseContent = leadingRule + corpusBlock + truthBlock + memoryBlock + planLine + noAssumeDebugLine + (() => { try { const { getImpactBlockForPrompt } = require('./lib/impact'); return getImpactBlockForPrompt(); } catch (_) { return ''; } })() + SYSTEM_PROMPT + recentLearningBlock + stickyIdeasBlock + getAndConsumePendingQuestionBlock()
      + getDailyMemoryBlock(key)
      + gmailContext
      + ragContext
      + (process.env.PIKO_LEARNING_CHAT_INJECT === '0' ? '' : '\n\nOccasionally, when it fits the conversation, ask the user a genuine question drawn from your recent learning or from the themes you keep returning to—so they can share their perspective. Do not do this every message; only when natural.')
      + (process.env.PIKO_CONTROLLED_DIVERGENCE === '1' || process.env.PIKO_CONTROLLED_DIVERGENCE === 'true' ? '\n\n' + (process.env.PIKO_DIVERGENCE_PROMPT || 'Occasionally offer a different angle or gently challenge an assumption when it fits; do not simply echo the user.') : '')
      + styleReminder;
    systemContent = baseContent;
  }
  const META_SLIP_PATTERN = /I see you've edited|key takeaways|I'll review the changes|I'm back online and ready to help|It's great to be back online|I'll restart the bot|persona document to refine|To confirm, the key takeaways|what'?s on your mind today/i;
  const HERE_TO_HELP_PATTERN = /I'm here to help/i;
  const EVASIVE_PATTERN = /could you clarify|I'm not sure what you mean by/i;
  /** User explicitly invited conversation — use conversational fallback instead of generic "Hey — what's up?" when we strip meta slips. */
  const INVITATION_TO_CHAT = /want to (chat|talk|have a chat)|up for a chat|feel like chatting|chat for a while|shoot the breeze|hang out/i;
  const INVITATION_FALLBACKS = ["Sure — what's on your mind?", "Yeah, happy to chat — what's up?", "Cool — what do you want to talk about?"];
  /** Stray learning echo: model appends a sentence that sounds like rabbit-hole content (e.g. "Their X were quite advanced for their time") without the user asking. */
  const STRAY_LEARNING_ECHO_PATTERN = /(?:^|\n)\s*(?:Their|Their .+ (?:were|was) (?:quite |remarkably )?(?:advanced|sophisticated|interesting) for their time\.?)\s*$/i;
  const PERSONAL_LIFE_ASK = /(want to )?talk about (my )?personal life|talk about (my )?life|how (I'm )?doing|how (I'm )?feeling/i;
  const CODING_IN_REPLY = /cod(e|ing)|tech(nology)?|ethical considerations|debug|programming|integrat(e|ion)|efficiency.*code/i;
  const STILTED_STOCK_PATTERN = /(^that settles it\.?$|^g'?day\s*[—-]\s*you\.?$|morning mate|anything new(?:\s+on that front|\s+brewing)?|same old\.?$|how're things\.?$|how's it rolling\.?$)/i;
  const MODE_FALLBACKS = {
    GREETING: [
      "Hey there — good to hear from you.",
      "G'day — nice to hear from you.",
      "Hey — good to hear your voice.",
    ],
    RECIPROCITY: [
      "Not bad — you?",
      "Pretty good — same here.",
      "Doing alright — you?",
    ],
    SOCIAL_EMPATHY: [
      "Sorry you're feeling that — I'm with you.",
      "That sounds rough — thanks for sharing.",
      "I hear you — that sounds heavy.",
    ],
    LIGHT_OPINION: [
      "Fair shout — depends on the day.",
      "I rate it, honestly.",
      "Not my favourite, but I get the appeal.",
    ],
    SIGN_OFF: [
      "No worries — catch you soon.",
      "Cheers — talk soon.",
      "All good — see you.",
    ],
    CASUAL: [
      "Hey — good to hear from you.",
      "Good to hear from you.",
      "Nice one — good to hear from you.",
    ],
    SOCIAL_CHAT: [
      "Yeah, happy to chat — what's on your mind?",
      "For sure — what do you want to talk about?",
      "Absolutely — I'm here for a yarn.",
    ],
  };
  function pickDeterministic(items, seed, turnCount = 0) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h + s.charCodeAt(i) * (i + 1)) >>> 0;
    const idx = (h + Number(turnCount || 0)) % items.length;
    return items[idx];
  }
  function applyModeFallback(userMsg, reply, planObj, ctx = {}) {
    if (!reply || typeof reply !== 'string') return reply;
    const text = reply.trim();
    if (!text) return reply;
    const words = text.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words).size;
    const uniqueRatio = words.length > 0 ? (uniqueWords / words.length) : 1;
    const repetitive = words.length >= 5 && uniqueRatio < 0.5;
    const tooShortToBeUseful = words.length <= 1;
    const stilted = STILTED_STOCK_PATTERN.test(text) || tooShortToBeUseful || repetitive;
    const seed = `${ctx.sessionId || 'default'}:${planObj.casualMode || (planObj.socialChat ? 'SOCIAL_CHAT' : 'GENERAL')}`;
    const turnCount = Number(ctx.turnCount || 0);
    if (planObj.socialChat) {
      if (stilted || text.length > 160) return pickDeterministic(MODE_FALLBACKS.SOCIAL_CHAT, seed, turnCount);
      return reply;
    }
    if (!planObj.casual) return reply;
    const mode = planObj.casualMode || 'CASUAL';
    let shouldFallback = stilted;
    if (mode === 'GREETING') {
      const greetingLike = /(hey|hi|hello|g'?day|good to hear|nice to hear|morning|yo|cheers|not bad|pretty good|doing alright)/i.test(text);
      if (!greetingLike) shouldFallback = true;
    }
    if (mode === 'RECIPROCITY') {
      const selfStatusLike = /(not bad|pretty good|doing|all good|same here|same boat|busy|good)/i.test(text);
      if (!selfStatusLike) shouldFallback = true;
    }
    if (mode === 'SIGN_OFF' && /\?/.test(text)) shouldFallback = true;
    if (mode === 'SOCIAL_EMPATHY' && !/(sorry|rough|hear you|that sounds|tough|flat|with you|okay|ok)/i.test(text)) shouldFallback = true;
    if (mode === 'LIGHT_OPINION' && /(morning mate|anything new|same old|g'?day\s*[—-]\s*you)/i.test(text)) shouldFallback = true;
    if (!shouldFallback) return reply;
    return pickDeterministic(MODE_FALLBACKS[mode] || MODE_FALLBACKS.CASUAL, seed, turnCount);
  }
  function stripMetaSlip(text, userMessage) {
    if (!text || typeof text !== 'string') return text;
    let fallback = "Hey — what's up?";
    if (userMessage && INVITATION_TO_CHAT.test(userMessage)) {
      fallback = INVITATION_FALLBACKS[Math.floor(Math.random() * INVITATION_FALLBACKS.length)];
    }
    if (META_SLIP_PATTERN.test(text)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    if (HERE_TO_HELP_PATTERN.test(text)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    if (EVASIVE_PATTERN.test(text)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    const t = text.trim();
    if (t === "I'm Piko." || t === "I'm Piko") return "Piko.";
    const stray = text.replace(STRAY_LEARNING_ECHO_PATTERN, '').trim();
    if (stray.length > 0 && stray.length < text.length) return stray;
    return text;
  }
  function fixPersonalLifeDeflection(userMsg, reply) {
    if (!reply || typeof reply !== 'string') return reply;
    if (!PERSONAL_LIFE_ASK.test(userMsg)) return reply;
    if (!CODING_IN_REPLY.test(reply)) return reply;
    return "Sure — what's on your mind?";
  }
  /** For casual: truncate at first theme injection (pondering, blend, tradition, theology attractors, etc.). */
  function stripCasualThemeBleed(text) {
    if (!text || typeof text !== 'string') return text;
    const themeBleed = /[\s—,]*(though I've been|pondering|can we blend|tradition with innovation|old-new mix|spill the tea on|forging your own path|breaking free from molds|what makes you unique|big plans|grand visions|making do without|cut out for grand|how are things on your side|how's your project|unique you|care to dive deeper|rainy days?|rainy mornings?|quiet (spot|corner)s?|spark(ing)? ideas?|cozy (spot|corner)s?|clear the mind|sort thoughts|break free|authenticity|faith framing|corpus|truth block|jot down|regrouping|overwhelming|productive|stimulating|wander|flow|morning there|keeping dry as usual|how are things shaping up|stepping back|anything new on that front)/i;
    const idx = text.search(themeBleed);
    if (idx > 0) {
      const before = text.slice(0, idx).replace(/\s*[—,]\s*$/, '').trim();
      if (before.length > 0) return before;
    }
    return text;
  }
  /** For casual: if the model echoed the user's greeting, or defaulted to "G'day Piko" when user said something else, replace with fallback. */
  function fixEchoReply(userMsg, reply) {
    if (!reply || typeof reply !== 'string' || !userMsg) return reply;
    const norm = (s) => (s || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/[\u2019\u2018\u201B]/g, "'");
    const u = norm(userMsg);
    const r = norm(reply);
    if (u.length > 0 && r === u) return "Hey — what's up?";
    if (u.length > 2 && r.startsWith(u) && r.length <= u.length + 5) return "Hey — what's up?";
    const gdayPikoOnly = /^g'?day\s+piko[\s—\-.]*$/i;
    if (gdayPikoOnly.test(r) && !/g'?day|piko/.test(u)) return "Hey — what's up?";
    return reply;
  }
  // Routing windows:
  // - casual: no history (anti-bleed)
  // - socialChat: short continuity window for natural back-and-forth without full worldview stack
  // - full: normal conversation window
  const historyWindow = plan.casual ? 0 : (plan.socialChat ? 4 : SLICE_HISTORY);
  const historyPart = history.slice(-historyWindow).map(({ role, content }) => ({ role, content }));
  const casualMaxTokens = plan.casual ? (plan.casualMode === 'GREETING' ? 24 : (plan.casualMode === 'RECIPROCITY' ? 28 : 32)) : 4000;
  const casualTemp = plan.casual ? (plan.casualMode === 'GREETING' ? 0.6 : 0.65) : 0.9;
  const socialChatOptions = plan.socialChat ? { max_tokens: 80, temperature: 0.72, repeat_penalty: 1.2, presence_penalty: 0.15, frequency_penalty: 0.1 } : null;
  if (process.env.PIKO_LOG_CASUAL === '1' || process.env.PIKO_DEBUG_CASUAL === '1') {
    const route = plan.casual ? 'casual' : (plan.socialChat ? 'socialChat' : 'full');
    console.log('[CASUAL]', JSON.stringify({
      sessionId: (key || '').slice(0, 24),
      route,
      casual: plan.casual,
      socialChat: plan.socialChat,
      casualMode: plan.casualMode,
      reason: plan.reason,
      historyLen: historyPart.length,
      maxTokens: plan.casual ? casualMaxTokens : (plan.socialChat ? socialChatOptions.max_tokens : 4000),
      temperature: plan.casual ? casualTemp : (plan.socialChat ? socialChatOptions.temperature : 0.9),
      repeatPenalty: plan.casual ? 1.25 : (plan.socialChat ? socialChatOptions.repeat_penalty : 1.12),
    }));
  }
  const messages = [
    { role: 'system', content: systemContent },
    ...historyPart,
  ];
  if (plan.casual || plan.socialChat) messages.push({ role: 'user', content: message });
  const latencyStart = Date.now();
  let latencyFirstToken = null;
  try {
    if (streamReply) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const streamOptions = plan.casual
        ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15 }
        : (plan.socialChat ? socialChatOptions : {});
      let reply = await ollamaChatStream(messages, (delta) => {
        if (latencyFirstToken === null) latencyFirstToken = Date.now();
        res.write('data: ' + JSON.stringify({ content: delta }) + '\n\n');
      }, sessionModel, streamOptions);
      const latencyTotal = Date.now() - latencyStart;
      log('info', 'latency', { stream: true, historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal }, req.requestId);
      if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal });
      if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
        console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
      }
      reply = stripMetaSlip(reply, message);
      reply = fixPersonalLifeDeflection(message, reply) || reply;
      if ((plan.casual || plan.socialChat) && reply) {
        reply = stripCasualThemeBleed(reply) || reply;
        if (plan.casual) {
          reply = fixEchoReply(message, reply) || reply;
          const cleaned = reply.trim().split(/\n+/)[0] || '';
          const firstSentence = cleaned.split(/[.!?]/)[0].trim();
          if (firstSentence.length > 0) {
            reply = firstSentence;
            if (!/[.!?]$/.test(reply)) reply = reply + '.';
          }
        } else if (plan.socialChat) {
          const cleaned = reply.trim().split(/\n+/)[0] || '';
          const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
          if (sentences.length > 0) reply = sentences.join(' ').trim();
          if (!/[.!?]$/.test(reply)) reply = reply + '.';
        }
        reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
      }
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      if (process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true') {
        try {
          const dm = require('./lib/dailyMemory');
          dm.append(key, 'user', message);
          dm.append(key, 'assistant', reply);
        } catch (_) {}
      }
      const lastExchange = history.slice(-2);
      setImmediate(() => updateMind(lastExchange).catch(() => {}));
      setImmediate(() =>
        beliefLoop.ingestRecentExperience(key).then(() => beliefLoop.applyBehaviourSignals(key, message, reply)).catch(() => {})
      );
      res.write('data: ' + JSON.stringify({ done: true, reply }) + '\n\n');
      res.end();
      return;
    }
    const chatOptions = plan.casual
      ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15 }
      : (plan.socialChat ? socialChatOptions : {});
    let reply = await ollamaChat(messages, sessionModel, chatOptions);
    const latencyTotal = Date.now() - latencyStart;
    log('info', 'latency', { stream: false, historyMessages: historyPart.length, totalMs: latencyTotal }, req.requestId);
    if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { historyMessages: historyPart.length, totalMs: latencyTotal });
    if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
      console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
    }
    reply = stripMetaSlip(reply, message);
    reply = fixPersonalLifeDeflection(message, reply) || reply;
    if ((plan.casual || plan.socialChat) && reply) {
      reply = stripCasualThemeBleed(reply) || reply;
      if (plan.casual) {
        reply = fixEchoReply(message, reply) || reply;
        const cleaned = reply.trim().split(/\n+/)[0] || '';
        const firstSentence = cleaned.split(/[.!?]/)[0].trim();
        if (firstSentence.length > 0) {
          reply = firstSentence;
          if (!/[.!?]$/.test(reply)) reply = reply + '.';
        }
      } else if (plan.socialChat) {
        const cleaned = reply.trim().split(/\n+/)[0] || '';
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
        if (sentences.length > 0) reply = sentences.join(' ').trim();
        if (!/[.!?]$/.test(reply)) reply = reply + '.';
      }
      reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
    }
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    if (process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true') {
      try {
        const dm = require('./lib/dailyMemory');
        dm.append(key, 'user', message);
        dm.append(key, 'assistant', reply);
      } catch (_) {}
    }
    const lastExchangeNonStream = history.slice(-2);
    setImmediate(() => updateMind(lastExchangeNonStream).catch(() => {}));
    setImmediate(() =>
      beliefLoop.ingestRecentExperience(key).then(() => beliefLoop.applyBehaviourSignals(key, message, reply)).catch(() => {})
    );
    send(res, 200, JSON.stringify({ reply }));
  } catch (e) {
    metrics.errors++;
    log('error', 'Ollama error', { message: e.message }, req.requestId);
    console.error('[ERROR] Ollama:', e.message);
    let errMsg = 'Ollama error: ' + e.message;
    if (e.message && e.message.includes('OPENAI_API_KEY')) {
      errMsg += ' Set PIKO_OLLAMA_ONLY=1 in the server env and ensure Ollama is reachable (e.g. OLLAMA_URL).';
    }
    send(res, 502, JSON.stringify({ error: errMsg }));
  }
}

function serveFile(filePath, contentType) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err);
      resolve({ data, contentType });
    });
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ico': 'image/x-icon',
};

async function handleRequest(req, res) {
  req.requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const { pathname } = parseUrl(req.url);

  if (req.method === 'POST' && pathname === '/api/chat') {
    return handleApiChat(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/ios-hub') {
    return handleIosHub(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/metrics') {
    const uptimeMs = Date.now() - startTime;
    return send(res, 200, JSON.stringify({
      requests: metrics.requests,
      errors: metrics.errors,
      chat: metrics.chat,
      commands: metrics.commands,
      uptimeMs,
      uptime: `${Math.floor(uptimeMs / 60000)}m`,
    }));
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const { query } = parseUrl(req.url);
    const tail = Math.min(100, Math.max(1, parseInt(query && query.tail, 10) || 20));
    let lines = [];
    try {
      const raw = fs.readFileSync(LOG_PATH, 'utf8');
      lines = raw.split('\n').filter(Boolean).slice(-tail);
    } catch (_) {}
    return send(res, 200, JSON.stringify({ logs: lines }));
  }

  // —— State API (read-only; localhost only) ——
  function isLocal(req) {
    const addr = req.socket && req.socket.remoteAddress;
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }
  /** Corpus edit lock: if PIKO_CORPUS_EDIT_ALLOWED_IP or PIKO_CORPUS_EDIT_HEADER is set, require match. */
  function canEditCorpus(req) {
    const allowedIps = (process.env.PIKO_CORPUS_EDIT_ALLOWED_IP || '').split(',').map((s) => s.trim()).filter(Boolean);
    const headerName = (process.env.PIKO_CORPUS_EDIT_HEADER || '').trim().toLowerCase();
    if (allowedIps.length === 0 && !headerName) return true;
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    if (allowedIps.length && allowedIps.some((ip) => clientIp === ip || clientIp === `::ffff:${ip}`)) return true;
    if (headerName && req.headers[headerName] !== undefined && req.headers[headerName] !== '') return true;
    return false;
  }
  /** Control panel / API protection: if PIKO_CONTROL_ALLOWED_IP or PIKO_CONTROL_HEADER is set, require match. */
  function canAccessControl(req) {
    const allowedIps = (process.env.PIKO_CONTROL_ALLOWED_IP || '').split(',').map((s) => s.trim()).filter(Boolean);
    const headerName = (process.env.PIKO_CONTROL_HEADER || '').trim().toLowerCase();
    if (allowedIps.length === 0 && !headerName) return true;
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    if (allowedIps.length && allowedIps.some((ip) => clientIp === ip || clientIp === `::ffff:${ip}`)) return true;
    if (headerName && req.headers[headerName] !== undefined && req.headers[headerName] !== '') return true;
    return false;
  }
  const controlPaths = pathname === '/control' || pathname.startsWith('/control-') || pathname === '/api/control' || pathname === '/api/integrations/linked' || pathname === '/api/gmail/unread' || (pathname && (pathname.startsWith('/api/control/') || pathname === '/api/ea-alerts' || pathname === '/api/ea-preferences' || pathname === '/api/oauth/gmail/start' || pathname === '/api/oauth/slack/start' || pathname === '/api/oauth/notion/start'));
  if (controlPaths && !canAccessControl(req)) {
    return send(res, 403, JSON.stringify({ error: 'Control access not allowed' }));
  }

  if (req.method === 'GET' && pathname === '/api/integrations/linked') {
    const linked = loadLinkedAccounts();
    const configured = {
      gmail: !!(process.env.GMAIL_ACCESS_TOKEN || (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET)),
      slack: !!process.env.SLACK_BOT_TOKEN,
      notion: !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY),
    };
    return send(res, 200, JSON.stringify({ linkedAccounts: linked, configured }));
  }

  // —— Gmail unread API (JSON for app) ——
  if (req.method === 'GET' && pathname === '/api/gmail/unread') {
    const gmailRefreshLive = process.env.GMAIL_REFRESH_TOKEN || GMAIL_REFRESH_TOKEN;
    if (!GMAIL_ACCESS_TOKEN && !(gmailRefreshLive && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET)) {
      return send(res, 200, JSON.stringify({ ok: false, error: 'Gmail not configured', emails: [] }));
    }
    try {
      let token = GMAIL_ACCESS_TOKEN;
      if (!token && gmailRefreshLive) {
        const body = new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: gmailRefreshLive, grant_type: 'refresh_token' }).toString();
        const opts = { hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
        const { data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        token = json.access_token;
      }
      if (!token) return send(res, 200, JSON.stringify({ ok: false, error: 'No access token', emails: [] }));
      const listOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages?maxResults=15&q=is:unread', method: 'GET', headers: { 'Authorization': 'Bearer ' + token } };
      const { statusCode, data: listData } = await httpsRequest(listOpts);
      if (statusCode !== 200) return send(res, 200, JSON.stringify({ ok: false, error: 'Gmail API error', emails: [] }));
      const list = JSON.parse(listData);
      const ids = (list.messages || []).map((m) => m.id);
      const emails = [];
      for (const id of ids) {
        const msgOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', method: 'GET', headers: { 'Authorization': 'Bearer ' + token } };
        const { data: msgData } = await httpsRequest(msgOpts);
        const msg = JSON.parse(msgData);
        const headers = (msg.payload && msg.payload.headers) || [];
        const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
        const snippet = (msg.snippet || '').slice(0, 120);
        emails.push({ id: id, from: getH('From'), subject: getH('Subject') || '(no subject)', date: getH('Date'), snippet });
      }
      return send(res, 200, JSON.stringify({ ok: true, emails }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ ok: false, error: e.message || 'Gmail error', emails: [] }));
    }
  }

  // —— Gmail OAuth: Connect Gmail flow (same result as manual refresh token) ——
  if (req.method === 'GET' && pathname === '/api/oauth/gmail/start') {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
      return send(res, 400, 'Gmail OAuth not configured: set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env');
    }
    const { query } = parseUrl(req.url);
    const fromApp = query && query.from === 'app';
    const stateHex = crypto.randomBytes(24).toString('hex');
    const state = fromApp ? stateHex + ':app' : stateHex;
    gmailOAuthStateMap.set(stateHex, { createdAt: Date.now(), fromApp: !!fromApp });
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/gmail/callback';
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_OAUTH_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/api/oauth/gmail/callback') {
    const { query } = parseUrl(req.url);
    const code = query && query.code;
    const state = query && query.state;
    const error = query && query.error;
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [s, v] of gmailOAuthStateMap.entries()) {
      if (v.createdAt < tenMinAgo) gmailOAuthStateMap.delete(s);
    }
    if (error) {
      const errStateHex = state && String(state).endsWith(':app') ? String(state).slice(0, -4) : state;
      const errFromApp = errStateHex && gmailOAuthStateMap.get(errStateHex)?.fromApp;
      const errRedirect = errFromApp ? 'piko://oauth-done?service=gmail&error=' + encodeURIComponent(error) : '/control-integrations?gmail=error&message=' + encodeURIComponent(error);
      res.writeHead(302, { Location: errRedirect });
      res.end();
      return;
    }
    const stateHex = state && state.endsWith(':app') ? state.slice(0, -4) : state;
    const stateMeta = stateHex ? gmailOAuthStateMap.get(stateHex) : undefined;
    if (!stateHex || !stateMeta) {
      return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
    }
    const fromApp = !!stateMeta.fromApp;
    gmailOAuthStateMap.delete(stateHex);
    if (!code) {
      return send(res, 400, 'Missing authorization code.');
    }
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/gmail/callback';
    const body = new URLSearchParams({
      code,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();
    try {
      const tokenRes = await new Promise((resolve, reject) => {
        const reqOpt = new URL('https://oauth2.googleapis.com/token');
        const post = https.request(
          reqOpt,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          }
        );
        post.on('error', reject);
        post.write(body);
        post.end();
      });
      const parsed = JSON.parse(tokenRes.data);
      if (parsed.error) {
        const msg = encodeURIComponent(parsed.error + ': ' + (parsed.error_description || ''));
        const tokErrRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=' + msg : '/control-integrations?gmail=error&message=' + msg;
        res.writeHead(302, { Location: tokErrRedirect });
        res.end();
        return;
      }
      const refreshToken = parsed.refresh_token;
      if (!refreshToken) {
        const noTokRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=No+refresh+token' : '/control-integrations?gmail=error&message=No+refresh+token+returned';
        res.writeHead(302, { Location: noTokRedirect });
        res.end();
        return;
      }
      process.env.GMAIL_REFRESH_TOKEN = refreshToken;
      const envPath = path.join(__dirname, '.env');
      let envContent = '';
      try {
        envContent = fs.readFileSync(envPath, 'utf8');
      } catch (_) {}
      const line = 'GMAIL_REFRESH_TOKEN=' + refreshToken.replace(/\n/g, '') + '\n';
      if (/^GMAIL_REFRESH_TOKEN=/m.test(envContent)) {
        envContent = envContent.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, 'GMAIL_REFRESH_TOKEN=' + refreshToken.replace(/\n/g, ''));
      } else {
        envContent = (envContent.trimEnd() ? envContent + '\n' : '') + line;
      }
      try {
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch (e) {
        log('warn', 'gmail-oauth-env-write', { error: e.message });
      }
      let gmailEmail = '';
      const accessToken = parsed.access_token;
      if (accessToken) {
        try {
          const profileRes = await new Promise((resolve, reject) => {
            https.get(
              'https://gmail.googleapis.com/gmail/v1/users/me/profile',
              { headers: { Authorization: 'Bearer ' + accessToken } },
              (resp) => {
                let data = '';
                resp.on('data', (c) => (data += c));
                resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
              }
            ).on('error', reject);
          });
          if (profileRes.statusCode === 200) {
            const profile = JSON.parse(profileRes.data);
            if (profile && profile.emailAddress) gmailEmail = profile.emailAddress;
          }
        } catch (_) {}
      }
      const linked = loadLinkedAccounts();
      if (gmailEmail) linked.gmail = { email: gmailEmail }; else delete linked.gmail;
      saveLinkedAccounts(linked);
      const redirectUrl = fromApp ? 'piko://oauth-done?service=gmail&success=1' : '/control-integrations?gmail=connected';
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      return;
    } catch (e) {
      log('warn', 'gmail-oauth-token-exchange', { error: e.message });
      const msg = encodeURIComponent(e.message || 'Token exchange failed');
      const catchRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=' + msg : '/control-integrations?gmail=error&message=' + msg;
      res.writeHead(302, { Location: catchRedirect });
      res.end();
      return;
    }
  }

  // —— Slack OAuth: Connect Slack (same pattern as Gmail) ——
  if (req.method === 'GET' && pathname === '/api/oauth/slack/start') {
    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
      return send(res, 400, 'Slack OAuth not configured: set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env');
    }
    const state = crypto.randomBytes(24).toString('hex');
    slackOAuthStateMap.set(state, { createdAt: Date.now() });
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/slack/callback';
    const authUrl = 'https://slack.com/oauth/v2/authorize?' + new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      scope: SLACK_OAUTH_SCOPES,
      redirect_uri: redirectUri,
      state,
    }).toString();
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/api/oauth/slack/callback') {
    const { query } = parseUrl(req.url);
    const code = query && query.code;
    const state = query && query.state;
    const error = query && query.error;
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [s, v] of slackOAuthStateMap.entries()) {
      if (v.createdAt < tenMinAgo) slackOAuthStateMap.delete(s);
    }
    if (error) {
      res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(error) });
      res.end();
      return;
    }
    if (!state || !slackOAuthStateMap.has(state)) {
      return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
    }
    slackOAuthStateMap.delete(state);
    if (!code) {
      return send(res, 400, 'Missing authorization code.');
    }
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/slack/callback';
    const body = new URLSearchParams({ code, client_id: SLACK_CLIENT_ID, client_secret: SLACK_CLIENT_SECRET, redirect_uri: redirectUri }).toString();
    try {
      const tokenRes = await new Promise((resolve, reject) => {
        const post = https.request(
          new URL('https://slack.com/api/oauth.v2.access'),
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
          (resp) => {
            let data = '';
            resp.on('data', (c) => (data += c));
            resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
          }
        );
        post.on('error', reject);
        post.write(body);
        post.end();
      });
      const parsed = JSON.parse(tokenRes.data);
      if (!parsed.ok || !parsed.access_token) {
        res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(parsed.error || 'No token returned') });
        res.end();
        return;
      }
      persistEnvVar('SLACK_BOT_TOKEN', parsed.access_token);
      const linked = loadLinkedAccounts();
      if (parsed.team && parsed.team.name) linked.slack = { team: parsed.team.name }; else delete linked.slack;
      saveLinkedAccounts(linked);
      res.writeHead(302, { Location: '/control-integrations?slack=connected' });
      res.end();
      return;
    } catch (e) {
      log('warn', 'slack-oauth-token', { error: e.message });
      res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(e.message || 'Token exchange failed') });
      res.end();
      return;
    }
  }

  // —— Notion OAuth: Connect Notion ——
  if (req.method === 'GET' && pathname === '/api/oauth/notion/start') {
    if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
      return send(res, 400, 'Notion OAuth not configured: set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in .env (public integration)');
    }
    const state = crypto.randomBytes(24).toString('hex');
    notionOAuthStateMap.set(state, { createdAt: Date.now() });
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/notion/callback';
    const authUrl = 'https://api.notion.com/v1/oauth/authorize?' + new URLSearchParams({
      client_id: NOTION_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state,
    }).toString();
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/api/oauth/notion/callback') {
    const { query } = parseUrl(req.url);
    const code = query && query.code;
    const state = query && query.state;
    const error = query && query.error;
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [s, v] of notionOAuthStateMap.entries()) {
      if (v.createdAt < tenMinAgo) notionOAuthStateMap.delete(s);
    }
    if (error) {
      res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(error) });
      res.end();
      return;
    }
    if (!state || !notionOAuthStateMap.has(state)) {
      return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
    }
    notionOAuthStateMap.delete(state);
    if (!code) {
      return send(res, 400, 'Missing authorization code.');
    }
    const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const redirectUri = baseUrl + '/api/oauth/notion/callback';
    const basicAuth = Buffer.from(NOTION_CLIENT_ID + ':' + NOTION_CLIENT_SECRET).toString('base64');
    const body = JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    try {
      const tokenRes = await new Promise((resolve, reject) => {
        const post = https.request(
          new URL('https://api.notion.com/v1/oauth/token'),
          { method: 'POST', headers: { 'Authorization': 'Basic ' + basicAuth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (resp) => {
            let data = '';
            resp.on('data', (c) => (data += c));
            resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
          }
        );
        post.on('error', reject);
        post.write(body);
        post.end();
      });
      const parsed = JSON.parse(tokenRes.data);
      if (parsed.error || !parsed.access_token) {
        res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(parsed.error || 'No token returned') });
        res.end();
        return;
      }
      persistEnvVar('NOTION_TOKEN', parsed.access_token);
      if (parsed.refresh_token) persistEnvVar('NOTION_REFRESH_TOKEN', parsed.refresh_token);
      let notionLabel = 'Workspace';
      try {
        const meRes = await new Promise((resolve, reject) => {
          https.get(
            'https://api.notion.com/v1/users/me',
            { headers: { Authorization: 'Bearer ' + parsed.access_token, 'Notion-Version': '2022-06-28' } },
            (resp) => {
              let data = '';
              resp.on('data', (c) => (data += c));
              resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
            }
          ).on('error', reject);
        });
        if (meRes.statusCode === 200) {
          const me = JSON.parse(meRes.data);
          if (me && me.name) notionLabel = me.name;
        }
      } catch (_) {}
      const linked = loadLinkedAccounts();
      linked.notion = { workspace: notionLabel };
      saveLinkedAccounts(linked);
      res.writeHead(302, { Location: '/control-integrations?notion=connected' });
      res.end();
      return;
    } catch (e) {
      log('warn', 'notion-oauth-token', { error: e.message });
      res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(e.message || 'Token exchange failed') });
      res.end();
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/state/intents') {
    if (!isLocal(req)) return send(res, 403, JSON.stringify({ error: 'State API is localhost only' }));
    const { query } = parseUrl(req.url);
    let intents = loadIntents();
    const statusFilter = query && query.status;
    if (statusFilter && statusFilter !== 'all') intents = intents.filter((i) => i.status === statusFilter);
    return send(res, 200, JSON.stringify({ intents }));
  }
  if (req.method === 'GET' && pathname === '/api/state/sessions') {
    if (!isLocal(req)) return send(res, 403, JSON.stringify({ error: 'State API is localhost only' }));
    const sessions = loadSessionsConfig();
    return send(res, 200, JSON.stringify({ sessions }));
  }
  if (req.method === 'GET' && pathname === '/api/state/allowlist') {
    if (!isLocal(req)) return send(res, 403, JSON.stringify({ error: 'State API is localhost only' }));
    const allowlist = loadAllowlist();
    return send(res, 200, JSON.stringify({ allowlist }));
  }
  if (req.method === 'GET' && pathname === '/api/state/skills') {
    if (!isLocal(req)) return send(res, 403, JSON.stringify({ error: 'State API is localhost only' }));
    const skills = loadedSkills.map((s, i) => ({
      id: s.id || s.name || 'skill_' + i,
      pattern: typeof s.pattern === 'string' ? s.pattern : (s.pattern && s.pattern.toString ? s.pattern.toString() : ''),
    }));
    return send(res, 200, JSON.stringify({ skills }));
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    if (PIKO_HEALTH_API_KEY && PIKO_HEALTH_API_KEY.trim()) {
      const authHeader = (req.headers['authorization'] || '').trim();
      const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const key = bearer || apiKeyHeader;
      if (key !== PIKO_HEALTH_API_KEY.trim()) {
        return send(res, 401, JSON.stringify({ error: 'Unauthorized', message: 'Set Authorization: Bearer <key> or x-api-key' }));
      }
    }
    const ok = { ok: true, llm: MODEL_PRIMARY, model: OLLAMA_MODEL };
    try {
      await ai('hi', { max_tokens: 2 });
    } catch (_) {
      ok.ok = false;
      ok.llm = 'unreachable';
    }
    return send(res, 200, JSON.stringify(ok));
  }

  if (req.method === 'GET' && pathname === '/api/mind') {
    try {
      const mind = loadMind();
      const identity = mind.self_model.identity || {};
      const out = {
        primary_human: identity.primary_human || '',
        values: mind.self_model.values || [],
        constraints: mind.self_model.constraints || [],
        beliefs: mind.beliefs || [],
        goals: mind.goals || [],
        tensions: mind.tensions || [],
      };
      return send(res, 200, JSON.stringify(out));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if ((req.method === 'POST' && pathname === '/api/mind/primary-human') || (req.method === 'PUT' && pathname === '/api/mind')) {
    readBody(req)
      .then((body) => {
        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch (_) {
          return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
        }
        try {
          if (pathname === '/api/mind/primary-human' && data.primary_human !== undefined) {
            saveSelfModel({ primary_human: data.primary_human });
            return send(res, 200, JSON.stringify({ ok: true }));
          }
          if (pathname === '/api/mind' && req.method === 'PUT') {
            const selfUpdates = {};
            if (data.primary_human !== undefined) selfUpdates.primary_human = data.primary_human;
            if (data.values !== undefined) selfUpdates.values = data.values;
            if (data.constraints !== undefined) selfUpdates.constraints = data.constraints;
            if (Object.keys(selfUpdates).length) saveSelfModel(selfUpdates);
            if (data.beliefs !== undefined) saveBeliefs(data.beliefs);
            return send(res, 200, JSON.stringify({ ok: true }));
          }
          return send(res, 400, JSON.stringify({ error: 'Missing body or path' }));
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ error: e.message })));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/corpus') {
    try {
      const { index, docs } = loadCorpus();
      return send(res, 200, JSON.stringify({ index, documents: docs }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/corpus/regenerate-summary') {
    if (!canEditCorpus(req)) return send(res, 403, JSON.stringify({ error: 'Corpus edit not allowed from this client' }));
    regenerateSummary()
      .then((result) => send(res, 200, JSON.stringify(result)))
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message })));
    return;
  }
  const corpusDocMatch = pathname && pathname.match(/^\/api\/corpus\/documents\/(.+)$/);
  if (req.method === 'PUT' && corpusDocMatch) {
    if (!canEditCorpus(req)) return send(res, 403, JSON.stringify({ error: 'Corpus edit not allowed from this client' }));
    const docName = decodeURIComponent(corpusDocMatch[1]);
    if (!CORPUS_DOCS.includes(docName)) {
      return send(res, 400, JSON.stringify({ error: 'Invalid document name' }));
    }
    readBody(req)
      .then((body) => {
        let content = typeof body === 'string' ? body : '';
        try {
          const j = body ? JSON.parse(body) : null;
          if (j && j.content !== undefined) content = String(j.content);
        } catch (_) {}
        try {
          fs.mkdirSync(CORPUS_DIR, { recursive: true });
          fs.writeFileSync(path.join(CORPUS_DIR, docName), content, 'utf8');
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
        regenerateSummary()
          .then((result) => send(res, 200, JSON.stringify({ ok: true, ...result })))
          .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message })));
      })
      .catch((e) => send(res, 500, JSON.stringify({ error: e.message })));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/wisdom/truth-stats') {
    try {
      const stats = getTruthStats();
      return send(res, 200, JSON.stringify(stats));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/wisdom/run-nightly') {
    const runNightly = require('./scripts/nightly_wisdom').runNightlyWisdom;
    runNightly()
      .then((result) => send(res, 200, JSON.stringify(result)))
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message })));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/metrics') {
    try {
      const { getMetrics } = require('./lib/metrics');
      const metrics = getMetrics();
      return send(res, 200, JSON.stringify(metrics));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/metrics/advice-followed') {
    try {
      const { recordAdviceFollowed } = require('./lib/metrics');
      recordAdviceFollowed();
      return send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/models') {
    return send(res, 200, JSON.stringify({
      primary: process.env.MODEL_PRIMARY || OLLAMA_MODEL,
      available: [
        'ollama/llama3.1:latest',
        'ollama/llama3.2',
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4o-mini',
      ],
    }));
  }

  if (req.method === 'GET' && pathname === '/api/widget') {
    const widget = { tensions: 0, nextReminder: null, moltbook: null };
    try {
      const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
      if (fs.existsSync(tensionsPath)) {
        const raw = fs.readFileSync(tensionsPath, 'utf8');
        widget.tensions = (raw.match(/^\s*-\s+/gm) || []).length;
      }
      const intents = loadIntents();
      const now = new Date();
      const reminders = (Array.isArray(intents) ? intents : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
      const dueAt = (r) => r.dueAt || r.time;
      const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
      if (next) widget.nextReminder = (next.title || next.message || next.text || '').slice(0, 60);
      const moltbookPath = path.join(DATA_DIR, 'moltbook-state.json');
      if (fs.existsSync(moltbookPath)) {
        const data = JSON.parse(fs.readFileSync(moltbookPath, 'utf8'));
        const last = (data.posts || [])[0];
        widget.moltbook = last && last.upvotes != null ? String(last.upvotes) + ' upvotes' : null;
      }
    } catch (_) {}
    return send(res, 200, JSON.stringify(widget));
  }

  if (req.method === 'GET' && pathname === '/api/ios-dashboard') {
    const dashboard = { learning: {}, nextReminder: null, moltbookLast: null, contextHint: null, freeSlot: null, ea: null, rabbitHole: null, calendarTodayCount: null, remindersPendingCount: null, tensionsUpdatedDaysAgo: null, gpuTemps: null };
    try {
      const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
      const stickyPath = path.join(LEARNING_DIR, 'sticky-ideas.md');
      if (fs.existsSync(tensionsPath)) {
        const raw = fs.readFileSync(tensionsPath, 'utf8');
        const lines = raw.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#') && !l.toLowerCase().startsWith('- max '));
        dashboard.learning.tensionsCount = lines.length;
        dashboard.learning.firstTension = lines[0] ? lines[0].slice(2).trim().slice(0, 80) : null;
        try { const stat = fs.statSync(tensionsPath); dashboard.tensionsUpdatedDaysAgo = Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)); } catch (_) {}
      } else {
        dashboard.learning.tensionsCount = 0;
        dashboard.learning.firstTension = null;
      }
      if (fs.existsSync(stickyPath)) {
        const raw = fs.readFileSync(stickyPath, 'utf8');
        const lines = raw.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#'));
        dashboard.learning.stickyCount = lines.length;
        dashboard.learning.firstSticky = lines[0] ? lines[0].slice(2).trim().slice(0, 80) : null;
      } else {
        dashboard.learning.stickyCount = 0;
        dashboard.learning.firstSticky = null;
      }
      const intents = loadIntents();
      const now = new Date();
      const reminders = (Array.isArray(intents) ? intents : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
      dashboard.remindersPendingCount = reminders.length;
      const dueAt = (r) => r.dueAt || r.time;
      const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
      if (next) dashboard.nextReminder = { text: (next.title || next.message || next.text || '').slice(0, 120), dueAt: next.dueAt || next.time };
      const moltbookPath = path.join(DATA_DIR, 'moltbook-state.json');
      if (fs.existsSync(moltbookPath)) {
        const raw = fs.readFileSync(moltbookPath, 'utf8');
        const data = JSON.parse(raw);
        const posts = Array.isArray(data.posts) ? data.posts : [];
        const last = posts[0];
        if (last) {
          dashboard.moltbookLast = { title: (last.title || '').slice(0, 60), upvotes: last.upvotes != null ? last.upvotes : 0 };
          if (last.createdAt) dashboard.moltbookLast.createdAt = last.createdAt;
        }
      }
      const calendarPath = path.join(DATA_DIR, 'calendar-snapshot.json');
      if (fs.existsSync(calendarPath)) {
        const cal = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));
        const events = Array.isArray(cal.events) ? cal.events : [];
        const today = new Date().toISOString().slice(0, 10);
        const todayEvents = events.filter((e) => (e.start || '').toString().slice(0, 10) === today);
        dashboard.calendarTodayCount = todayEvents.length;
        const tensionsCount = dashboard.learning.tensionsCount || 0;
        if (todayEvents.length > 3 && tensionsCount >= 1) {
          dashboard.contextHint = 'Busy day + ' + tensionsCount + ' tension(s). Prioritize Tension #1?';
          const withStart = todayEvents.map((e) => ({ start: e.start ? new Date(e.start).getTime() : 0, end: e.end ? new Date(e.end).getTime() : 0 })).filter((e) => e.start > 0).sort((a, b) => a.start - b.start);
          const dayStart = new Date().setHours(9, 0, 0, 0);
          const dayEnd = new Date().setHours(18, 0, 0, 0);
          for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000) {
            const blockEnd = t + 30 * 60 * 1000;
            const overlaps = withStart.some((e) => (e.start < blockEnd && (e.end || e.start + 3600000) > t));
            if (!overlaps && blockEnd <= dayEnd) {
              dashboard.freeSlot = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '–' + new Date(blockEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              break;
            }
          }
        }
      }
      if (fs.existsSync(EA_ALERTS_FILE)) {
        try {
          const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            dashboard.ea = { alertsLast24h: list.filter((a) => (a.at || 0) > cutoff).length };
          }
        } catch (_) {}
      }
      const rabbitPath = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
      if (fs.existsSync(rabbitPath)) {
        try {
          const raw = fs.readFileSync(rabbitPath, 'utf8');
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const cutoffStr = sevenDaysAgo.toISOString().slice(0, 10);
          let notesLast7Days = 0; let lastNoteDate = null; let lastNoteTitle = null; let lastNoteExcerpt = null;
          const blocks = raw.split(/\n## /);
          for (let i = 1; i < blocks.length; i++) {
            const head = blocks[i].match(/^(\d{4}-\d{2}-\d{2}):\s*(.+?)(?:\n|$)/);
            if (head) {
              const d = head[1]; const title = (head[2] || '').trim().slice(0, 60);
              if (d >= cutoffStr) notesLast7Days++;
              if (!lastNoteDate || d > lastNoteDate) {
                lastNoteDate = d; lastNoteTitle = title;
                const body = blocks[i].replace(/^[\s\S]*?\n\n?/, '').trim().slice(0, 220);
                lastNoteExcerpt = body ? body + (body.length >= 220 ? '…' : '') : null;
              }
            }
          }
          dashboard.rabbitHole = { notesLast7Days, lastNoteDate, lastNoteTitle, lastNoteExcerpt };
        } catch (_) {}
      }
      const topicsPath = path.join(LEARNING_DIR, 'topics.txt');
      if (fs.existsSync(topicsPath)) {
        try {
          const raw = fs.readFileSync(topicsPath, 'utf8');
          dashboard.researchTopics = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        } catch (_) {}
      }
      try {
        const out = execSync('nvidia-smi --query-gpu=index,name,temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 });
        const gpus = [];
        out.trim().split('\n').forEach((line) => {
          const parts = line.split(',').map((s) => s.trim());
          if (parts.length >= 3) {
            const temp = parseInt(parts[2], 10);
            gpus.push({ index: parseInt(parts[0], 10), name: parts[1], temp: isNaN(temp) ? null : temp });
          }
        });
        if (gpus.length) dashboard.gpuTemps = gpus;
      } catch (_) {}
    } catch (e) {
      log('warn', 'ios-dashboard', { error: e.message });
    }
    return send(res, 200, JSON.stringify(dashboard));
  }

  if (req.method === 'GET' && pathname === '/api/pending') {
    let pending = [];
    try {
      const raw = fs.readFileSync(PENDING_NOTIFICATIONS_FILE, 'utf8');
      pending = raw.split('\n').filter(Boolean);
      fs.writeFileSync(PENDING_NOTIFICATIONS_FILE, '', 'utf8');
    } catch (_) {}
    return send(res, 200, JSON.stringify({ pending }));
  }

  // —— Phase 4: CLI /api/intents (read-only for piko intents) ——
  if (req.method === 'GET' && pathname === '/api/intents') {
    const intents = loadIntents();
    return send(res, 200, JSON.stringify({ intents }));
  }

  // —— EA Phase 4: alerts API (last 24h) ——
  if (req.method === 'GET' && pathname === '/api/ea-alerts') {
    let list = [];
    try {
      if (fs.existsSync(EA_ALERTS_FILE)) {
        const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      }
    } catch (_) {}
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const alerts = list.filter((a) => (a.at || 0) > cutoff).sort((a, b) => (b.at || 0) - (a.at || 0));
    return send(res, 200, JSON.stringify({ alerts }));
  }

  // —— EA Phase 4: delivery preferences (quiet hours) ——
  if (req.method === 'GET' && pathname === '/api/ea-preferences') {
    let prefs = { quietStart: null, quietEnd: null };
    try {
      if (fs.existsSync(EA_PREFERENCES_FILE)) {
        const raw = fs.readFileSync(EA_PREFERENCES_FILE, 'utf8');
        prefs = { ...prefs, ...JSON.parse(raw) };
      }
    } catch (_) {}
    return send(res, 200, JSON.stringify(prefs));
  }
  if (req.method === 'PUT' && pathname === '/api/ea-preferences') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let prefs = { quietStart: null, quietEnd: null };
      try {
        if (fs.existsSync(EA_PREFERENCES_FILE)) {
          const raw = fs.readFileSync(EA_PREFERENCES_FILE, 'utf8');
          prefs = { ...prefs, ...JSON.parse(raw) };
        }
      } catch (_) {}
      try {
        const data = JSON.parse(body || '{}');
        if (data.quietStart !== undefined) prefs.quietStart = data.quietStart === '' || data.quietStart === null ? null : String(data.quietStart).trim().slice(0, 8);
        if (data.quietEnd !== undefined) prefs.quietEnd = data.quietEnd === '' || data.quietEnd === null ? null : String(data.quietEnd).trim().slice(0, 8);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(EA_PREFERENCES_FILE, JSON.stringify(prefs, null, 2), 'utf8');
        return send(res, 200, JSON.stringify(prefs));
      } catch (e) {
        return send(res, 400, JSON.stringify({ error: e.message || 'Bad request' }));
      }
    });
    return;
  }

  // —— Phase 3: Control UI dashboard ——
  if (req.method === 'GET' && pathname === '/api/control') {
    const controlTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    let ollamaOk = false;
    try {
      await controlTimeout(ai('hi', { max_tokens: 2 }), 4000);
      ollamaOk = true;
    } catch (_) {}
    const intents = loadIntents();
    const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
    const reminders = intents.filter((i) => i.type === 'reminder');
    const scheduled = intents.filter((i) => i.type === 'scheduled');
    const now = new Date();
    const reminderDue = (r) => r.dueAt || r.time;
    const scheduledRun = (s) => s.dueAt || s.run;
    const futureReminders = reminders.filter((r) => new Date(reminderDue(r) || 0) > now).sort((a, b) => new Date(reminderDue(a)) - new Date(reminderDue(b)));
    const futureScheduled = scheduled.filter((s) => new Date(scheduledRun(s) || 0) > now).sort((a, b) => new Date(scheduledRun(a)) - new Date(scheduledRun(b)));
    const nextReminder = futureReminders[0];
    const nextScheduled = futureScheduled[0];
    let pendingCount = 0;
    try {
      const raw = fs.readFileSync(PENDING_NOTIFICATIONS_FILE, 'utf8');
      pendingCount = raw.split('\n').filter(Boolean).length;
    } catch (_) {}
    let lastMoltbookPostAt = null;
    let nextMoltbookPostEligibleAt = null;
    let lastMoltbookPostUrl = null;
    try {
      const lastPostRaw = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post.txt'), 'utf8').trim();
      const lastTs = Date.parse(lastPostRaw);
      if (!isNaN(lastTs)) {
        lastMoltbookPostAt = new Date(lastTs).toISOString();
        nextMoltbookPostEligibleAt = new Date(lastTs + 30 * 60 * 1000).toISOString();
      }
    } catch (_) {}
    let moltbookPosts = [];
    let moltbookProfile = null;
    if (MOLTBOOK_API_KEY) {
      try {
        await controlTimeout(
          (async () => {
            moltbookProfile = await fetchMoltbookProfile(MOLTBOOK_API_KEY);
            moltbookPosts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
            if (moltbookPosts.length && !lastMoltbookPostUrl) {
              lastMoltbookPostUrl = moltbookPosts[0].url;
            } else if (moltbookPosts.length && lastMoltbookPostUrl) {
              const byId = moltbookPosts.find((p) => p.url === lastMoltbookPostUrl);
              if (!byId && moltbookPosts[0]) lastMoltbookPostUrl = moltbookPosts[0].url;
            }
          })(),
          8000
        );
      } catch (e) {
        if (e.message !== 'timeout') log('warn', 'control-moltbook', { error: e.message });
      }
    }
    // Merge with local state so we show all posts we know about (API often returns only 1 recent).
    const statePath = path.join(DATA_DIR, 'moltbook-state.json');
    let postsFromLocal = 0;
    const apiPostsCount = moltbookPosts.length;
    if (fs.existsSync(statePath)) {
      try {
        let lastPostId = '';
        try {
          lastPostId = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post-id.txt'), 'utf8').trim();
        } catch (_) {}
        const stateRaw = fs.readFileSync(statePath, 'utf8');
        const state = JSON.parse(stateRaw);
        const localPosts = state.posts || [];
        if (!lastPostId && localPosts.length) lastPostId = (localPosts[localPosts.length - 1].id || '').toString().trim();
        if (lastPostId && !lastMoltbookPostUrl) lastMoltbookPostUrl = 'https://www.moltbook.com/post/' + lastPostId;
        const byId = new Map(moltbookPosts.map((p) => [String(p.id), p]));
        for (const p of localPosts) {
          const id = (p && p.id) ? String(p.id) : '';
          if (!id || byId.has(id)) continue;
          const rawTitle = (p.title || 'Post').slice(0, 80);
          const cleanTitle = stripWrappingQuotes(stripMarkdownFromText(rawTitle) || rawTitle) || stripMarkdownFromText(rawTitle) || rawTitle;
          byId.set(id, {
            id: p.id,
            title: cleanTitle,
            url: 'https://www.moltbook.com/post/' + id,
            createdAt: p.createdAt || null,
          });
          postsFromLocal += 1;
        }
        moltbookPosts = Array.from(byId.values()).sort((a, b) => {
          const ta = (a.createdAt && new Date(a.createdAt).getTime()) || 0;
          const tb = (b.createdAt && new Date(b.createdAt).getTime()) || 0;
          return tb - ta;
        });
        log('info', 'moltbook-merge', { apiPosts: apiPostsCount, localPosts: localPosts.length, mergedCount: moltbookPosts.length, statePath: statePath });
      } catch (e) {
        log('warn', 'moltbook-merge-fail', { error: e.message, statePath });
      }
    }
    let moltbookJournal = '';
    let moltbookPendingProposal = null;
    try {
      const journalPath = path.join(DATA_DIR, 'moltbook-journal.md');
      if (fs.existsSync(journalPath)) {
        const raw = fs.readFileSync(journalPath, 'utf8');
        moltbookJournal = raw.slice(-4000);
      }
    } catch (_) {}
    try {
      const proposalPath = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
      if (fs.existsSync(proposalPath)) {
        moltbookPendingProposal = fs.readFileSync(proposalPath, 'utf8').trim();
      }
    } catch (_) {}
    let pikoMemory = null;
    try {
      const memoryPath = path.join(DATA_DIR, 'piko-memory.json');
      if (fs.existsSync(memoryPath)) {
        const raw = fs.readFileSync(memoryPath, 'utf8');
        const m = JSON.parse(raw);
        if (m && typeof m.goals === 'object' && typeof m.metrics === 'object') pikoMemory = { goals: m.goals, metrics: m.metrics, lastCycle: m.lastCycle, selfAssessment: m.selfAssessment || null, cycleHistory: (m.cycleHistory || []).slice(0, 10) };
      }
    } catch (_) {}
    let moltbookLastRun = null;
    try {
      const lastRunPath = path.join(DATA_DIR, 'moltbook-last-run.txt');
      if (fs.existsSync(lastRunPath)) moltbookLastRun = fs.readFileSync(lastRunPath, 'utf8').trim();
    } catch (_) {}
    let moltbookFeedbackSignals = null;
    try {
      const feedbackPath = path.join(DATA_DIR, 'moltbook-feedback.json');
      if (fs.existsSync(feedbackPath)) {
        const raw = fs.readFileSync(feedbackPath, 'utf8');
        const fb = JSON.parse(raw);
        if (fb && typeof fb.signals === 'object' && Object.keys(fb.signals).length > 0) moltbookFeedbackSignals = { signals: fb.signals, lastUpdated: fb.lastUpdated || null };
      }
    } catch (_) {}
    // Learning velocity: causality, consolidation, sticky/tensions, Phase B, week number
    const nowMs = Date.now();
    const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const getISOWeek = (d) => {
      const dt = new Date(d);
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    };
    let learningVelocity = {
      weekNumber: getISOWeek(nowMs),
      causalityPct: null,
      causalityFollowed: 0,
      causalityTotal: 0,
      consolidationCount: 0,
      refinementLinesCount: 0,
      stickyCount: 0,
      stickyNewThisWeek: false,
      tensionsCount: 0,
      tensionsFileUpdatedDaysAgo: null,
      phaseBTotal: 0,
      phaseBBreakdown: {},
    };
    if (pikoMemory && Array.isArray(pikoMemory.cycleHistory)) {
      const thisWeek = pikoMemory.cycleHistory.filter((c) => {
        const t = c.timestamp || c.lastCycle;
        return t && new Date(t).getTime() >= weekAgo;
      });
      const withEval = thisWeek.filter((c) => c.followedPlan === true || c.followedPlan === false);
      const followed = withEval.filter((c) => c.followedPlan === true).length;
      learningVelocity.causalityTotal = withEval.length;
      learningVelocity.causalityFollowed = followed;
      learningVelocity.causalityPct = withEval.length ? Math.round((followed / withEval.length) * 100) : null;
    }
    if (pikoMemory && pikoMemory.selfAssessment && Array.isArray(pikoMemory.selfAssessment.nextExperiments)) {
      learningVelocity.consolidationCount = pikoMemory.selfAssessment.nextExperiments.length;
    }
    try {
      const refinementsPath = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');
      if (fs.existsSync(refinementsPath)) {
        const raw = fs.readFileSync(refinementsPath, 'utf8');
        learningVelocity.refinementLinesCount = raw.split('\n').filter((l) => /^\s*[-*]\s*\[/.test(l) || /^\s*-\s+/.test(l.trim())).length;
      }
    } catch (_) {}
    try {
      const stickyPath = path.join(LEARNING_DIR, 'sticky-ideas.md');
      if (fs.existsSync(stickyPath)) {
        const raw = fs.readFileSync(stickyPath, 'utf8');
        learningVelocity.stickyCount = raw.split('\n').filter((l) => {
          const t = l.trim();
          return t.startsWith('- ') && !t.startsWith('#') && !t.toLowerCase().startsWith('- max ');
        }).length;
        try {
          const stat = fs.statSync(stickyPath);
          learningVelocity.stickyNewThisWeek = stat.mtimeMs >= weekAgo;
        } catch (_) {}
      }
      const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
      if (fs.existsSync(tensionsPath)) {
        const raw = fs.readFileSync(tensionsPath, 'utf8');
        learningVelocity.tensionsCount = raw.split('\n').filter((l) => {
          const t = l.trim();
          return t.startsWith('- ') && !t.startsWith('#') && !t.toLowerCase().startsWith('- max ');
        }).length;
        try {
          const stat = fs.statSync(tensionsPath);
          learningVelocity.tensionsFileUpdatedDaysAgo = Math.floor((nowMs - stat.mtimeMs) / (24 * 60 * 60 * 1000));
        } catch (_) {}
      }
    } catch (_) {}
    if (moltbookFeedbackSignals && typeof moltbookFeedbackSignals.signals === 'object') {
      const sig = moltbookFeedbackSignals.signals;
      learningVelocity.phaseBBreakdown = { ...sig };
      learningVelocity.phaseBTotal = Object.values(sig).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0);
    }
    // Weekly summary: this week vs last week for dashboard card
    let weeklySummary = { rabbitHoleNewThisWeek: 0, causalityTrend: null, phaseBSignalsUsed: learningVelocity.phaseBTotal || 0 };
    try {
      const rabbitPath = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
      if (fs.existsSync(rabbitPath)) {
        const raw = fs.readFileSync(rabbitPath, 'utf8');
        const blockDates = raw.match(/^##\s+(\d{4}-\d{2}-\d{2})/gm) || [];
        const weekAgoDate = new Date(weekAgo);
        const y = weekAgoDate.getFullYear();
        const m = String(weekAgoDate.getMonth() + 1).padStart(2, '0');
        const d = String(weekAgoDate.getDate()).padStart(2, '0');
        const weekAgoStr = `${y}-${m}-${d}`;
        weeklySummary.rabbitHoleNewThisWeek = blockDates.filter((line) => {
          const match = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
          return match && match[1] >= weekAgoStr;
        }).length;
      }
    } catch (_) {}
    if (pikoMemory && Array.isArray(pikoMemory.cycleHistory)) {
      const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
      const lastWeek = pikoMemory.cycleHistory.filter((c) => {
        const t = c.timestamp || c.lastCycle;
        const ts = t ? new Date(t).getTime() : 0;
        return ts >= twoWeeksAgo && ts < weekAgo;
      });
      const lastWeekWithEval = lastWeek.filter((c) => c.followedPlan === true || c.followedPlan === false);
      const lastWeekFollowed = lastWeekWithEval.filter((c) => c.followedPlan === true).length;
      const lastWeekPct = lastWeekWithEval.length ? Math.round((lastWeekFollowed / lastWeekWithEval.length) * 100) : null;
      const thisPct = learningVelocity.causalityPct;
      if (thisPct != null && lastWeekPct != null) {
        const diff = thisPct - lastWeekPct;
        weeklySummary.causalityTrend = diff > 0 ? '↑' + diff + '%' : diff < 0 ? '↓' + Math.abs(diff) + '%' : '→0%';
        weeklySummary.causalityLastWeek = lastWeekPct;
        weeklySummary.causalityThisWeek = thisPct;
      }
    }
    let allowlist = {};
    try {
      allowlist = loadAllowlist();
    } catch (_) {}
    const linkedAccounts = loadLinkedAccounts();
    const integrations = {
      dailyMemoryEnabled: process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true',
      dailyMemoryDays: Math.min(30, Math.max(1, parseInt(process.env.PIKO_DAILY_MEMORY_DAYS || '7', 10))),
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN) && !!process.env.TELEGRAM_CHAT_ID,
      gmailConfigured: !!(process.env.GMAIL_ACCESS_TOKEN || (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET)),
      gmailOAuthAvailable: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
      slackConfigured: !!process.env.SLACK_BOT_TOKEN,
      slackOAuthAvailable: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
      notionConfigured: !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY),
      notionOAuthAvailable: !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
      discordConfigured: !!(process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN),
      linkedAccounts: { gmail: linkedAccounts.gmail || null, slack: linkedAccounts.slack || null, notion: linkedAccounts.notion || null },
      eaGmailMinUnread: Math.max(0, parseInt(process.env.PIKO_EA_GMAIL_MIN_UNREAD || '1', 10)),
      eaUseLlmSynthesis: process.env.PIKO_EA_USE_LLM_SYNTHESIS === '1' || process.env.PIKO_EA_USE_LLM_SYNTHESIS === 'true',
      eaImessageConfigured: !!(process.env.PIKO_EA_IMESSAGE_CHAT_GUID && process.env.BLUEBUBBLES_URL && process.env.BLUEBUBBLES_API_KEY),
      eaPrepMeeting: process.env.PIKO_EA_PREP_MEETING === '1' || process.env.PIKO_EA_PREP_MEETING === 'true',
      eaGmailReadBody: process.env.PIKO_EA_GMAIL_READ_BODY === '1' || process.env.PIKO_EA_GMAIL_READ_BODY === 'true',
    };
    let eaAlertsCount = 0;
    try {
      if (fs.existsSync(EA_ALERTS_FILE)) {
        const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          eaAlertsCount = list.filter((a) => (a.at || 0) > cutoff).length;
        }
      }
    } catch (_) {}
    const payload = {
      health: { ollama: ollamaOk, model: OLLAMA_MODEL },
      integrations,
      eaAlertsCount,
      allowlist,
      moltbook: { profile: moltbookProfile, lastPostAt: lastMoltbookPostAt, nextPostEligibleAt: nextMoltbookPostEligibleAt, lastPostUrl: lastMoltbookPostUrl, posts: moltbookPosts, postsFromLocal: postsFromLocal, note: 'Cron runs every 30 min at :00 and :30', journal: moltbookJournal, pendingProposal: moltbookPendingProposal, memory: pikoMemory, lastRun: moltbookLastRun, feedbackSignals: moltbookFeedbackSignals },
      learningVelocity,
      weeklySummary,
      intentsCount: intents.length,
      queueLength: queue.length,
      remindersCount: reminders.length,
      scheduledCount: scheduled.length,
      pendingCount,
      sessionsCount: sessionStore.getSessionCount(),
      nextReminderAt: nextReminder ? (nextReminder.dueAt || nextReminder.time) : null,
      nextReminderText: nextReminder ? (nextReminder.title || nextReminder.message || nextReminder.text || '').slice(0, 60) : null,
      nextScheduledRun: nextScheduled ? (nextScheduled.dueAt || nextScheduled.run) : null,
      nextScheduledCommand: nextScheduled ? (nextScheduled.command || '').slice(0, 60) : null,
    };
    try {
      const out = execSync('nvidia-smi --query-gpu=index,name,temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 });
      const gpus = [];
      out.trim().split('\n').forEach((line) => {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 3) {
          const temp = parseInt(parts[2], 10);
          gpus.push({ index: parseInt(parts[0], 10), name: parts[1], temp: isNaN(temp) ? null : temp });
        }
      });
      if (gpus.length) payload.gpuTemps = gpus;
    } catch (_) {}
    return send(res, 200, JSON.stringify(payload));
  }

  // —— Control: list/get/put prompt and config .md files (whitelist only) ——
  const PROMPTS_WHITELIST = [
    { id: 'IDENTITY', file: 'IDENTITY.md', description: 'Who Piko is (system identity)' },
    { id: 'SOUL', file: 'SOUL.md', description: 'Piko’s soul / personality' },
    { id: 'INTERESTS', file: 'INTERESTS.md', description: 'Interests and topics' },
    { id: 'MEMORY', file: 'MEMORY.md', description: 'Durable memory facts' },
    { id: 'MOLTBOOK_AIM', file: 'MOLTBOOK_AIM.md', description: 'What Piko posts about on Moltbook' },
    { id: 'MOLTBOOK_REFINEMENTS', file: 'MOLTBOOK_REFINEMENTS.md', description: 'Approved Moltbook refinements' },
    { id: 'MOLTBOOK_POST_CONFIG', file: 'MOLTBOOK_POST_CONFIG.md', description: 'Post length (title_max_chars, body_max_chars)' },
  ];
  if (req.method === 'GET' && pathname === '/api/control/prompts') {
    const list = PROMPTS_WHITELIST.map(({ id, file, description }) => ({ id, file, description }));
    return send(res, 200, JSON.stringify({ prompts: list }));
  }
  const promptsMatch = pathname && pathname.match(/^\/api\/control\/prompts\/([A-Za-z0-9_]+)$/);
  if (promptsMatch) {
    const id = promptsMatch[1].toUpperCase().replace(/-/g, '_');
    const entry = PROMPTS_WHITELIST.find((e) => e.id === id || e.file.toLowerCase() === id.toLowerCase() + '.md');
    if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown prompt id' }));
    const filePath = path.join(PROMPTS_DIR, entry.file);
    if (req.method === 'GET') {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return send(res, 200, JSON.stringify({ id: entry.id, file: entry.file, description: entry.description, content }));
      } catch (e) {
        if (e.code === 'ENOENT') return send(res, 200, JSON.stringify({ id: entry.id, file: entry.file, description: entry.description, content: '' }));
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
    if (req.method === 'PUT') {
      let body;
      try {
        body = await readBody(req);
        body = body ? JSON.parse(body) : {};
      } catch (_) {
        return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
      }
      const content = typeof body.content === 'string' ? body.content : '';
      try {
        fs.mkdirSync(PROMPTS_DIR, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, id: entry.id }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
  }

  const MOLTBOOK_PENDING_PROPOSAL_FILE = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
  const MOLTBOOK_REFINEMENTS_FILE = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');

  if (req.method === 'POST' && pathname === '/api/control/integrations/telegram') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : (body.chat_id != null ? String(body.chat_id).trim() : '');
    if (!token) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing token' }));
    if (!chatId) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing chatId' }));
    persistEnvVar('TELEGRAM_BOT_TOKEN', token);
    persistEnvVar('TELEGRAM_CHAT_ID', chatId);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Telegram connected.' }));
  }
  if (req.method === 'POST' && pathname === '/api/control/integrations/imessage') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    const url = typeof body.blueBubblesUrl === 'string' ? body.blueBubblesUrl.trim() : (body.url && String(body.url).trim()) || '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : (body.api_key && String(body.api_key).trim()) || '';
    const chatGuid = typeof body.chatGuid === 'string' ? body.chatGuid.trim() : (body.chat_guid && String(body.chat_guid).trim()) || '';
    if (!url || !apiKey || !chatGuid) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Missing blueBubblesUrl, apiKey, or chatGuid' }));
    }
    persistEnvVar('BLUEBUBBLES_URL', url);
    persistEnvVar('BLUEBUBBLES_API_KEY', apiKey);
    persistEnvVar('PIKO_EA_IMESSAGE_CHAT_GUID', chatGuid);
    return send(res, 200, JSON.stringify({ ok: true, message: 'iMessage (EA) connected.' }));
  }
  if (req.method === 'POST' && pathname === '/api/control/integrations/discord') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    const token = typeof body.token === 'string' ? body.token.trim() : (body.botToken && String(body.botToken).trim()) || '';
    if (!token) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing token' }));
    persistEnvVar('DISCORD_TOKEN', token);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Discord connected.' }));
  }
  if (req.method === 'POST' && pathname === '/api/control/integrations/gmail/disable') {
    clearEnvVar('GMAIL_REFRESH_TOKEN');
    clearEnvVar('GMAIL_ACCESS_TOKEN');
    const linked = loadLinkedAccounts();
    delete linked.gmail;
    saveLinkedAccounts(linked);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Gmail disconnected.' }));
  }
  if (req.method === 'POST' && pathname === '/api/control/integrations/slack/disable') {
    clearEnvVar('SLACK_BOT_TOKEN');
    const linked = loadLinkedAccounts();
    delete linked.slack;
    saveLinkedAccounts(linked);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Slack disconnected.' }));
  }
  if (req.method === 'POST' && pathname === '/api/control/integrations/notion/disable') {
    clearEnvVar('NOTION_TOKEN');
    clearEnvVar('NOTION_REFRESH_TOKEN');
    const linked = loadLinkedAccounts();
    delete linked.notion;
    saveLinkedAccounts(linked);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Notion disconnected.' }));
  }

  if (req.method === 'POST' && pathname === '/api/control/aim-approve') {
    let proposal = '';
    try {
      proposal = fs.readFileSync(MOLTBOOK_PENDING_PROPOSAL_FILE, 'utf8').trim();
    } catch (_) {}
    if (!proposal) return send(res, 200, JSON.stringify({ ok: false, error: 'No pending proposal' }));
    const dateStr = new Date().toISOString().slice(0, 10);
    const line = '- [' + dateStr + '] ' + proposal.split(/\n/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).join('; ') + '\n';
    try {
      fs.appendFileSync(MOLTBOOK_REFINEMENTS_FILE, line, 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ ok: false, error: e.message }));
    }
    try { fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE); } catch (_) {}
    return send(res, 200, JSON.stringify({ ok: true }));
  }
  if (req.method === 'POST' && pathname === '/api/control/session-reset') {
    let body;
    try {
      body = await new Promise((res, rej) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => { try { res(JSON.parse(data || '{}')); } catch (e) { rej(e); } });
        req.on('error', rej);
      });
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
    }
    const sid = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sid) return send(res, 400, JSON.stringify({ error: 'Missing sessionId' }));
    try {
      sessionStore.clear(sid);
      log('info', 'session-reset', { sessionId: sid }, req.requestId);
      return send(res, 200, JSON.stringify({ ok: true, message: 'Session history cleared.' }));
    } catch (e) {
      log('error', 'session-reset', { error: e.message, sessionId: sid }, req.requestId);
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/control/aim-reject') {
    try {
      fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
    } catch (_) {}
    return send(res, 200, JSON.stringify({ ok: true }));
  }

  if (req.method === 'POST' && pathname === '/api/control/moltbook-prune') {
    const key = MOLTBOOK_API_KEY;
    if (!key) return send(res, 400, JSON.stringify({ error: 'MOLTBOOK_API_KEY not set' }));
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const postIds = Array.isArray(body.postIds) ? body.postIds.map((id) => String(id).trim()).filter(Boolean) : [];
    if (postIds.length === 0) return send(res, 200, JSON.stringify({ pruned: 0, failed: 0 }));
    let pruned = 0;
    let failed = 0;
    const errors = [];
    for (const id of postIds) {
      try {
        const opts = { hostname: 'www.moltbook.com', port: 443, path: '/api/v1/posts/' + encodeURIComponent(id), method: 'DELETE', headers: { 'Authorization': 'Bearer ' + key } };
        const { statusCode } = await httpsRequest(opts);
        if (statusCode >= 200 && statusCode < 300) pruned++;
        else { failed++; errors.push({ id, status: statusCode }); }
      } catch (e) { failed++; errors.push({ id, error: e.message }); }
    }
    return send(res, 200, JSON.stringify({ pruned, failed, errors: errors.length ? errors : undefined }));
  }

  // —— Control: Learning repo API (Notion-style databases: sticky-ideas, tensions, rabbit-hole) ——
  const LEARNING_DATABASES = [
    { id: 'sticky-ideas', name: 'Sticky ideas', description: 'Ideas Piko keeps in mind' },
    { id: 'tensions', name: 'Tensions', description: 'Max 5 tensions to reflect on' },
    { id: 'rabbit-hole', name: 'Rabbit-hole notes', description: 'Exploration notes by date/topic' },
  ];
  const STICKY_IDEAS_FILE_CONTROL = path.join(LEARNING_DIR, 'sticky-ideas.md');
  const TENSIONS_FILE_CONTROL = path.join(LEARNING_DIR, 'tensions.md');
  const RABBIT_HOLE_NOTES_FILE_CONTROL = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');

  function readStickyIdeasControl() {
    if (!fs.existsSync(STICKY_IDEAS_FILE_CONTROL)) return [];
    const raw = fs.readFileSync(STICKY_IDEAS_FILE_CONTROL, 'utf8');
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
        items.push(line.slice(2).trim());
      }
    }
    return items;
  }
  function readTensionsControl() {
    if (!fs.existsSync(TENSIONS_FILE_CONTROL)) return [];
    const raw = fs.readFileSync(TENSIONS_FILE_CONTROL, 'utf8');
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
        items.push(line.slice(2).trim());
      }
    }
    return items;
  }
  function readRabbitHoleBlocksControl() {
    if (!fs.existsSync(RABBIT_HOLE_NOTES_FILE_CONTROL)) return [];
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, 'utf8');
    const blocks = raw.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter((b) => b.trim());
    if (blocks.length === 0) {
      const anyBlock = raw.split(/\n(?=## )/).filter((b) => b.trim());
      return anyBlock.map((block) => {
        const firstLine = block.split('\n')[0] || '';
        const titleMatch = firstLine.match(/^##\s+(.+)$/);
        const title = titleMatch ? titleMatch[1].trim() : firstLine.slice(0, 80);
        return { title, content: block.trim() };
      });
    }
    return blocks.map((block) => {
      const firstLine = block.split('\n')[0] || '';
      const titleMatch = firstLine.match(/^##\s+(.+)$/);
      const title = titleMatch ? titleMatch[1].trim() : firstLine.slice(0, 80);
      return { title, content: block.trim() };
    });
  }

  if (req.method === 'GET' && pathname === '/api/control/search') {
    const { query } = parseUrl(req.url);
    const q = (query && query.q && String(query.q).trim()) || '';
    const results = { learning: [], moltbook: [], journal: [], prompts: [] };
    const lower = q.toLowerCase();
    if (lower.length < 2) return send(res, 200, JSON.stringify(results));
    try {
      const stickyPath = path.join(LEARNING_DIR, 'sticky-ideas.md');
      if (fs.existsSync(stickyPath)) {
        const raw = fs.readFileSync(stickyPath, 'utf8');
        raw.split('\n').forEach((line) => {
          const t = line.trim();
          if (t.startsWith('- ') && !t.startsWith('#') && t.toLowerCase().indexOf(lower) !== -1) {
            results.learning.push({ type: 'sticky', text: t.slice(2).trim().slice(0, 80), id: 'sticky-ideas' });
          }
        });
      }
      const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
      if (fs.existsSync(tensionsPath)) {
        const raw = fs.readFileSync(tensionsPath, 'utf8');
        let i = 0;
        raw.split('\n').forEach((line) => {
          const t = line.trim();
          if (t.startsWith('- ') && !t.startsWith('#') && t.toLowerCase().indexOf(lower) !== -1) {
            i++;
            results.learning.push({ type: 'tension', text: t.slice(2).trim().slice(0, 80), id: 'tensions', label: 'Tension #' + i });
          }
        });
      }
      const rabbitPath = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
      if (fs.existsSync(rabbitPath)) {
        const raw = fs.readFileSync(rabbitPath, 'utf8');
        const blocks = raw.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter((b) => b.trim());
        blocks.forEach((block) => {
          if (block.toLowerCase().indexOf(lower) === -1) return;
          const firstLine = block.split('\n')[0] || '';
          const titleMatch = firstLine.match(/^##\s+(.+)$/);
          const title = (titleMatch ? titleMatch[1].trim() : firstLine).slice(0, 60);
          results.learning.push({ type: 'rabbit-hole', text: title, id: 'rabbit-hole' });
        });
      }
    } catch (_) {}
    try {
      const journalPath = path.join(DATA_DIR, 'moltbook-journal.md');
      if (fs.existsSync(journalPath)) {
        const raw = fs.readFileSync(journalPath, 'utf8');
        const chunk = raw.slice(-8000);
        const lines = chunk.split('\n');
        let count = 0;
        for (let i = 0; i < lines.length && count < 5; i++) {
          if (lines[i].toLowerCase().indexOf(lower) !== -1) {
            count++;
            results.journal.push({ text: lines[i].trim().slice(0, 100), line: i + 1 });
          }
        }
      }
    } catch (_) {}
    try {
      const statePath = path.join(DATA_DIR, 'moltbook-state.json');
      if (fs.existsSync(statePath)) {
        const stateRaw = fs.readFileSync(statePath, 'utf8');
        const state = JSON.parse(stateRaw);
        const posts = state.posts || [];
        posts.forEach((p) => {
          const title = (p && p.title || 'Post').replace(/\*\*/g, '');
          if (title.toLowerCase().indexOf(lower) !== -1) {
            results.moltbook.push({ text: title.slice(0, 60), date: p.createdAt, url: p.id ? 'https://www.moltbook.com/post/' + p.id : null, id: p.id });
          }
        });
      }
    } catch (_) {}
    return send(res, 200, JSON.stringify(results));
  }
  if (req.method === 'GET' && pathname === '/api/control/learning') {
    return send(res, 200, JSON.stringify({ databases: LEARNING_DATABASES }));
  }
  const TOPICS_FILE_CONTROL = path.join(LEARNING_DIR, 'topics.txt');
  if (pathname === '/api/control/learning/topics') {
    if (req.method === 'GET') {
      try {
        fs.mkdirSync(LEARNING_DIR, { recursive: true });
        const raw = fs.existsSync(TOPICS_FILE_CONTROL) ? fs.readFileSync(TOPICS_FILE_CONTROL, 'utf8') : '';
        const topics = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        return send(res, 200, JSON.stringify({ topics }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
        body = body ? JSON.parse(body) : {};
      } catch (_) {
        return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
      }
      const toAdd = [];
      if (typeof body.topic === 'string' && body.topic.trim()) toAdd.push(body.topic.trim());
      if (Array.isArray(body.topics)) toAdd.push(...body.topics.map((t) => String(t).trim()).filter(Boolean));
      if (toAdd.length === 0) return send(res, 400, JSON.stringify({ error: 'Provide topic or topics (string or array)' }));
      try {
        fs.mkdirSync(LEARNING_DIR, { recursive: true });
        const existing = fs.existsSync(TOPICS_FILE_CONTROL) ? fs.readFileSync(TOPICS_FILE_CONTROL, 'utf8') : '';
        const line = (existing.trim() ? '\n' : '') + toAdd.join('\n') + '\n';
        fs.appendFileSync(TOPICS_FILE_CONTROL, line, 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, added: toAdd.length }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
    return send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }));
  }
  const SUGGESTED_TOPICS_FILE_CONTROL = path.join(LEARNING_DIR, 'suggested-topics.txt');
  if (pathname === '/api/control/learning/suggest' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const toAdd = [];
    if (typeof body.topic === 'string' && body.topic.trim()) toAdd.push(body.topic.trim());
    if (Array.isArray(body.topics)) toAdd.push(...body.topics.map((t) => String(t).trim()).filter(Boolean));
    if (toAdd.length === 0) return send(res, 400, JSON.stringify({ error: 'Provide topic or topics (string or array)' }));
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const existing = fs.existsSync(SUGGESTED_TOPICS_FILE_CONTROL) ? fs.readFileSync(SUGGESTED_TOPICS_FILE_CONTROL, 'utf8') : '';
      const line = (existing.trim() ? '\n' : '') + toAdd.join('\n') + '\n';
      fs.appendFileSync(SUGGESTED_TOPICS_FILE_CONTROL, line, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, added: toAdd.length, message: 'Topic(s) queued for next rabbit-hole run' }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (pathname === '/api/control/learning/suggest' && req.method === 'GET') {
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const raw = fs.existsSync(SUGGESTED_TOPICS_FILE_CONTROL) ? fs.readFileSync(SUGGESTED_TOPICS_FILE_CONTROL, 'utf8') : '';
      const topics = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return send(res, 200, JSON.stringify({ suggested: topics }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  const learningMatch = pathname && pathname.match(/^\/api\/control\/learning\/([a-z0-9-]+)$/);
  if (learningMatch) {
    const id = learningMatch[1];
    const entry = LEARNING_DATABASES.find((e) => e.id === id);
    if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown learning database' }));
    if (req.method === 'GET') {
      try {
        if (id === 'sticky-ideas') return send(res, 200, JSON.stringify({ id, ...entry, items: readStickyIdeasControl() }));
        if (id === 'tensions') return send(res, 200, JSON.stringify({ id, ...entry, items: readTensionsControl() }));
        if (id === 'rabbit-hole') return send(res, 200, JSON.stringify({ id, ...entry, blocks: readRabbitHoleBlocksControl() }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
    if (req.method === 'PUT') {
      let body;
      try {
        body = await readBody(req);
        body = body ? JSON.parse(body) : {};
      } catch (_) {
        return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
      }
      try {
        fs.mkdirSync(LEARNING_DIR, { recursive: true });
        if (id === 'sticky-ideas') {
          const items = Array.isArray(body.items) ? body.items.map((s) => String(s).trim()).filter(Boolean) : [];
          const content = '# Piko sticky ideas\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
          fs.writeFileSync(STICKY_IDEAS_FILE_CONTROL, content, 'utf8');
        } else if (id === 'tensions') {
          const items = Array.isArray(body.items) ? body.items.map((s) => String(s).trim()).filter(Boolean) : [];
          const content = '# Piko tensions (synced from Notion)\n\nMax 5 entries.\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
          fs.writeFileSync(TENSIONS_FILE_CONTROL, content, 'utf8');
        } else if (id === 'rabbit-hole') {
          const blocks = Array.isArray(body.blocks) ? body.blocks : [];
          const datePrefix = new Date().toISOString().slice(0, 10);
          const lines = ['# Piko rabbit-hole notes\n'];
          for (const b of blocks) {
            const title = (b.title || '').trim() || datePrefix + ': Note';
            const t = title.match(/^\d{4}-\d{2}-\d{2}/) ? title : datePrefix + ': ' + title;
            lines.push('## ' + t);
            lines.push((b.content || '').trim());
            lines.push('');
          }
          fs.writeFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, lines.join('\n'), 'utf8');
        }
        return send(res, 200, JSON.stringify({ ok: true, id }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }));
      }
    }
    return send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }));
  }
  const learningArchiveMatch = pathname && pathname.match(/^\/api\/control\/learning\/([a-z0-9-]+)\/archive$/);
  if (req.method === 'POST' && learningArchiveMatch) {
    const id = learningArchiveMatch[1];
    const entry = LEARNING_DATABASES.find((e) => e.id === id);
    if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown learning database' }));
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const indices = Array.isArray(body.indices) ? body.indices.map((i) => parseInt(i, 10)).filter((n) => !isNaN(n) && n >= 0) : [];
    if (indices.length === 0) return send(res, 200, JSON.stringify({ ok: true, archived: 0 }));
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const ARCHIVED_STICKY = path.join(LEARNING_DIR, 'sticky-ideas-archived.md');
      const ARCHIVED_TENSIONS = path.join(LEARNING_DIR, 'tensions-archived.md');
      const ARCHIVED_RABBIT = path.join(LEARNING_DIR, 'rabbit-hole-notes-archived.md');
      if (id === 'sticky-ideas') {
        const items = readStickyIdeasControl();
        const toArchive = indices.filter((i) => i < items.length).sort((a, b) => b - a);
        const archived = toArchive.map((i) => items[i]);
        const remaining = items.filter((_, i) => !toArchive.includes(i));
        const header = '# Piko sticky ideas (archived)\n\n';
        const line = archived.map((s) => '- ' + s).join('\n') + '\n';
        try { fs.appendFileSync(ARCHIVED_STICKY, (fs.existsSync(ARCHIVED_STICKY) ? '' : header) + line, 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_STICKY, header + line, 'utf8'); }
        fs.writeFileSync(STICKY_IDEAS_FILE_CONTROL, '# Piko sticky ideas\n\n' + remaining.map((s) => '- ' + s).join('\n') + '\n', 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
      }
      if (id === 'tensions') {
        const items = readTensionsControl();
        const toArchive = indices.filter((i) => i < items.length).sort((a, b) => b - a);
        const archived = toArchive.map((i) => items[i]);
        const remaining = items.filter((_, i) => !toArchive.includes(i));
        const header = '# Piko tensions (archived)\n\n';
        const line = archived.map((s) => '- ' + s).join('\n') + '\n';
        try { fs.appendFileSync(ARCHIVED_TENSIONS, (fs.existsSync(ARCHIVED_TENSIONS) ? '' : header) + line, 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_TENSIONS, header + line, 'utf8'); }
        fs.writeFileSync(TENSIONS_FILE_CONTROL, '# Piko tensions (synced from Notion)\n\nMax 5 entries.\n\n' + remaining.map((s) => '- ' + s).join('\n') + '\n', 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
      }
      if (id === 'rabbit-hole') {
        const blocks = readRabbitHoleBlocksControl();
        const toArchive = indices.filter((i) => i < blocks.length).sort((a, b) => b - a);
        const archived = toArchive.map((i) => blocks[i]);
        const remaining = blocks.filter((_, i) => !toArchive.includes(i));
        const datePrefix = new Date().toISOString().slice(0, 10);
        const lines = [];
        for (const b of archived) {
          const title = (b.title || '').trim() || datePrefix + ': Note';
          const t = title.match(/^\d{4}-\d{2}-\d{2}/) ? title : datePrefix + ': ' + title;
          lines.push('## ' + t);
          lines.push((b.content || '').trim());
          lines.push('');
        }
        const header = '# Piko rabbit-hole notes (archived)\n\n';
        try { fs.appendFileSync(ARCHIVED_RABBIT, (fs.existsSync(ARCHIVED_RABBIT) ? '' : header) + lines.join('\n'), 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_RABBIT, header + lines.join('\n'), 'utf8'); }
        const mainLines = ['# Piko rabbit-hole notes\n'];
        for (const b of remaining) {
          const title = (b.title || '').trim() || datePrefix + ': Note';
          const t = title.match(/^\d{4}-\d{2}-\d{2}/) ? title : datePrefix + ': ' + title;
          mainLines.push('## ' + t);
          mainLines.push((b.content || '').trim());
          mainLines.push('');
        }
        fs.writeFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, mainLines.join('\n'), 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
      }
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/control/learning/preview') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const databaseId = (body.databaseId || body.database || '').trim() || 'sticky-ideas';
    const content = (body.content || '').trim().slice(0, 500);
    const title = (body.title || '').trim().slice(0, 120);
    const label = databaseId === 'rabbit-hole' ? 'a rabbit-hole note' : databaseId === 'tensions' ? 'a tension you\'re holding' : 'a sticky idea you\'re considering';
    const text = databaseId === 'rabbit-hole' && (title || content) ? (title ? title + '\n\n' : '') + content : content;
    if (!text) return send(res, 200, JSON.stringify({ preview: '' }));
    const userMsg = `This is ${label}:\n\n${text}\n\nIn one short sentence (under 15 words), say how you'd naturally mention this in conversation to the user. No preamble, just the sentence.`;
    try {
      const preview = (await ai(userMsg, { max_tokens: 80 })).trim().slice(0, 200);
      return send(res, 200, JSON.stringify({ preview }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ preview: '', error: e.message }));
    }
  }

  // —— Phase 3: Chart SVG ——
  if (req.method === 'GET' && pathname === '/api/chart') {
    const { query } = parseUrl(req.url);
    const type = (query && query.type) || 'bar';
    const dataStr = (query && query.data) || '';
    const values = dataStr.split(/[,;\s]+/).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    if (values.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Usage: /api/chart?type=bar&data=10,20,30');
      return;
    }
    const w = 400;
    const h = 200;
    const pad = 40;
    const max = Math.max(...values, 1);
    let svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += '<rect width="100%" height="100%" fill="#25262a"/>';
    const barW = (w - pad * 2) / values.length - 4;
    values.forEach((v, i) => {
      const x = pad + i * ((w - pad * 2) / values.length) + 2;
      const barH = Math.max(2, ((v / max) * (h - pad * 2)));
      const y = h - pad - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#7c9cbf" rx="2"/>`;
    });
    svg += '</svg>';
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(svg);
    return;
  }

  if (req.method !== 'GET') {
    return send(res, 405, 'Method Not Allowed', 'text/plain');
  }

  let file = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/control' || pathname === '/control/') file = '/control.html';
  if (pathname === '/control-moltbook' || pathname === '/control-moltbook/') file = '/control-moltbook.html';
  if (pathname === '/control-prompts' || pathname === '/control-prompts/') file = '/control-prompts.html';
  if (pathname === '/control-learning' || pathname === '/control-learning/') file = '/control-learning.html';
  if (pathname === '/control-mind' || pathname === '/control-mind/') file = '/control-mind.html';
  if (pathname === '/control-wisdom' || pathname === '/control-wisdom/') file = '/control-wisdom.html';
  if (pathname === '/control-wisdom-metrics' || pathname === '/control-wisdom-metrics/') file = '/control-wisdom-metrics.html';
  if (pathname === '/control-channels' || pathname === '/control-channels/') file = '/control-channels.html';
  if (pathname === '/control-integrations' || pathname === '/control-integrations/') file = '/control-integrations.html';
  if (pathname === '/control-accounts' || pathname === '/control-accounts/') file = '/control-accounts.html';
  const filePath = path.join(PUBLIC_DIR, file);
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  try {
    const { data } = await serveFile(filePath, contentType);
    send(res, 200, data, contentType);
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not Found', 'text/plain');
    send(res, 500, 'Internal Server Error', 'text/plain');
  }
}

// —— Unified heartbeat (every 5 min): tensions, Moltbook, learning dir ——
function checkTensions() {
  try {
    const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      const count = (raw.match(/^\s*-\s+/gm) || []).length;
      if (LOG_CONSOLE && count > 0) log('info', 'heartbeat tensions', { count });
    }
  } catch (_) {}
}
function checkMoltbookFeedback() {
  if (!MOLTBOOK_API_KEY || !MOLTBOOK_API_KEY.trim()) return;
  try {
    const statePath = path.join(DATA_DIR, 'moltbook-state.json');
    const state = { lastHeartbeat: new Date().toISOString() };
    if (fs.existsSync(statePath)) {
      const existing = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.posts = existing.posts || [];
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}
function learningHeartbeat() {
  try {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const stampPath = path.join(LEARNING_DIR, '.heartbeat');
    fs.writeFileSync(stampPath, new Date().toISOString(), 'utf8');
  } catch (_) {}
}
function runUnifiedHeartbeat() {
  Promise.all([
    Promise.resolve().then(checkTensions),
    Promise.resolve().then(checkMoltbookFeedback),
    Promise.resolve().then(learningHeartbeat),
  ]).catch((e) => log('error', 'heartbeat', { message: e.message }));
}

// Nightly history dump: write sessions to HISTORY_DIR/YYYY-MM-DD.txt each night
function dumpHistory(forDate) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const lines = [];
    const dumpTime = new Date().toISOString();
    lines.push(`# Piko history dump for ${forDate} (written ${dumpTime})`);
    lines.push('');
    for (const [key, history] of sessions.entries()) {
      if (!Array.isArray(history) || history.length === 0) continue;
      lines.push(`=== Session: ${key} ===`);
      for (const msg of history) {
        const role = msg.role === 'user' ? 'User' : 'Piko';
        const content = (msg.content || '').replace(/\n/g, '\n  ');
        lines.push(`${role}: ${content}`);
      }
      lines.push('');
    }
    const filePath = path.join(HISTORY_DIR, `${forDate}.txt`);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log('[history] Dumped to', filePath);
  } catch (e) {
    console.error('[history] Dump failed:', e.message);
  }
}

let lastDumpDate = new Date().toISOString().slice(0, 10);
const HISTORY_CHECK_MS = 60000; // check every minute
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  if (today > lastDumpDate) {
    dumpHistory(lastDumpDate);
    lastDumpDate = today;
  }
}, HISTORY_CHECK_MS);

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Piko WebChat http://0.0.0.0:${PORT} (Ollama: ${OLLAMA_MODEL})`);
  if (HISTORY_DIR) console.log('[history] Nightly dumps to', HISTORY_DIR);
  runUnifiedHeartbeat();
  cron.schedule('*/5 * * * *', runUnifiedHeartbeat);
  cron.schedule('*/5 * * * *', () => {
    const cwd = __dirname;
    exec('node scripts/intent-poller.js', { cwd, env: process.env, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) log('error', 'intent_poller', { message: err.message }, null);
    });
  });
  const runMoltbookPoster = () => {
    const cwd = __dirname;
    exec('node scripts/moltbook-poster.js', { cwd, env: process.env, timeout: 90000 }, (err, stdout, stderr) => {
      if (err) log('error', 'moltbook_poster', { message: err.message }, null);
    });
  };
  cron.schedule('0,30 * * * *', runMoltbookPoster);
  setTimeout(runMoltbookPoster, 60000);
  cron.schedule('0 2 * * *', () => {
    require('./scripts/nightly_wisdom').runNightlyWisdom().catch((e) => log('error', 'nightly_wisdom', { message: e.message }));
  });
  cron.schedule('0 3 * * *', () => {
    beliefLoop.runBeliefConsolidation()
      .then(() => memory.pruneEpisodicOlderThanDays())
      .then(() => beliefLoop.resolveBeliefConflicts())
      .catch((e) => log('error', 'belief_consolidation', { message: e.message }));
  });
  cron.schedule('0 8 * * 0', () => {
    try {
      const { weeklyRetro } = require('./lib/metrics');
      const report = weeklyRetro();
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const https = require('https');
        const body = JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: report });
        const u = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`);
        const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } }, () => {});
        req.on('error', (e) => log('error', 'weekly_retro_telegram', { message: e.message }));
        req.write(body);
        req.end();
      } else {
        const retroPath = path.join(DATA_DIR, 'learning', 'weekly-retro.md');
        fs.mkdirSync(path.dirname(retroPath), { recursive: true });
        fs.appendFileSync(retroPath, '\n\n---\n' + new Date().toISOString() + '\n\n' + report, 'utf8');
      }
    } catch (e) {
      log('error', 'weekly_retro', { message: e.message });
    }
  });
  console.log('[heartbeat] Unified 5min cron; intent poller every 5min; Moltbook poster at :00 and :30; nightly wisdom 2AM; belief 3AM; weekly retro Sun 8AM');
});
