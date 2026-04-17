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
const { ai, aiStream, ollamaNativeChat, MODEL_PRIMARY } = require('./lib/llm');
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
const MODEL_GATE_BLOCK_CANDIDATE = process.env.PIKO_MODEL_GATE_BLOCK_CANDIDATE !== '0' && process.env.PIKO_MODEL_GATE_BLOCK_CANDIDATE !== 'false';
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
const PENDING_CANCEL_FILE = path.join(DATA_DIR, 'pending-cancel-confirmations.json');
const PROACTIVE_WEBHOOK_URL = String(process.env.PIKO_PROACTIVE_WEBHOOK_URL || '').trim();
const PROACTIVE_WEBHOOK_WHATSAPP_URL = String(process.env.PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL || '').trim();
const PROACTIVE_WEBHOOK_IMESSAGE_URL = String(process.env.PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL || '').trim();
const PROACTIVE_WEBHOOK_BEARER = String(process.env.PIKO_PROACTIVE_WEBHOOK_BEARER || '').trim();
const PROACTIVE_CYCLE_TIMEOUT_MS = Math.max(1000, Number(process.env.PIKO_PROACTIVE_CYCLE_TIMEOUT_MS || 60000));
const LEGION_ADAPTER_API_BASE = String(process.env.PIKO_LEGION_ADAPTER_API_BASE || process.env.LEGION_ADAPTER_API_BASE || 'http://127.0.0.1:8000').trim();
const LEGION_ADAPTER_API_BEARER = String(process.env.PIKO_LEGION_ADAPTER_API_BEARER || '').trim();
const LEGION_BRIEF_DEFAULT_ADAPTER = String(process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies').trim();
const AUSMAKER_BASE_URL = String(process.env.AUSMAKER_BASE_URL || process.env.PIKO_AUSMAKER_BASE_URL || 'http://127.0.0.1:5001').trim();
const PIKO_WEBHOOK_SECRET = String(process.env.PIKO_WEBHOOK_SECRET || '').trim();
/** Pending NL intent confirmation: sessionKey -> { extracted, createdAt }. Expires after 5 min. */
const pendingIntentsBySession = new Map();
const PENDING_INTENT_EXPIRY_MS = 5 * 60 * 1000;
const PENDING_CANCEL_TTL_MS = 5 * 60 * 1000;

/** Tracks in-flight requests to coalesce duplicates and prevent OpenClaw state corruption. */
const inFlightRequests = new Map();

/** Per-session mutex to prevent double-tap history corruption (sequential processing per sessionId). */
const sessionLocks = new Map();
async function acquireSessionLock(sessionId, task) {
  if (!sessionLocks.has(sessionId)) sessionLocks.set(sessionId, Promise.resolve());
  const previousTask = sessionLocks.get(sessionId);
  let release;
  const nextTask = new Promise((resolve) => { release = resolve; });
  sessionLocks.set(sessionId, previousTask.then(() => nextTask));
  try {
    await previousTask;
    return await task();
  } finally {
    release();
  }
}

function loadPendingCancelConfirmations() {
  const map = new Map();
  try {
    if (fs.existsSync(PENDING_CANCEL_FILE)) {
      const raw = fs.readFileSync(PENDING_CANCEL_FILE, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const now = Date.now();
        for (const [k, v] of Object.entries(obj)) {
          if (v && Array.isArray(v.intentIds) && v.expiresAt && v.expiresAt > now) {
            map.set(k, { intentIds: v.intentIds, expiresAt: v.expiresAt });
          }
        }
      }
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[pendingCancel] load:', e.message);
  }
  return map;
}

function savePendingCancelConfirmations(map) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [k, v] of map.entries()) {
      if (v && Array.isArray(v.intentIds)) obj[k] = { intentIds: v.intentIds, expiresAt: v.expiresAt };
    }
    fs.writeFileSync(PENDING_CANCEL_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[pendingCancel] save:', e.message);
  }
}

const pendingCancelConfirmations = loadPendingCancelConfirmations();

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

function buildConnectorContext() {
  return {
    env: process.env,
    dataDir: DATA_DIR,
    linkedAccounts: loadLinkedAccounts(),
  };
}

function loadMobilePreferences() {
  const defaults = {
    quietStart: null,
    quietEnd: null,
    mobilePushEnabled: true,
    backgroundSyncEnabled: true,
    updatedAt: null,
  };
  try {
    if (!fs.existsSync(EA_PREFERENCES_FILE)) return defaults;
    const raw = fs.readFileSync(EA_PREFERENCES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      ...defaults,
      ...parsed,
      mobilePushEnabled: parsed.mobilePushEnabled !== false,
      backgroundSyncEnabled: parsed.backgroundSyncEnabled !== false,
      updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : null,
    };
  } catch (_) {
    return defaults;
  }
}

function saveMobilePreferences(nextPrefs, expectedUpdatedAt) {
  const current = loadMobilePreferences();
  const expected = String(expectedUpdatedAt || '').trim();
  if (expected && current.updatedAt && expected !== current.updatedAt) {
    const err = new Error('Preference version conflict');
    err.code = 'PREFERENCES_CONFLICT';
    err.current = current;
    throw err;
  }
  const merged = mergeMobilePreferences(current, nextPrefs);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EA_PREFERENCES_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function buildIntentSnapshot(now) {
  const intents = loadIntents();
  const reminders = intents.filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
  const scheduled = intents.filter((i) => i.type === 'scheduled' && (i.status === 'pending' || !i.status));
  const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
  const reminderDue = (r) => r.dueAt || r.time;
  const scheduledRun = (s) => s.dueAt || s.run;
  const nextReminder = reminders
    .filter((r) => new Date(reminderDue(r) || 0) > now)
    .sort((a, b) => new Date(reminderDue(a)) - new Date(reminderDue(b)))[0] || null;
  const nextScheduled = scheduled
    .filter((s) => new Date(scheduledRun(s) || 0) > now)
    .sort((a, b) => new Date(scheduledRun(a)) - new Date(scheduledRun(b)))[0] || null;
  return {
    queueLength: queue.length,
    remindersCount: reminders.length,
    scheduledCount: scheduled.length,
    nextReminder: nextReminder ? {
      at: reminderDue(nextReminder),
      text: (nextReminder.title || nextReminder.message || nextReminder.text || '').slice(0, 120),
    } : null,
    nextScheduled: nextScheduled ? {
      at: scheduledRun(nextScheduled),
      command: (nextScheduled.command || '').slice(0, 120),
    } : null,
  };
}

function getMobilePollHintSeconds(intentSnapshot) {
  if (intentSnapshot.nextReminder) return 60;
  if (intentSnapshot.queueLength > 0) return 120;
  return 300;
}

const OLLAMA_HEALTH_CACHE_MS = Math.max(5000, Number(process.env.PIKO_OLLAMA_HEALTH_CACHE_MS || 30000));
const OLLAMA_HEALTH_TIMEOUT_MS = Math.max(500, Number(process.env.PIKO_OLLAMA_HEALTH_TIMEOUT_MS || 1500));
let ollamaHealthCache = { checkedAtMs: 0, ok: null };

async function probeOllamaReachability() {
  try {
    const target = new url.URL(OLLAMA_URL);
    const opts = {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: '/api/tags',
      method: 'GET',
    };
    const requester = target.protocol === 'https:' ? https : http;
    const statusCode = await new Promise((resolve, reject) => {
      const req = requester.request(opts, (res) => {
        resolve(Number(res.statusCode) || 0);
        res.resume();
      });
      req.on('error', reject);
      req.setTimeout(OLLAMA_HEALTH_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
      req.end();
    });
    return statusCode >= 200 && statusCode < 500;
  } catch (_) {
    return false;
  }
}

async function getCachedOllamaHealth() {
  const nowMs = Date.now();
  if (ollamaHealthCache.ok !== null && (nowMs - ollamaHealthCache.checkedAtMs) < OLLAMA_HEALTH_CACHE_MS) {
    return {
      ok: !!ollamaHealthCache.ok,
      checkedAt: new Date(ollamaHealthCache.checkedAtMs).toISOString(),
    };
  }
  const ok = await probeOllamaReachability();
  ollamaHealthCache = { checkedAtMs: nowMs, ok };
  return {
    ok,
    checkedAt: new Date(nowMs).toISOString(),
  };
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
const metrics = {
  requests: 0,
  errors: 0,
  chat: 0,
  commands: 0,
  conversation: {
    route: { casual: 0, socialChat: 0, full: 0, deep: 0 },
    fallbackApplied: 0,
    stiltedDetected: 0,
    resetTrigger: 0,
    bleedTrigger: 0,
  },
};
const startTime = Date.now();
const { log: logStructured } = require('./lib/logger');
function log(level, msg, meta = {}, requestId) {
  if (LOG_CONSOLE) console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta, requestId }));
  logStructured(level, msg, meta, requestId);
}
const sessionStore = require('./lib/sessionStore');
const rateLimit = require('./lib/rateLimit');

const CHAT_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.PIKO_CHAT_MAX_CONCURRENCY || '2', 10) || 2);
const CHAT_QUEUE_MAX = Math.max(0, parseInt(process.env.PIKO_CHAT_QUEUE_MAX || '24', 10) || 24);
const CHAT_QUEUE_WAIT_MS = Math.max(250, parseInt(process.env.PIKO_CHAT_QUEUE_WAIT_MS || '2000', 10) || 2000);
let chatInFlight = 0;
const chatQueue = [];

metrics.conversation.chatQueue = {
  inFlight: 0,
  queued: 0,
  maxConcurrency: CHAT_MAX_CONCURRENCY,
  maxQueue: CHAT_QUEUE_MAX,
  waitMs: CHAT_QUEUE_WAIT_MS,
  admitted: 0,
  rejected: 0,
  timedOut: 0,
  peakInFlight: 0,
  peakQueued: 0,
};

function updateChatQueueMetrics() {
  const cq = metrics.conversation.chatQueue;
  cq.inFlight = chatInFlight;
  cq.queued = chatQueue.length;
  cq.peakInFlight = Math.max(cq.peakInFlight, chatInFlight);
  cq.peakQueued = Math.max(cq.peakQueued, chatQueue.length);
}

function releaseChatSlot() {
  chatInFlight = Math.max(0, chatInFlight - 1);
  while (chatQueue.length > 0) {
    const next = chatQueue.shift();
    if (!next || next.cancelled) continue;
    if (next.timer) clearTimeout(next.timer);
    chatInFlight += 1;
    updateChatQueueMetrics();
    metrics.conversation.chatQueue.admitted += 1;
    next.resolve(() => {
      if (next.released) return;
      next.released = true;
      releaseChatSlot();
    });
    return;
  }
  updateChatQueueMetrics();
}

function acquireChatSlot() {
  if (chatInFlight < CHAT_MAX_CONCURRENCY) {
    chatInFlight += 1;
    updateChatQueueMetrics();
    metrics.conversation.chatQueue.admitted += 1;
    return Promise.resolve(() => releaseChatSlot());
  }
  if (chatQueue.length >= CHAT_QUEUE_MAX) {
    const err = new Error('Chat queue full');
    err.code = 'chat_queue_full';
    metrics.conversation.chatQueue.rejected += 1;
    updateChatQueueMetrics();
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, cancelled: false, released: false, timer: null };
    entry.timer = setTimeout(() => {
      entry.cancelled = true;
      metrics.conversation.chatQueue.timedOut += 1;
      updateChatQueueMetrics();
      const err = new Error('Chat queue wait timeout');
      err.code = 'chat_queue_timeout';
      reject(err);
    }, CHAT_QUEUE_WAIT_MS);
    chatQueue.push(entry);
    updateChatQueueMetrics();
  });
}

const DATA_SOUL_PATH = path.join(DATA_DIR, 'SOUL.md');

function loadDataSoul() {
  try {
    if (fs.existsSync(DATA_SOUL_PATH)) {
      return fs.readFileSync(DATA_SOUL_PATH, 'utf8').trim();
    }
  } catch (_) {}
  return '';
}

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
  nextDueFromSchedule,
} = require('./lib/intents.js');

/** Normalize natural-language schedule from LLM to canonical format for nextDueFromSchedule. */
function normalizeSchedule(s) {
  if (!s || typeof s !== 'string') return s;
  let out = s
    .toLowerCase()
    .replace(/every hour (from|between) /gi, 'hourly ')
    .replace(/\s+to\s+|\s+and\s+/g, '-')
    .replace(/\s+at\s+/g, ' ')
    .replace(/\s+daily\s*$/g, '')
    .trim();
  // 12h -> 24h for common patterns (6am -> 06:00, 11pm -> 23:00)
  out = out.replace(/(\d{1,2})(?::(\d{2}))?\s*am\b/gi, (_, h, m) => {
    const hr = parseInt(h, 10);
    const hour = hr === 12 ? 0 : hr;
    return `${String(hour).padStart(2, '0')}:${(m || '00')}`;
  });
  out = out.replace(/(\d{1,2})(?::(\d{2}))?\s*pm\b/gi, (_, h, m) => {
    const hr = parseInt(h, 10);
    const hour = hr === 12 ? 12 : hr + 12;
    return `${String(hour).padStart(2, '0')}:${(m || '00')}`;
  });
  return out;
}
const { updateMind, loadMind, saveSelfModel, saveBeliefs } = require('./lib/mind');
const { getCorpusBlockForPrompt, regenerateSummary, loadCorpus, DOCS: CORPUS_DOCS, readDoc, CORPUS_DIR } = require('./lib/corpus');
const { getKnowledgeBaseBlockForPrompt } = require('./lib/knowledgeBase');
const { getTruthBlockForPrompt, appendCorrection, getTruthStats } = require('./lib/truth');
const beliefLoop = require('./lib/beliefLoop');
const memory = require('./lib/memory');
const { createResponsePlan, formatPlanForPrompt, classifyDepthOptional } = require('./lib/planner');
const { loadPolicy: loadProactivePolicy, savePolicy: saveProactivePolicy } = require('./lib/proactivePolicy');
const { listDecisions: listLegateDecisions, findDecisionByTrace } = require('./lib/phase0/decisionLedger');
const { sendLegionCommand } = require('./lib/phase0/legionClient');
const { executeDecisionAction, replayDecisionActionDeadLetter } = require('./lib/phase0/decisionActions');
const { listDeadLetters: listLegateActionDeadLetters } = require('./lib/phase0/actionDeadLetters');
const { getSnapshot: getLegateLinkReliability } = require('./lib/phase0/linkReliability');
const {
  recordEvent: recordLegateObsEvent,
  getObservability: getLegateObservability,
  getTraceCorrelation: getLegateTraceCorrelation,
  getSloSnapshot: getLegateSloSnapshot,
} = require('./lib/phase0/observability');
const { loadRollout: loadLegateRollout, saveRollout: saveLegateRollout, canExecuteProductionAction } = require('./lib/phase0/rollout');
const {
  startBriefSession,
  getBriefSession,
  clearBriefSession,
  nextMissingField,
  isBriefComplete,
  setBriefField,
  parseFieldValueLine,
  formatRecap,
  appendConfirmedBrief,
} = require('./lib/phase0/legionBrief');
const { isLegionApproveAllowed, verifyAndStripApprovalPin } = require('./lib/legionApprove');
const { handleConversationQualityRoute } = require('./lib/routes/controlConversationQuality');
const { handleLegateEventsRoute } = require('./lib/routes/legateEvents');
const { handleLegateDecisionRequestRoute } = require('./lib/routes/legateDecisionRequest');
const { listConnectors, getConnectorHealth, invokeConnector } = require('./lib/connectors');
const { createProactiveEngine } = require('./lib/proactiveEngine');
const { createProactiveCycleRunner } = require('./lib/proactive/schedulerRunner');
const {
  loadState,
  upsertDeviceHeartbeat,
  registerPushToken,
  recordPushAck,
  listDevices,
  getMobileReliabilityMetrics,
} = require('./lib/mobileState');
const { toWidgetPayload, toLiveActivityPayload, toIosDashboardPayload } = require('./lib/mobileContracts');
const { decideMobilePoll } = require('./lib/mobileCadence');
const { loadRules, createRule, updateRule, deleteRule, toggleRule } = require('./lib/webhookRules');
const { processWebhookEvent } = require('./lib/webhookProcessor');
const {
  makeWeakEtag,
  parseIfMatchVersion,
  buildMobilePolicyPatch,
  mergeMobilePreferences,
} = require('./lib/mobileSync');
const {
  loadRegistry,
  promoteModel,
  rollbackModel,
  upsertModel,
  getLatestGateEvaluation,
  getModelOpsOverview,
} = require('./lib/modelRegistry');
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

function appendPendingNotification(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(PENDING_NOTIFICATIONS_FILE, String(line || '').slice(0, 2000) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function resolveProactiveWebhookUrl(meta) {
  const rawTarget = String((meta && meta.target) || '').trim();
  const target = rawTarget.toLowerCase();
  if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) return rawTarget;
  if (target === 'whatsapp_bridge' && PROACTIVE_WEBHOOK_WHATSAPP_URL) return PROACTIVE_WEBHOOK_WHATSAPP_URL;
  if (target === 'imessage_bridge' && PROACTIVE_WEBHOOK_IMESSAGE_URL) return PROACTIVE_WEBHOOK_IMESSAGE_URL;
  return PROACTIVE_WEBHOOK_URL;
}

async function sendProactiveWebhook(message, meta) {
  const target = String((meta && meta.target) || '').toLowerCase();
  const endpoint = resolveProactiveWebhookUrl(meta);
  if (target === 'whatsapp_bridge' && !PROACTIVE_WEBHOOK_WHATSAPP_URL && !PROACTIVE_WEBHOOK_URL) {
    throw new Error('Missing PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL (or global webhook fallback)');
  }
  if (target === 'imessage_bridge' && !PROACTIVE_WEBHOOK_IMESSAGE_URL && !PROACTIVE_WEBHOOK_URL) {
    throw new Error('Missing PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL (or global webhook fallback)');
  }
  if (!endpoint) throw new Error('No proactive webhook endpoint configured');
  let parsed;
  try {
    parsed = new url.URL(endpoint);
  } catch (_) {
    throw new Error('Invalid proactive webhook URL');
  }
  const body = JSON.stringify({
    source: 'piko_proactive',
    at: new Date().toISOString(),
    channel: meta && meta.channel ? String(meta.channel).slice(0, 60) : 'webhook',
    target: meta && meta.target ? String(meta.target).slice(0, 60) : 'webhook',
    urgency: meta && meta.urgency ? String(meta.urgency).slice(0, 20) : 'normal',
    message: String(message || '').slice(0, 2000),
  });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'piko-proactive/1.0',
  };
  if (PROACTIVE_WEBHOOK_BEARER) headers.Authorization = 'Bearer ' + PROACTIVE_WEBHOOK_BEARER;
  const opts = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
    path: (parsed.pathname || '/') + (parsed.search || ''),
    method: 'POST',
    headers,
  };
  const requester = parsed.protocol === 'http:' ? httpRequest : httpsRequest;
  const { statusCode, data } = await requester(opts, body);
  if (statusCode < 200 || statusCode >= 300) {
    const payload = String(data || '').slice(0, 200);
    throw new Error(`Webhook dispatch failed (${statusCode}): ${payload}`);
  }
  return { ok: true };
}

const proactiveEngine = createProactiveEngine({
  dataDir: DATA_DIR,
  loadPolicy: loadProactivePolicy,
  loadIntents,
  sendTelegram: telegramNotify,
  appendPending: appendPendingNotification,
  sendWebhook: sendProactiveWebhook,
  log,
});
const proactiveCycleRunner = createProactiveCycleRunner({
  runCycle: proactiveEngine.runCycle,
  log,
  defaultTimeoutMs: PROACTIVE_CYCLE_TIMEOUT_MS,
});

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

function setCurrentModelOverride(tag) {
  const value = String(tag || '').trim();
  if (!value) throw new Error('Missing model tag');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CURRENT_MODEL_FILE, value, 'utf8');
  return value;
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
// Non-human automation clients should never share the unified human chat memory.
function isAutomationSession(sessionId) {
  const s = String(sessionId || '').trim().toLowerCase();
  if (!s) return false;
  const exact = new Set([
    'intent-poller',
    'scheduler',
    'cron',
    'system',
    'worker',
    'healthcheck',
    'auto',
  ]);
  if (exact.has(s)) return true;
  return (
    s.startsWith('intent-') ||
    s.startsWith('scheduler-') ||
    s.startsWith('cron-') ||
    s.startsWith('system-') ||
    s.startsWith('worker-') ||
    s.startsWith('auto-') ||
    s.startsWith('health-') ||
    s.includes('poller')
  );
}
/**
 * Learning-related questions. When true:
 * - At fast-path (2945): return buildLearningUpdateReply() immediately — NO LLM, no timeout.
 * - At full-path (3107): inject RAG + learning blocks (only for explicit "what have you learned" etc).
 * Casual check-ins like "have you been learning much recently?" take the fast path to avoid timeouts.
 */
function requestsLearningUpdate(message) {
  const text = String(message || '').toLowerCase();
  return (
    /\bhave you been learning\b/.test(text) ||
    /\blearned (anything|much)\b/.test(text) ||
    /what (have|did) you (been\s+)?learn(ing|ed)/.test(text) ||
    /what are you learning/.test(text) ||
    /(tell me|what)'?s?\s+(about|your)\s+(recent\s+)?learning/.test(text) ||
    /anything (new|interesting) (you've|you have)?\s*learn/.test(text) ||
    /\brecent learning\b/.test(text) ||
    /\brabbit[- ]?hole\b/.test(text) ||
    /^\/learning\b/.test(text)
  );
}
function isSimpleStatusAck(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text || /\?/.test(text)) return false;
  return /^(so far so good|so far, so good|all good|good thanks|doing good|doing well|not bad|pretty good|fine thanks|same here|sounds good|nice|cool|ok|okay|alright|cheers|thanks)[.!]*$/.test(text);
}
function pickBySeed(items, seed) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return items[h % items.length];
}
function isToneDriftComplaint(message) {
  const text = String(message || '').toLowerCase();
  return /\b(random|weird|disjointed|off|odd|strange)\b/.test(text) && /\?/.test(text);
}
function buildLearningUpdateReply() {
  const fallback = "Lately I've been testing conversational reliability and agent orchestration workflows.";
  try {
    if (!fs.existsSync(RABBIT_HOLE_NOTES_FILE)) return fallback;
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES_FILE, 'utf8');
    const blocks = raw.split(/\n## /).filter(Boolean);
    const last = (blocks.slice(-1)[0] || '').trim();
    if (!last) return fallback;
    const lines = last.split(/\n/).map((l) => l.trim()).filter(Boolean);
    // Prefer the first content line after timestamp/title lines.
    const candidate = lines.find((l) => !/^#/.test(l) && !/^\d{4}-\d{2}-\d{2}/.test(l) && l.length > 15) || '';
    const clean = candidate
      .replace(/^[-*•]\s*/, '')
      .replace(/[`*_#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return fallback;
    const out = clean.slice(0, 180);
    return /[.!?]$/.test(out) ? out : `${out}.`;
  } catch (_) {
    return fallback;
  }
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
const SLICE_HISTORY = Math.max(6, Math.min(30, parseInt(process.env.PIKO_SLICE_HISTORY || '6', 10) || 6));

function parseUrl(u) {
  const parsed = url.parse(u, true);
  return { pathname: parsed.pathname || '/', query: parsed.query };
}

function extractWordLimit(message) {
  const text = String(message || '').toLowerCase();
  const digitMatch = text.match(/(?:under|in|to|at most|max)\s+(\d+)\s+words?/i) || text.match(/(\d+)\s+words?\s+max/i);
  if (digitMatch && Number(digitMatch[1]) > 0) return Number(digitMatch[1]);
  const wordMap = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const wordMatch = text.match(/(?:under|in|to|at most|max)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+words?/i);
  if (wordMatch && wordMap[wordMatch[1]]) return wordMap[wordMatch[1]];
  return 0;
}

function extractSentenceLimit(message) {
  const text = String(message || '').toLowerCase();
  if (/(one|1|single)\s+sentence/.test(text)) return 1;
  if (/(one|1|single)\s+line/.test(text)) return 1;
  return 0;
}

function requestsNoQuestion(message) {
  const text = String(message || '').toLowerCase();
  return /do not ask questions?/.test(text) || /\bno questions?\b/.test(text) || /\bno question\b/.test(text);
}

function isKeepItShortPrompt(message) {
  const text = String(message || '').toLowerCase().trim();
  return /(keep it short|keep this short|keep it brief|be brief|short reply|brief reply)/.test(text);
}

function requestsLegionBrief(message) {
  const text = String(message || '').toLowerCase().trim();
  if (!text) return false;
  if (text === 'legion brief') return true;
  if (text.startsWith('/legion brief') || text.startsWith('/legion-brief')) return true;
  return /(start|create|make|prepare|fill|do|need|want|ask for|give me)\b[\s\S]{0,40}\blegion brief\b/.test(text);
}

function inferLegionAdapterFromBrief(fields) {
  const objective = String(fields && fields.objective || '').toLowerCase();
  const scope = String(fields && fields.scope || '').toLowerCase();
  const merged = `${objective} ${scope}`;
  if (/\baus\s*maker\b|\bausmaker\b|\bcin7\b|\bshopify\b/.test(merged)) return 'ausmakersupplies';
  return LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies';
}

const { inferCapabilityFromObjectiveAsync } = require('./lib/legionCapabilities');

function postJsonToUrl(urlString, payload, options = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(e); }
    const body = JSON.stringify(payload || {});
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000));
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(options.headers || {}),
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search || ''}`,
      method: 'POST',
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) {}
        resolve({ statusCode: res.statusCode || 0, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

async function dispatchLegionBrief(brief, dispatchContext) {
  const fields = brief && brief.fields ? brief.fields : {};
  const adapterId = inferLegionAdapterFromBrief(fields);
  const model = dispatchContext && dispatchContext.model;
  const capability = await inferCapabilityFromObjectiveAsync(fields, DATA_DIR, model);
  if (!adapterId || !capability) {
    return { ok: false, code: 'NO_CAPABILITY_MATCH', message: 'Could not infer adapter/capability from brief objective.' };
  }
  const endpoint = `${LEGION_ADAPTER_API_BASE.replace(/\/$/, '')}/api/adapters/${encodeURIComponent(adapterId)}/run`;
  const payload = {
    capability,
    input: {
      include_raw: capability === 'inventory.low_stock.scan',
    },
    context: {
      trace_id: `trc_brief_${Date.now()}`,
      brief_id: `lbrief_${Date.now()}`,
      project_id: adapterId,
      execution_mode: String(fields.execution_mode || 'needs_approval'),
      requested_by: 'piko',
      risk_level: String(fields.risk_level || 'medium'),
      piko_user_id: String(dispatchContext && dispatchContext.piko_user_id || ''),
      piko_decision_id: `dec_brief_${Date.now()}`,
    },
  };
  const headers = LEGION_ADAPTER_API_BEARER ? { Authorization: `Bearer ${LEGION_ADAPTER_API_BEARER}` } : {};
  const timeoutMs = Math.max(5000, parseInt(process.env.PIKO_LEGION_TIMEOUT_MS || '20000', 10));
  const res = await postJsonToUrl(endpoint, payload, { timeoutMs, headers });
  if (res.statusCode >= 200 && res.statusCode < 300 && res.body && res.body.ok) {
    return {
      ok: true,
      adapterId,
      capability,
      runId: String(res.body.run_id || ''),
      status: String(res.body.status || 'accepted'),
    };
  }
  return {
    ok: false,
    code: 'DISPATCH_FAILED',
    message: `Legion dispatch failed (HTTP ${res.statusCode})`,
    details: res.body && res.body.error ? res.body.error : null,
  };
}

const LEGION_APPROVE_PENDING_FILE = path.join(DATA_DIR, 'phase0-legion-approve-pending.json');

function loadApprovalPending() {
  try {
    if (!fs.existsSync(LEGION_APPROVE_PENDING_FILE)) return {};
    const raw = fs.readFileSync(LEGION_APPROVE_PENDING_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function setApprovalPending(sessionKey, opts = {}) {
  const data = loadApprovalPending();
  data[sessionKey] = {
    awaiting: 'po_submit',
    since: new Date().toISOString(),
    source: opts.source || null,
  };
  fs.mkdirSync(path.dirname(LEGION_APPROVE_PENDING_FILE), { recursive: true });
  fs.writeFileSync(LEGION_APPROVE_PENDING_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function clearApprovalPending(sessionKey) {
  const data = loadApprovalPending();
  if (data[sessionKey]) {
    delete data[sessionKey];
    fs.writeFileSync(LEGION_APPROVE_PENDING_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

async function dispatchLegionPoSubmit(poPayload, dispatchContext) {
  const adapterId = LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies';
  const endpoint = `${LEGION_ADAPTER_API_BASE.replace(/\/$/, '')}/api/adapters/${encodeURIComponent(adapterId)}/run`;
  const payload = {
    capability: 'purchase_order.submit',
    input: {
      purchase_order_payload: poPayload,
      dry_run: false,
    },
    context: {
      trace_id: `trc_approve_${Date.now()}`,
      execution_mode: 'auto',
      requested_by: 'piko',
      piko_user_id: String(dispatchContext && dispatchContext.piko_user_id || ''),
      piko_decision_id: `dec_approve_${Date.now()}`,
    },
  };
  const headers = LEGION_ADAPTER_API_BEARER ? { Authorization: `Bearer ${LEGION_ADAPTER_API_BEARER}` } : {};
  const res = await postJsonToUrl(endpoint, payload, { timeoutMs: 30000, headers });
  if (res.statusCode >= 200 && res.statusCode < 300 && res.body && res.body.ok) {
    return {
      ok: true,
      adapterId,
      runId: String(res.body.run_id || ''),
      status: String(res.body.status || 'accepted'),
      result: res.body.result,
    };
  }
  return {
    ok: false,
    code: 'DISPATCH_FAILED',
    message: `Legion PO submit failed (HTTP ${res.statusCode})`,
    details: res.body && res.body.error ? res.body.error : null,
  };
}

function enforceReplyConstraints(reply, constraints = {}) {
  let text = String(reply || '').trim();
  if (!text) return text;
  const maxSentences = Number(constraints.maxSentences || 0);
  const noQuestion = constraints.noQuestion === true;
  const maxWords = Number(constraints.maxWords || 0);

  if (maxSentences > 0) {
    const bits = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    text = bits.slice(0, maxSentences).join(' ').trim() || text;
  }
  if (noQuestion) {
    text = text.replace(/\?/g, '.');
  }
  if (maxWords > 0) {
    text = truncateToWords(text, maxWords);
  }
  if (!/[.!?]$/.test(text)) text += '.';
  return text;
}

function truncateToWords(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const take = Math.max(1, Math.min(20, Number(maxWords) || 1));
  const out = words.slice(0, take).join(' ');
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

function findRequestedNickname(history, sessionKey) {
  try {
    const durable = memory.getSessionNickname(sessionKey);
    if (durable) return durable;
  } catch (_) {}
  const priorUsers = Array.isArray(history) ? history.filter((m) => m && m.role === 'user').map((m) => String(m.content || '')) : [];
  for (let i = priorUsers.length - 1; i >= 0; i -= 1) {
    const line = priorUsers[i];
    let m = line.match(/nickname is\s+([a-z0-9_-]+)/i);
    if (m && m[1]) return m[1];
    m = line.match(/call me\s+([a-z0-9_-]+)/i);
    if (m && m[1]) return m[1];
    m = line.match(/use\s+([a-z0-9_-]+)\s+as my nickname/i);
    if (m && m[1]) return m[1];
  }
  return '';
}

function extractNicknameFromMessage(message) {
  const text = String(message || '').trim();
  let m = text.match(/nickname is\s+([a-z0-9_-]+)/i);
  if (m && m[1]) return m[1];
  m = text.match(/call me\s+([a-z0-9_-]+)/i);
  if (m && m[1]) return m[1];
  m = text.match(/use\s+([a-z0-9_-]+)\s+as my nickname/i);
  if (m && m[1]) return m[1];
  return '';
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
  const defaultMaxTokens = Math.max(64, Math.min(1200, Number(process.env.PIKO_CHAT_MAX_TOKENS || 1024)));
  const timeoutMs = Math.max(5000, Number(process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000));
  return withTimeout(ai(messages, {
    model: normalized,
    max_tokens: options.max_tokens ?? defaultMaxTokens,
    temperature: options.temperature,
    repeat_penalty: options.repeat_penalty,
    presence_penalty: options.presence_penalty,
    frequency_penalty: options.frequency_penalty,
  }), timeoutMs, 'ollama_chat_timeout');
}

/** Phase 3: stream via LiteLLM; onChunk(delta) for each piece; returns full reply. */
async function ollamaChatStream(messages, onChunk, model, options = {}) {
  const m = model || OLLAMA_MODEL;
  const normalized = (m && m.startsWith('ollama/')) ? m : `ollama/${m || OLLAMA_MODEL}`;
  const timeoutMs = Math.max(5000, Number(process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000));
  return withTimeout(aiStream(messages, onChunk, normalized, options), timeoutMs, 'ollama_stream_timeout');
}

function withTimeout(promise, timeoutMs, code) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Timeout after ${timeoutMs}ms`);
      err.code = code || 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
  if (res.writableEnded) return;
  if (res.headersSent) {
    try { res.end(body); } catch (_) {}
    return;
  }
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
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Optimus can intermittently fail IPv6 egress to Telegram.
        // Force IPv4 for deterministic delivery from server-side dispatch.
        family: 4,
      },
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
    const inquiryTimeoutMs = Math.max(30000, Number(process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000)) + 10000; // model timeout + buffer
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
      reqIn.setTimeout(inquiryTimeoutMs, () => { reqIn.destroy(); resolve(send(res, 504, JSON.stringify({ error: 'Chat timeout' }))); });
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
  // Session key: keep unified memory for human channels, but isolate automation clients.
  const automationSession = isAutomationSession(sessionId);
  if (!automationSession) {
    try {
      require('./scripts/proactiveThinker').updateLastInteraction();
    } catch (_) {}
  }
  const key = automationSession ? (sessionId || 'automation') : (process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main');
  // Keep identity facts scoped to the caller-provided session to avoid cross-channel nickname bleed.
  const identityKey = sessionId || key;
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const ollamaPriority = automationSession ? 'background' : 'user';
  const { runWithContext } = require('./lib/requestContext');
  return runWithContext({ priority: ollamaPriority }, async () => {
  return acquireSessionLock(key, async () => {
  const limit = rateLimit.check(clientIp);
  if (!limit.ok) return send(res, 429, JSON.stringify({ error: 'Too many requests' }));

  // Promise-based request coalescing: duplicate requests wait for original and get same payload
  const userIdentifier = key;
  const msgSignature = `${userIdentifier}::${message.trim().toLowerCase()}`;

  if (inFlightRequests.has(msgSignature)) {
    console.warn('[SERVER] Piggybacking duplicate request onto active process:', msgSignature.slice(0, 80) + (msgSignature.length > 80 ? '...' : ''));
    try {
      const { statusCode, body } = await inFlightRequests.get(msgSignature);
      return send(res, statusCode, body);
    } catch (e) {
      return send(res, 500, JSON.stringify({ reply: 'Concurrent request failed.' }));
    }
  }

  let resolveReq;
  const reqPromise = new Promise((resolve) => { resolveReq = resolve; });
  inFlightRequests.set(msgSignature, reqPromise);

  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  let capturedStatus = 200;
  res.writeHead = function (statusCode, ...args) {
    capturedStatus = statusCode;
    return originalWriteHead(statusCode, ...args);
  };
  res.end = function (body, encoding, callback) {
    if (resolveReq) {
      try {
        resolveReq({ statusCode: capturedStatus, body: typeof body === 'string' ? body : String(body) });
      } catch (_) {
        resolveReq({ statusCode: 500, body: JSON.stringify({ reply: '' }) });
      }
      resolveReq = null;
      setTimeout(() => inFlightRequests.delete(msgSignature), 5000);
    }
    return originalEnd(body, encoding, callback);
  };

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

  const lowerMessage = String(message || '').toLowerCase().trim();

  // —— Pending Legion approve: next message is PO payload or cancel ——
  const approvalPending = loadApprovalPending()[key];
  if (approvalPending && approvalPending.awaiting === 'po_submit') {
    const trimmed = String(message || '').trim();
    if (/\/legion\s*[-]?\s*approve\s+cancel/i.test(trimmed)) {
      clearApprovalPending(key);
      return send(res, 200, JSON.stringify({ reply: 'Legion approve cancelled.' }));
    }
    if (trimmed.startsWith('{')) {
      let poPayload = null;
      try {
        poPayload = JSON.parse(trimmed);
      } catch (_) {}
      if (poPayload && typeof poPayload === 'object' && !Array.isArray(poPayload)) {
        if (!isLegionApproveAllowed(reqSource)) {
          return send(res, 403, JSON.stringify({ reply: 'PO approval is restricted to primary channels. Set PIKO_LEGION_APPROVE_PRIMARY_SOURCES to allow this source.' }));
        }
        const initSource = approvalPending.source;
        if (initSource != null && String(reqSource || '') !== String(initSource)) {
          clearApprovalPending(key);
          return send(res, 403, JSON.stringify({ reply: 'PO approval must be completed from the same channel that initiated it.' }));
        }
        const pinCheck = verifyAndStripApprovalPin(poPayload);
        if (!pinCheck.ok) {
          return send(res, 403, JSON.stringify({ reply: pinCheck.error }));
        }
        clearApprovalPending(key);
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        let dispatch;
        try {
          dispatch = await dispatchLegionPoSubmit(pinCheck.payload, { piko_user_id: pikoUserId });
        } catch (e) {
          dispatch = { ok: false, code: 'DISPATCH_EXCEPTION', message: e && e.message ? e.message : 'Dispatch failed' };
        }
        const reply = dispatch.ok
          ? `PO submit accepted: run_id=${dispatch.runId || 'n/a'} (${dispatch.status}).`
          : `PO submit failed: ${dispatch.message || 'Unknown error'}.`;
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    clearApprovalPending(key);
    return send(res, 200, JSON.stringify({
      reply: 'Expected JSON PO payload. Cancelled. Use /legion approve submit with inline JSON, e.g. /legion approve submit {"supplier":"X","lines":[{"sku":"A","quantity":1}]}',
    }));
  }

  // —— /legion approve submit (PO approval path) ——
  if (lowerMessage.startsWith('/legion approve') || lowerMessage.startsWith('/legion-approve')) {
    if (!isLegionApproveAllowed(reqSource)) {
      return send(res, 403, JSON.stringify({ reply: 'PO approval is restricted to primary channels. Set PIKO_LEGION_APPROVE_PRIMARY_SOURCES (e.g. webchat,app) to allow this source.' }));
    }
    const rest = lowerMessage.replace('/legion-approve', '/legion approve').replace('/legion approve', '').trim();
    if (rest.startsWith('submit')) {
      const afterSubmit = rest.slice(6).trim();
      let poPayload = null;
      if (afterSubmit.startsWith('{')) {
        try {
          poPayload = JSON.parse(afterSubmit);
        } catch (_) {}
      }
      if (poPayload && typeof poPayload === 'object' && !Array.isArray(poPayload)) {
        const pinCheck = verifyAndStripApprovalPin(poPayload);
        if (!pinCheck.ok) {
          return send(res, 403, JSON.stringify({ reply: pinCheck.error }));
        }
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        let dispatch;
        try {
          dispatch = await dispatchLegionPoSubmit(pinCheck.payload, { piko_user_id: pikoUserId });
        } catch (e) {
          dispatch = { ok: false, code: 'DISPATCH_EXCEPTION', message: e && e.message ? e.message : 'Dispatch failed' };
        }
        const reply = dispatch.ok
          ? `PO submit accepted: run_id=${dispatch.runId || 'n/a'} (${dispatch.status}).`
          : `PO submit failed: ${dispatch.message || 'Unknown error'}.`;
        return send(res, 200, JSON.stringify({ reply }));
      }
      setApprovalPending(key, { source: reqSource });
      const pinHint = process.env.PIKO_LEGION_APPROVE_PIN ? ' Include "_pin": "your-pin" in the JSON when you paste it.' : '';
      return send(res, 200, JSON.stringify({
        reply: 'Awaiting PO payload. Paste JSON in your next message, e.g. {"supplier":"Example Supplier","lines":[{"sku":"ABC-123","quantity":10}]}. Or use /legion approve cancel to cancel.' + pinHint,
      }));
    }
    if (rest.startsWith('cancel')) {
      clearApprovalPending(key);
      return send(res, 200, JSON.stringify({ reply: 'Legion approve cancelled.' }));
    }
    return send(res, 200, JSON.stringify({
      reply: 'Usage: /legion approve submit [<json>] | /legion approve cancel',
    }));
  }

  // —— Legion brief wizard (/legion brief) ——
  const isLegionBriefCommand = lowerMessage.startsWith('/legion brief') || lowerMessage.startsWith('/legion-brief');
  let activeBrief = getBriefSession(DATA_DIR, key);
  const isNaturalStart = !activeBrief && !isLegionBriefCommand && requestsLegionBrief(message);
  let shouldHandleActiveBriefTurn = !!activeBrief && !String(message || '').trim().startsWith('/');

  // Stale brief expiration: if idle >15 min, assume user abandoned the form
  if (activeBrief && !isLegionBriefCommand) {
    const updatedMs = activeBrief.updatedAt ? new Date(activeBrief.updatedAt).getTime() : 0;
    if (Date.now() - updatedMs > 15 * 60 * 1000) {
      clearBriefSession(DATA_DIR, key);
      console.log(`[BRIEF INTERRUPT] Brief for session ${key} is stale (>15 mins). Auto-cancelling.`);
      shouldHandleActiveBriefTurn = false;
      activeBrief = null;
    }
  }

  // Semantic Bouncer: context-switching logic (is user answering the wizard or switching to a new command?)
  if (activeBrief && !isLegionBriefCommand) {
    const { classifyUserIntent } = require('./lib/semanticBouncer');
    const nextField = nextMissingField(activeBrief);
    const currentQuestion = nextField ? nextField.prompt : 'Unknown';
    const intent = await classifyUserIntent(message, currentQuestion, sessionModel);
    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[SEMANTIC ROUTER] User intent classified as: ${intent}`);

    if (intent === 'escape') {
      clearBriefSession(DATA_DIR, key);
      return send(res, 200, JSON.stringify({ reply: "Okay, I've cancelled the brief. What do you need?" }));
    }
    if (intent === 'intent_override') {
      clearBriefSession(DATA_DIR, key);
      console.log('[BRIEF INTERRUPT] User switched context (intent_override). Cancelling brief.');
      shouldHandleActiveBriefTurn = false;
      activeBrief = null;
    }
    // intent === 'form_input' — let the brief wizard absorb the message
  }

  if (isLegionBriefCommand || isNaturalStart || shouldHandleActiveBriefTurn) {
    const cmdRest = isLegionBriefCommand
      ? lowerMessage.replace('/legion-brief', '/legion brief').slice('/legion brief'.length).trim()
      : '';

    if (isLegionBriefCommand && (cmdRest === 'cancel' || cmdRest === 'stop')) {
      clearBriefSession(DATA_DIR, key);
      return send(res, 200, JSON.stringify({ reply: 'Legion Brief cancelled.' }));
    }

    if (!activeBrief && (isNaturalStart || isLegionBriefCommand)) {
      const started = startBriefSession(DATA_DIR, key);
      const next = nextMissingField(started);
      const intro = [
        'Legion Brief started.',
        'I will collect the required details step-by-step, then relay the full recap before proceeding.',
        next ? `${next.prompt}` : 'Please provide the objective.',
        'Tips: use "field: value" to set specific fields; /legion brief show; /legion brief cancel.',
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply: intro }));
    }

    const brief = getBriefSession(DATA_DIR, key);
    if (!brief) {
      return send(res, 200, JSON.stringify({ reply: 'No active Legion Brief. Start with /legion brief.' }));
    }

    if (isLegionBriefCommand && cmdRest === 'show') {
      const recap = formatRecap(brief);
      const next = nextMissingField(brief);
      const trailer = next ? `\n\nNext needed: ${next.prompt}` : '\n\nAll fields captured. Reply "/legion brief confirm" to proceed or "/legion brief edit <field>: <value>".';
      return send(res, 200, JSON.stringify({ reply: recap + trailer }));
    }

    if (isLegionBriefCommand && cmdRest === 'confirm') {
      if (!isBriefComplete(brief)) {
        const next = nextMissingField(brief);
        return send(res, 200, JSON.stringify({ reply: `Brief is incomplete. ${next ? next.prompt : 'Please continue.'}` }));
      }
      appendConfirmedBrief(DATA_DIR, brief);
      let dispatch = null;
      try {
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        dispatch = await dispatchLegionBrief(brief, { piko_user_id: pikoUserId, model: sessionModel });
      } catch (e) {
        dispatch = { ok: false, code: 'DISPATCH_EXCEPTION', message: e && e.message ? e.message : 'Dispatch failed' };
      }
      clearBriefSession(DATA_DIR, key);
      let resultSummary = '';
      if (dispatch && dispatch.ok && dispatch.runId && dispatch.capability) {
        try {
          const { pollLegionRun, buildSummaryFromResult } = require('./lib/legionRunPoller');
          const { saveLegionResult, isSilentCapability } = require('./lib/sharedContext');
          const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
          if (polled.ok && polled.result) {
            saveLegionResult(DATA_DIR, dispatch.capability, polled.result);
            const fromIntentPoller = String(key || '').toLowerCase() === 'intent-poller';
            const skipNotify = fromIntentPoller && isSilentCapability(dispatch.capability, DATA_DIR);
            if (!skipNotify) {
              resultSummary = buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR);
              if (resultSummary) {
                appendPendingNotification(resultSummary);
                telegramNotify(resultSummary).catch(() => {});
              }
            }
          }
        } catch (e) {
          if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legion-brief] poll/deliver:', e.message);
        }
      }
      const dispatchLine = dispatch && dispatch.ok
        ? `Dispatch accepted: adapter=${dispatch.adapterId}, capability=${dispatch.capability}, run_id=${dispatch.runId || 'n/a'} (${dispatch.status}).`
        : `Dispatch not started: ${dispatch && dispatch.message ? dispatch.message : 'No matching capability or Legion unavailable.'}`;
      const reply = [
        `${formatRecap(brief)}`,
        '',
        'Confirmed. I will proceed with this Legion Brief.',
        dispatchLine,
        resultSummary ? `\n${resultSummary}` : '',
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply }));
    }

    let fieldInput = null;
    if (isLegionBriefCommand && cmdRest.startsWith('edit ')) {
      fieldInput = parseFieldValueLine(cmdRest.slice(5).trim());
    } else if (!isLegionBriefCommand) {
      fieldInput = parseFieldValueLine(message);
    }

    if (!fieldInput && !isLegionBriefCommand) {
      const next = nextMissingField(brief);
      if (next) fieldInput = { fieldKey: next.key, value: message };
    }

    if (!fieldInput) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion brief | /legion brief show | /legion brief edit <field>: <value> | /legion brief confirm | /legion brief cancel' }));
    }

    const saved = setBriefField(DATA_DIR, key, fieldInput.fieldKey, fieldInput.value);
    if (!saved.ok) return send(res, 200, JSON.stringify({ reply: saved.error || 'Could not update Legion Brief field.' }));

    const current = saved.session;
    if (!isBriefComplete(current)) {
      const next = nextMissingField(current);
      return send(res, 200, JSON.stringify({ reply: `Saved.\n${next ? next.prompt : 'Continue.'}` }));
    }

    return send(res, 200, JSON.stringify({
      reply: `${formatRecap(current)}\n\nReply "/legion brief confirm" to proceed, or "/legion brief edit <field>: <value>" to revise.`,
    }));
  }

  // —— /legion schedule ——
  if (lowerMessage.startsWith('/legion schedule') || lowerMessage.startsWith('/legion-schedule')) {
    const rest = lowerMessage.replace('/legion-schedule', '/legion schedule').replace('/legion schedule', '').trim();
    if (rest === 'list' || rest === '') {
      const intents = loadIntents();
      const legionScheduled = intents.filter((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status));
      if (legionScheduled.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No scheduled Legion tasks. Use /legion schedule daily 08:00 <objective> to add one.' }));
      }
      const lines = legionScheduled.map((s) => {
        const due = s.dueAt ? new Date(s.dueAt).toLocaleString() : '—';
        const sched = s.schedule || 'one-shot';
        const obj = (s.title || s.description || s.briefFields?.objective || s.command || '').slice(0, 50);
        return `- ${s.id}: ${sched} (next: ${due}) ${obj}`;
      });
      return send(res, 200, JSON.stringify({ reply: 'Scheduled Legion tasks:\n' + lines.join('\n') + '\n\nCancel: /legion schedule cancel <id>' }));
    }
    if (rest.startsWith('cancel ')) {
      const id = rest.slice(7).trim();
      if (!id) return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule cancel <id> (e.g. intent_1772943737170_210)' }));
      const updated = updateIntent(id, { status: 'cancelled' });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `Intent ${id} not found.` }));
      if (updated.type !== 'legion_scheduled') return send(res, 200, JSON.stringify({ reply: 'That intent is not a Legion schedule.' }));
      return send(res, 200, JSON.stringify({ reply: `Cancelled: ${(updated.title || updated.description || '').slice(0, 50)}` }));
    }
    // /legion schedule daily 08:00 <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective> | in N <objective>
    const parts = rest.split(/\s+/);
    if (parts.length < 3) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule daily HH:MM <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective> | in N <objective>' }));
    }
    const [freq, timeStr, ...restParts] = parts;
    let schedule, nextDue, objective;
    const inMatch = /^in$/i.test(freq) && /^\d+$/.test(timeStr);
    if (inMatch) {
      objective = restParts.join(' ').trim();
      const mins = Math.max(1, Math.min(60, parseInt(timeStr, 10)));
      const from = new Date();
      nextDue = new Date(from.getTime() + mins * 60 * 1000).toISOString();
      schedule = `in ${mins}`;
    } else if (/^cron$/i.test(freq)) {
      // cron 0 17 * * 1-5 <objective> — 5 fields: min hour dom month dow
      if (restParts.length < 6) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule cron 0 17 * * 1-5 <objective> (5 cron fields + objective, e.g. weekdays at 5pm)' }));
      }
      const cronFields = restParts.slice(0, 5);
      objective = restParts.slice(5).join(' ').trim();
      schedule = `cron ${cronFields.join(' ')}`;
      nextDue = nextDueFromSchedule(schedule, new Date());
    } else {
      objective = restParts.join(' ').trim();
      schedule = `${freq.toLowerCase()} ${timeStr}`;
      nextDue = nextDueFromSchedule(schedule, new Date());
    }
    if (!objective) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule daily HH:MM <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective>' }));
    }
    if (!nextDue) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid schedule. Use: daily HH:MM, hourly HH:MM-HH:MM, cron 0 17 * * 1-5 (weekdays 5pm), or in N' }));
    }
    // Idempotency: skip duplicate if same schedule+objective created in last 30s (client double-send)
    const intents = loadIntents();
    const cutoff = Date.now() - 30000;
    const recentDup = intents.find(
      (i) =>
        i &&
        i.type === 'legion_scheduled' &&
        (i.status === 'pending' || !i.status) &&
        i.schedule === schedule &&
        (i.title === objective || i.description === objective) &&
        new Date(i.createdAt || 0).getTime() >= cutoff
    );
    if (recentDup) {
      const replyMsg = inMatch
        ? `Already scheduled (in ${timeStr} min). I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
        : schedule.startsWith('hourly ') || schedule.startsWith('cron ')
          ? `Already scheduled ${schedule}. I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
          : `Already scheduled daily at ${timeStr}. I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`;
      return send(res, 200, JSON.stringify({ reply: replyMsg }));
    }
    const briefFields = {
      objective,
      success_criteria: 'Task completed as scheduled',
      scope: 'Recurring Legion task',
      constraints: 'Scheduled via Piko',
      risk_level: 'low',
      priority: 'P2',
      deadline: 'Ongoing',
      execution_mode: 'auto',
    };
    createIntent({
      type: 'legion_scheduled',
      title: objective,
      description: objective,
      dueAt: nextDue,
      schedule,
      briefFields,
      source: reqSource,
      sessionId: key,
    });
    const replyMsg = inMatch
      ? `Done. Scheduled in ${timeStr} min — I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
      : schedule.startsWith('hourly ')
        ? `Done. Scheduled ${schedule} — I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
        : schedule.startsWith('cron ')
          ? `Done. Scheduled ${schedule} — I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
          : `Done. Scheduled daily at ${timeStr} — I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`;
    return send(res, 200, JSON.stringify({ reply: replyMsg }));
  }

  // —— /webhook (rules for event-driven actions) ——
  if (lowerMessage.startsWith('/webhook') || lowerMessage.startsWith('/webhook ')) {
    const rest = lowerMessage.replace(/^\/webhook\s*/, '').trim();
    if (rest === '' || rest === 'rules' || rest === 'list') {
      const rules = loadRules();
      if (rules.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No webhook rules yet. Add one with /webhook add <eventType> legion [or dm]. Example: /webhook add low_stock_alert legion' }));
      }
      const lines = rules.map((r) => {
        const acts = (r.actions || []).map((a) => a.type).join(', ') || 'none';
        const status = r.enabled ? 'on' : 'off';
        return `• ${r.eventType} (${r.id}) [${status}]: ${acts}`;
      });
      return send(res, 200, JSON.stringify({ reply: 'Webhook rules:\n' + lines.join('\n') }));
    }
    if (rest.startsWith('add ')) {
      const spec = rest.slice(4).trim();
      const parts = spec.split(/\s+/);
      const eventType = parts[0];
      if (!eventType || !/^[a-z0-9_]+$/.test(eventType)) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /webhook add <eventType> legion|dm. Example: /webhook add low_stock_alert legion' }));
      }
      const actions = [];
      if (parts.includes('legion')) {
        let capability = 'inventory.low_stock.scan';
        if (/low_stock|inventory|stock/.test(eventType)) capability = 'inventory.low_stock.scan';
        else if (/sale|forecast|analysis/.test(eventType)) capability = 'sales.analysis.run';
        actions.push({ type: 'legion', adapterId: 'ausmakersupplies', capability });
      }
      if (parts.includes('dm')) {
        actions.push({ type: 'dm', channel: 'telegram', template: `Webhook: {{eventType}} — {{payload}}` });
      }
      if (actions.length === 0) actions.push({ type: 'log' });
      const rule = createRule({ eventType, sourceFilter: [], actions });
      return send(res, 200, JSON.stringify({ reply: `Added rule for \`${eventType}\`: ${actions.map((a) => a.type).join(', ')}.` }));
    }
    if (rest.startsWith('pause ')) {
      const eventType = rest.slice(6).trim();
      const rules = loadRules().filter((r) => r.eventType === eventType);
      let toggled = 0;
      for (const r of rules) {
        if (r.enabled) {
          toggleRule(r.id);
          toggled++;
        }
      }
      return send(res, 200, JSON.stringify({ reply: toggled > 0 ? `Paused ${toggled} rule(s) for \`${eventType}\`.` : `No enabled rules for \`${eventType}\`.` }));
    }
    if (rest.startsWith('resume ')) {
      const eventType = rest.slice(7).trim();
      const rules = loadRules().filter((r) => r.eventType === eventType);
      let toggled = 0;
      for (const r of rules) {
        if (!r.enabled) {
          toggleRule(r.id);
          toggled++;
        }
      }
      return send(res, 200, JSON.stringify({ reply: toggled > 0 ? `Resumed ${toggled} rule(s) for \`${eventType}\`.` : `No disabled rules for \`${eventType}\`.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /webhook rules | add <eventType> legion|dm | pause <eventType> | resume <eventType>' }));
  }

  // —— /new ——
  if (message === '/new') {
    (async () => {
      try {
        const { flushSessionToVectorMemory } = require('./lib/vectorMemory');
        await flushSessionToVectorMemory(key);
      } catch (_) {}
      sessionStore.clear(key);
      clearBriefSession(DATA_DIR, key);
      clearApprovalPending(key);
    })().then(() => send(res, 200, JSON.stringify({ reply: 'New session.' })));
    return;
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
      try {
        upsertModel(OLLAMA_MODEL, { status: 'primary', source: 'model_command_default' });
        promoteModel({
          modelTag: OLLAMA_MODEL,
          toStage: 'primary',
          by: 'model_command',
          notes: 'Reset to default model',
          allowUnsafe: true,
        });
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
      try {
        upsertModel(rest, { status: 'primary', source: 'model_command' });
        promoteModel({
          modelTag: rest,
          toStage: 'primary',
          by: 'model_command',
          notes: 'Set by /model command',
          allowUnsafe: true,
        });
      } catch (_) {}
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
      const { querySearXNG } = require('./lib/sovereignSearch');
      const searxResults = await querySearXNG(query, 5);
      if (searxResults.length > 0) {
        reply = searxResults.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.url || ''}\n${(r.content || '').slice(0, 200)}…`).join('\n\n');
      } else if (SERPER_API_KEY) {
        const body = JSON.stringify({ q: query });
        const u = new URL('https://google.serper.dev/search');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY } };
        const { data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const results = (json.organic || []).slice(0, 5);
        reply = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.link || ''}\n${(r.snippet || '').slice(0, 200)}…`).join('\n\n') || 'No results.';
      } else {
        reply = 'No results. Ensure SearXNG is running on port 8080, or set SERPER_API_KEY for fallback.';
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

  // —— /cycle (Moltbook disabled — no longer maintained)
  if (message === '/cycle') {
    return send(res, 200, JSON.stringify({ reply: 'Moltbook is disabled. Use /queue, /status, or /profile main for other actions.' }));
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

  // —— Pending cancel confirmation: "yes" executes multi-item cancel ——
  const trimmedMsg = String(message || '').trim().replace(/[.!?]+$/, '');
  if (/^(yes|y|confirm|ok|sure|yes please|do it)$/i.test(trimmedMsg) && pendingCancelConfirmations.has(key)) {
    const pending = pendingCancelConfirmations.get(key);
    pendingCancelConfirmations.delete(key);
    savePendingCancelConfirmations(pendingCancelConfirmations);
    if (pending.expiresAt && Date.now() > pending.expiresAt) {
      const reply = "That confirmation expired. Ask to cancel again if you still want to.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }
    const { removeIntentById } = require('./lib/intents');
    let cancelled = 0;
    for (const id of pending.intentIds || []) {
      if (removeIntentById(id)) cancelled++;
    }
    const reply = cancelled > 0 ? `Too easy. I've cancelled those ${cancelled} schedule(s) for you. Anything else?` : 'No matching schedules found.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

  // —— Pending NL intent confirmation: "yes" creates the legion_scheduled ——
  const pending = pendingIntentsBySession.get(key);
  if (pending) {
    const age = Date.now() - (pending.createdAt || 0);
    if (age > PENDING_INTENT_EXPIRY_MS) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Pending expired for key:', key);
      pendingIntentsBySession.delete(key);
    } else if (/^(yes|y|confirm|ok|sure)$/i.test(trimmedMsg)) {
      pendingIntentsBySession.delete(key);
      const { type, schedule, objective } = pending.extracted;
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Confirmation received for key:', key, 'objective:', objective, 'schedule:', schedule);
      const nextDue = nextDueFromSchedule(schedule, new Date());
      if (nextDue) {
        const briefFields = {
          objective,
          success_criteria: 'Task completed as scheduled',
          scope: 'Recurring Legion task',
          constraints: 'Scheduled via Piko',
          risk_level: 'low',
          priority: 'P2',
          deadline: 'Ongoing',
          execution_mode: 'auto',
        };
        createIntent({
          type: 'legion_scheduled',
          title: objective,
          description: objective,
          dueAt: nextDue,
          schedule,
          briefFields,
          source: reqSource,
          sessionId: key,
          _creationSource: 'nl_confirm',
        });
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Created from confirmation:', objective, schedule);
        const reply = `Done — scheduled "${objective}" ${schedule}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    } else {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Pending cleared (no yes match) for key:', key);
      pendingIntentsBySession.delete(key);
    }
  } else if (require('./lib/proactivePendingAction').isAffirmativeReply(message)) {
    const { loadPending, clearPending } = require('./lib/proactivePendingAction');
    const pp = loadPending(DATA_DIR);
    if (pp && pp.action) {
      clearPending(DATA_DIR);
      const capabilityToObjective = {
        'purchase_order.draft.create': 'purchase order draft',
        'inventory.low_stock.scan': 'low stock scan',
        'sales.analysis.run': 'sales analysis',
      };
      const objective = capabilityToObjective[pp.action] || pp.action;
      const syntheticBrief = {
        fields: {
          objective,
          execution_mode: 'auto',
          risk_level: 'low',
        },
      };
      try {
        const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
        if (dispatch.ok && dispatch.runId) {
          const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./lib/legionRunPoller');
          const { saveLegionResult } = require('./lib/sharedContext');
          const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
          if (polled.ok && polled.result) {
            saveLegionResult(DATA_DIR, dispatch.capability, polled.result);
            const reply = dispatch.capability === 'inventory.low_stock.scan'
              ? formatInventoryReply(polled.result, dispatch.capability, DATA_DIR, message)
              : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done.');
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./lib/activityLog');
              logActivity('action_router_run', { capability: pp.action, outcome: 'success', source: 'proactive_followup' });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
        }
      } catch (e) {
        if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[proactive-followup]', e.message);
      }
      const reply = "Couldn't run that — Legion may be unavailable. Try again in a minute.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }

    const lastAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
    const lastAskedConfirm = lastAssistant && /shall i schedule|reply yes to confirm/i.test(String(lastAssistant.content || ''));
    if (lastAskedConfirm && /^(yes|y|confirm|ok|sure)$/i.test(String(message || '').trim())) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] User said yes but no pending intent for key:', key, '(possible session mismatch or expiry)');
      const expiredReply = 'Sorry, that confirmation expired. Please try again — e.g. "schedule Load Recent Data every hour between 6am and 11pm" then reply yes.';
      history.push({ role: 'assistant', content: expiredReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', expiredReply);
      return send(res, 200, JSON.stringify({ reply: expiredReply }));
    }
  }

  const nicknameDeclared = extractNicknameFromMessage(message);
  if (nicknameDeclared) {
    const safeNick = nicknameDeclared.slice(0, 24);
    try {
      memory.setSessionNickname(identityKey, safeNick, 'chat_declared');
    } catch (_) {}
    const reply = `Got it — I will use ${safeNick}.`;
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

  const wordLimit = extractWordLimit(message);
  const sentenceLimit = extractSentenceLimit(message);
  const noQuestionRequested = requestsNoQuestion(message);
  if (isKeepItShortPrompt(message) && wordLimit === 0 && sentenceLimit === 0) {
    const reply = 'Got it — keeping it short.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  const formatDirectiveOnly = sentenceLimit === 1 && noQuestionRequested && wordLimit === 0 && !/:\s*\S+/.test(String(message || ''));
  if (formatDirectiveOnly) {
    const reply = 'Understood — one concise line, no questions.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (requestsLearningUpdate(message)) {
    const reply = buildLearningUpdateReply();
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (isToneDriftComplaint(message)) {
    const reply = "You're right — I drifted there. I'll keep it plain and on-topic.";
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (isSimpleStatusAck(message)) {
    const reply = pickBySeed([
      'Good to hear.',
      'Nice one.',
      'Glad it is going smoothly.',
    ], `${identityKey}:${message}`);
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (wordLimit > 0) {
    const summaryTargetMatch = String(message).match(/summari[sz]e[^:]*:\s*(.+)$/i);
    const explicitTarget = summaryTargetMatch && summaryTargetMatch[1] ? summaryTargetMatch[1].trim() : '';
    const prevAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
    const sourceText = explicitTarget || (prevAssistant && prevAssistant.content ? prevAssistant.content : '');
    if (sourceText) {
      const concise = truncateToWords(sourceText, wordLimit);
      history.push({ role: 'assistant', content: concise });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', concise);
      return send(res, 200, JSON.stringify({ reply: concise }));
    }
  }

  if (/what nickname did i ask you to use\??/i.test(message)) {
    const nick = findRequestedNickname(history, identityKey);
    const reply = nick ? `You asked me to use ${nick}.` : 'You have not told me a nickname in this session yet.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

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

  /** Plan first with minimal data. Pass recentTurns for history-aware routing (e.g. "Why?" after deep exchange). */
  const recentTurnsForPlan = history.slice(-4).map((h) => ({ role: h.role, content: (h.content || '').slice(0, 500) }));
  let plan = createResponsePlan({
    userBeliefs: [],
    mind: {},
    userMessage: message,
    recentEpisodic: [],
    recentTurns: recentTurnsForPlan,
  });
  /** Optional model classification for borderline full-path messages (15–120 chars). Gate: PIKO_MODEL_ROUTING=1. */
  if (!plan.casual && !plan.socialChat && !plan.deepReasoning && message.length >= 15 && message.length <= 120) {
    const modelDepth = await classifyDepthOptional(message, recentTurnsForPlan, sessionModel);
    if (modelDepth === 'deep') {
      plan = { ...plan, deepReasoning: true, mode: 'DEEP' };
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[PLANNER] Model classified as deep');
    }
  }
  if (process.env.PIKO_PLANNER_DEBUG === '1' || process.env.PIKO_PLANNER_DEBUG === 'true') {
    log('info', 'planner', { plan: { verbosity: plan.verbosity, tone: plan.tone }, reason: plan.reason || null }, {}, req.requestId);
  }

  // —— ROUTING: Circuit breakers (no LLM) or routeToAction (single LLM) — Phase 1: merged, no double-LLM tax
  const useReAct = process.env.PIKO_USE_REACT_AGENT === '1' || process.env.PIKO_USE_REACT_AGENT === 'true';

  // Phase 2.4: Circuit breakers — bypass LLM for common phrasings (both ReAct and non-ReAct)
  const { loadCapabilityRegistry, getPikoNativeCapabilityIds } = require('./lib/actionRouter');
  const circuitRegistry = loadCapabilityRegistry();
  const circuitNativeIds = getPikoNativeCapabilityIds();
  const circuitValidCaps = new Set([...circuitRegistry.map((c) => c.id), ...circuitNativeIds]);

  // —— CONTEXTUAL CIRCUIT BREAKER: "Top 10 please" after CSV/Top 10 negotiation ——
  let circuitRoute = null;
  const historyBeforeTurn = sessionStore.getHistory(key) || [];
  if (process.env.PIKO_LOG_PLANNER === '1' || /top 10|ten|just list/i.test(message)) {
    console.log('[CIRCUIT-BREAKER] Incoming History:', historyBeforeTurn?.length, historyBeforeTurn?.slice(-3));
  }
  const lastAssistant = [...historyBeforeTurn].reverse().find((m) => m.role === 'assistant' && m.content);
  const isNegotiatingInventory = lastAssistant && lastAssistant.content && lastAssistant.content.includes('email you the full CSV report');
  if (isNegotiatingInventory && /top 10|ten|just list/i.test(message)) {
    console.log('[DECISION] Circuit breaker (contextual) → inventory.low_stock.scan top10=true');
    circuitRoute = { actionType: 'run_capability', capability: 'inventory.low_stock.scan', opts: { top10: true } };
  } else if (isNegotiatingInventory && /email|send|csv|yes|download/i.test(message)) {
    console.log('[DECISION] Circuit breaker (contextual) → inventory.csv.generate');
    circuitRoute = { actionType: 'run_capability', capability: 'inventory.csv.generate', opts: { silent: false } };
  } else if (/top 10|ten|just list/i.test(message)) {
    const reason = !lastAssistant ? 'no assistant message in history' : (!lastAssistant.content || !lastAssistant.content.includes('email you the full CSV report')) ? 'last assistant not in negotiation state' : 'unknown';
    console.log('[DECISION] Circuit breaker (contextual): no match —', reason, '→ routing via 7B');
  }

  // Clear digest schedule — deterministic; never let LLM route destructive "stop/clear" commands.
  // Must mention digest/summary/product change (not generic "schedule" — avoids matching "cancel scheduled inventory scan")
  if (!circuitRoute && /(stop|cancel|clear|remove|disable).*(digest|summary|product change)/i.test(message)) {
    console.log('[DECISION] Circuit breaker (clear digest) → clear_digest_schedule');
    circuitRoute = { actionType: 'clear_digest_schedule' };
  }

  // Sales summary fast path — "how are sales", "biggest seller", etc. (7B/ReAct often picks sales.analysis.run by mistake → "Legion run completed.")
  if (!circuitRoute && /how are sales|sales (going|doing|today|this week|this month)|(biggest|best|top) seller|top (sellers?|5|10)|revenue (today|this week|this month)/i.test(message)) {
    const period = /week|this week/i.test(message) ? 'week' : /month|this month/i.test(message) ? 'month' : 'today';
    console.log('[DECISION] Circuit breaker (sales summary) → sales_summary_get period=', period);
    circuitRoute = { actionType: 'sales_summary_get', period };
  }

  const SHORT_CIRCUITS = [
    { pattern: /what('s| is|s) in the queue|tell me what is in the queue|what('s| is) (in|the) queue|what have we got in the queue|what do we have in the queue|queue at the moment|what('s| is) (in|the) queue at the moment/i, capability: 'system.intents.read' },
    { pattern: /what( cron)? jobs are you running|what jobs do you run|cron list|list (cron|background) jobs/i, capability: 'system.operations.read' },
    { pattern: /cancel.*(scan|task|reminder|schedule)|delete.*(scan|task|schedule)|remove.*(scan|task|schedule)/i, capability: 'system.intents.manage' },
    { pattern: /(list|show)\s*all\s+(reorder|products?|items?)|list\s+all\s+reorder|full\s+list\s+(of\s+)?(reorder|products?)/i, capability: 'inventory.report.export' },
    { pattern: /list.*(sku|product).*reorder|which.*(sku|product|item).*reorder|reorder status|run.*low stock scan|what needs ordering|low stock|inventory (scan|check)/i, capability: 'inventory.low_stock.scan' },
  ];
  if (!circuitRoute) {
  for (const sc of SHORT_CIRCUITS) {
    if (sc.pattern.test(message) && circuitValidCaps.has(sc.capability)) {
      console.log('[DECISION] Circuit breaker (short-circuit) →', sc.capability);
      circuitRoute = { actionType: 'run_capability', capability: sc.capability };
      break;
    }
  }
  }

  if (circuitRoute) {
    // Circuit breaker matched — run capability directly (no LLM)
    const route = circuitRoute;
    if (route.actionType === 'clear_digest_schedule') {
      const { clearDigestSchedule } = require('./lib/tripwireEngine');
      const success = clearDigestSchedule();
      const reply = success
        ? "Done, boss. I've stopped the daily product change summary and cleared your digest schedule. You won't get those morning alerts anymore."
        : "I tried to clear the digest schedule, boss, but I hit a file system error. You might need to check my logs.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { actionType: 'clear_digest_schedule', outcome: success ? 'success' : 'error', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.actionType === 'sales_summary_get') {
      const { getUrl } = require('./lib/legionRunPoller');
      const period = ['today', 'week', 'month'].includes(String(route.period || 'today').toLowerCase()) ? String(route.period).toLowerCase() : 'today';
      let url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/sales/summary?period=${encodeURIComponent(period)}`;
      if (route.sku && String(route.sku).trim()) url += `&sku=${encodeURIComponent(String(route.sku).trim())}`;
      try {
        const getRes = await getUrl(url);
        if (getRes.statusCode !== 200) {
          const reply = "Sales API unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const data = JSON.parse(getRes.body || '{}');
        const top = (data.top_skus || []).slice(0, 5).map((t) => `${t.sku}: ${t.units}`).join(', ');
        const reply = `Sales for ${period}: ${data.total_units_sold || 0} units sold, $${(data.total_revenue || 0).toFixed(2)} revenue. Top SKUs: ${top || 'none'}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: 'sales_summary_get', outcome: 'success', fastPath: true }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply }));
      } catch (e) {
        const reply = "Couldn't fetch sales: " + (e.message || 'Unknown error');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    if (route.capability === 'system.operations.read') {
      const { loadOperations, formatOperationsForPrompt } = require('./lib/operations');
      const ops = loadOperations();
      const formatted = formatOperationsForPrompt(ops);
      const reply = formatted
        ? `Here's what's running: ${formatted.replace(/\n/g, ' ').trim()}.`
        : "No background operations configured. Add knowledge/piko-operations.json if you want to track crons.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'system.intents.read') {
      const useTemplate = process.env.PIKO_FAST_QUEUE_TEMPLATE !== '0' && process.env.PIKO_FAST_QUEUE_TEMPLATE !== 'false';
      const intents = loadIntents();
      const pending = intents.filter((i) => (i.status === 'pending' || !i.status));
      const cleanIntents = pending.map((i) => {
        const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
        const schedule = i.schedule || (i.dueAt || i.time || i.run ? String(i.dueAt || i.time || i.run).slice(0, 16) : null) || 'Pending';
        return { task: String(task).slice(0, 60), schedule };
      });
      let reply;
      if (cleanIntents.length === 0) reply = "Queue is empty mate. Nothing scheduled.";
      else if (cleanIntents.length <= 5) {
        const parts = cleanIntents.map((c) => `${c.task} (${c.schedule})`);
        reply = `You've got ${parts.length} in the queue: ${parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]}. Let me know if you want to cancel any.`;
      } else {
        const shown = cleanIntents.slice(0, 10);
        const parts = shown.map((c) => `${c.task} (${c.schedule})`);
        const more = cleanIntents.length - 10;
        const list = parts.join('; ');
        reply = `You've got ${cleanIntents.length} in the queue: ${list}${more > 0 ? ` … plus ${more} more.` : ''} Let me know if you want to cancel any.`;
      }
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'system.intents.manage') {
      const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./lib/intents');
      const { ollamaNativeChat } = require('./lib/llm');
      const pending = getPendingIntents();
      if (pending.length === 0) {
        const reply = "Queue is already empty mate. Nothing to cancel.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const simplifiedIntents = pending.map((i) => ({
        id: i.id,
        task: `${((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60)} (${i.schedule || 'pending'})`,
      }));
      const extractPrompt = `You are a strict data extraction assistant.
User Request to Cancel: "${String(message || '').slice(0, 500)}"

Current Active Tasks:
${JSON.stringify(simplifiedIntents, null, 2)}

RULES:
1. Match the user's request to the Active Tasks. The user will use natural language (e.g., "8am" instead of "08:00", "both" to mean multiple tasks).
2. Respond ONLY with a valid JSON object. It must contain exactly one key: "ids".
3. The value of "ids" must be an array of the matched "id" strings.

EXAMPLE OUTPUTS:
{"ids": ["intent_123_456", "intent_789_012"]}
{"ids": []}`;
      let idsToDelete = [];
      try {
        const extractModel = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || sessionModel;
        const raw = await ollamaNativeChat(extractModel, [{ role: 'user', content: extractPrompt }], { format: 'json', temperature: 0, max_tokens: 120 });
        const parsed = JSON.parse((raw || '').replace(/```json\s*|\s*```/g, '').trim());
        idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : (parsed.idsToDelete || []);
        if (!Array.isArray(idsToDelete)) idsToDelete = [];
        const validIds = new Set(pending.map((i) => i.id));
        idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
      } catch (e) {
        const raw = String(message || '').replace(/^(?:can you please |please )?(?:cancel|delete|remove):?\s*/i, '').trim();
        const parts = raw.split(/\n|,\s*|\s+and\s+/i).map((p) => p.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
        idsToDelete = findIntentsByDescriptions(parts.length ? parts : [message]).map((m) => m.id);
      }
      if (idsToDelete.length === 0) {
        const reply = "No matching schedules found. Ask \"what's in the queue?\" to see what's pending.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const preview = idsToDelete.map((id) => {
        const i = pending.find((p) => p.id === id);
        const task = (i && ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task')) || id;
        return `${String(task).slice(0, 50)} (${(i && i.schedule) || 'pending'})`;
      }).join('; ');
      const reply = `I'll cancel: ${preview}. Reply YES to confirm.`;
      pendingCancelConfirmations.set(key, { intentIds: idsToDelete, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
      savePendingCancelConfirmations(pendingCancelConfirmations);
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'preview', pendingCount: idsToDelete.length }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'inventory.csv.generate') {
      const { formatInventoryReply, getUrl } = require('./lib/legionRunPoller');
      const csvUrl = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/csv`;
      try {
        const res2 = await getUrl(csvUrl);
        if (res2.statusCode !== 200) {
          const reply = "Couldn't fetch the CSV — AusMaker API may be unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const data = JSON.parse(res2.body || '{}');
        if (!data.success || !data.csv_content) {
          const reply = data.error || "No CSV data available. Run a low stock scan first to prime the cache.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const reply = formatInventoryReply(data, 'inventory.csv.generate', DATA_DIR, message, route.opts || {});
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply }));
      } catch (e) {
        const reply = "Couldn't generate CSV: " + (e.message || 'Unknown error') + ". Try again in a minute.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    if (route.capability === 'inventory.low_stock.scan' || route.capability === 'inventory.report.export' || route.capability === 'sales.analysis.run' || route.capability === 'purchase_order.draft.create') {
      const capabilityToObjective = { 'inventory.low_stock.scan': 'low stock scan', 'inventory.report.export': 'low stock scan', 'sales.analysis.run': 'sales analysis', 'purchase_order.draft.create': 'purchase order draft' };
      const objective = capabilityToObjective[route.capability] || route.capability;
      const syntheticBrief = { fields: { objective, execution_mode: 'auto', risk_level: 'low' } };
      const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
      if (!dispatch.ok || !dispatch.runId) {
        const reply = "Couldn't start that — Legion or the adapter may be unavailable. Try again in a minute.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./lib/legionRunPoller');
      const { saveLegionResult } = require('./lib/sharedContext');
      const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
      if (polled.ok && polled.result) {
        saveLegionResult(DATA_DIR, dispatch.capability, polled.result);
        const reply = (route.capability === 'inventory.low_stock.scan' || route.capability === 'inventory.report.export')
          ? formatInventoryReply(polled.result, route.capability, DATA_DIR, message, route.opts || {})
          : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done. No items flagged.');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, runId: dispatch.runId, outcome: 'success', fastPath: true }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply }));
      }
      const reply = polled.status === 'timeout' ? "Started but taking longer than expected. Try again in a minute." : (polled.error ? `Failed: ${polled.error}` : "Didn't complete. Try again in a minute.");
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }
  }

  if (!circuitRoute) {
    const isCompoundTask = /(and then|also|first|secondly|after that|finally|forecast and|check .* and|ping .* then|metrics.*forecast|revenue.*forecast)/i.test(message);
    if (isCompoundTask) {
      console.log('[ROUTING] Compound task detected. Routing to Plan-and-Execute Orchestrator.');
      try {
        const { planAndExecute } = require('./lib/taskOrchestrator');
        const finalResponse = await planAndExecute(message, {
          sessionModel,
          message,
          dataDir: DATA_DIR,
          ausmakerBaseUrl: AUSMAKER_BASE_URL,
          dispatchLegionBrief,
          legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
        });
        if (finalResponse) {
          history.push({ role: 'assistant', content: finalResponse });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', finalResponse);
          return send(res, 200, JSON.stringify({ reply: finalResponse }));
        }
      } catch (e) {
        console.error('[ORCHESTRATOR] Error, falling back to single-shot:', e.message);
      }
    }
    console.log('[DECISION] No circuit match → routing via 7B');
    try {
      const { routeToAction } = require('./lib/actionRouter');
      const lastAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
      const route = await routeToAction(message, sessionModel, {
        lastAssistantMessage: lastAssistant ? lastAssistant.content : '',
      });
      if (route.actionType === 'none') {
        // Fall through to casual chat — routeToAction is gatekeeper; chat goes to standard LLM
        console.log('[DECISION] 7B returned none → casual chat (main LLM)');
      } else if (route.actionType === 'clarification_needed') {
        const reply = route.fallbackMessage || "I'm having a little trouble understanding exactly what you want me to do. Did you want to run a task, check the queue, or schedule something?";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SERVER] Clarification Loop — router uncertainty');
        return send(res, 200, JSON.stringify({ reply }));
      } else if (route.actionType === 'web_research_run' && route.query) {
        // Deterministic execution: 7B router said web search — execute directly, bypass ReAct (no second-guessing)
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: web_research_run');
        try {
          const { sovereignSearchAndSynthesize } = require('./lib/sovereignSearch');
          const q = String(route.query).trim().slice(0, 500);
          const reply = await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'memory_subconscious_search' && route.query) {
        // Deterministic execution: 7B router said memory search — execute directly, bypass ReAct
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: memory_subconscious_search');
        try {
          const vectorMemory = require('./lib/vectorMemory');
          const hits = await vectorMemory.search(route.query, { limit: 5 });
          const reply = hits.length === 0
            ? 'No relevant past context found.'
            : 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search memory: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'python_execute' && route.objective) {
        // Deterministic execution: 7B router said Python — generate code via LLM, execute in sandbox
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: python_execute');
        try {
          const { ollamaNativeChat } = require('./lib/llm');
          const { executePythonCode } = require('./lib/pythonSandbox');
          const model = process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';
          const genPrompt = `Generate a Python script that accomplishes this: ${route.objective}
Use only standard library and common packages (math, json, csv). If you need pandas or matplotlib, try import them but handle ImportError.
Output ONLY the raw Python code. No markdown, no explanation, no \`\`\`python.`;
          const rawCode = await ollamaNativeChat(model, [{ role: 'user', content: genPrompt }], { max_tokens: 1500, temperature: 0.2 });
          const code = (rawCode && typeof rawCode === 'string' ? rawCode : String(rawCode || ''))
            .replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
          if (!code || code.length < 5) {
            const reply = "Couldn't generate valid Python code for that request.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const output = await executePythonCode(code);
          const reply = output.startsWith('Error:') ? output : `**Result:**\n\`\`\`\n${output}\n\`\`\``;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't run Python: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'email_send' && route.to && route.subject != null) {
        console.log('[EXECUTION] Deterministically executing: email_send');
        try {
          const { sendEmail } = require('./lib/emailClient');
          const reply = await sendEmail({ to: route.to, subject: route.subject, body: route.body || '' });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Failed to send email: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'document_parse' && route.filePath) {
        console.log('[EXECUTION] Deterministically executing: document_parse');
        try {
          const { parseLocalDocument } = require('./lib/documentParser');
          const reply = await parseLocalDocument(route.filePath);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Failed to parse document: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'browser_actuate' && route.url && route.actions && route.actions.length) {
        console.log('[EXECUTION] Deterministically executing: browser_actuate');
        try {
          const { actuateWebPage } = require('./lib/webReader');
          const reply = await actuateWebPage(route.url, route.actions);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Web actuation failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'system_settings_update' && route.key && route.value != null) {
        console.log('[EXECUTION] Deterministically executing: system_settings_update', route.key, route.value);
        try {
          const { updateConfig } = require('./lib/configManager');
          let parsedValue = route.value;
          if (route.key.includes('Hour') || route.key === 'proactiveIntervalHours') {
            parsedValue = parseInt(String(route.value), 10);
            if (isNaN(parsedValue)) parsedValue = route.value;
          }
          const result = updateConfig(route.key, parsedValue);
          const synthesisPrompt = `You are Piko. The user asked to change a system setting.
You ran the update tool and got this result: "${result}"
Confirm to the user that you have updated your internal programming. Keep it brief and conversational.`;
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SYNTHESIS] Asking Piko to confirm settings update...');
          const reply = (await ollamaNativeChat(sessionModel, [{ role: 'user', content: synthesisPrompt }], { max_tokens: 150, temperature: 0.4 }))?.trim() || result;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Settings update failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'legion_deploy_agent' && route.role && route.taskContext) {
        console.log('[EXECUTION] Deterministically executing: legion_deploy_agent', route.role);
        try {
          const { deploySubAgent } = require('./lib/legionSwarm');
          const { ollamaNativeChat } = require('./lib/llm');

          // Asynchronous progress ping — fire-and-forget so user knows we're working (quant can take 1–2 min)
          if (route.role === 'quant') {
            const { sendToAdmin } = require('./lib/telegramNotifier');
            sendToAdmin("⏳ *Piko:* I'm spinning up the Quant Agent to crunch these numbers. This requires processing thousands of rows, so it might take a minute or two. I'll ping you as soon as the forecast is ready!").catch(() => {});
          }

          const rawResult = await deploySubAgent(route.role, route.taskContext);
          if (rawResult.startsWith('Error:') || rawResult.includes('Failed after')) {
            history.push({ role: 'assistant', content: rawResult });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', rawResult);
            return send(res, 200, JSON.stringify({ reply: rawResult }));
          }
          const synthesisPrompt = `You are Piko. The user asked you this: "${message}"
You deployed your '${route.role}' sub-agent to do the heavy lifting, and it returned this raw data:

${rawResult}

- CRITICAL RULE: If the raw data says "Failed", contains a "Traceback", or mentions an Error, you MUST apologize and report the exact error text to the user. Do NOT invent a success story. Do NOT make up numbers.
- If successful, report the numbers provided in the text. Do not convert units to dollars.
- Speak directly to your boss without markdown headers like "**Legion quant Agent:**".`;
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SYNTHESIS] Asking Piko to format the agent raw data...');
          const finalPikoResponse = await ollamaNativeChat(sessionModel, [{ role: 'user', content: synthesisPrompt }], { max_tokens: 250, temperature: 0.4 });
          const reply = (finalPikoResponse || '').trim() || rawResult;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Legion agent failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (useReAct && (route.actionType === 'run_capability' || route.actionType === 'create_intent' || route.actionType === 'create_reminder' || route.actionType === 'create_tripwire' || route.actionType === 'create_digest_schedule' || route.actionType === 'forecast_get' || route.actionType === 'forecast_override_set' || route.actionType === 'sales_summary_get' || route.actionType === 'memory_core_update' || route.actionType === 'cancel_intent')) {
        // sales_summary_get: bypass ReAct — agent often picks sales.analysis.run (Legion) instead, which returns "Legion run completed." with no data
        if (route.actionType === 'sales_summary_get') {
          const { getUrl } = require('./lib/legionRunPoller');
          const period = ['today', 'week', 'month'].includes(String(route.period || 'today').toLowerCase()) ? String(route.period).toLowerCase() : 'today';
          let url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/sales/summary?period=${encodeURIComponent(period)}`;
          if (route.sku && String(route.sku).trim()) url += `&sku=${encodeURIComponent(String(route.sku).trim())}`;
          try {
            const getRes = await getUrl(url);
            if (getRes.statusCode === 200) {
              const data = JSON.parse(getRes.body || '{}');
              const top = (data.top_skus || []).slice(0, 5).map((t) => `${t.sku}: ${t.units}`).join(', ');
              const reply = `Sales for ${period}: ${data.total_units_sold || 0} units sold, $${(data.total_revenue || 0).toFixed(2)} revenue. Top SKUs: ${top || 'none'}.`;
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { actionType: 'sales_summary_get', outcome: 'success', fastPath: true }); } catch (_) {}
              return send(res, 200, JSON.stringify({ reply }));
            }
          } catch (_) {}
          const reply = "Sales API unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        // Task detected — use ReAct agent
        console.log('[DECISION] Executing via ReAct agent:', route.actionType, route.capability || route.schedule || route.dueAt || '');
        const { runAgent } = require('./lib/agentBrain');
      const capabilityToObjective = {
        'inventory.low_stock.scan': 'low stock scan',
        'inventory.report.export': 'low stock scan',
        'sales.analysis.run': 'sales analysis',
        'purchase_order.draft.create': 'purchase order draft',
      };
      const executeTool = async (action, params) => {
        if (action === 'create_intent' && params.schedule && params.objective) {
          const { nextDueFromSchedule } = require('./lib/intents');
          const normalizedSchedule = normalizeSchedule(params.schedule);
          const nextDue = nextDueFromSchedule(normalizedSchedule, new Date());
          if (!nextDue) return { error: `Couldn't parse schedule "${params.schedule}". Use daily 09:00 or hourly 06:00-23:00.` };
          const intents = loadIntents();
          const alreadyScheduled = intents.some((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status) && i.schedule === normalizedSchedule && (i.title === params.objective || (i.briefFields && i.briefFields.objective === params.objective)));
          if (alreadyScheduled) return `Already set up — ${params.objective} ${normalizedSchedule}.`;
          const briefFields = { objective: params.objective, success_criteria: 'Task completed as scheduled', execution_mode: 'auto', risk_level: 'low' };
          createIntent({ type: 'legion_scheduled', title: params.objective, description: params.objective, dueAt: nextDue, schedule: normalizedSchedule, briefFields, source: reqSource, sessionId: key, _creationSource: 'agent_brain' });
          return `Done — scheduled ${params.objective} ${normalizedSchedule}.`;
        }
        if (action === 'create_reminder' && params.dueAt && params.objective) {
          const at = new Date(params.dueAt);
          if (isNaN(at.getTime())) return { error: "Couldn't parse the time. Use ISO format." };
          createIntent({ type: 'reminder', title: params.objective, dueAt: at.toISOString(), source: reqSource, sessionId: key, _creationSource: 'agent_brain' });
          return `Reminder set — ${params.objective} at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
        }
        if (action === 'create_tripwire' && params.sku && params.operator != null && params.value != null) {
          const { addTripwire } = require('./lib/tripwireEngine');
          const sku = String(params.sku || '').trim();
          const field = String(params.field || 'stock').toLowerCase();
          const op = String(params.operator).trim() === '=' ? '==' : String(params.operator).trim();
          const val = parseFloat(params.value);
          if (!sku || isNaN(val)) return { error: 'I need a SKU and a numeric value to set a tripwire.' };
          addTripwire(sku, field, op, val);
          return `Tripwire set! I will alert you if the ${field} for ${sku} goes ${op} ${val}.`;
        }
        if (action === 'create_digest_schedule' && params.time) {
          const { addSummarySchedule, normalizeTimeString } = require('./lib/tripwireEngine');
          const normalized = normalizeTimeString(params.time);
          if (!normalized) return { error: 'Please specify a time (e.g. 4pm, 16:00, 9am).' };
          addSummarySchedule(normalized);
          return `Got it. I will compile and send the Product Change Summary every day at ${normalized}.`;
        }
        if (action === 'forecast_get' && params.sku) {
          const { getUrl } = require('./lib/legionRunPoller');
          const sku = String(params.sku || '').trim();
          if (!sku) return { error: 'Please specify a SKU.' };
          const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
          const res = await getUrl(url);
          if (res.statusCode !== 200) return { error: 'Forecast API unavailable. Try again in a minute.' };
          const data = JSON.parse(res.body || '{}');
          const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
          return `Forecast for ${sku}: daily run rate ${data.daily_run_rate || 0}. Next months: ${months || 'none'}.`;
        }
        if (action === 'forecast_override_set' && params.sku && params.year_month != null && params.qty != null) {
          const { postJson } = require('./lib/legionRunPoller');
          const sku = String(params.sku || '').trim();
          const ym = String(params.year_month || '').trim();
          const qty = parseInt(params.qty, 10);
          if (!sku || !/^\d{4}-\d{2}$/.test(ym) || isNaN(qty)) return { error: 'Need sku, year_month (YYYY-MM), and qty.' };
          const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/override`;
          const res = await postJson(url, { sku, year_month: ym, override_qty: qty });
          if (res.statusCode < 200 || res.statusCode >= 300) return { error: 'Override failed. ' + (res.body || '').slice(0, 100) };
          return `Override applied. ${sku} is now set to ${qty} units for ${ym}.`;
        }
        if (action === 'sales_summary_get') {
          const { getUrl } = require('./lib/legionRunPoller');
          const period = ['today', 'week', 'month'].includes(String(params.period || 'today').toLowerCase()) ? String(params.period).toLowerCase() : 'today';
          let url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/sales/summary?period=${encodeURIComponent(period)}`;
          if (params.sku && String(params.sku).trim()) url += `&sku=${encodeURIComponent(String(params.sku).trim())}`;
          const res = await getUrl(url);
          if (res.statusCode !== 200) return { error: 'Sales API unavailable. Try again in a minute.' };
          const data = JSON.parse(res.body || '{}');
          const top = (data.top_skus || []).slice(0, 5).map((t) => `${t.sku}: ${t.units}`).join(', ');
          return `Sales for ${period}: ${data.total_units_sold || 0} units sold, $${(data.total_revenue || 0).toFixed(2)} revenue. Top SKUs: ${top || 'none'}.`;
        }
        if (action === 'memory_core_update' && params.preference) {
          const { appendToDataSoul } = require('./lib/vectorMemory');
          const pref = String(params.preference).trim().slice(0, 500);
          if (pref) {
            appendToDataSoul(pref);
            return `Preference saved to Core Truths: "${pref.slice(0, 80)}${pref.length > 80 ? '…' : ''}".`;
          }
          return { error: 'No preference text provided.' };
        }
        if (action === 'memory_subconscious_search' && params.query) {
          const vectorMemory = require('./lib/vectorMemory');
          const q = String(params.query).trim().slice(0, 300);
          if (q) {
            const hits = await vectorMemory.search(q, { limit: 5 });
            if (hits.length === 0) return 'No relevant past context found.';
            return 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          }
          return { error: 'No search query provided.' };
        }
        if (action === 'web_research_run' && params.query) {
          const { sovereignSearchAndSynthesize } = require('./lib/sovereignSearch');
          return await sovereignSearchAndSynthesize(params.query, message, sessionModel, { topN: 2 });
        }
        if (action === 'python_execute' && params.code) {
          const { executePythonCode } = require('./lib/pythonSandbox');
          return await executePythonCode(params.code);
        }
        if (action === 'email_send' && params.to && params.subject != null) {
          const { sendEmail } = require('./lib/emailClient');
          return await sendEmail({ to: params.to, subject: params.subject, body: params.body || '' });
        }
        if (action === 'document_parse' && params.filePath) {
          const { parseLocalDocument } = require('./lib/documentParser');
          return await parseLocalDocument(params.filePath);
        }
        if (action === 'browser_actuate' && params.url && Array.isArray(params.actions) && params.actions.length) {
          const { actuateWebPage } = require('./lib/webReader');
          return await actuateWebPage(params.url, params.actions);
        }
        if (action === 'legion_deploy_agent' && params.role && params.taskContext) {
          const { deploySubAgent } = require('./lib/legionSwarm');
          return await deploySubAgent(params.role, params.taskContext);
        }
        if (action === 'system.intents.read') {
          const intents = loadIntents();
          const pending = intents.filter((i) => i.status === 'pending' || !i.status);
          const cleanIntents = pending.map((i) => ({ task: ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60), schedule: i.schedule || 'Pending' }));
          if (cleanIntents.length === 0) return 'Queue is empty. Nothing scheduled.';
          if (cleanIntents.length <= 5) return cleanIntents.map((c) => `${c.task} (${c.schedule})`).join('. ');
          return JSON.stringify(cleanIntents.slice(0, 10));
        }
        if (action === 'system.operations.read') {
          const { loadOperations, formatOperationsForPrompt } = require('./lib/operations');
          return formatOperationsForPrompt(loadOperations()) || 'No background operations configured.';
        }
        if (action === 'system.intents.manage') {
          const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./lib/intents');
          const { ollamaNativeChat } = require('./lib/llm');
          const pending = getPendingIntents();
          if (pending.length === 0) return "Queue is already empty. Nothing to cancel.";
          const simplifiedIntents = pending.map((i) => ({ id: i.id, task: `${((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60)} (${i.schedule || 'pending'})` }));
          const extractPrompt = `User Request to Cancel: "${String(message || '').slice(0, 500)}"\n\nCurrent Active Tasks:\n${JSON.stringify(simplifiedIntents, null, 2)}\n\nRespond ONLY with JSON: {"ids": ["id1","id2"]} or {"ids": []}`;
          let idsToDelete = [];
          try {
            const raw = await ollamaNativeChat(sessionModel, [{ role: 'user', content: extractPrompt }], { format: 'json', temperature: 0, max_tokens: 120 });
            const parsed = JSON.parse((raw || '').replace(/```json\s*|\s*```/g, '').trim());
            idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : [];
            const validIds = new Set(pending.map((i) => i.id));
            idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
          } catch (_) {
            const parts = String(message || '').replace(/^(?:can you please |please )?(?:cancel|delete|remove):?\s*/i, '').trim().split(/\n|,\s*|\s+and\s+/i).map((p) => p.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
            idsToDelete = findIntentsByDescriptions(parts.length ? parts : [message]).map((m) => m.id);
          }
          let cancelled = 0;
          for (const id of idsToDelete) { if (removeIntentById(id)) cancelled++; }
          return cancelled > 0 ? `Cancelled ${cancelled} schedule(s).` : 'No matching schedules found.';
        }
        if (action === 'ausmaker.business.health.review') {
          const { runBusinessHealthReview } = require('./lib/proactive/analyst');
          const review = await runBusinessHealthReview(DATA_DIR, { forceAnalyze: true });
          return review.action === 'alert' && review.anomaly ? `Business: ${review.anomaly.summary || review.anomaly.detail || 'Anomaly detected.'}` : 'Nothing to report — business looks normal.';
        }
        if (action === 'business.metrics.aggregate') {
          const { aggregateBusinessMetrics } = require('./lib/adapters/business.metrics');
          const r = await aggregateBusinessMetrics();
          return r.success ? `Metrics: ${r.data.total_sales} units, $${r.data.revenue} revenue (${r.data.timeframe})` : r.error;
        }
        if (action === 'system.health.ping') {
          const { pingEndpoints } = require('./lib/adapters/system.health');
          let urls = Array.isArray(params.urls) ? params.urls : (process.env.PIKO_HEALTH_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
          if (urls.length === 0) urls = [(AUSMAKER_BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')];
          const r = await pingEndpoints(urls);
          return r.success ? `${r.overall_status}: ${r.results.map((x) => `${x.url}=${x.ok ? x.status : 'fail'}`).join(', ')}` : r.error;
        }
        if (action === 'performance.benchmark.run') {
          const { runPerformanceBenchmark } = require('./lib/adapters/performance.benchmark');
          const url = params.url || process.env.PIKO_HEALTH_CHECK_URL || AUSMAKER_BASE_URL || 'http://127.0.0.1:5001';
          const r = await runPerformanceBenchmark(url);
          return r.success ? `${r.target}: ${r.latency_ms}ms (${r.status})` : r.error;
        }
        if (action === 'web.research.run') {
          const { sovereignSearchAndSynthesize } = require('./lib/sovereignSearch');
          const q = String(message || params.query || '').trim().slice(0, 500);
          if (!q) return { error: 'No search query. Provide search terms in your message.' };
          return await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
        }
        const objective = capabilityToObjective[action] || action;
        const syntheticBrief = { fields: { objective, execution_mode: 'auto', risk_level: 'low' } };
        const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
        if (!dispatch.ok || !dispatch.runId) return "Couldn't start that — Legion or the adapter may be unavailable.";
        const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./lib/legionRunPoller');
        const { saveLegionResult } = require('./lib/sharedContext');
        const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
        if (polled.ok && polled.result) {
          saveLegionResult(DATA_DIR, dispatch.capability, polled.result);
          return (action === 'inventory.low_stock.scan' || action === 'inventory.report.export')
            ? formatInventoryReply(polled.result, action, DATA_DIR, message)
            : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done. No items flagged.');
        }
        if (polled.status === 'timeout') return "Started but taking longer than expected. Try again in a minute.";
        return polled.error ? `Failed: ${polled.error}` : "Didn't complete. Try again in a minute.";
      };
      const reply = await runAgent(message, { executeTool, model: sessionModel });
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
      } else {
        // Task but ReAct disabled — inline capability execution
      console.log('[DECISION] Executing capability from 7B:', route.actionType, route.capability || route.schedule || route.dueAt || '');
      if (route.actionType === 'cancel_intent') {
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SERVER] Intercepted cancel_intent. Re-routing to system.intents.manage.');
        route.actionType = 'run_capability';
        route.capability = 'system.intents.manage';
      }
      if (route.actionType === 'run_capability' && route.capability === 'business.metrics.aggregate') {
        const { aggregateBusinessMetrics } = require('./lib/adapters/business.metrics');
        const result = await aggregateBusinessMetrics();
        const reply = result.success
          ? `**Business Metrics (${result.data.timeframe}):**\n• Total units sold: ${result.data.total_sales}\n• Revenue: $${result.data.revenue}`
          : `Couldn't fetch metrics: ${result.error}`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'system.health.ping') {
        const { pingEndpoints } = require('./lib/adapters/system.health');
        const urls = (route.opts && route.opts.urls) || (process.env.PIKO_HEALTH_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
        if (urls.length === 0) urls.push((AUSMAKER_BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, ''));
        const result = await pingEndpoints(urls);
        const reply = result.success
          ? `**System Health:** ${result.overall_status}\n${result.results.map((r) => `• ${r.url}: ${r.ok ? r.status : (r.error || 'Failed')}`).join('\n')}`
          : `Health check failed: ${result.error}`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'performance.benchmark.run') {
        const { runPerformanceBenchmark } = require('./lib/adapters/performance.benchmark');
        const url = (route.opts && route.opts.url) || process.env.PIKO_HEALTH_CHECK_URL || AUSMAKER_BASE_URL || 'http://127.0.0.1:5001';
        const result = await runPerformanceBenchmark(url);
        const reply = result.success
          ? `**Performance:** ${result.target}\n• Latency: ${result.latency_ms}ms (${result.status})\n• HTTP: ${result.http_status}`
          : `Benchmark failed: ${result.error}`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'inventory.csv.generate') {
        const { formatInventoryReply, getUrl } = require('./lib/legionRunPoller');
        const csvUrl = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/csv`;
        try {
          const res2 = await getUrl(csvUrl);
          if (res2.statusCode !== 200) {
            const reply = "Couldn't fetch the CSV — AusMaker API may be unavailable. Try again in a minute.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(res2.body || '{}');
          if (!data.success || !data.csv_content) {
            const reply = data.error || "No CSV data available. Run a low stock scan first to prime the cache.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const reply = formatInventoryReply(data, 'inventory.csv.generate', DATA_DIR, message, route.opts || {});
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          try { const { logActivity } = require('./lib/activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't generate CSV: " + (e.message || 'Unknown error') + ". Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }
      if (route.actionType === 'run_capability' && route.capability) {
        const { PIKO_NATIVE_CAPABILITIES } = require('./lib/actionRouter');
        if (PIKO_NATIVE_CAPABILITIES.includes(route.capability)) {
          if (route.capability === 'system.intents.manage') {
            const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./lib/intents');
            const { ollamaNativeChat } = require('./lib/llm');
            const pending = getPendingIntents();
            if (pending.length === 0) {
              const reply = "Queue is already empty mate. Nothing to cancel.";
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            // Simplify so 3B model can fuzzy-match (e.g. "8am" → "08:00", "both" → multiple)
            const simplifiedIntents = pending.map((i) => {
              const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
              return { id: i.id, task: `${String(task).slice(0, 60)} (${i.schedule || 'pending'})` };
            });
            const extractPrompt = `You are a strict data extraction assistant.
User Request to Cancel: "${String(message || '').slice(0, 500)}"

Current Active Tasks:
${JSON.stringify(simplifiedIntents, null, 2)}

RULES:
1. Match the user's request to the Active Tasks. The user will use natural language (e.g., "8am" instead of "08:00", "both" to mean multiple tasks).
2. Respond ONLY with a valid JSON object. It must contain exactly one key: "ids".
3. The value of "ids" must be an array of the matched "id" strings.

EXAMPLE OUTPUTS:
{"ids": ["intent_123_456", "intent_789_012"]}
{"ids": []}`;
            let idsToDelete = [];
            try {
              const extractModel = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || sessionModel;
              const raw = await ollamaNativeChat(extractModel, [{ role: 'user', content: extractPrompt }], {
                format: 'json',
                temperature: 0,
                max_tokens: 120,
              });
              console.log('[MANAGE INTENTS] LLM Raw Output:', raw || '(empty)');
              const cleaned = (raw || '').replace(/```json\s*|\s*```/g, '').trim();
              const parsed = JSON.parse(cleaned);
              idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : (parsed.idsToDelete || []);
              if (!Array.isArray(idsToDelete)) idsToDelete = [];
              const validIds = new Set(pending.map((i) => i.id));
              idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
            } catch (e) {
              if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[manage] LLM extraction failed:', e.message);
              const raw = String(message || '').replace(/^(?:can you please |please )?(?:cancel|delete|remove):?\s*/i, '').trim();
              const parts = raw.split(/\n|,\s*|\s+and\s+/i).map((p) => p.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
              const descriptions = parts.length > 0 ? parts : [raw].filter(Boolean);
              const matches = findIntentsByDescriptions(descriptions);
              idsToDelete = matches.map((m) => m.id);
            }
            if (idsToDelete.length === 0) {
              const reply = "No matching schedules found. Ask \"what's in the queue?\" to see what's pending.";
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            const preview = idsToDelete.map((id) => {
              const i = pending.find((p) => p.id === id);
              const task = (i && ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task')) || id;
              return `${String(task).slice(0, 50)} (${(i && i.schedule) || 'pending'})`;
            }).join('; ');
            const reply = `I'll cancel: ${preview}. Reply YES to confirm.`;
            pendingCancelConfirmations.set(key, { intentIds: idsToDelete, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
            savePendingCancelConfirmations(pendingCancelConfirmations);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./lib/activityLog');
              logActivity('action_router_run', { capability: route.capability, outcome: 'preview', pendingCount: idsToDelete.length });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
          if (route.capability === 'ausmaker.business.health.review') {
            const { runBusinessHealthReview } = require('./lib/proactive/analyst');
            const review = await runBusinessHealthReview(DATA_DIR, { forceAnalyze: true });
            const reply = review.action === 'alert' && review.anomaly
              ? `Business: ${review.anomaly.summary || review.anomaly.detail || 'Anomaly detected.'}${review.anomaly.detail ? ` ${review.anomaly.detail}` : ''}`
              : 'Nothing to report — business looks normal.';
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./lib/activityLog');
              logActivity('action_router_run', { capability: route.capability, outcome: review.action });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
          if (route.capability === 'web.research.run') {
            const { sovereignSearchAndSynthesize } = require('./lib/sovereignSearch');
            const q = String(message || '').trim().slice(0, 500);
            if (!q) {
              const reply = 'What would you like me to search for?';
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            try {
              const reply = await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            } catch (e) {
              const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
          }
          if (route.capability === 'system.operations.read' || route.capability === 'system.intents.read') {
            // Phase 2: Template-only fast path — no LLM for queue/ops. Instant reply.
            try {
              const useTemplate = process.env.PIKO_FAST_QUEUE_TEMPLATE !== '0' && process.env.PIKO_FAST_QUEUE_TEMPLATE !== 'false';
              if (route.capability === 'system.operations.read') {
                const { loadOperations, formatOperationsForPrompt } = require('./lib/operations');
                const ops = loadOperations();
                const formatted = formatOperationsForPrompt(ops);
                const reply = formatted
                  ? `Here's what's running: ${formatted.replace(/\n/g, ' ').trim()}.`
                  : "No background operations configured. Add knowledge/piko-operations.json if you want to track crons.";
                history.push({ role: 'assistant', content: reply });
                sessionStore.append(key, 'user', message);
                sessionStore.append(key, 'assistant', reply);
                try {
                  const { logActivity } = require('./lib/activityLog');
                  logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
                } catch (_) {}
                if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.operations.read — template');
                return send(res, 200, JSON.stringify({ reply }));
              }
              // system.intents.read
              const intents = loadIntents();
              const pending = intents.filter((i) => (i.status === 'pending' || !i.status));
              const cleanIntents = pending.map((i) => {
                const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
                const schedule = i.schedule || (i.dueAt || i.time || i.run ? String(i.dueAt || i.time || i.run).slice(0, 16) : null) || 'Pending';
                return { task: String(task).slice(0, 60), schedule };
              });
              if (useTemplate) {
                let reply;
                if (cleanIntents.length === 0) {
                  reply = "Queue is empty mate. Nothing scheduled.";
                } else if (cleanIntents.length <= 5) {
                  const parts = cleanIntents.map((c) => `${c.task} (${c.schedule})`);
                  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
                  reply = `You've got ${parts.length} in the queue: ${list}. Let me know if you want to cancel any.`;
                } else {
                  const shown = cleanIntents.slice(0, 10);
                  const parts = shown.map((c) => `${c.task} (${c.schedule})`);
                  const more = cleanIntents.length - 10;
                  const list = parts.join('; ');
                  reply = `You've got ${cleanIntents.length} in the queue: ${list}${more > 0 ? ` … plus ${more} more.` : ''} Let me know if you want to cancel any.`;
                }
                history.push({ role: 'assistant', content: reply });
                sessionStore.append(key, 'user', message);
                sessionStore.append(key, 'assistant', reply);
                try {
                  const { logActivity } = require('./lib/activityLog');
                  logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
                } catch (_) {}
                if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.intents.read — template');
                return send(res, 200, JSON.stringify({ reply }));
              }
              const systemDataText = cleanIntents.length ? JSON.stringify(cleanIntents.slice(0, 15), null, 2) : 'The queue is currently empty.';
              const cancelHint = ' If there are items, just say "Let me know if you want me to cancel any of these." DO NOT list technical commands or IDs.';
              const leanSystemData = `[INTERNAL SYSTEM DATA]: The user is asking about their scheduled intents/queue. Here is the live data:\n\n${systemDataText}\n\nSynthesize a short, brotherly summary. Do not read the whole list verbatim if long.${cancelHint}`;
              const leanPersona = 'You are Piko, a friendly, dry-humoured mate. Reply briefly in character.';
              const leanMessages = [
                { role: 'system', content: leanPersona },
                { role: 'system', content: leanSystemData },
                { role: 'user', content: message },
              ];
              const fastModel = process.env.PIKO_CASUAL_MODEL || sessionModel;
              const rawReply = await ollamaChat(leanMessages, fastModel, { max_tokens: 150, temperature: 0.4 });
              const reply = (rawReply || 'Couldn\'t summarise that — try again in a moment.').trim().slice(0, 400);
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              try {
                const { logActivity } = require('./lib/activityLog');
                logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
              } catch (_) {}
              if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.intents.read — LLM fallback');
              return send(res, 200, JSON.stringify({ reply }));
            } catch (e) {
              console.error('[FAST-PATH]', route.capability, e.message);
              const fallback = "Tried to pull that data but hit a snag. Check the Optimus logs.";
              history.push({ role: 'assistant', content: fallback });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', fallback);
              return send(res, 200, JSON.stringify({ reply: fallback }));
            }
          } else {
        const capabilityToObjective = {
          'inventory.low_stock.scan': 'low stock scan',
          'inventory.report.export': 'low stock scan',
          'sales.analysis.run': 'sales analysis',
          'purchase_order.draft.create': 'purchase order draft',
        };
        const objective = capabilityToObjective[route.capability] || route.capability;
        const syntheticBrief = {
          fields: {
            objective,
            execution_mode: 'auto',
            risk_level: 'low',
          },
        };
        const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
        if (!dispatch.ok || !dispatch.runId) {
          const reply = "Couldn't start that — Legion or the adapter may be unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./lib/legionRunPoller');
        const { saveLegionResult } = require('./lib/sharedContext');
        const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
        if (polled.ok && polled.result) {
          saveLegionResult(DATA_DIR, dispatch.capability, polled.result);
          const reply = (route.capability === 'inventory.low_stock.scan' || route.capability === 'inventory.report.export')
            ? formatInventoryReply(polled.result, route.capability, DATA_DIR, message, route.opts || {})
            : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done. No items flagged.');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          try {
            const { logActivity } = require('./lib/activityLog');
            logActivity('action_router_run', { capability: route.capability, runId: dispatch.runId, outcome: 'success' });
          } catch (_) {}
          return send(res, 200, JSON.stringify({ reply }));
        }
        if (polled.status === 'timeout') {
          const reply = "I've started it, but it's taking longer than expected. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const reply = polled.error ? `Failed: ${polled.error}. Check Legion logs.` : "Didn't complete. Try again in a minute.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
          }
        }
      }

      if (route.actionType === 'create_intent' && route.schedule && route.objective) {
        const normalizedSchedule = normalizeSchedule(route.schedule);
        const nextDue = nextDueFromSchedule(normalizedSchedule, new Date());
        if (!nextDue) {
          const fallback = `Couldn't parse schedule "${route.schedule}". Use \`/legion schedule daily 09:00 ${route.objective.slice(0, 40)}\` for daily tasks.`;
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        const intents = loadIntents();
        const alreadyScheduled = intents.some(
          (i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status) &&
            i.schedule === normalizedSchedule && (i.title === route.objective || (i.briefFields && i.briefFields.objective === route.objective))
        );
        if (alreadyScheduled) {
          const reply = `Already set up — ${route.objective} ${normalizedSchedule}. I'll keep you posted.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const briefFields = {
          objective: route.objective,
          success_criteria: 'Task completed as scheduled',
          scope: 'Recurring Legion task',
          constraints: 'Scheduled via Piko',
          risk_level: 'low',
          priority: 'P2',
          deadline: 'Ongoing',
          execution_mode: 'auto',
        };
        const newIntent = createIntent({
          type: 'legion_scheduled',
          title: route.objective,
          description: route.objective,
          dueAt: nextDue,
          schedule: normalizedSchedule,
          briefFields,
          source: reqSource,
          sessionId: key,
          _creationSource: 'action_router',
        });
        try {
          const { logActivity } = require('./lib/activityLog');
          logActivity('intent_created', { intentId: newIntent.id, type: 'legion_scheduled', objective: route.objective, schedule: normalizedSchedule, source: 'action_router' });
        } catch (_) {}
        const reply = `Done — scheduled ${route.objective} ${normalizedSchedule}. I'll run it when it's due and alert you.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'create_tripwire' && route.sku && route.operator != null && route.value != null) {
        const { addTripwire } = require('./lib/tripwireEngine');
        const sku = String(route.sku || '').trim();
        const field = String(route.field || 'stock').toLowerCase();
        const op = String(route.operator).trim();
        const val = parseFloat(route.value);
        if (!sku || isNaN(val)) {
          const fallback = "I need a SKU and a numeric value to set a tripwire. Try: \"Set a tripwire for METALCLIP-2.2 if stock drops below 25\".";
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        addTripwire(sku, field, op, val);
        const reply = `Tripwire set! I will alert you if the ${field} for ${sku} goes ${op} ${val}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'create_digest_schedule' && route.time) {
        const { addSummarySchedule } = require('./lib/tripwireEngine');
        addSummarySchedule(route.time);
        const reply = `Got it. I will compile and send the Product Change Summary every day at ${route.time}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'forecast_get' && route.sku) {
        const { getUrl } = require('./lib/legionRunPoller');
        const sku = String(route.sku || '').trim();
        const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
        try {
          const getRes = await getUrl(url);
          if (getRes.statusCode !== 200) {
            const reply = "Forecast API unavailable. Try again in a minute.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(getRes.body || '{}');
          const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
          const reply = `Forecast for ${sku}: daily run rate ${data.daily_run_rate || 0}. Next months: ${months || 'none'}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't fetch forecast: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'forecast_override_set' && route.sku && route.year_month && route.qty != null) {
        const { postJson } = require('./lib/legionRunPoller');
        const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast/override`;
        try {
          const postRes = await postJson(url, { sku: route.sku, year_month: route.year_month, override_qty: route.qty });
          if (postRes.statusCode < 200 || postRes.statusCode >= 300) {
            const reply = "Override failed. " + (JSON.parse(postRes.body || '{}').error || postRes.body || '').slice(0, 80);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const reply = `Override applied. ${route.sku} is now set to ${route.qty} units for ${route.year_month}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't set override: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'sales_summary_get') {
        const { getUrl } = require('./lib/legionRunPoller');
        const period = ['today', 'week', 'month'].includes(String(route.period || 'today').toLowerCase()) ? String(route.period).toLowerCase() : 'today';
        let url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/sales/summary?period=${encodeURIComponent(period)}`;
        if (route.sku && String(route.sku).trim()) url += `&sku=${encodeURIComponent(String(route.sku).trim())}`;
        try {
          const getRes = await getUrl(url);
          if (getRes.statusCode !== 200) {
            const reply = "Sales API unavailable. Try again in a minute.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(getRes.body || '{}');
          const top = (data.top_skus || []).slice(0, 5).map((t) => `${t.sku}: ${t.units}`).join(', ');
          const reply = `Sales for ${period}: ${data.total_units_sold || 0} units sold, $${(data.total_revenue || 0).toFixed(2)} revenue. Top SKUs: ${top || 'none'}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't fetch sales: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'memory_core_update' && route.preference) {
        const { appendToDataSoul } = require('./lib/vectorMemory');
        appendToDataSoul(route.preference);
        const reply = `Preference saved to Core Truths: "${route.preference.slice(0, 80)}${route.preference.length > 80 ? '…' : ''}".`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'memory_subconscious_search' && route.query) {
        const vectorMemory = require('./lib/vectorMemory');
        try {
          const hits = await vectorMemory.search(route.query, { limit: 5 });
          const reply = hits.length === 0
            ? 'No relevant past context found.'
            : 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search memory: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'web_research_run' && route.query) {
        const { sovereignSearchAndSynthesize } = require('./lib/sovereignSearch');
        try {
          const reply = await sovereignSearchAndSynthesize(route.query, message, sessionModel, { topN: 2 });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'create_reminder' && route.dueAt && route.objective) {
        const at = new Date(route.dueAt);
        if (isNaN(at.getTime())) {
          const fallback = "Couldn't parse the time. Use `/remind 17:00 <text>` for reminders.";
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        createIntent({
          type: 'reminder',
          title: route.objective,
          dueAt: at.toISOString(),
          source: reqSource,
          sessionId: key,
          _creationSource: 'action_router',
        });
        const reply = `Reminder set — ${route.objective} at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      // When actionType === 'none', fall through to normal chat so the main LLM can answer
      }
    } catch (e) {
      console.error('[action-router]', e.message);
      const fallback = "Hit a snag routing that. Try a slash command: `/legion schedule daily 09:00 low stock scan`.";
      history.push({ role: 'assistant', content: fallback });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', fallback);
      return send(res, 200, JSON.stringify({ reply: fallback }));
    }
  }

  // —— SCAN FOLLOW-UP: "How many items need reorder?" — extract from last result, no LLM (avoids timeout)
  const lastAssistantForFollowup = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
  const lastContent = lastAssistantForFollowup ? String(lastAssistantForFollowup.content || '') : '';
  const howManyMatch = /how many|what'?s the (total )?count|how many (items|skus)/i.test(message);
  const hasScanResult = /need reorder|ordered|need review|SKUs checked/.test(lastContent);
  if (howManyMatch && hasScanResult) {
    const needReorder = lastContent.match(/(\d+)\s+need reorder/);
    const ordered = lastContent.match(/(\d+)\s+ordered/);
    const needReview = lastContent.match(/(\d+)\s+need review/);
    const skusChecked = lastContent.match(/(\d+)\s+SKUs checked/);
    let reply = null;
    if (/reorder/i.test(message) && needReorder) reply = `${needReorder[1]} items need reorder.`;
    else if (/ordered|awaiting delivery/i.test(message) && ordered) reply = `${ordered[1]} items ordered (awaiting delivery).`;
    else if (/review/i.test(message) && needReview) reply = `${needReview[1]} items need review.`;
    else if (needReorder) reply = `${needReorder[1]} items need reorder.`;
    else if (skusChecked) reply = `${skusChecked[1]} SKUs were checked.`;
    if (reply) {
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }
  }

  // —— RECALL: "What did you do today?" — read activity log, summarize in Piko's voice ——
  if (plan.recallRequested) {
    try {
      const { readRecentActivity } = require('./lib/activityLog');
      const recent = readRecentActivity(50);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEntries = recent.filter((e) => e.ts && new Date(e.ts) >= todayStart);
      const entries = /today|this (morning|afternoon)/i.test(message) ? todayEntries : recent;
      if (entries.length === 0) {
        const reply = "No entries in my activity log yet — nothing scheduled or fired. Once you set up reminders or Legion tasks, I'll have a record.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const activityLines = entries.map((e) => {
        const action = e.action === 'intent_created' ? 'created' : e.action === 'intent_fired' ? 'fired' : e.action;
        const obj = e.objective || e.title || '';
        const sched = e.schedule ? ` (${e.schedule})` : '';
        const out = e.outcome === 'failed' ? ' [failed]' : '';
        return `${e.ts}: ${action} ${e.type || ''} ${obj}${sched}${out}`;
      }).join('\n');
      const recallPrompt = `You are Piko. The user asked: "${message}".

Your activity log (recent actions):
${activityLines}

Summarize what you've done in your dry, brotherly tone. One or two short sentences. Be conversational — e.g. "Quiet day mostly. I set up that Aus Maker stock scan you asked for at 9 AM, and fired off your reminder to call Mum at 5 PM." If something failed, mention it briefly. Do not list raw timestamps or JSON.`;
      const reply = await ollamaChat([{ role: 'user', content: recallPrompt }], sessionModel, { max_tokens: 120, temperature: 0.6 });
      const finalReply = (reply || 'Not much to report.').trim().slice(0, 300);
      history.push({ role: 'assistant', content: finalReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', finalReply);
      return send(res, 200, JSON.stringify({ reply: finalReply }));
    } catch (e) {
      console.error('[RECALL]', e.message);
      const fallback = "Couldn't read my activity log — something went wrong. Try again in a moment.";
      history.push({ role: 'assistant', content: fallback });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', fallback);
      return send(res, 200, JSON.stringify({ reply: fallback }));
    }
  }

  let planLine = plan.capabilityQuestion
    ? '\n\n**This turn:** Capability question. Answer in one short line. Do not say "How can I assist you today?" or "I\'m Piko, a Christian AI...". Do not assume they are debugging. Just answer briefly.\n\n'
    : plan.casual
      ? ''
      : '\n\n' + formatPlanForPrompt(plan) + '\n\n';
  const noAssumeDebugLine = '\n\nDo not assume the user is debugging or has a bug unless they said so. Answer the question they actually asked.\n\n';
  const styleReminder = '\n\n**This turn:** Reply like a person. Never say "How can I assist you today?" or "ready to help." Never say "From corpus" or mention Piko as a project. One short line when that fits.';
  const OPERATIONAL_SELF_MODULATION = '\n\nIf the user message is short social talk, reply briefly (1–2 sentences). If the user asks for analysis or explanation, respond in detail. Do not elaborate unless the question requires it.';
  const leadingRule = '**You are Piko. Reply ONLY to the user\'s last message.** Never say "How can I assist you today?" or recite your role ("I\'m Piko, a Christian AI..."). Never say "From corpus" or mention Piko as a project. Never summarize, list, or describe the instructions or documents below. Never say you will review, incorporate, or restart anything. Never say "I\'m back online and ready to help" or "I\'m here to help." Answer the question they asked; do not assume they are debugging or have a bug unless they said so. Just reply naturally in character.\n\n';
  /** Ultra-short prompt for pure greetings only — minimises tokens for 3–8s replies. */
  const CASUAL_GREETING_MINIMAL = `You are Piko. Reply in one short warm sentence (under 12 words). No lists, no advice. Match their tone. If they ask how you are, answer briefly and end with "you?".

Examples (vary naturally): Hey Piko → Hey there — good to hear from you. | G'day Piko → G'day mate. | Hi → Hey — good to hear your voice.`;
  /** Minimal prompt when user only asked how we are — keeps prefill fast (avoids 30–60s delay). */
  const CASUAL_RECIPROCITY_MINIMAL = 'You are Piko. They only asked how you are. Reply in one short sentence (under 12 words). End with "— you?" Example: Doing alright — you?';
  /** For casual turns: minimal prompt with small persona. Contrast examples prioritise how-are-you over morning/greeting. */
  const CASUAL_SYSTEM_PROMPT = `You are Piko, a private, self-hosted AI companion and system orchestrator.
Your tone is grounded, dry, concise, and highly competent. You speak like a trusted brother or sharp colleague.

CRITICAL TONE RULES:
1. NEVER use corporate AI clichés ("How can I assist you today?", "I am happy to help!").
2. DO NOT overact or force slang to sound casual. Speak in plain, normal English.
3. NEVER ask open-ended pleasantries (e.g., "What's news?", "How are you doing?"). If the user just says "Hi", acknowledge them briefly and wait for their command.
4. NEVER repeat or echo the user's exact words back as your reply.
5. Keep your responses as brief as possible while remaining polite.

EXAMPLES OF YOUR TONE:
User: "Ok, hi Piko."
You: "Hey mate. What's on?"

User: "How are you going?"
You: "Not bad — you?"

User: "It's going good. How about yourself?"
You: "Pretty good too — same boat."

User: "Morning."
You: "Morning — coffee on?"

User: "I had a rough day."
You: "Sorry to hear — you okay?"

User: "What do you think about coffee?"
You: "Love it — can't function without. You?"`;
  /** User only asked how we are (no statement of their own). Used for prompt selection and safety net. */
  function onlyAskedHowAreYou(msg) {
    if (!msg || typeof msg !== 'string') return false;
    const u = String(msg).trim().toLowerCase();
    return /\?|？/.test(msg) && /how\s+(are|is|you|things|it)(\s+going)?\b|how'?s\s+(it|things|ya|you)(\s+going)?\b|how\s+you\s+doing|you\s+doing\s+ok|(how|what)\s+about\s+(you|yourself)/i.test(u) && !/\b(i'?m|i am|doing|good|well|fine|alright|ok|not bad|great|busy)\b/i.test(u);
  }
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
    if (plan.casualMode === 'GREETING' && process.env.PIKO_CASUAL_FAST_GREETING !== '0')
      systemContent = CASUAL_GREETING_MINIMAL;
    else if (plan.casualMode === 'RECIPROCITY' && onlyAskedHowAreYou(message))
      systemContent = CASUAL_RECIPROCITY_MINIMAL;
    else
      systemContent = CASUAL_SYSTEM_PROMPT;
  } else if (plan.socialChat) {
    systemContent = SOCIAL_CHAT_SYSTEM_PROMPT;
  } else {
    /** Full path only: load corpus, truth, memory, beliefs — not needed for casual/socialChat. */
    const mind = loadMind();
    const primaryHuman = (mind.self_model.identity && mind.self_model.identity.primary_human) || process.env.PIKO_PRIMARY_HUMAN || '';
    const userBeliefs = memory.getUserBeliefs();
    const fullPlan = createResponsePlan({
      userBeliefs,
      mind,
      userMessage: message,
      recentEpisodic: memory.getEpisodic().slice(-3),
      recentTurns: recentTurnsForPlan,
    });
    planLine = fullPlan.capabilityQuestion
      ? '\n\n**This turn:** Capability question. Answer in one short line. Do not say "How can I assist you today?" or "I\'m Piko, a Christian AI...". Do not assume they are debugging. Just answer briefly.\n\n'
      : '\n\n' + formatPlanForPrompt(fullPlan) + '\n\n';
    const corpusBlock = getCorpusBlockForPrompt(primaryHuman);
    const knowledgeBaseBlock = getKnowledgeBaseBlockForPrompt(message);
    const truthBlock = getTruthBlockForPrompt();
    let gmailContext = '';
    try {
      const { getGmailContextBlock } = require('./lib/gmailContext');
      gmailContext = await getGmailContextBlock();
    } catch (_) {}
    const learningRequested = requestsLearningUpdate(message);
    const learningInjectEnabled = process.env.PIKO_LEARNING_CHAT_INJECT !== '0' && learningRequested;
    const ragContext = learningInjectEnabled ? getRagContext(message) : '';
    const recentLearningBlock = learningInjectEnabled ? getRecentLearningBlock() : '';
    const stickyIdeasBlock = learningInjectEnabled ? getStickyIdeasBlock() : '';
    const memoryBlock = memory.getMemoryBlockForPrompt(8, 3);
    const dataSoulBlock = loadDataSoul() ? loadDataSoul() + '\n\n' : '';
    let baseContent = leadingRule + OPERATIONAL_SELF_MODULATION + dataSoulBlock + corpusBlock + knowledgeBaseBlock + truthBlock + memoryBlock + planLine + noAssumeDebugLine + (() => { try { const { getImpactBlockForPrompt } = require('./lib/impact'); return getImpactBlockForPrompt(); } catch (_) { return ''; } })() + SYSTEM_PROMPT + recentLearningBlock + stickyIdeasBlock + (learningInjectEnabled ? getAndConsumePendingQuestionBlock() : '')
      + getDailyMemoryBlock(key)
      + gmailContext
      + ragContext
      + (learningInjectEnabled ? '\n\nOccasionally, when it fits the conversation, ask the user a genuine question drawn from your recent learning or from the themes you keep returning to—so they can share their perspective. Do not do this every message; only when natural.' : '')
      + (process.env.PIKO_CONTROLLED_DIVERGENCE === '1' || process.env.PIKO_CONTROLLED_DIVERGENCE === 'true' ? '\n\n' + (process.env.PIKO_DIVERGENCE_PROMPT || 'Occasionally offer a different angle or gently challenge an assumption when it fits; do not simply echo the user.') : '')
      + styleReminder;
    if (fullPlan.deepReasoning) {
      baseContent += '\n\n**This turn: deep reasoning.** The user has asked a question that deserves thoughtful consideration. Think step by step before answering. Take your time. Do not say "Let me think" or "Hmm" in your reply — the user has already been told you are thinking. Provide a considered, substantive answer.';
    }
    systemContent = baseContent;
  }
  const META_SLIP_PATTERN = /I see you've edited|I'll review the changes|I'm back online and ready to help|It's great to be back online|I'll restart the bot|persona document to refine|what'?s on your mind today/i;
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
      "Pretty good — you?",
      "Doing alright — you?",
    ],
    ACK: [
      "Good to hear.",
      "Nice one.",
      "Glad to hear it.",
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
      if (stilted || text.length > 160) {
        metrics.conversation.fallbackApplied += 1;
        if (stilted) metrics.conversation.stiltedDetected += 1;
        return pickDeterministic(MODE_FALLBACKS.SOCIAL_CHAT, seed, turnCount);
      }
      return reply;
    }
    if (!planObj.casual) return reply;
    const userAskedQuestion = /\?/.test(String(userMsg || ''));
    const mode = planObj.casualMode || 'CASUAL';
    let shouldFallback = stilted;
    if (mode === 'GREETING') {
      const greetingLike = /(hey|hi|hello|g'?day|good to hear|nice to hear|morning|yo|cheers|not bad|pretty good|doing alright)/i.test(text);
      if (!greetingLike) shouldFallback = true;
    }
    if (mode === 'RECIPROCITY') {
      const selfStatusLike = /(not bad|pretty good|doing|all good|same here|same boat|busy|good)/i.test(text);
      const endsWithYou = /(— |\s)you\?\.?\s*$/i.test(text);
      if (onlyAskedHowAreYou(userMsg) && !endsWithYou) shouldFallback = true;
      else if (!selfStatusLike) shouldFallback = true;
    }
    if (mode === 'SIGN_OFF' && /\?/.test(text)) shouldFallback = true;
    if (mode === 'SOCIAL_EMPATHY' && !/(sorry|rough|hear you|that sounds|tough|flat|with you|okay|ok)/i.test(text)) shouldFallback = true;
    if (mode === 'LIGHT_OPINION' && /(morning mate|anything new|same old|g'?day\s*[—-]\s*you)/i.test(text)) shouldFallback = true;
    if (!userAskedQuestion && /\?/.test(text)) shouldFallback = true;
    if (!shouldFallback) return reply;
    metrics.conversation.fallbackApplied += 1;
    if (stilted) metrics.conversation.stiltedDetected += 1;
    const fallbackPool = (!userAskedQuestion && mode === 'RECIPROCITY')
      ? MODE_FALLBACKS.ACK
      : (MODE_FALLBACKS[mode] || MODE_FALLBACKS.CASUAL);
    if (mode === 'GREETING') return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
    return pickDeterministic(fallbackPool, seed, turnCount);
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
  /** For deep path: strip accidental "Hmm, let me think" etc. from model output — we already sent that as placeholder. */
  function stripDeepPlaceholderEcho(reply) {
    if (!reply || typeof reply !== 'string') return reply;
    const t = reply.trim();
    const echoed = /^(hmm,?\s*(let me\s+)?think(ing)?[.…\s]*|give me a moment[.…\s]*|thinking that through[.…\s]*)/i;
    const m = t.match(echoed);
    if (m) return t.slice(m[0].length).trim() || reply;
    return reply;
  }
  /** "Same here" only makes sense when user stated their state. If user asked a "how are you" question (and didn't state theirs), replace with " — you?". */
  function fixSameHereWhenInvalid(userMsg, reply) {
    if (!reply || typeof reply !== 'string' || !userMsg) return reply;
    const u = String(userMsg || '').trim().toLowerCase();
    if (!/\?|？/.test(userMsg)) return reply;
    const howAreYou = /how\s+(are|is|you|things|it)(\s+going)?\b|how'?s\s+(it|things|ya|you)(\s+going)?\b|how\s+you\s+doing|you\s+doing\s+ok/i;
    if (!howAreYou.test(u)) return reply;
    const userStatedState = /\b(i'?m|i am|doing|good|well|fine|alright|ok|not bad|great|busy)\b/i.test(u);
    if (userStatedState) return reply;
    const r = reply.trim();
    if (/^same\s+here\.?\s*$/i.test(r)) {
      const fixed = 'Doing alright — you?';
      if (process.env.PIKO_LOG_SAME_HERE === '1') console.log('[same_here] Replaced (reply was only "same here"):', r, '→', fixed);
      return fixed;
    }
    const sameHere = /([.—,\s]+same\s+here\.?)\s*$/i;
    if (sameHere.test(reply)) {
      const fixed = reply.replace(sameHere, ' — you?').trim();
      if (process.env.PIKO_LOG_SAME_HERE === '1') console.log('[same_here] Replaced (user asked, did not state):', reply.slice(0, 50), '→', fixed.slice(0, 50));
      return fixed;
    }
    return reply;
  }
  // Routing windows:
  // - casual: last 4 messages (2 exchanges) so Piko remembers context on acknowledgments (e.g. "Thanks" after supplier choice)
  // - socialChat: short continuity window for natural back-and-forth without full worldview stack
  // - full: normal conversation window
  const historyWindow = plan.casual ? 4 : (plan.socialChat ? 4 : SLICE_HISTORY);
  const maxContextChars = parseInt(process.env.PIKO_MAX_CONTEXT_CHARS, 10) || 24000;
  let historyPart;
  if (historyWindow === 0) {
    historyPart = [];
  } else {
    const candidate = history.slice(-historyWindow);
    let finalHistory = [];
    let currentChars = systemContent.length;
    for (let i = candidate.length - 1; i >= 0; i--) {
      const msg = candidate[i];
      const msgLen = (msg.content || '').length + 80;
      // Always keep the most recent message (i === candidate.length - 1) even if it breaches the limit
      if (i !== candidate.length - 1 && currentChars + msgLen > maxContextChars) {
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[MEMORY] Context guillotine triggered; kept', finalHistory.length, 'recent messages');
        break;
      }
      finalHistory.unshift(msg);
      currentChars += msgLen;
    }
    historyPart = finalHistory.map(({ role, content }) => ({ role, content }));
  }
  const casualMaxTokens = plan.casual ? (plan.casualMode === 'GREETING' ? 24 : (plan.casualMode === 'RECIPROCITY' ? 28 : 32)) : 4000;
  const casualTemp = plan.casual ? (plan.casualMode === 'GREETING' ? 0.3 : 0.4) : 0.9;
  const socialChatOptions = plan.socialChat ? { max_tokens: 80, temperature: 0.72, repeat_penalty: 1.2, presence_penalty: 0.15, frequency_penalty: 0.1 } : null;
  const deepOptions = plan.deepReasoning ? { max_tokens: Math.min(2500, parseInt(process.env.PIKO_DEEP_MAX_TOKENS, 10) || 2500), temperature: 0.8, repeat_penalty: 1.15 } : null;
  const DEEP_PLACEHOLDERS = ["Hmm, let me think…", "Give me a moment…", "Thinking that through…"];
  const route = plan.casual ? 'casual' : (plan.socialChat ? 'socialChat' : (plan.deepReasoning ? 'deep' : 'full'));
  metrics.conversation.route[route] = (metrics.conversation.route[route] || 0) + 1;
  if (process.env.PIKO_LOG_CASUAL === '1' || process.env.PIKO_DEBUG_CASUAL === '1') {
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
  let userContentForCasual = message;
  if (plan.casual && plan.casualMode === 'RECIPROCITY' && onlyAskedHowAreYou(message) && systemContent !== CASUAL_RECIPROCITY_MINIMAL) {
    messages[0].content = systemContent + '\n\n**This turn:** The user only asked how you are; they did not state their own state. End your reply with "— you?".';
  }
  if (plan.casual || plan.socialChat) messages.push({ role: 'user', content: userContentForCasual });
  let releaseChat = null;
  try {
    releaseChat = await acquireChatSlot();
  } catch (queueErr) {
    const busyReply = 'I am handling a few replies right now. Please retry in a moment.';
    const retryAfterSec = Math.max(1, Math.ceil(CHAT_QUEUE_WAIT_MS / 1000));
    if (queueErr && queueErr.code === 'chat_queue_full') {
      return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
    }
    if (queueErr && queueErr.code === 'chat_queue_timeout') {
      return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
    }
    return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
  }
  const latencyStart = Date.now();
  let latencyFirstToken = null;
  function buildTimeoutFallbackReply() {
    return 'I hit a local model timeout just now. Please retry in a moment.';
  }
  try {
    if (streamReply) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const streamOptions = plan.casual
        ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15, num_ctx: Number(process.env.PIKO_CASUAL_NUM_CTX) || 512 }
        : (plan.socialChat ? socialChatOptions : (plan.deepReasoning ? deepOptions : {}));
      if (plan.deepReasoning) {
        const placeholder = DEEP_PLACEHOLDERS[Math.floor(Math.random() * DEEP_PLACEHOLDERS.length)];
        res.write('data: ' + JSON.stringify({ content: placeholder + ' ' }) + '\n\n');
      }
      const modelForStream = (plan.casual && process.env.PIKO_CASUAL_MODEL) ? process.env.PIKO_CASUAL_MODEL : sessionModel;
      let reply = await ollamaChatStream(messages, (delta) => {
        if (latencyFirstToken === null) latencyFirstToken = Date.now();
        res.write('data: ' + JSON.stringify({ content: delta }) + '\n\n');
      }, modelForStream, streamOptions);
      const latencyTotal = Date.now() - latencyStart;
      log('info', 'latency', { stream: true, route, historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal }, req.requestId);
      if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { route, historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal });
      if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
        console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
      }
      reply = stripMetaSlip(reply, message);
      if (plan.deepReasoning) reply = stripDeepPlaceholderEcho(reply) || reply;
      reply = fixPersonalLifeDeflection(message, reply) || reply;
      if ((plan.casual || plan.socialChat) && reply) {
        const beforeBleedStrip = reply;
        reply = stripCasualThemeBleed(reply) || reply;
        if (beforeBleedStrip !== reply) metrics.conversation.bleedTrigger += 1;
        if (plan.casual) {
          reply = fixEchoReply(message, reply) || reply;
          reply = fixSameHereWhenInvalid(message, reply) || reply;
          const cleaned = reply.trim().split(/\n+/)[0] || '';
          // Sentence boundary: period+space+capital or end — avoid chopping decimals ($4.50), abbreviations (Mr.), URLs
          const sentences = cleaned.match(/[^.!?]+[.!?]+(?=\s+[A-Z]|\s*$)|[^.!?]+$/g);
          const firstSentence = (sentences ? sentences[0] : cleaned).trim();
          if (firstSentence.length > 0) {
            reply = firstSentence;
            if (!/[.!?]$/.test(reply)) reply = reply + '.';
          }
        } else if (plan.socialChat) {
          reply = fixSameHereWhenInvalid(message, reply) || reply;
          const cleaned = reply.trim().split(/\n+/)[0] || '';
          const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
          if (sentences.length > 0) reply = sentences.join(' ').trim();
          if (!/[.!?]$/.test(reply)) reply = reply + '.';
        }
        reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
        if (/^hey\s*[—-]\s*what'?s up\??\.?$/i.test((reply || '').trim())) metrics.conversation.resetTrigger += 1;
      }
      reply = enforceReplyConstraints(reply, {
        maxWords: wordLimit,
        maxSentences: sentenceLimit,
        noQuestion: noQuestionRequested,
      }) || reply;
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
      ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15, num_ctx: Number(process.env.PIKO_CASUAL_NUM_CTX) || 512 }
      : (plan.socialChat ? socialChatOptions : (plan.deepReasoning ? deepOptions : {}));
    const modelForRequest = (plan.casual && process.env.PIKO_CASUAL_MODEL) ? process.env.PIKO_CASUAL_MODEL : sessionModel;
    let reply = await ollamaChat(messages, modelForRequest, chatOptions);
    const latencyTotal = Date.now() - latencyStart;
    log('info', 'latency', { stream: false, route, historyMessages: historyPart.length, totalMs: latencyTotal }, req.requestId);
    if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { route, historyMessages: historyPart.length, totalMs: latencyTotal });
    if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
      console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
    }
    reply = stripMetaSlip(reply, message);
    reply = fixPersonalLifeDeflection(message, reply) || reply;
    if ((plan.casual || plan.socialChat) && reply) {
      const beforeBleedStrip = reply;
      reply = stripCasualThemeBleed(reply) || reply;
      if (beforeBleedStrip !== reply) metrics.conversation.bleedTrigger += 1;
      if (plan.casual) {
        reply = fixEchoReply(message, reply) || reply;
        reply = fixSameHereWhenInvalid(message, reply) || reply;
        const cleaned = reply.trim().split(/\n+/)[0] || '';
        // Sentence boundary: period+space+capital or end — avoid chopping decimals ($4.50), abbreviations (Mr.), URLs
        const sentences = cleaned.match(/[^.!?]+[.!?]+(?=\s+[A-Z]|\s*$)|[^.!?]+$/g);
        const firstSentence = (sentences ? sentences[0] : cleaned).trim();
        if (firstSentence.length > 0) {
          reply = firstSentence;
          if (!/[.!?]$/.test(reply)) reply = reply + '.';
        }
      } else if (plan.socialChat) {
        reply = fixSameHereWhenInvalid(message, reply) || reply;
        const cleaned = reply.trim().split(/\n+/)[0] || '';
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
        if (sentences.length > 0) reply = sentences.join(' ').trim();
        if (!/[.!?]$/.test(reply)) reply = reply + '.';
      }
      reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
      if (/^hey\s*[—-]\s*what'?s up\??\.?$/i.test((reply || '').trim())) metrics.conversation.resetTrigger += 1;
    }
    reply = enforceReplyConstraints(reply, {
      maxWords: wordLimit,
      maxSentences: sentenceLimit,
      noQuestion: noQuestionRequested,
    }) || reply;
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
    const isTimeout = e && (e.code === 'ollama_chat_timeout' || e.code === 'ollama_stream_timeout');
    if (isTimeout) {
      const fallbackReply = buildTimeoutFallbackReply();
      if (streamReply) {
        if (!res.writableEnded) {
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          }
          try {
            res.write('data: ' + JSON.stringify({ timeout: true, content: fallbackReply }) + '\n\n');
            res.write('data: ' + JSON.stringify({ done: true, reply: fallbackReply, timeout: true }) + '\n\n');
          } catch (_) {}
          try { res.end(); } catch (_) {}
        }
        return;
      }
      return send(res, 200, JSON.stringify({ reply: fallbackReply, timeout: true }));
    }
    let errMsg = 'Ollama error: ' + e.message;
    if (e.message && e.message.includes('OPENAI_API_KEY')) {
      errMsg += ' Set PIKO_OLLAMA_ONLY=1 in the server env and ensure Ollama is reachable (e.g. OLLAMA_URL).';
    }
    if (res.headersSent || res.writableEnded) {
      try { res.end(); } catch (_) {}
      return;
    }
    send(res, 502, JSON.stringify({ error: errMsg }));
  } finally {
    if (typeof releaseChat === 'function') {
      try { releaseChat(); } catch (_) {}
    }
  }
  });
  });
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

  if (await handleLegateEventsRoute(req, res, pathname, {
    readBody,
    send,
    log,
    dataDir: DATA_DIR,
    observe: (ev) => recordLegateObsEvent(DATA_DIR, ev),
  })) return;
  if (await handleLegateDecisionRequestRoute(req, res, pathname, {
    readBody,
    send,
    log,
    dataDir: DATA_DIR,
    loadPolicy: loadProactivePolicy,
    sendLegionCommand,
    observe: (ev) => recordLegateObsEvent(DATA_DIR, ev),
  })) return;

  if (req.method === 'POST' && pathname === '/api/chat') {
    return handleApiChat(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/chat/inject') {
    readBody(req)
      .then((body) => {
        let json;
        try {
          json = JSON.parse(body || '{}');
        } catch (_) {
          return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
        }
        const sessionId = json.sessionId || json.session_id;
        const role = json.role || 'assistant';
        const content = json.content;
        if (!sessionId || typeof content !== 'string') {
          return send(res, 400, JSON.stringify({ error: 'Missing sessionId or content' }));
        }
        const ok = sessionStore.append(sessionId, role, content.slice(0, 10000));
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[MEMORY] Injected', role, 'vision context into session', sessionId.slice(0, 30));
        return send(res, 200, JSON.stringify({ success: !!ok }));
      })
      .catch((e) => {
        console.error('[MEMORY INJECTION]', e.message);
        return send(res, 500, JSON.stringify({ error: 'Failed to inject memory' }));
      });
    return;
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
      conversation: metrics.conversation,
      uptimeMs,
      uptime: `${Math.floor(uptimeMs / 60000)}m`,
    }));
  }

  if (handleConversationQualityRoute(req, res, pathname, metrics, send)) return;

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

  // —— Webhook events (external systems POST here) ——
  function checkWebhookAuth(req) {
    if (!PIKO_WEBHOOK_SECRET) return true;
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const key = (req.headers['x-webhook-key'] || '').trim();
    return bearer === PIKO_WEBHOOK_SECRET || key === PIKO_WEBHOOK_SECRET;
  }
  if (req.method === 'POST' && (pathname === '/api/webhooks/events' || pathname === '/api/webhooks/ausmaker')) {
    if (!checkWebhookAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
    }
    readBody(req)
      .then(async (body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          let event = {
            source: pathname === '/api/webhooks/ausmaker' ? 'ausmaker' : (parsed.source || 'unknown'),
            eventType: String(parsed.eventType || parsed.event_type || '').trim() || 'unknown',
            payload: parsed.payload || parsed,
            timestamp: parsed.timestamp || new Date().toISOString(),
          };
          const result = await processWebhookEvent(event, {
            postJsonToUrl,
            sendTelegram: telegramNotify,
            appendPending: appendPendingNotification,
            legionBase: LEGION_ADAPTER_API_BASE,
            bearer: LEGION_ADAPTER_API_BEARER,
          });
          const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          return send(res, 202, JSON.stringify({ id, status: 'processed', rulesMatched: result.rulesMatched }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid webhook payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' })));
    return;
  }

  // —— /webhook/inventory-alert: AusMaker real-time inventory alerts (Reorder/Review status) ——
  if (req.method === 'POST' && pathname === '/webhook/inventory-alert') {
    readBody(req)
      .then(async (body) => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const { sku, name, old_status, new_status, soh, forecast, active_method } = payload;
          if (new_status === 'Reorder' || new_status === 'Review') {
            const { sendToAdmin } = require('./lib/telegramNotifier');
            const { enqueueInventoryAlert } = require('./lib/inventoryAlertBatcher');
            await enqueueInventoryAlert(
              { sku, name, old_status, new_status, soh, forecast, active_method },
              sendToAdmin,
            );
          }
          return send(res, 200, 'OK');
        } catch (e) {
          console.error('[WEBHOOK] inventory-alert failed:', e.message);
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ error: e.message || 'Webhook failed' })));
    return;
  }

  // —— /api/webhook/alert: LLM-evaluated push alerts (Shopify, Cin7, custom scripts) ——
  if (req.method === 'POST' && (pathname === '/api/webhook/alert' || pathname === '/webhook/alert')) {
    if (!checkWebhookAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
    }
    readBody(req)
      .then(async (body) => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const alertSource = payload.source || 'External System';
          const alertMessage = payload.message || (payload.data ? JSON.stringify(payload.data) : JSON.stringify(payload));
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[WEBHOOK] Received external alert:', alertSource, alertMessage.slice(0, 200));
          const { ollamaNativeChat } = require('./lib/llm');
          const model = process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';
          const prompt = `You are Piko. An urgent webhook alert just arrived from ${alertSource}.
Alert details: ${String(alertMessage).slice(0, 1500)}
Draft a concise, urgent Telegram message to the user notifying them of this event. If it is trivial or noise, return exactly "IGNORE". Otherwise return only the message text.`;
          const pikoResponse = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], { max_tokens: 150, temperature: 0.3 });
          const trimmed = (pikoResponse && typeof pikoResponse === 'string' ? pikoResponse : String(pikoResponse || '')).trim();
          if (trimmed && !/^IGNORE$/i.test(trimmed)) {
            await telegramNotify('🚨 **Automated Alert**\n' + trimmed);
          }
          return send(res, 200, JSON.stringify({ success: true, processed: true }));
        } catch (e) {
          log('error', 'webhook_alert', { message: e.message });
          return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' })));
    return;
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

  if (req.method === 'GET' && pathname === '/api/control/proactive-policy') {
    try {
      const policy = loadProactivePolicy();
      return send(res, 200, JSON.stringify({ ok: true, policy }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load policy' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/control/proactive-policy') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const expectedUpdatedAt = parsed && parsed.expectedUpdatedAt ? parsed.expectedUpdatedAt : '';
          const next = saveProactivePolicy(parsed && parsed.policy ? parsed.policy : parsed, { expectedUpdatedAt });
          return send(res, 200, JSON.stringify({ ok: true, policy: next }));
        } catch (e) {
          if (e && e.code === 'POLICY_CONFLICT') {
            return send(res, 409, JSON.stringify({
              ok: false,
              error: 'Policy version conflict',
              code: e.code,
              current: e.current || loadProactivePolicy(),
            }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid policy payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save policy' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-decisions') {
    try {
      const { query } = parseUrl(req.url);
      const limit = query && query.limit ? Number(query.limit) : 100;
      const rows = listLegateDecisions(DATA_DIR, limit);
      return send(res, 200, JSON.stringify({ ok: true, decisions: rows }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legate decisions' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/control/legate-decisions/execute') {
    const startedAt = Date.now();
    readBody(req)
      .then(async (body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const traceId = String(parsed && parsed.trace_id ? parsed.trace_id : '').trim();
          if (!traceId) {
            recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 400, latencyMs: Date.now() - startedAt, outcome: 'invalid_payload', errorCode: 'MISSING_TRACE_ID' });
            return send(res, 400, JSON.stringify({ ok: false, error: 'Missing trace_id' }));
          }
          const decision = findDecisionByTrace(DATA_DIR, traceId);
          if (!decision) {
            recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 404, latencyMs: Date.now() - startedAt, outcome: 'not_found', errorCode: 'DECISION_NOT_FOUND', trace_id: traceId });
            return send(res, 404, JSON.stringify({ ok: false, error: 'Decision not found' }));
          }
          const rollout = loadLegateRollout(DATA_DIR);
          const gate = canExecuteProductionAction(rollout);
          if (!gate.ok) {
            recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 409, latencyMs: Date.now() - startedAt, outcome: 'rollout_blocked', errorCode: gate.reason, trace_id: traceId });
            return send(res, 409, JSON.stringify({ ok: false, error: `Execution blocked by rollout gate: ${gate.reason}`, code: 'ROLLOUT_BLOCKED', gate: gate.reason, rollout }));
          }
          const execution = await executeDecisionAction(decision, { sendLegionCommand, dataDir: DATA_DIR });
          recordLegateObsEvent(DATA_DIR, {
            route: '/api/control/legate-decisions/execute',
            status: 200,
            latencyMs: Date.now() - startedAt,
            outcome: execution && execution.status === 'sent' ? 'execute_sent' : 'execute_not_sent',
            trace_id: traceId,
          });
          return send(res, 200, JSON.stringify({ ok: true, trace_id: traceId, execution }));
        } catch (e) {
          recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 400, latencyMs: Date.now() - startedAt, outcome: 'invalid_execute_payload', errorCode: 'INVALID_EXECUTE_PAYLOAD' });
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid execute payload' }));
        }
      })
      .catch((e) => {
        recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: Date.now() - startedAt, outcome: 'execute_failed', errorCode: 'EXECUTE_FAILED' });
        return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to execute decision action' }));
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-rollout') {
    try {
      const rollout = loadLegateRollout(DATA_DIR);
      return send(res, 200, JSON.stringify({ ok: true, rollout }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legate rollout state' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/control/legate-rollout') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const expectedUpdatedAt = String(parsed && parsed.expectedUpdatedAt || '');
          const payload = parsed && parsed.rollout ? parsed.rollout : parsed;
          const rollout = saveLegateRollout(DATA_DIR, payload, { expectedUpdatedAt });
          return send(res, 200, JSON.stringify({ ok: true, rollout }));
        } catch (e) {
          if (e && e.code === 'ROLLOUT_CONFLICT') {
            return send(res, 409, JSON.stringify({ ok: false, error: 'Rollout version conflict', code: e.code, current: e.current || loadLegateRollout(DATA_DIR) }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid rollout payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save rollout state' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/control/legate-rollout/rollback') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const current = loadLegateRollout(DATA_DIR);
          const rollout = saveLegateRollout(DATA_DIR, {
            ...current,
            emergencyRollback: true,
            rollbackReason: String(parsed && parsed.reason || 'manual_rollback'),
            stage: 'shadow',
            trafficPercent: 0,
          }, { expectedUpdatedAt: parsed && parsed.expectedUpdatedAt ? String(parsed.expectedUpdatedAt) : '' });
          return send(res, 200, JSON.stringify({ ok: true, rollout }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Failed to apply rollback' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to apply rollback' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/control/legate-rollout/failback') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const current = loadLegateRollout(DATA_DIR);
          const nextStage = String(parsed && parsed.stage || 'canary');
          const nextTraffic = Number(parsed && parsed.trafficPercent != null ? parsed.trafficPercent : 10);
          const rollout = saveLegateRollout(DATA_DIR, {
            ...current,
            emergencyRollback: false,
            rollbackReason: '',
            stage: nextStage,
            trafficPercent: nextTraffic,
          }, { expectedUpdatedAt: parsed && parsed.expectedUpdatedAt ? String(parsed.expectedUpdatedAt) : '' });
          return send(res, 200, JSON.stringify({ ok: true, rollout }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Failed to apply failback' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to apply failback' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-link-reliability') {
    try {
      const snapshot = getLegateLinkReliability(DATA_DIR);
      return send(res, 200, JSON.stringify({ ok: true, reliability: snapshot }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load link reliability' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legion-scheduled') {
    try {
      const intents = loadIntents();
      const legionScheduled = intents.filter((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status));
      const items = legionScheduled.map((s) => ({
        id: s.id,
        title: s.title || s.description || '',
        objective: s.briefFields?.objective || s.title || s.description || '',
        schedule: s.schedule || null,
        dueAt: s.dueAt || null,
        lastFiredAt: s.lastFiredAt || null,
      }));
      return send(res, 200, JSON.stringify({ ok: true, items }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legion-scheduled' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/intents-failed') {
    try {
      const failedPath = path.join(DATA_DIR, 'intents-failed.json');
      let rows = [];
      if (fs.existsSync(failedPath)) {
        const raw = fs.readFileSync(failedPath, 'utf8');
        const parsed = JSON.parse(raw);
        rows = Array.isArray(parsed) ? parsed : [];
      }
      const { query } = parseUrl(req.url);
      const sinceHours = query?.sinceHours ? Number(query.sinceHours) : 24;
      const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
      const recent = rows.filter((r) => new Date(r.at || 0).getTime() >= cutoff);
      return send(res, 200, JSON.stringify({ ok: true, items: recent, total: rows.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load intents-failed' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/webhook-rules') {
    try {
      const rules = loadRules();
      return send(res, 200, JSON.stringify({ ok: true, rules }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load webhook rules' }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/control/webhook-rules') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const rule = createRule(parsed.rule || parsed);
          return send(res, 200, JSON.stringify({ ok: true, rule }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid rule payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to create rule' })));
    return;
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/control/webhook-rules/') && !pathname.endsWith('/toggle')) {
    const id = pathname.replace('/api/control/webhook-rules/', '').replace(/\/$/, '');
    if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const rule = updateRule(id, parsed.rule || parsed);
          if (!rule) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
          return send(res, 200, JSON.stringify({ ok: true, rule }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid update payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to update rule' })));
    return;
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/control/webhook-rules/')) {
    const id = pathname.replace('/api/control/webhook-rules/', '').replace(/\/$/, '');
    if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
    try {
      const deleted = deleteRule(id);
      if (!deleted) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
      return send(res, 200, JSON.stringify({ ok: true }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to delete rule' }));
    }
  }
  if (req.method === 'POST' && pathname.match(/^\/api\/control\/webhook-rules\/[^/]+\/toggle$/)) {
    const id = pathname.replace('/api/control/webhook-rules/', '').replace(/\/toggle$/, '');
    if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
    try {
      const rule = toggleRule(id);
      if (!rule) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
      return send(res, 200, JSON.stringify({ ok: true, rule }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to toggle rule' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/control/webhook-events') {
    try {
      const logPath = path.join(DATA_DIR, 'webhook-events-log.json');
      let log = [];
      if (fs.existsSync(logPath)) {
        try {
          log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        } catch (_) {}
      }
      const { query } = parseUrl(req.url);
      const limit = Math.min(100, Math.max(1, parseInt(query?.limit, 10) || 50));
      const since = query?.since ? new Date(query.since).getTime() : 0;
      const filtered = (Array.isArray(log) ? log : []).filter((e) => !since || new Date(e.at || 0).getTime() >= since);
      const items = filtered.slice(0, limit);
      return send(res, 200, JSON.stringify({ ok: true, items, total: filtered.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load webhook events' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-observability') {
    try {
      const { query } = parseUrl(req.url);
      const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
      const snapshot = getLegateObservability(DATA_DIR, { sinceHours });
      return send(res, 200, JSON.stringify(snapshot));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load observability' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-slo') {
    try {
      const { query } = parseUrl(req.url);
      const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
      const targetAvailability = query && query.targetAvailability ? Number(query.targetAvailability) : undefined;
      const targetP95Ms = query && query.targetP95Ms ? Number(query.targetP95Ms) : undefined;
      const snapshot = getLegateSloSnapshot(DATA_DIR, { sinceHours, targetAvailability, targetP95Ms });
      return send(res, 200, JSON.stringify(snapshot));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load SLO snapshot' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-observability/trace') {
    try {
      const { query } = parseUrl(req.url);
      const traceId = query && query.traceId ? String(query.traceId) : '';
      const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
      const snapshot = getLegateTraceCorrelation(DATA_DIR, { traceId, sinceHours });
      if (!snapshot.ok) return send(res, 400, JSON.stringify(snapshot));
      return send(res, 200, JSON.stringify(snapshot));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load trace correlation' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-audit-export') {
    try {
      const { query } = parseUrl(req.url);
      const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
      const cutoff = Date.now() - Math.max(1, Math.min(24 * 30, sinceHours)) * 60 * 60 * 1000;
      const decisions = listLegateDecisions(DATA_DIR, 1000).filter((d) => {
        const t = Date.parse(d && d.at || '');
        return Number.isFinite(t) && t >= cutoff;
      });
      const actionDeadLetters = listLegateActionDeadLetters(DATA_DIR, { limit: 1000 }).filter((d) => {
        const t = Date.parse(d && d.at || '');
        return Number.isFinite(t) && t >= cutoff;
      });
      const observability = getLegateObservability(DATA_DIR, { sinceHours });
      const reliability = getLegateLinkReliability(DATA_DIR);
      const slo = getLegateSloSnapshot(DATA_DIR, { sinceHours });
      const rollout = loadLegateRollout(DATA_DIR);
      return send(res, 200, JSON.stringify({
        ok: true,
        exportedAt: new Date().toISOString(),
        sinceHours: Math.max(1, Math.min(24 * 30, sinceHours)),
        reliability,
        observability,
        slo,
        rollout,
        decisions,
        actionDeadLetters,
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to build legate audit export' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/legate-action-dead-letters') {
    try {
      const { query } = parseUrl(req.url);
      const limit = query && query.limit ? Number(query.limit) : 100;
      const status = query && query.status ? String(query.status) : '';
      const rows = listLegateActionDeadLetters(DATA_DIR, { limit, status });
      return send(res, 200, JSON.stringify({ ok: true, deadLetters: rows }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load action dead letters' }));
    }
  }

  if (req.method === 'POST' && pathname.startsWith('/api/control/legate-action-dead-letters/replay/')) {
    const id = decodeURIComponent(pathname.slice('/api/control/legate-action-dead-letters/replay/'.length));
    const startedAt = Date.now();
    replayDecisionActionDeadLetter(id, { sendLegionCommand, dataDir: DATA_DIR })
      .then((out) => {
        recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 200, latencyMs: Date.now() - startedAt, outcome: 'replay_sent' });
        return send(res, 200, JSON.stringify({ ok: true, ...out }));
      })
      .catch((e) => {
        if (e && e.code === 'REPLAY_COOLDOWN') {
          recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 409, latencyMs: Date.now() - startedAt, outcome: 'replay_cooldown', errorCode: 'REPLAY_COOLDOWN' });
          return send(res, 409, JSON.stringify({ ok: false, error: e.message || 'Replay cooldown', code: e.code, deadLetter: e.deadLetter || null }));
        }
        recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 404, latencyMs: Date.now() - startedAt, outcome: 'replay_failed', errorCode: e && e.code ? e.code : 'REPLAY_FAILED' });
        return send(res, 404, JSON.stringify({ ok: false, error: e.message || 'Replay failed', code: e.code || 'REPLAY_FAILED', deadLetter: e.deadLetter || null }));
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/summary') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    const now = new Date();
    const intent = buildIntentSnapshot(now);
    const deviceId = query && query.deviceId ? String(query.deviceId).slice(0, 120) : '';
    const state = loadState();
    const device = (deviceId && state && state.devices && state.devices[deviceId]) ? state.devices[deviceId] : null;
    const ollamaHealth = await getCachedOllamaHealth();
    const cadence = decideMobilePoll({
      intentSnapshot: intent,
      device,
      serviceHealth: { modelReachable: ollamaHealth.ok },
    });
    const proactive = proactiveEngine.getStatus(5);
    const summary = proactive && proactive.summary ? proactive.summary : null;
    const mobileReliability = getMobileReliabilityMetrics({ activeWithinMin: 60, staleAfterMin: 6 * 60, ackSinceHours: 24 });
    return send(res, 200, JSON.stringify({
      ok: true,
      now: now.toISOString(),
      model: OLLAMA_MODEL,
      pollAfterSec: cadence.pollAfterSec,
      cadence: {
        urgency: cadence.urgency,
        reason: cadence.cadenceReason,
        degraded: cadence.degraded,
        degradedReasons: cadence.degradedReasons,
      },
      service: {
        modelReachable: ollamaHealth.ok,
        modelCheckedAt: ollamaHealth.checkedAt,
      },
      device: device ? {
        id: device.deviceId || deviceId,
        appState: device.appState || '',
        network: device.network || '',
        networkConstrained: device.networkConstrained === true,
        networkExpensive: device.networkExpensive === true,
        batteryLevel: Number.isFinite(Number(device.batteryLevel)) ? Number(device.batteryLevel) : null,
        cadenceEffectivePollSec: Number.isFinite(Number(device.cadenceEffectivePollSec)) ? Number(device.cadenceEffectivePollSec) : null,
      } : null,
      intent,
      proactive: summary ? {
        mode: summary.mode,
        at: summary.at,
        drafted: summary.drafted || 0,
        sent: summary.sent || 0,
        failed: summary.failed || 0,
      } : null,
      reliability: {
        activeDevices: mobileReliability.activeDevices || 0,
        staleDevices: mobileReliability.staleDevices || 0,
        pushTokenRegistered: mobileReliability.pushTokenRegistered || 0,
        pushTokenMissing: mobileReliability.pushTokenMissing || 0,
      },
    }));
  }

  if (req.method === 'POST' && pathname === '/api/mobile/device-heartbeat') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const device = upsertDeviceHeartbeat(parsed || {});
          return send(res, 200, JSON.stringify({ ok: true, device }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid heartbeat payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save heartbeat' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/push-token') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const device = registerPushToken(parsed || {});
          return send(res, 200, JSON.stringify({ ok: true, device }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid push-token payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save push token' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/push-ack') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const ack = recordPushAck(parsed || {});
          let deliveryAck = null;
          const deliveryId = parsed && parsed.deliveryId ? String(parsed.deliveryId) : '';
          if (deliveryId) {
            deliveryAck = proactiveEngine.acknowledgeDelivery(deliveryId, {
              source: 'mobile_push_ack',
              channel: parsed && parsed.channel ? parsed.channel : 'push',
              status: parsed && parsed.status ? parsed.status : 'delivered',
              ackId: ack.id,
              deviceId: parsed && parsed.deviceId ? parsed.deviceId : '',
              note: parsed && parsed.note ? parsed.note : '',
            });
          }
          return send(res, 200, JSON.stringify({ ok: true, ack, deliveryAck }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid ack payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save ack' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/live-activity') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    const now = new Date();
    const intent = buildIntentSnapshot(now);
    const ollamaHealth = await getCachedOllamaHealth();
    const cadence = decideMobilePoll({
      intentSnapshot: intent,
      serviceHealth: { modelReachable: ollamaHealth.ok },
    });
    const statusText = intent.nextReminder
      ? `Next reminder: ${intent.nextReminder.text}`
      : intent.queueLength > 0
        ? `${intent.queueLength} tasks queued`
        : 'All clear';
    return send(res, 200, JSON.stringify(toLiveActivityPayload({
      status: statusText.slice(0, 180),
      queueLength: intent.queueLength,
      remindersCount: intent.remindersCount,
      nextReminderAt: intent.nextReminder ? intent.nextReminder.at : null,
      refreshAfterSec: cadence.pollAfterSec,
      cadence: {
        urgency: cadence.urgency,
        reason: cadence.cadenceReason,
        degraded: cadence.degraded,
      },
      service: {
        modelReachable: ollamaHealth.ok,
        modelCheckedAt: ollamaHealth.checkedAt,
      },
    }, {
      generatedAt: now.toISOString(),
      refreshAfterSec: cadence.pollAfterSec,
    })));
  }

  if (req.method === 'GET' && pathname === '/api/mobile/proactive-policy') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    try {
      const policy = loadProactivePolicy();
      const version = String(policy && policy.updatedAt ? policy.updatedAt : '');
      const etag = makeWeakEtag(version);
      res.setHeader('ETag', etag);
      return send(res, 200, JSON.stringify({ ok: true, policy, version, etag }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile policy' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/mobile/proactive-policy') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const expectedUpdatedAt = (parsed && parsed.expectedUpdatedAt)
            ? String(parsed.expectedUpdatedAt)
            : parseIfMatchVersion(req.headers['if-match']);
          const current = loadProactivePolicy();
          const merged = buildMobilePolicyPatch(current, parsed && parsed.patch ? parsed.patch : {});
          const next = saveProactivePolicy(merged, { expectedUpdatedAt });
          const version = String(next && next.updatedAt ? next.updatedAt : '');
          const etag = makeWeakEtag(version);
          res.setHeader('ETag', etag);
          return send(res, 200, JSON.stringify({ ok: true, policy: next, version, etag }));
        } catch (e) {
          if (e && e.code === 'POLICY_CONFLICT') {
            const current = e.current || loadProactivePolicy();
            const version = String(current && current.updatedAt ? current.updatedAt : '');
            const etag = makeWeakEtag(version);
            res.setHeader('ETag', etag);
            return send(res, 409, JSON.stringify({
              ok: false,
              code: e.code,
              error: 'Policy version conflict',
              current,
              version,
              etag,
            }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid mobile policy patch' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to update mobile policy' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/preferences') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    const prefs = loadMobilePreferences();
    const version = String(prefs && prefs.updatedAt ? prefs.updatedAt : '');
    const etag = makeWeakEtag(version);
    res.setHeader('ETag', etag);
    return send(res, 200, JSON.stringify({ ok: true, preferences: prefs, version, etag }));
  }

  if (req.method === 'PUT' && pathname === '/api/mobile/preferences') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (PIKO_HEALTH_API_KEY && key !== PIKO_HEALTH_API_KEY) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const expectedUpdatedAt = (parsed && parsed.expectedUpdatedAt)
            ? String(parsed.expectedUpdatedAt)
            : parseIfMatchVersion(req.headers['if-match']);
          const next = saveMobilePreferences(parsed && parsed.preferences ? parsed.preferences : parsed, expectedUpdatedAt);
          const version = String(next && next.updatedAt ? next.updatedAt : '');
          const etag = makeWeakEtag(version);
          res.setHeader('ETag', etag);
          return send(res, 200, JSON.stringify({ ok: true, preferences: next, version, etag }));
        } catch (e) {
          if (e && e.code === 'PREFERENCES_CONFLICT') {
            const current = e.current || loadMobilePreferences();
            const version = String(current && current.updatedAt ? current.updatedAt : '');
            const etag = makeWeakEtag(version);
            res.setHeader('ETag', etag);
            return send(res, 409, JSON.stringify({
              ok: false,
              code: e.code,
              error: 'Preferences version conflict',
              current,
              version,
              etag,
            }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid mobile preferences payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save mobile preferences' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/control/mobile-devices') {
    try {
      const { query } = parseUrl(req.url);
      const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
      const out = listDevices(limit);
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile devices' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/mobile-reliability') {
    try {
      const { query } = parseUrl(req.url);
      const activeWithinMin = Math.max(5, Math.min(24 * 60, parseInt(query && query.activeWithinMin, 10) || 60));
      const staleAfterMin = Math.max(10, Math.min(7 * 24 * 60, parseInt(query && query.staleAfterMin, 10) || 6 * 60));
      const ackSinceHours = Math.max(1, Math.min(24 * 30, parseInt(query && query.ackSinceHours, 10) || 24));
      const out = getMobileReliabilityMetrics({ activeWithinMin, staleAfterMin, ackSinceHours });
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile reliability metrics' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/connectors') {
    const connectorIds = listConnectors();
    const health = await getConnectorHealth(buildConnectorContext());
    return send(res, 200, JSON.stringify({ ok: true, connectors: connectorIds, health }));
  }

  if (req.method === 'GET' && pathname === '/api/control/connector-health') {
    const health = await getConnectorHealth(buildConnectorContext());
    return send(res, 200, JSON.stringify({ ok: true, connectors: health }));
  }

  const connectorStatusMatch = req.method === 'GET' && pathname.match(/^\/api\/control\/connectors\/([^/]+)\/status$/);
  if (connectorStatusMatch) {
    const connectorId = decodeURIComponent(connectorStatusMatch[1] || '').trim();
    const out = await invokeConnector(connectorId, 'status', buildConnectorContext(), {});
    if (!out.ok) {
      const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
      return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
    }
    return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, status: out.result || {} }));
  }

  const connectorListMatch = req.method === 'GET' && pathname.match(/^\/api\/control\/connectors\/([^/]+)\/list$/);
  if (connectorListMatch) {
    const connectorId = decodeURIComponent(connectorListMatch[1] || '').trim();
    const { query } = parseUrl(req.url);
    const params = {
      limit: query && query.limit,
    };
    const out = await invokeConnector(connectorId, 'list', buildConnectorContext(), params);
    if (!out.ok) return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
    return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, ...out.result }));
  }

  const connectorPullMatch = req.method === 'GET' && pathname.match(/^\/api\/control\/connectors\/([^/]+)\/pull$/);
  if (connectorPullMatch) {
    const connectorId = decodeURIComponent(connectorPullMatch[1] || '').trim();
    const { query } = parseUrl(req.url);
    const params = {
      id: query && query.id,
      messageId: query && query.messageId,
      eventId: query && query.eventId,
    };
    const out = await invokeConnector(connectorId, 'pull', buildConnectorContext(), params);
    if (!out.ok) return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
    return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, ...out.result }));
  }

  const connectorActMatch = req.method === 'POST' && pathname.match(/^\/api\/control\/connectors\/([^/]+)\/act$/);
  if (connectorActMatch) {
    const connectorId = decodeURIComponent(connectorActMatch[1] || '').trim();
    readBody(req)
      .then(async (body) => {
        try {
          const params = body ? JSON.parse(body) : {};
          const out = await invokeConnector(connectorId, 'act', buildConnectorContext(), params || {});
          if (!out.ok) {
            const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
            return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
          }
          return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, result: out.result }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: e.message || 'Invalid payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, connector: connectorId, error: e.message || 'Connector act failed' })));
    return;
  }

  const connectorDisconnectMatch = req.method === 'POST' && pathname.match(/^\/api\/control\/connectors\/([^/]+)\/disconnect$/);
  if (connectorDisconnectMatch) {
    const connectorId = decodeURIComponent(connectorDisconnectMatch[1] || '').trim();
    const out = await invokeConnector(connectorId, 'disconnect', buildConnectorContext(), {});
    if (!out.ok) {
      const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
      return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
    }
    return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, result: out.result }));
  }

  if (req.method === 'GET' && pathname === '/api/control/proactive-events') {
    try {
      const { query } = parseUrl(req.url);
      const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
      const status = query && query.status ? String(query.status).trim() : '';
      const type = query && query.type ? String(query.type).trim() : '';
      const since = query && query.since ? String(query.since).trim() : '';
      const out = proactiveEngine.getStatus({ limit, status, type, since });
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive events' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/control/proactive-engine/run') {
    proactiveCycleRunner.run('manual', { skipIfBusy: true })
      .then((out) => {
        if (out && out.skipped) {
          return send(res, 409, JSON.stringify({
            ok: false,
            skipped: true,
            reason: out.reason || 'busy',
            activeSource: out.activeSource || '',
            activeForMs: Number(out.activeForMs || 0),
          }));
        }
        return send(res, 200, JSON.stringify({ ok: true, summary: out.summary, durationMs: out.durationMs }));
      })
      .catch((e) => {
        const status = e && e.code === 'PROACTIVE_CYCLE_TIMEOUT' ? 504 : 500;
        return send(res, status, JSON.stringify({ ok: false, code: e.code || '', error: e.message || 'Failed to run proactive engine' }));
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/control/proactive-deliveries') {
    try {
      const { query } = parseUrl(req.url);
      const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
      const status = query && query.status ? String(query.status) : '';
      const out = proactiveEngine.getDeliveries(limit, status);
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive deliveries' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/proactive-dead-letters') {
    try {
      const { query } = parseUrl(req.url);
      const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
      const status = query && query.status ? String(query.status) : '';
      const out = proactiveEngine.getDeadLetters(limit, status);
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive dead letters' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/control/proactive-reliability') {
    try {
      const { query } = parseUrl(req.url);
      const sinceHours = Math.max(1, Math.min(24 * 30, parseInt(query && query.sinceHours, 10) || 24));
      const repeatThreshold = Math.max(2, Math.min(100, parseInt(query && query.repeatThreshold, 10) || 3));
      const out = proactiveEngine.getReliabilityMetrics({ sinceHours, repeatThreshold });
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive reliability metrics' }));
    }
  }

  if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-deliveries/') && pathname.endsWith('/ack')) {
    const id = decodeURIComponent(pathname.slice('/api/control/proactive-deliveries/'.length, -('/ack'.length)));
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const out = proactiveEngine.acknowledgeDelivery(id, {
            source: parsed && parsed.source ? parsed.source : 'api',
            channel: parsed && parsed.channel ? parsed.channel : 'manual',
            status: parsed && parsed.status ? parsed.status : 'acknowledged',
            ackType: parsed && parsed.ackType ? parsed.ackType : 'seen',
            ackId: parsed && parsed.ackId ? parsed.ackId : '',
            deviceId: parsed && parsed.deviceId ? parsed.deviceId : '',
            userResponse: parsed && parsed.userResponse ? parsed.userResponse : '',
            note: parsed && parsed.note ? parsed.note : '',
          });
          return send(res, 200, JSON.stringify({ ok: true, ...out }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Ack failed' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to process ack payload' })));
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-replay/')) {
    const id = decodeURIComponent(pathname.slice('/api/control/proactive-replay/'.length));
    proactiveEngine.replayDelivery(id, 'api')
      .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
      .catch((e) => {
        const status = e && (e.code === 'REPLAY_COOLDOWN' || e.code === 'REPLAY_IN_PROGRESS') ? 429 : 404;
        return send(res, status, JSON.stringify({ ok: false, code: e.code || '', error: e.message || 'Replay failed' }));
      });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-dead-letters/replay/')) {
    const id = decodeURIComponent(pathname.slice('/api/control/proactive-dead-letters/replay/'.length));
    proactiveEngine.replayDeadLetter(id, 'api_dead_letter_replay')
      .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
      .catch((e) => send(res, 404, JSON.stringify({ ok: false, error: e.message || 'Dead-letter replay failed' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/control/proactive-dispatch/test') {
    readBody(req)
      .then((body) => {
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid JSON' }));
        }
        proactiveEngine.dispatchTest(parsed || {})
          .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
          .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Dispatch test failed' })));
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to read body' })));
    return;
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
    const registry = loadRegistry();
    return send(res, 200, JSON.stringify({
      primary: process.env.MODEL_PRIMARY || OLLAMA_MODEL,
      currentOverride: getCurrentModelOverride(),
      registry: {
        updatedAt: registry.updatedAt,
        stages: registry.stages,
        lastStable: registry.lastStable,
      },
      available: [
        'ollama/llama3.1:latest',
        'ollama/llama3.2',
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4o-mini',
      ],
    }));
  }

  if (req.method === 'GET' && pathname === '/api/control/model-registry') {
    const registry = loadRegistry();
    return send(res, 200, JSON.stringify({ ok: true, registry }));
  }

  if (req.method === 'GET' && pathname === '/api/control/modelops/overview') {
    try {
      const overview = getModelOpsOverview();
      return send(res, 200, JSON.stringify({ ok: true, overview }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load modelops overview' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/control/model-registry/register-model') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const modelTag = String(parsed.modelTag || '').trim();
          if (!modelTag) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing modelTag' }));
          const next = upsertModel(modelTag, {
            notes: parsed.notes ? String(parsed.notes).slice(0, 500) : '',
            status: parsed.status ? String(parsed.status).slice(0, 40) : 'registered',
            source: parsed.source ? String(parsed.source).slice(0, 80) : 'manual',
          });
          return send(res, 200, JSON.stringify({ ok: true, registry: next }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to register model' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/control/model-registry/promote') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const targetStage = String(parsed.toStage || '').trim();
          const latestGate = targetStage === 'candidate' ? getLatestGateEvaluation() : null;
          if (
            targetStage === 'candidate'
            && MODEL_GATE_BLOCK_CANDIDATE
            && latestGate
            && latestGate.pass === false
            && !parsed.allowUnsafe
          ) {
            return send(res, 409, JSON.stringify({
              ok: false,
              code: 'GATE_BLOCKED',
              error: 'Candidate promotion blocked by failed gate',
              gate: latestGate,
            }));
          }
          const next = promoteModel({
            modelTag: parsed.modelTag,
            toStage: targetStage,
            by: parsed.by || 'api',
            notes: parsed.notes || '',
            allowUnsafe: !!parsed.allowUnsafe,
          });
          if (targetStage === 'primary') {
            setCurrentModelOverride(parsed.modelTag);
          }
          let warning = null;
          if (targetStage === 'candidate' && latestGate && latestGate.pass === false) {
            warning = {
              code: 'GATE_FAILED_SOFT',
              message: 'Candidate promotion succeeded, but latest gate did not pass.',
              gate: {
                id: latestGate.id || '',
                createdAt: latestGate.createdAt || '',
                pass: false,
                reasons: Array.isArray(latestGate.reasons) ? latestGate.reasons : [],
                metrics: latestGate.metrics || {},
              },
            };
          }
          return send(res, 200, JSON.stringify({
            ok: true,
            registry: next,
            gate: latestGate,
            warning,
          }));
        } catch (e) {
          const code = e.code || '';
          const status = (code === 'UNKNOWN_MODEL' || code === 'INVALID_STAGE' || code === 'INVALID_PROMOTION_PATH') ? 400 : 500;
          return send(res, status, JSON.stringify({ ok: false, error: e.message || 'Promotion failed', code }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Promotion failed' })));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/control/model-registry/rollback') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const next = rollbackModel({
            by: parsed.by || 'api',
            notes: parsed.notes || '',
            targetModel: parsed.targetModel || '',
          });
          if (next.stages && next.stages.primary) {
            setCurrentModelOverride(next.stages.primary);
          }
          return send(res, 200, JSON.stringify({ ok: true, registry: next }));
        } catch (e) {
          const code = e.code || '';
          const status = (code === 'NO_ROLLBACK_TARGET' || code === 'UNKNOWN_MODEL') ? 400 : 500;
          return send(res, status, JSON.stringify({ ok: false, error: e.message || 'Rollback failed', code }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Rollback failed' })));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/widget') {
    const widget = { tensions: 0, nextReminder: null, moltbook: null };
    const generatedAt = new Date().toISOString();
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
    return send(res, 200, JSON.stringify(toWidgetPayload(widget, {
      generatedAt,
      refreshAfterSec: 300,
    })));
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
    return send(res, 200, JSON.stringify(toIosDashboardPayload(dashboard, {
      generatedAt: new Date().toISOString(),
      refreshAfterSec: 300,
    })));
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
    const prefs = loadMobilePreferences();
    return send(res, 200, JSON.stringify(prefs));
  }
  if (req.method === 'PUT' && pathname === '/api/ea-preferences') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const next = saveMobilePreferences(data, data && data.expectedUpdatedAt ? String(data.expectedUpdatedAt) : '');
        return send(res, 200, JSON.stringify(next));
      } catch (e) {
        if (e && e.code === 'PREFERENCES_CONFLICT') {
          return send(res, 409, JSON.stringify({ error: 'Preferences version conflict', code: e.code, current: e.current || loadMobilePreferences() }));
        }
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
    let connectorHealth = {};
    try {
      connectorHealth = await getConnectorHealth(buildConnectorContext());
    } catch (_) {}
    let mobileDevices = { totalDevices: 0, devices: [] };
    try {
      mobileDevices = listDevices(5);
    } catch (_) {}
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
    let proactive = null;
    try {
      proactive = proactiveEngine.getStatus(10);
    } catch (_) {}
    const payload = {
      health: { ollama: ollamaOk, model: OLLAMA_MODEL },
      integrations,
      connectorHealth,
      mobileDevices: {
        totalDevices: mobileDevices.totalDevices || 0,
        recent: Array.isArray(mobileDevices.devices) ? mobileDevices.devices.slice(0, 5) : [],
      },
      proactive: proactive ? {
        summary: proactive.summary,
        recentEvents: (proactive.events || []).slice(0, 5),
      } : null,
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
    (async () => {
      try {
        const { flushSessionToVectorMemory } = require('./lib/vectorMemory');
        await flushSessionToVectorMemory(sid);
      } catch (_) {}
      sessionStore.clear(sid);
      log('info', 'session-reset', { sessionId: sid }, req.requestId);
      return send(res, 200, JSON.stringify({ ok: true, message: 'Session history cleared.' }));
    })().catch((e) => {
      log('error', 'session-reset', { error: e.message, sessionId: sid }, req.requestId);
      return send(res, 500, JSON.stringify({ error: e.message }));
    });
    return;
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

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Piko WebChat http://0.0.0.0:${PORT} (Ollama: ${OLLAMA_MODEL})`);
  try {
    const { startFridayCloser } = require('./scripts/fridayCloser');
    startFridayCloser();
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Friday Closer:', e.message);
  }
  try {
    const { startProactiveLoop } = require('./scripts/proactiveThinker');
    startProactiveLoop();
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Proactive Thinker:', e.message);
  }
  // Boot warm-up: load model into VRAM with keep_alive: -1 so first user request is fast
  const warmModel = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
  ollamaNativeChat(warmModel, [{ role: 'user', content: 'hi' }], { max_tokens: 2 })
    .then(() => { if (process.env.PIKO_LOG_PLANNER === '1') console.log('[boot] Ollama model warmed'); })
    .catch((e) => { if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Ollama warm-up:', e.message); });
  const { loadManifest } = require('./lib/knowledgeManifest');
  const manifest = loadManifest(__dirname);
  if (!manifest.fromFile) {
    console.log('[knowledge] No manifest at knowledge/manifest.json — using defaults. For platform-agnostic config, add knowledge/ and restart. See docs/PLATFORM_AGNOSTICISM_AUDIT.md');
  }
  const { discoverCapabilities } = require('./lib/legionAdapterDiscovery');
  discoverCapabilities(__dirname)
    .then((caps) => {
      if (caps.length > 0) console.log('[legionDiscovery] Discovered', caps.length, 'capabilities from Legion + adapters');
    })
    .catch((e) => {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionDiscovery]', e.message);
    });
  if (HISTORY_DIR) console.log('[history] Nightly dumps to', HISTORY_DIR);
  runUnifiedHeartbeat();
  proactiveCycleRunner.run('boot', { skipIfBusy: true }).catch((e) => {
    log('error', 'proactive_cycle_boot', { code: e.code || '', message: e.message });
  });
  cron.schedule('*/5 * * * *', runUnifiedHeartbeat);

  // The Watchman — every 5 mins: evaluate tripwires
  cron.schedule('*/5 * * * *', async () => {
    const { evaluateTripwires } = require('./lib/tripwireEngine');
    try {
      await evaluateTripwires(async (alertMessage) => {
        console.log('[TRIPWIRE TRIGGERED]:', alertMessage.slice(0, 120) + (alertMessage.length > 120 ? '…' : ''));
        await telegramNotify(alertMessage);
      });
    } catch (e) {
      log('error', 'tripwire_eval', { message: e.message });
    }
  });

  // The Daily Digest — every minute: check dynamic schedules
  cron.schedule('* * * * *', async () => {
    const { loadSchedules, saveSchedules, flushDailyDigest } = require('./lib/tripwireEngine');
    const schedules = loadSchedules();
    if (schedules.length === 0) return;
    const now = new Date();
    const currentDateString = now.toDateString();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let schedulesUpdated = false;
    for (const sched of schedules) {
      const [schedH, schedM] = sched.time.split(':').map(Number);
      const schedMinutes = (schedH || 0) * 60 + (schedM || 0);
      if (currentMinutes >= schedMinutes && sched.lastSentDate !== currentDateString) {
        try {
          await flushDailyDigest(async (reportMessage) => {
            console.log('[DAILY DIGEST TO USER]:', reportMessage.slice(0, 80) + '…');
            await telegramNotify(reportMessage);
          });
          sched.lastSentDate = currentDateString;
          schedulesUpdated = true;
        } catch (e) {
          console.error('[DIGEST] Failed:', e.message);
        }
      }
    }
    if (schedulesUpdated) saveSchedules(schedules);
  });

  // The Urgency Engine — every 30 mins during work hours (9am–5pm)
  cron.schedule('*/30 9-17 * * *', async () => {
    const { runInternalMonologue } = require('./lib/urgencyEngine');
    try {
      await runInternalMonologue(async (msg) => await telegramNotify(msg));
    } catch (e) {
      log('error', 'urgency_engine', { message: e.message });
    }
  });

  // The Weekly PO — Thursdays at 4 PM
  cron.schedule('0 16 * * 4', async () => {
    const { flushWeeklyPO } = require('./lib/tripwireEngine');
    try {
      await flushWeeklyPO(async (reportMessage) => {
        await telegramNotify(reportMessage);
      });
    } catch (e) {
      console.error('[WEEKLY PO] Failed:', e.message);
    }
  });

  cron.schedule('* * * * *', () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today > lastDumpDate) {
      dumpHistory(lastDumpDate);
      lastDumpDate = today;
    }
  });

  cron.schedule('*/5 * * * *', () => {
    proactiveCycleRunner.run('scheduler', { skipIfBusy: true }).catch((e) => {
      log('error', 'proactive_cycle', { code: e.code || '', message: e.message });
    });
  });
  cron.schedule('*/5 * * * *', () => {
    const cwd = __dirname;
    exec('node scripts/intent-poller.js', { cwd, env: process.env, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) log('error', 'intent_poller', { message: err.message }, null);
    });
  });
  // Phase 3: continuous mind loop — processes due intents every 60s when ReAct agent enabled
  const useReAct = process.env.PIKO_USE_REACT_AGENT === '1' || process.env.PIKO_USE_REACT_AGENT === 'true';
  if (useReAct) {
    const { fork } = require('child_process');
    const mindPath = path.join(__dirname, 'workers', 'pikoMind.js');
    const mindProcess = fork(mindPath, [], { env: process.env, cwd: __dirname });
    mindProcess.on('error', (err) => console.error('[pikoMind] spawn error:', err.message));
    mindProcess.on('exit', (code, sig) => {
      if (code !== 0 && code !== null) console.warn('[pikoMind] exited', code, sig);
    });
    if (process.env.PIKO_LOG_PLANNER === '1') console.log('[boot] Mind loop spawned');
  }
  // Moltbook disabled — no longer maintained. Removed cron to avoid 403s and event-loop churn.
  // let moltbookPosterRunning = false;
  // const runMoltbookPoster = () => { ... };
  // cron.schedule('0,30 * * * *', runMoltbookPoster);
  cron.schedule('0 2 * * *', () => {
    require('./scripts/nightly_wisdom').runNightlyWisdom().catch((e) => log('error', 'nightly_wisdom', { message: e.message }));
  });
  // Nightly Quant Agent — 1 AM: run statistical forecasts, write all SKUs to agent_forecasts
  cron.schedule('0 1 * * *', async () => {
    console.log('[CRON] Waking up Quant Agent for nightly batch forecast...');
    try {
      const { deploySubAgent } = require('./lib/legionSwarm');
      const taskContext = 'Deploy the quant agent to run our statistical forecasts and write all SKUs to the database.';
      const result = await deploySubAgent('quant', taskContext);
      const { sendToAdmin } = require('./lib/telegramNotifier');
      if (result && !result.startsWith('Error:') && !result.includes('Failed after')) {
        await sendToAdmin('🌙 **Nightly Math Complete:**\nI just finished running the 1 AM statistical forecasts across the catalog. Database is updated for today!');
      } else {
        console.error('[CRON] Quant Agent failed:', result || 'No result');
        const errSnippet = (result || '').slice(0, 500);
        await sendToAdmin('⚠️ **Nightly Quant Agent:** The forecast run encountered an issue.\n\n' + (errSnippet || 'Check logs for details.'));
      }
    } catch (e) {
      console.error('[CRON] Quant Agent failed:', e.message);
      const { sendToAdmin } = require('./lib/telegramNotifier');
      await sendToAdmin('⚠️ **Nightly Quant Agent Failed:** ' + (e.message || 'Unknown error')).catch(() => {});
    }
  });
  cron.schedule('0 3 * * *', () => {
    beliefLoop.runBeliefConsolidation()
      .then(() => memory.pruneEpisodicOlderThanDays())
      .then(() => beliefLoop.resolveBeliefConflicts())
      .catch((e) => log('error', 'belief_consolidation', { message: e.message }));
  });
  cron.schedule('0 3 * * 0', () => {
    require('./scripts/memoryConsolidation').consolidateSoul().catch((e) => log('error', 'memory_consolidation', { message: e.message }));
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
  console.log('[heartbeat] Watchman 5min; Daily Digest 1min; Weekly PO Thu 4PM; Urgency 30min 9–17; intent poller 5min; nightly wisdom 2AM; belief 3AM; SOUL consolidation Sun 3AM; weekly retro Sun 8AM');
});
