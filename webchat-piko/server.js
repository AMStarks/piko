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
try {
  require('./lib/opsMetrics').installProcessHandlers();
} catch (_) { /* non-fatal */ }
const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const { exec, execSync, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const {
  includesAny,
  toLowerAsciiish,
  collapseWhitespace,
  startsWithAny,
  isSafeName,
  extractDigitRuns,
  parseHhMm,
  splitLines,
  squeezeBlankLines,
  hasHttpUrl,
  isAsciiDigit,
  isAsciiLetter,
  isHexChar,
  hasWord,
  hasAnyWord,
  normalizeApostrophes,
  stripTrailingSlash,
  removeNewlines,
  isAllAsciiDigits,
  startsWithYyyyMmDd,
  isYyyyMm,
  isUuidLike,
  isSafePathPrefix,
  matchPath,
  splitMarkdownH2,
  stripListMarker,
  stripCodeFences,
  upsertEnvLine,
  removeEnvLine,
  envHasKey,
  replaceAllLiteral,
  keepLettersDigitsSpaces,
  stripTrailingPunct,
  endsWithAny,
  parseClockMention,
} = require('./lib/text');
const { parseSlashCommand } = require('./lib/slashCommands');

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
const PIKO_HEAVY_MODEL = String(process.env.PIKO_HEAVY_MODEL || process.env.PIKO_LEGION_MODEL || '').trim() || OLLAMA_MODEL;
const { ai, aiStream, ollamaNativeChat, MODEL_PRIMARY } = require('./lib/llm');
const yoloBridge = require('./lib/yoloBridge');
const opsMonitor = require('./lib/opsMonitor');
const pikoUpload = require('./lib/pikoUpload');
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
const DATA_DIR = process.env.PIKO_DATA_DIR
  ? path.resolve(process.env.PIKO_DATA_DIR)
  : path.join(__dirname, 'data');
const { getTenantBackgroundProfile, isBackgroundJobEnabled } = require('./lib/tenantBackgroundJobs');
const TENANT_BG = getTenantBackgroundProfile(__dirname);
/** High Architect manifest from `piko_core.generate_app_manifest()` (repo root by default). */
const PIKO_STATE_MANIFEST_PATH = process.env.PIKO_STATE_MANIFEST_PATH || path.join(__dirname, '..', 'piko_state.json');
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
const { acquireSessionLock } = require('./lib/sessionLock');

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
// 1.5s flagged healthy-but-cold models (esp. remote inference lanes) as
// "unreachable" on the dashboards; a real outage still fails fast at connect.
const OLLAMA_HEALTH_TIMEOUT_MS = Math.max(500, Number(process.env.PIKO_OLLAMA_HEALTH_TIMEOUT_MS || 8000));
let ollamaHealthCache = { checkedAtMs: 0, ok: null };

// Self-heal (optional): if the model is repeatedly unreachable, restart Ollama once per cooldown.
const OLLAMA_SELF_HEAL_ENABLED = String(process.env.PIKO_OLLAMA_SELF_HEAL || '').trim() === '1' || String(process.env.PIKO_OLLAMA_SELF_HEAL || '').trim().toLowerCase() === 'true';
const OLLAMA_SELF_HEAL_FAILURES = Math.max(1, Number(process.env.PIKO_OLLAMA_SELF_HEAL_FAILURES || 3));
const OLLAMA_SELF_HEAL_COOLDOWN_MS = Math.max(30_000, Number(process.env.PIKO_OLLAMA_SELF_HEAL_COOLDOWN_MS || (10 * 60 * 1000)));
const OLLAMA_SELF_HEAL_COMMAND = String(process.env.PIKO_OLLAMA_SELF_HEAL_COMMAND || 'docker restart ollama').trim();
let ollamaSelfHealState = { consecutiveFailures: 0, lastHealAtMs: 0 };

function maybeTriggerOllamaSelfHeal(reason) {
  if (!OLLAMA_SELF_HEAL_ENABLED) return;
  const now = Date.now();
  if (ollamaSelfHealState.consecutiveFailures < OLLAMA_SELF_HEAL_FAILURES) return;
  if ((now - ollamaSelfHealState.lastHealAtMs) < OLLAMA_SELF_HEAL_COOLDOWN_MS) return;
  ollamaSelfHealState.lastHealAtMs = now;
  try {
    const { exec } = require('child_process');
    exec(OLLAMA_SELF_HEAL_COMMAND, { timeout: 20_000 }, (err, stdout, stderr) => {
      const msg = String((stdout || stderr || '')).trim().slice(0, 500);
      if (err) {
        console.error('[self-heal] Ollama restart failed:', err.message, msg);
      } else {
        console.log('[self-heal] Ollama restart triggered:', reason || 'unreachable', msg);
      }
    });
  } catch (e) {
    console.error('[self-heal] exec unavailable:', e.message);
  }
}

// Manifest refresh (optional): generate/update `piko_state.json` on the host that owns the Legion DB.
// This keeps the iOS HUD "Legion Ledger" visible without manual SSH.
const MANIFEST_REFRESH_ENABLED = String(process.env.PIKO_STATE_MANIFEST_REFRESH || '').trim() === '1' || String(process.env.PIKO_STATE_MANIFEST_REFRESH || '').trim().toLowerCase() === 'true';
const MANIFEST_REFRESH_SEC = Math.max(60, Number(process.env.PIKO_STATE_MANIFEST_REFRESH_SEC || 300));
const MANIFEST_REFRESH_COMMAND = String(
  process.env.PIKO_STATE_MANIFEST_REFRESH_COMMAND ||
  "cd /root/projects/Piko && python3 -c \"import piko_core; print(piko_core.generate_app_manifest(25))\""
).trim();
let manifestRefreshInFlight = false;

function startManifestRefreshLoop() {
  if (!MANIFEST_REFRESH_ENABLED) return;
  if (!isBackgroundJobEnabled('manifest_refresh', __dirname)) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log('[manifest-refresh] skipped — not enabled for tenant profile', TENANT_BG.profileId);
    }
    return;
  }
  const { exec } = require('child_process');
  const run = () => {
    if (manifestRefreshInFlight) return;
    manifestRefreshInFlight = true;
    exec(MANIFEST_REFRESH_COMMAND, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String((stderr || stdout || '')).trim().slice(0, 500);
        console.error('[manifest-refresh] failed:', err.message, msg);
      } else if (process.env.PIKO_LOG_PLANNER === '1') {
        const msg = String((stdout || '')).trim().slice(0, 200);
        console.log('[manifest-refresh] ok:', msg);
      }
      manifestRefreshInFlight = false;
    });
  };
  // Fire once at boot, then on interval.
  setTimeout(run, 2000);
  setInterval(run, MANIFEST_REFRESH_SEC * 1000).unref?.();
}

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
  if (!envHasKey(envContent, key)) {
    delete process.env[key];
    return true;
  }
  envContent = removeEnvLine(envContent, key);
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
const PIKO_BASE_URL = stripTrailingSlash(process.env.PIKO_BASE_URL || ''); // optional; e.g. https://piko.example.com for OAuth redirect
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
  const safeValue = removeNewlines(String(value)).trim();
  envContent = upsertEnvLine(envContent, key, safeValue);
  try {
    fs.writeFileSync(envPath, envContent.endsWith('\n') ? envContent : envContent + '\n', 'utf8');
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
  // Tenant persona pack files (data dir) shadow the repo prompts, so a code
  // release never clobbers a tenant's personality.
  const { readPersonaFile } = require('./lib/personaPack');
  const identity = readPersonaFile('IDENTITY.md', PROMPTS_DIR);
  const soul = readPersonaFile('SOUL.md', PROMPTS_DIR);
  const memory = readPersonaFile('MEMORY.md', PROMPTS_DIR);
  const interests = readPersonaFile('INTERESTS.md', PROMPTS_DIR);
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
    const blocks = splitMarkdownH2(raw).filter(Boolean);
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
    const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const ideas = lines.map((l) => stripListMarker(l)).filter((l) => l.length >= 5).slice(-STICKY_SNIPPET_ITEMS);
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
      const oneLine = collapseWhitespace(raw);
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

/** Culture-spine corpus RAG + structured notes for research questions. */
async function getRagContextAsync(query) {
  const parts = [];
  try {
    const profile = getTenantBackgroundProfile(__dirname);
    if (profile && profile.isCulture) {
      const { getCorpusRagContext } = require('./lib/eiCorpusRag');
      const corpus = await getCorpusRagContext(query);
      if (corpus) parts.push(corpus);
      const { getNotesContextForGoal } = require('./lib/eiCorpusNotes');
      const notes = getNotesContextForGoal(query);
      if (notes) parts.push(notes);
    }
  } catch (_) { /* optional */ }
  return parts.filter(Boolean).join('\n\n');
}

/** Simple RAG: scan data/learning/*.md, score chunks by keyword overlap with query, return top N chunks. Disabled if PIKO_RAG=0. */
function getRagContext(query) {
  if (!PIKO_RAG_ENABLED || !query || typeof query !== 'string') return '';
  const q = keepLettersDigitsSpaces(query.toLowerCase()).split(' ').filter((w) => w.length > 2);
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
      const h2 = splitMarkdownH2(raw);
      const blocks = [];
      if (h2.length) {
        for (const b of h2) if (b.trim().length >= 20) blocks.push(b);
      } else {
        let buf = '';
        for (const line of splitLines(raw)) {
          if (!line.trim()) {
            if (buf.trim().length >= 20) blocks.push(buf);
            buf = '';
          } else buf += (buf ? '\n' : '') + line;
        }
        if (buf.trim().length >= 20) blocks.push(buf);
      }
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
  createLegionScheduleIntent,
  createLegionScheduledWithTask,
  listLegionScheduleIntents,
  updateIntent,
  parseDuration,
  nextDueFromSchedule,
} = require('./lib/intents.js');

/** Normalize natural-language schedule from LLM to canonical format for nextDueFromSchedule. */
function normalizeSchedule(s) {
  if (!s || typeof s !== 'string') return s;
  let out = collapseWhitespace(toLowerAsciiish(s));
  out = replaceAllLiteral(out, 'every hour from ', 'hourly ');
  out = replaceAllLiteral(out, 'every hour between ', 'hourly ');
  out = replaceAllLiteral(out, ' to ', '-');
  out = replaceAllLiteral(out, ' and ', '-');
  out = replaceAllLiteral(out, ' at ', ' ');
  out = collapseWhitespace(out);
  if (out.endsWith(' daily')) out = out.slice(0, -6).trim();
  const tokens = out.split(' ');
  const converted = tokens.map((tok) => {
    let t = tok;
    let ampm = '';
    const low = t.toLowerCase();
    if (low.endsWith('am') || low.endsWith('pm')) {
      ampm = low.slice(-2);
      t = t.slice(0, -2);
    }
    if (!t) return tok;
    const parts = t.split(':');
    const hStr = parts[0];
    const mStr = parts[1];
    if (!isAllAsciiDigits(hStr) || hStr.length > 2) return tok;
    if (mStr != null && (mStr.length !== 2 || !isAllAsciiDigits(mStr))) return tok;
    if (!ampm && mStr == null) return tok;
    let hour = parseInt(hStr, 10);
    const min = mStr || '00';
    if (ampm === 'am') hour = hour === 12 ? 0 : hour;
    if (ampm === 'pm') hour = hour === 12 ? 12 : hour + 12;
    return String(hour).padStart(2, '0') + ':' + min;
  });
  return converted.join(' ').trim();
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
const { handleLaskoModerationRoute } = require('./lib/routes/laskoModeration');
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
  const trimmed = (() => { let s = userPath.trim(); while (s.startsWith('/')) s = s.slice(1); return s; })();
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
  const text = toLowerAsciiish(message);
  const slash = parseSlashCommand(message);
  if (slash && slash.kind === 'learning') return true;
  return includesAny(text, [
    'have you been learning',
    'learned anything',
    'learned much',
    'what have you been learning',
    'what have you learned',
    'what did you learn',
    'what are you learning',
    'tell me about recent learning',
    'tell me about your learning',
    'tell me your recent learning',
    "what's your recent learning",
    'whats your recent learning',
    'anything new you',
    'anything interesting you',
    'recent learning',
    'rabbit hole',
    'rabbit-hole',
  ]) || (text.includes('learn') && includesAny(text, ['anything new', 'anything interesting']));
}
function isSimpleStatusAck(message) {
  let text = String(message || '').trim().toLowerCase();
  if (!text || text.includes('?')) return false;
  while (text.length && (text.endsWith('.') || text.endsWith('!'))) text = text.slice(0, -1);
  text = text.trim();
  const acks = [
    'so far so good', 'so far, so good', 'all good', 'good thanks', 'doing good', 'doing well',
    'not bad', 'pretty good', 'fine thanks', 'same here', 'sounds good', 'nice', 'cool',
    'ok', 'okay', 'alright', 'cheers', 'thanks',
  ];
  return acks.includes(text);
}
function pickBySeed(items, seed) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return items[h % items.length];
}
function isToneDriftComplaint(message) {
  const text = toLowerAsciiish(message);
  if (!text.includes('?')) return false;
  return hasAnyWord(text, ['random', 'weird', 'disjointed', 'off', 'odd', 'strange']);
}
function buildLearningUpdateReply() {
  const fallback = "Lately I've been testing conversational reliability and agent orchestration workflows.";
  try {
    if (!fs.existsSync(RABBIT_HOLE_NOTES_FILE)) return fallback;
    const raw = fs.readFileSync(RABBIT_HOLE_NOTES_FILE, 'utf8');
    const blocks = splitMarkdownH2(raw).filter(Boolean);
    const last = (blocks.slice(-1)[0] || '').trim();
    if (!last) return fallback;
    const lines = splitLines(last).map((l) => l.trim()).filter(Boolean);
    const candidate = lines.find((l) => !l.startsWith('#') && !startsWithYyyyMmDd(l) && l.length > 15) || '';
    let clean = stripListMarker(candidate);
    let out2 = '';
    for (const ch of clean) {
      if (ch === '`' || ch === '*' || ch === '_' || ch === '#') continue;
      out2 += ch;
    }
    clean = collapseWhitespace(out2);
    if (!clean) return fallback;
    const out = clean.slice(0, 180);
    return endsWithAny(out, ['.', '!', '?']) ? out : out + '.';
  } catch (_) {
    return fallback;
  }
}
const { isAllowedByAllowlist } = require('./lib/channelAllowlist');

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

function stripCancelPrefix(message) {
  let s = String(message || '').trim();
  const low = toLowerAsciiish(s);
  for (const p of ['can you please ', 'please ']) {
    if (low.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  const low2 = toLowerAsciiish(s);
  for (const p of ['cancel', 'delete', 'remove']) {
    if (low2.startsWith(p)) {
      s = s.slice(p.length).trim();
      if (s.startsWith(':')) s = s.slice(1).trim();
      return s;
    }
  }
  return String(message || '').trim();
}

function splitSentencesSimple(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const out = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    buf += s[i];
    if ('.!?'.includes(s[i])) {
      let j = i + 1;
      while (j < s.length && s[j] === ' ') j++;
      out.push(buf.trim());
      buf = '';
      i = j - 1;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}


function extractTag(html, tag) {
  const open = '<' + tag;
  const close = '</' + tag + '>';
  const low = toLowerAsciiish(html);
  let from = 0;
  const opens = [];
  while (true) {
    const idx = low.indexOf(open, from);
    if (idx < 0) break;
    const gt = html.indexOf('>', idx);
    if (gt < 0) break;
    const cidx = low.indexOf(close, gt);
    if (cidx < 0) break;
    return html.slice(gt + 1, cidx).trim();
  }
  return '';
}
function extractHref(html) {
  const low = toLowerAsciiish(html);
  const key = 'href="';
  const idx = low.indexOf(key);
  if (idx < 0) return '';
  const start = idx + key.length;
  const end = html.indexOf('"', start);
  if (end < 0) return '';
  return html.slice(start, end).trim();
}
function splitRssItems(data) {
  const low = toLowerAsciiish(data);
  const parts = [];
  let from = 0;
  while (true) {
    let idx = low.indexOf('<item>', from);
    if (idx < 0) idx = low.indexOf('<item ', from);
    if (idx < 0) break;
    const next = (() => {
      let n = low.indexOf('<item>', idx + 5);
      const n2 = low.indexOf('<item ', idx + 5);
      if (n < 0) n = n2;
      else if (n2 >= 0) n = Math.min(n, n2);
      return n;
    })();
    parts.push(data.slice(idx, next < 0 ? data.length : next));
    from = idx + 5;
    if (parts.length >= 5) break;
  }
  return parts;
}

function hasColonDirective(message) {
  const s = String(message || '');
  const i = s.indexOf(':');
  if (i < 0) return false;
  let j = i + 1;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
  return j < s.length && s[j] !== '\n';
}

function extractWordLimit(message) {
  const text = toLowerAsciiish(message);
  const wordMap = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  for (const cue of ['under ', 'in ', 'to ', 'at most ', 'max ']) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(cue, from);
      if (idx < 0) break;
      let i = idx + cue.length;
      while (i < text.length && text[i] === ' ') i++;
      let num = '';
      while (i < text.length && isAsciiDigit(text[i])) { num += text[i]; i++; }
      if (num) {
        while (i < text.length && text[i] === ' ') i++;
        if (text.startsWith('word', i) || text.startsWith('words', i)) return Number(num);
      } else {
        let word = '';
        while (i < text.length && isAsciiLetter(text[i])) { word += text[i]; i++; }
        if (wordMap[word]) {
          while (i < text.length && text[i] === ' ') i++;
          if (text.startsWith('word', i) || text.startsWith('words', i)) return wordMap[word];
        }
      }
      from = idx + cue.length;
    }
  }
  // N words max
  const tokens = collapseWhitespace(text).split(' ');
  for (let i = 0; i < tokens.length - 2; i++) {
    if (isAllAsciiDigits(tokens[i]) && (tokens[i + 1] === 'word' || tokens[i + 1] === 'words') && tokens[i + 2] === 'max') {
      return Number(tokens[i]);
    }
  }
  return 0;
}

function extractSentenceLimit(message) {
  const text = toLowerAsciiish(message);
  if (includesAny(text, ['one sentence', '1 sentence', 'single sentence'])) return 1;
  if (includesAny(text, ['one line', '1 line', 'single line'])) return 1;
  return 0;
}

function requestsNoQuestion(message) {
  const text = toLowerAsciiish(message);
  return includesAny(text, ['do not ask questions', 'do not ask question', 'no questions', 'no question']);
}

function isKeepItShortPrompt(message) {
  const text = toLowerAsciiish(message).trim();
  return includesAny(text, [
    'keep it short', 'keep this short', 'keep it brief', 'be brief', 'short reply', 'brief reply',
  ]);
}

function requestsLegionBrief(message) {
  const text = toLowerAsciiish(message).trim();
  if (!text) return false;
  if (text === 'legion brief') return true;
  if (text.startsWith('/legion brief') || text.startsWith('/legion-brief')) return true;
  if (!text.includes('legion brief')) return false;
  return includesAny(text, [
    'start', 'create', 'make', 'prepare', 'fill', 'do', 'need', 'want', 'ask for', 'give me',
  ]);
}

function inferLegionAdapterFromBrief(fields) {
  const { inferAdapterFromBrief } = require('./lib/knowledgeManifest');
  return inferAdapterFromBrief(fields, __dirname)
    || LEGION_BRIEF_DEFAULT_ADAPTER
    || 'ausmakersupplies';
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
  const { parseRunbookFromMessage, buildCapabilityInput } = require('./lib/ausmakerRunbook');
  const { dispatchLegionCapabilityRun } = require('./lib/legionDispatch');
  let capability = '';
  let input = {};
  const parsedRb = parseRunbookFromMessage(fields.objective || '');
  if (parsedRb) {
    capability = 'ausmaker.runbook.execute';
    input = buildCapabilityInput({
      capability,
      opts: { runbook_id: parsedRb.runbook_id, sku: parsedRb.sku },
    });
  } else {
    const model = dispatchContext && dispatchContext.model;
    const inferModel = PIKO_HEAVY_MODEL || model;
    capability = await inferCapabilityFromObjectiveAsync(fields, DATA_DIR, inferModel);
    input = { include_raw: capability === 'inventory.low_stock.scan' };
  }
  if (!adapterId || !capability) {
    return { ok: false, code: 'NO_CAPABILITY_MATCH', message: 'Could not infer adapter/capability from brief objective.' };
  }
  return dispatchLegionCapabilityRun({
    adapterId,
    capability,
    input,
    baseUrl: LEGION_ADAPTER_API_BASE,
    piko_user_id: String(dispatchContext && dispatchContext.piko_user_id || ''),
    execution_mode: String(fields.execution_mode || 'needs_approval'),
    risk_level: String(fields.risk_level || 'medium'),
    context: {
      trace_id: `trc_brief_${Date.now()}`,
      brief_id: `lbrief_${Date.now()}`,
      piko_decision_id: `dec_brief_${Date.now()}`,
    },
  });
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
  const { dispatchLegionCapabilityRun } = require('./lib/legionDispatch');
  const { pollLegionRun } = require('./lib/legionRunPoller');
  const { formatPoSubmitReply } = require('./lib/poWriteLadder');
  const adapterId = LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies';
  const dryRun = poPayload.dry_run === true
    || (process.env.PIKO_PO_SUBMIT_DRY_RUN === '1' && poPayload.dry_run !== false);
  const { _pin, dry_run: _ignoredDry, ...cleanPayload } = poPayload || {};
  const dispatch = await dispatchLegionCapabilityRun({
    adapterId,
    capability: 'purchase_order.submit',
    input: {
      purchase_order_payload: cleanPayload,
      dry_run: dryRun,
    },
    baseUrl: LEGION_ADAPTER_API_BASE,
    piko_user_id: String(dispatchContext && dispatchContext.piko_user_id || ''),
    execution_mode: 'auto',
    risk_level: 'low',
    context: {
      trace_id: `trc_approve_${Date.now()}`,
      piko_decision_id: `dec_approve_${Date.now()}`,
    },
  });
  if (!dispatch.ok || !dispatch.runId) {
    const out = {
      ok: false,
      code: dispatch.code || 'DISPATCH_FAILED',
      message: dispatch.message || 'Legion PO submit dispatch failed',
      details: dispatch.details,
    };
    out.message = formatPoSubmitReply(out);
    return out;
  }
  const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
  if (!polled.ok) {
    const failResult = polled.result;
    if (failResult && failResult.error) {
      const out = {
        ok: false,
        code: failResult.error,
        message: failResult.message || failResult.error,
        details: failResult.error,
        runId: dispatch.runId,
        result: failResult,
      };
      out.message = formatPoSubmitReply(out);
      return out;
    }
    const out = {
      ok: false,
      code: 'POLL_FAILED',
      message: polled.error || polled.status || 'PO submit did not complete',
      runId: dispatch.runId,
    };
    out.message = formatPoSubmitReply(out);
    return out;
  }
  if (!polled.result) {
    const out = { ok: false, code: 'NO_RESULT', message: 'PO submit returned no result', runId: dispatch.runId };
    out.message = formatPoSubmitReply(out);
    return out;
  }
  if (polled.result.ok === false && polled.result.error) {
    const out = {
      ok: false,
      code: polled.result.error,
      message: polled.result.message || polled.result.error,
      details: polled.result.error,
      runId: dispatch.runId,
      result: polled.result,
    };
    out.message = formatPoSubmitReply(out);
    return out;
  }
  const out = {
    ok: true,
    adapterId,
    runId: dispatch.runId,
    status: polled.status || 'completed',
    result: polled.result,
  };
  out.message = formatPoSubmitReply(out);
  return out;
}

function enforceReplyConstraints(reply, constraints = {}) {
  let text = String(reply || '').trim();
  if (!text) return text;
  const maxSentences = Number(constraints.maxSentences || 0);
  const noQuestion = constraints.noQuestion === true;
  const maxWords = Number(constraints.maxWords || 0);

  if (maxSentences > 0) {
    const bits = [];
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      buf += text[i];
      if ('.!?'.includes(text[i])) {
        let j = i + 1;
        while (j < text.length && text[j] === ' ') j++;
        bits.push(buf.trim());
        buf = '';
        i = j - 1;
      }
    }
    if (buf.trim()) bits.push(buf.trim());
    text = bits.slice(0, maxSentences).join(' ').trim() || text;
  }
  if (noQuestion) {
    text = replaceAllLiteral(text, '?', '.');
  }
  if (maxWords > 0) {
    text = truncateToWords(text, maxWords);
  }
  if (!endsWithAny(text, ['.', '!', '?'])) text += '.';
  return text;
}


function truncateToWords(text, maxWords) {
  const words = collapseWhitespace(String(text || '').trim()).split(' ').filter(Boolean);
  if (!words.length) return '';
  const take = Math.max(1, Math.min(20, Number(maxWords) || 1));
  const out = words.slice(0, take).join(' ');
  return endsWithAny(out, ['.', '!', '?']) ? out : out + '.';
}


function extractNicknameToken(text, phrase) {
  const low = toLowerAsciiish(text);
  const idx = low.indexOf(phrase);
  if (idx < 0) return '';
  let i = idx + phrase.length;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  let tok = '';
  while (i < text.length) {
    const ch = text[i];
    const lowCh = ch.toLowerCase();
    if (isAsciiLetter(lowCh) || isAsciiDigit(lowCh) || ch === '_' || ch === '-') tok += ch;
    else break;
    i++;
  }
  return tok;
}

function findRequestedNickname(history, sessionKey) {
  try {
    const durable = memory.getSessionNickname(sessionKey);
    if (durable) return durable;
  } catch (_) {}
  const priorUsers = Array.isArray(history) ? history.filter((m) => m && m.role === 'user').map((m) => String(m.content || '')) : [];
  for (let i = priorUsers.length - 1; i >= 0; i -= 1) {
    const line = priorUsers[i];
    let n = extractNicknameToken(line, 'nickname is');
    if (n) return n;
    n = extractNicknameToken(line, 'call me');
    if (n) return n;
    const low = toLowerAsciiish(line);
    const idx = low.indexOf(' as my nickname');
    if (idx > 0) {
      const useIdx = low.lastIndexOf('use ', idx);
      if (useIdx >= 0) {
        n = extractNicknameToken(line.slice(useIdx), 'use');
        if (n) return n;
      }
    }
  }
  return '';
}

function extractNicknameFromMessage(message) {
  const text = String(message || '').trim();
  let n = extractNicknameToken(text, 'nickname is');
  if (n) return n;
  n = extractNicknameToken(text, 'call me');
  if (n) return n;
  const low = toLowerAsciiish(text);
  const idx = low.indexOf(' as my nickname');
  if (idx > 0) {
    const useIdx = low.lastIndexOf('use ', idx);
    if (useIdx >= 0) {
      n = extractNicknameToken(text.slice(useIdx), 'use');
      if (n) return n;
    }
  }
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
  let s = str;
  // remove **bold** and __bold__ and *em* / _em_ by scanning
  const stripWrap = (input, marker) => {
    let out = '';
    let i = 0;
    while (i < input.length) {
      if (input.startsWith(marker, i)) {
        const close = input.indexOf(marker, i + marker.length);
        if (close > i) {
          out += input.slice(i + marker.length, close);
          i = close + marker.length;
          continue;
        }
      }
      out += input[i];
      i++;
    }
    return out;
  };
  s = stripWrap(s, '**');
  s = stripWrap(s, '__');
  s = stripWrap(s, '*');
  s = stripWrap(s, '_');
  s = replaceAllLiteral(s, '**', '');
  s = replaceAllLiteral(s, '__', '');
  return s.trim();
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
  // Allow chat to use a stricter timeout than background/ops tasks.
  const timeoutMs = Math.max(
    5000,
    Number(process.env.PIKO_OLLAMA_CHAT_TIMEOUT_MS || process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000)
  );
  return withTimeout(ai(messages, {
    model: normalized,
    max_tokens: options.max_tokens ?? defaultMaxTokens,
    temperature: options.temperature,
    repeat_penalty: options.repeat_penalty,
    presence_penalty: options.presence_penalty,
    frequency_penalty: options.frequency_penalty,
    num_ctx: options.num_ctx,
  }), timeoutMs, 'ollama_chat_timeout');
}

/** Phase 3: stream via LiteLLM; onChunk(delta) for each piece; returns full reply. */
async function ollamaChatStream(messages, onChunk, model, options = {}) {
  const m = model || OLLAMA_MODEL;
  const normalized = (m && m.startsWith('ollama/')) ? m : `ollama/${m || OLLAMA_MODEL}`;
  const timeoutMs = Math.max(
    5000,
    Number(process.env.PIKO_OLLAMA_CHAT_TIMEOUT_MS || process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000)
  );
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
  // Operator-voice floor: any JSON body with a chat `reply` gets polished on
  // the way out, so no branch of the chat router can leak internal telemetry.
  if (typeof body === 'string' && contentType === 'application/json' && body.includes('"reply"')) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.reply === 'string' && parsed.reply) {
        parsed.reply = require('./lib/operatorVoice').polishOutbound(parsed.reply);
        body = JSON.stringify(parsed);
      }
    } catch (_) {}
  }
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
function telegramNotify(text, meta = {}) {
  const opts = meta && typeof meta === 'object' ? meta : {};
  const { notifyAdmin } = require('./lib/notifyAdmin');
  return notifyAdmin(String(text).slice(0, 4096), {
    category: opts.category || 'system',
    title: opts.title,
    severity: opts.severity || 'info',
    source: opts.source || 'telegramNotify',
    meta: opts.meta,
    parseMode: opts.parseMode,
  }).then((r) => ({ statusCode: r.telegram === 'sent' ? 200 : 500, ...r }));
}

/** Parse ACTIONS: 1. ... 2. ... from Ollama conversation summary reply. Returns [{ title }, ...]. */
function parseConversationActions(summaryReply) {
  if (!summaryReply || typeof summaryReply !== 'string') return [];
  const lines = splitLines(summaryReply);
  const actions = [];
  let inActions = false;
  const numberedTitle = (line) => {
    let s = line.trim();
    let i = 0;
    while (i < s.length && isAsciiDigit(s[i])) i++;
    if (i === 0 || i >= s.length || s[i] !== '.') return '';
    return s.slice(i + 1).trim().slice(0, 200);
  };
  for (const line of lines) {
    if (toLowerAsciiish(line.trim()) === 'actions:') {
      inActions = true;
      continue;
    }
    if (inActions) {
      const title = numberedTitle(line);
      if (title) actions.push({ title });
    }
  }
  if (actions.length === 0) {
    for (const line of lines) {
      const title = numberedTitle(line);
      if (title) actions.push({ title });
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
  const hhmm = (() => { const p = parseHhMm(s); return p ? [null, String(p.h), String(p.m).padStart(2,'0')] : null; })();
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

function getMobileLanBaseURL() {
  const fromEnv = stripTrailingSlash(String(process.env.PIKO_LAN_BASE_URL || process.env.PIKO_IOS_BASE_URL || '').trim());
  if (fromEnv) return fromEnv;
  try {
    const { execSync } = require('child_process');
    const out = String(execSync('hostname -I', { encoding: 'utf8', timeout: 2000 })).trim().split(' ').filter(Boolean);
    const ip = out.find((x) => x.startsWith('192.168.') || x.startsWith('10.'));
    if (ip) return `http://${ip}:3000`;
  } catch (_) { /* ignore */ }
  return null;
}

function getMobilePublicBaseURL() {
  const fromEnv = stripTrailingSlash(String(process.env.PIKO_PUBLIC_BASE_URL || process.env.PIKO_IOS_PUBLIC_URL || '').trim());
  if (fromEnv) return fromEnv;
  const defaultPublic = 'https://andrewstarkey.net/piko';
  if (process.env.PIKO_DEFAULT_PUBLIC_URL !== '0') return defaultPublic;
  try {
    const filePath = process.env.PIKO_IOS_PUBLIC_URL_FILE || '/opt/piko/ios_public_url.txt';
    if (fs.existsSync(filePath)) {
      const raw = stripTrailingSlash(String(fs.readFileSync(filePath, 'utf8')).trim());
      if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** Fail closed: unset/empty YOLO/health key never authorizes. */
function checkYoloApiAuth(req) {
  const keyEnv = (process.env.PIKO_YOLO_API_KEY || process.env.PIKO_HEALTH_API_KEY || '').trim();
  if (!keyEnv) return false;
  const authHeader = (req.headers.authorization || '').trim();
  const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return (bearer || apiKeyHeader) === keyEnv;
}

/** YOLO/HITL routes: matching API key OR an active admin session. */
function checkYoloOrSessionAuth(req) {
  if (checkYoloApiAuth(req)) return true;
  try {
    const adminAuth = require('./lib/adminAuth');
    if (!adminAuth.isEnabled()) return false;
    return !!adminAuth.getSessionFromRequest(req, DATA_DIR);
  } catch (_) {
    return false;
  }
}

/** HQ/operator actions: API key OR an active admin session (browser HQ). */
function checkMgmtOperatorAuth(req) {
  if (checkYoloApiAuth(req)) return true;
  try {
    const adminAuth = require('./lib/adminAuth');
    if (!adminAuth.isEnabled()) return false;
    return !!adminAuth.getSessionFromRequest(req, DATA_DIR);
  } catch (_) {
    return false;
  }
}

function checkHqApiAuth(req) {
  const keyEnv = (process.env.PIKO_HQ_API_KEY || process.env.PIKO_HEALTH_API_KEY || '').trim();
  if (!keyEnv) return false;
  const authHeader = (req.headers.authorization || '').trim();
  const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return (bearer || apiKeyHeader) === keyEnv;
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
          const summaryMatch = (() => {
            const low = summaryReply;
            const idx = toLowerAsciiish(low).indexOf('summary:');
            if (idx < 0) return null;
            let rest = low.slice(idx + 8).trim();
            const cut = toLowerAsciiish(rest).indexOf('actions:');
            if (cut >= 0) rest = rest.slice(0, cut);
            const nl = rest.indexOf('\n');
            if (nl >= 0) rest = rest.slice(0, nl);
            return [null, rest.trim()];
          })();
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
    const pdfCount = collapseWhitespace(combined).split(' ').filter((w) => toLowerAsciiish(w).includes('.pdf')).length;
    if (pdfCount >= 3) suggestedTopics.push('Weekly deep dives');
    if ((hasWord(toLowerAsciiish(combined), 'agent') || includesAny(toLowerAsciiish(combined), ['coordination', 'distributed']))) suggestedTopics.push('agent coordination', 'distributed systems');
    if (includesAny(toLowerAsciiish(combined), ['research', 'paper', 'arxiv'])) suggestedTopics.push('research synthesis');
    return send(res, 200, JSON.stringify({ ok: true, action: 'files_recent', suggestedTopics: [...new Set(suggestedTopics)] }));
  }

  /** iOS Legion Tree → human override: update task status in Legion SQLite (`yolo_protocol.update_legion_task`). */
  if (action === 'legion_task_update') {
    const taskId = Number(body.task_id ?? body.taskId);
    const newStatus = String(body.new_status ?? body.newStatus ?? '').trim().toLowerCase();
    if (!Number.isFinite(taskId) || taskId < 1) {
      return send(res, 400, JSON.stringify({ error: 'task_id must be a positive integer' }));
    }
    const allowed = new Set(['active', 'pending', 'rejected', 'submitted', 'approved', 'cancelled', 'completed', 'done', 'reviewed', 'delegated']);
    if (!allowed.has(newStatus)) {
      return send(res, 400, JSON.stringify({ error: 'new_status not allowed', allowed: Array.from(allowed).sort() }));
    }
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(__dirname, '..')).trim();
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.update_legion_task_with_trigger(${taskId}, ${JSON.stringify(newStatus)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 45000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion update failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg }));
    }
    const regen = process.env.PIKO_MANIFEST_REGEN_AFTER_LEGION_UPDATE !== '0' && process.env.PIKO_MANIFEST_REGEN_AFTER_LEGION_UPDATE !== 'false';
    if (regen) {
      try {
        const py2 = 'import piko_core; piko_core.generate_app_manifest(25)';
        spawn(pyBin, ['-c', py2], { cwd: repo, detached: true, stdio: 'ignore', env: process.env }).unref();
      } catch (_) {}
    }
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_update',
      task_id: taskId,
      new_status: newStatus,
      result: parsed,
    }));
  }

  /** iOS → save file to PIKO_TOOL_DATA_ROOT/inbox for tool ingestion. */
  if (action === 'file_upload') {
    try {
      const out = pikoUpload.saveUpload({
        filename: body.filename || body.name,
        content_base64: body.content_base64 || body.base64,
        subdir: body.subdir || 'inbox',
      });
      return send(res, 200, JSON.stringify({ ok: true, action: 'file_upload', ...out }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
  }

  /** iOS → single Python tool registry (`yolo_protocol.execute_tool_yolo`). */
  if (action === 'yolo_tool') {
    const toolName = String(body.name || body.tool_name || body.toolName || '').trim();
    if (!toolName) {
      return send(res, 400, JSON.stringify({ error: 'name (tool name) is required' }));
    }
    const args = body.arguments && typeof body.arguments === 'object'
      ? body.arguments
      : (body.args && typeof body.args === 'object' ? body.args : {});
    try {
      const result = yoloBridge.runYoloTool(toolName, args, { channel: 'ios' });
      const pending = toLowerAsciiish(result).includes('pending human approval');
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'yolo_tool',
        tool: toolName,
        pending_approval: pending,
        result,
      }));
    } catch (e) {
      const msg = (e && e.stderr && String(e.stderr)) || e.message || String(e);
      return send(res, 502, JSON.stringify({ ok: false, error: msg, tool: toolName }));
    }
  }

  /** iOS Command Deck → create Legion row + wiki log + manifest (``piko_core.create_legion_task_atomic``). */
  if (action === 'legion_task_create') {
    const title = String(body.title || '').trim();
    if (!title) {
      return send(res, 400, JSON.stringify({ error: 'title is required' }));
    }
    const description = String(body.description || body.desc || '').trim();
    const denarii = Number.isFinite(Number(body.denarii)) ? Math.max(0, Math.floor(Number(body.denarii))) : 0;
    const parentId = Number.isFinite(Number(body.parent_id ?? body.parentId)) ? Math.max(0, Math.floor(Number(body.parent_id ?? body.parentId))) : 0;
    const businessUnit = String(body.business_unit || body.businessUnit || '').trim();
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(__dirname, '..')).trim();
    const spec = JSON.stringify({
      title,
      description,
      denarii,
      parent_id: parentId,
      ...(businessUnit ? { business_unit: businessUnit } : {}),
    });
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.create_legion_task_atomic(${JSON.stringify(spec)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 60000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion task create failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg, result: parsed || undefined }));
    }
    const tid = parsed.dispatch && parsed.dispatch.id;
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_create',
      task_id: tid,
      message: tid ? `Task #${tid} has been dispatched to the Legion ledger.` : undefined,
      result: parsed,
    }));
  }

  /** iOS Command Deck → propose a Legion draft (no DB write) for confirmation. */
  if (action === 'legion_task_propose') {
    const text = String(body.text || body.message || '').trim();
    if (!text) {
      return send(res, 400, JSON.stringify({ error: 'text is required' }));
    }
    const businessUnit = String(body.business_unit || body.businessUnit || '').trim();
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(__dirname, '..')).trim();
    const spec = JSON.stringify({
      text,
      ...(businessUnit ? { business_unit: businessUnit } : {}),
    });
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.propose_legion_task(${JSON.stringify(spec)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 60000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion task propose failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg, result: parsed || undefined }));
    }
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_propose',
      message: parsed.message || '',
      draft: parsed.draft || null,
      result: parsed,
    }));
  }

  /** iOS — list scheduled mission activations (``legion_scheduled`` intents). */
  if (action === 'legion_schedule_list') {
    try {
      const taskId = body.task_id != null || body.taskId != null
        ? Number(body.task_id ?? body.taskId)
        : null;
      const rows = listLegionScheduleIntents(
        taskId != null && Number.isFinite(taskId) ? { task_id: taskId } : {},
      );
      const items = rows.map((s) => ({
        id: s.id,
        task_id: s.task_id || s.taskId || null,
        title: s.title || s.description || '',
        schedule: s.schedule || null,
        dueAt: s.dueAt || null,
        lastFiredAt: s.lastFiredAt || null,
        mode: s.mode || 'require_approval',
        business_unit: s.business_unit || null,
      }));
      return send(res, 200, JSON.stringify({ ok: true, action: 'legion_schedule_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'legion_schedule_list failed' }));
    }
  }

  /** iOS — register when a mission MUST run (intent-poller → same path as manual START). */
  if (action === 'legion_schedule_create') {
    const taskId = Number(body.task_id ?? body.taskId);
    const schedule = String(body.schedule || '').trim();
    if (!Number.isFinite(taskId) || taskId < 1) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'task_id must be a positive integer' }));
    }
    if (!schedule) {
      return send(res, 400, JSON.stringify({
        ok: false,
        error: 'schedule is required (daily HH:MM, weekly HH:MM, hourly HH:MM-HH:MM, cron …, or in N minutes)',
      }));
    }
    try {
      const out = createLegionScheduleIntent({
        task_id: taskId,
        title: String(body.title || body.objective || '').trim(),
        objective: String(body.objective || body.title || '').trim(),
        schedule,
        mode: body.mode || body.activation_mode || 'require_approval',
        business_unit: String(body.business_unit || body.businessUnit || '').trim(),
        source,
        sessionId,
      });
      const boundTaskId = out.intent.task_id || taskId;
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'legion_schedule_create',
        task_id: boundTaskId,
        duplicate: !!out.duplicate,
        message: boundTaskId ? `Task #${boundTaskId}: schedule registered.` : undefined,
        intent: {
          id: out.intent.id,
          task_id: boundTaskId,
          schedule: out.intent.schedule,
          dueAt: out.intent.dueAt,
          mode: out.intent.mode,
          business_unit: out.intent.business_unit || null,
        },
      }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'legion_schedule_create failed' }));
    }
  }

  /** iOS — cancel a scheduled mission activation by intent id. */
  if (action === 'legion_schedule_cancel') {
    const intentId = String(body.intent_id || body.intentId || body.id || '').trim();
    if (!intentId) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'intent_id is required' }));
    }
    const updated = updateIntent(intentId, { status: 'cancelled' });
    if (!updated) {
      return send(res, 404, JSON.stringify({ ok: false, error: 'Schedule not found' }));
    }
    if (updated.type !== 'legion_scheduled') {
      return send(res, 400, JSON.stringify({ ok: false, error: 'That intent is not a mission schedule' }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'legion_schedule_cancel', intent_id: intentId }));
  }

  /** List daily Product Change Summary times (``digest_schedules.json``). */
  if (action === 'digest_schedule_list') {
    try {
      const { loadSchedules } = require('./lib/tripwireEngine');
      const rows = loadSchedules();
      const items = rows.map((s) => ({
        id: s.time,
        time: s.time,
        last_sent_date: s.lastSentDate || null,
        title: 'Product Change Summary',
        channel: 'telegram',
      }));
      return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'digest_schedule_list failed' }));
    }
  }

  /** Cancel one digest by time (HH:MM) or remove all when ``clear_all`` is true. */
  if (action === 'digest_schedule_cancel') {
    try {
      const { removeDigestSchedule, clearDigestSchedule } = require('./lib/tripwireEngine');
      if (body.clear_all === true || String(body.mode || '').toLowerCase() === 'all') {
        const ok = clearDigestSchedule();
        return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_cancel', cleared_all: ok }));
      }
      const time = String(body.time || body.id || '').trim();
      if (!time) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'time (HH:MM) is required, or set clear_all: true' }));
      }
      const removed = removeDigestSchedule(time);
      if (!removed) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'Digest schedule not found for that time' }));
      }
      return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_cancel', time }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'digest_schedule_cancel failed' }));
    }
  }

  // iOS Sovereign HUD → optional local shell (same host as webchat) or Telegram ping only.
  const sovereignHub = {
    sovereign_legion_audit: { envKey: 'PIKO_SOV_CMD_AUDIT', label: 'Legion audit', emoji: '🔍' },
    sovereign_remediate_stale: { envKey: 'PIKO_SOV_CMD_REMEDIATE', label: 'Remediate stale', emoji: '⚡️' },
    sovereign_evaluate_quality: { envKey: 'PIKO_SOV_CMD_QUALITY_GATE', label: 'Quality gate', emoji: '✂️' },
    sovereign_hierarchy_audit: { envKey: 'PIKO_SOV_CMD_HIERARCHY_AUDIT', label: 'Hierarchy integrity', emoji: '🧭' },
    sovereign_housekeeping: { envKey: 'PIKO_SOV_CMD_HOUSEKEEPING', label: 'Wiki housekeeping', emoji: '🧹' },
  };
  if (sovereignHub[action]) {
    const cfg = sovereignHub[action];
    const cmd = String(process.env[cfg.envKey] || '').trim();
    const cwd = process.env.PIKO_REPO_ROOT || path.join(__dirname, '..');
    let ran = false;
    let output = null;
    let cmdError = null;
    if (cmd) {
      try {
        output = execSync(cmd, { encoding: 'utf8', timeout: 120000, shell: true, cwd, env: process.env }).trim().slice(0, 12000);
        ran = true;
      } catch (e) {
        ran = true;
        cmdError = (e && e.stderr && String(e.stderr)) || e.message || String(e);
        output = String(cmdError).slice(0, 4000);
      }
    }
    telegramNotify(`${cfg.emoji} iOS HUD: ${cfg.label} requested.`).catch(() => {});
    return send(res, 200, JSON.stringify({
      ok: cmdError == null,
      action,
      ran,
      output,
      note: cmd ? null : `Set ${cfg.envKey} (shell one-liner) and optionally PIKO_REPO_ROOT on the server to run ${cfg.label} here; otherwise use Telegram menu on Mac.`,
      error: cmdError || undefined,
    }));
  }

  if (action === 'notification_list') {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(body.limit, 10) || 40));
      const { readMergedNotifications } = require('./lib/notificationFeed');
      const items = readMergedNotifications(limit);
      return send(res, 200, JSON.stringify({ ok: true, action: 'notification_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_list failed' }));
    }
  }

  if (action === 'notification_config_get') {
    try {
      const { getConfigForDashboard } = require('./lib/configManager');
      const { getCategoryMeta } = require('./lib/notificationFeed');
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'notification_config_get',
        config: getConfigForDashboard(),
        categories: getCategoryMeta(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_config_get failed' }));
    }
  }

  if (action === 'notification_config_update') {
    try {
      const { updateConfig } = require('./lib/configManager');
      const key = String(body.key || '').trim();
      if (!key) return send(res, 400, JSON.stringify({ ok: false, error: 'key is required' }));
      if (body.value === undefined) return send(res, 400, JSON.stringify({ ok: false, error: 'value is required' }));
      const result = updateConfig(key, body.value);
      const ok = !String(result).startsWith('Error:');
      return send(res, ok ? 200 : 400, JSON.stringify({
        ok,
        action: 'notification_config_update',
        message: result,
        config: require('./lib/configManager').getConfigForDashboard(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_config_update failed' }));
    }
  }

  return send(res, 400, JSON.stringify({ error: 'Unknown action. Use: reminder, calendar, notes_capture, inquiry, file_capture, calendar_snapshot, files_recent, legion_task_propose, legion_task_create, legion_task_update, legion_schedule_list, legion_schedule_create, legion_schedule_cancel, digest_schedule_list, digest_schedule_cancel, notification_list, notification_config_get, notification_config_update, sovereign_legion_audit, sovereign_remediate_stale, sovereign_evaluate_quality, sovereign_hierarchy_audit, sovereign_housekeeping' }));
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
  return isSafeName(name, { min: 1, max: 256, allowDot: true, allowHyphen: true, allowUnderscore: true }) && !name.includes('..');
}
function parseTaskCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (!t.startsWith('/task ') || t === '/task') return null;
  const rest = t.slice(6).trim();
  if (!rest) return null;
  const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
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
  const taskEsc = replaceAllLiteral(taskCmd.task, "'", "'\"'\"'");
  const keyEsc = replaceAllLiteral(apiKey, "'", "'\"'\"'");
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
  const cmdArg = replaceAllLiteral(replaceAllLiteral(cursor.command, '"', '\\"'), '`', '\\`');
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


const { createHandleApiChat } = require('./lib/chatPipeline');
const handleApiChat = createHandleApiChat({
  AUSMAKER_BASE_URL,
  CHAT_QUEUE_WAIT_MS,
  CURRENT_MODEL_FILE,
  CURSOR_OPTIMUS_ONLY,
  DATA_DIR,
  GMAIL_ACCESS_TOKEN,
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  GROK_API_KEY,
  LEGION_ADAPTER_API_BASE,
  MOLTBOOK_API_KEY,
  NEWS_API_KEY,
  OLLAMA_MODEL,
  OLLAMA_URL,
  PENDING_CANCEL_TTL_MS,
  PENDING_INTENT_EXPIRY_MS,
  PIKO_HEAVY_MODEL,
  PROMPTS_DIR,
  SANDBOX_DIR,
  SERPER_API_KEY,
  SLICE_HISTORY,
  SYSTEM_PROMPT,
  TASK_OPTIMUS_ONLY,
  TENANT_BG,
  rootDir: __dirname,
  acquireChatSlot,
  acquireSessionLock,
  appendConfirmedBrief,
  appendCorrection,
  appendPendingNotification,
  beliefLoop,
  buildLearningUpdateReply,
  classifyDepthOptional,
  clearApprovalPending,
  clearBriefSession,
  collapseWhitespace,
  createIntent,
  createLegionScheduledWithTask,
  createResponsePlan,
  createRule,
  dispatchLegionBrief,
  dispatchLegionPoSubmit,
  endsWithAny,
  enforceReplyConstraints,
  extractHref,
  extractNicknameFromMessage,
  extractSentenceLimit,
  extractTag,
  extractWordLimit,
  fetchMoltbookPostsByPiko,
  findRequestedNickname,
  formatPlanForPrompt,
  formatRecap,
  fs,
  getAndConsumePendingQuestionBlock,
  getBriefSession,
  getCorpusBlockForPrompt,
  getCurrentModelOverride,
  getDailyMemoryBlock,
  getKnowledgeBaseBlockForPrompt,
  getRagContext,
  getRagContextAsync,
  getRecentLearningBlock,
  getStickyIdeasBlock,
  getTruthBlockForPrompt,
  grokChat,
  hasAnyWord,
  hasColonDirective,
  http,
  httpRequest,
  https,
  httpsRequest,
  inFlightRequests,
  includesAny,
  isAllAsciiDigits,
  isAllowedByAllowlist,
  isAsciiDigit,
  isAutomationSession,
  isBriefComplete,
  isKeepItShortPrompt,
  isLegionApproveAllowed,
  isSafeName,
  isSimpleStatusAck,
  isToneDriftComplaint,
  isUuidLike,
  isYyyyMm,
  loadAllowlist,
  loadApprovalPending,
  loadDataSoul,
  loadIntents,
  loadMind,
  loadRules,
  loadSessionsConfig,
  loadedSkills,
  log,
  memory,
  metrics,
  nextDueFromSchedule,
  nextMissingField,
  normalizeApostrophes,
  normalizeSchedule,
  ollamaChat,
  ollamaChatStream,
  ollamaNativeChat,
  parseCursorCommand,
  parseDuration,
  parseFieldValueLine,
  parseHhMm,
  parseSessionSource,
  parseSlashCommand,
  parseTaskCommand,
  path,
  pendingCancelConfirmations,
  pendingIntentsBySession,
  pickBySeed,
  promoteModel,
  rateLimit,
  readBody,
  replaceAllLiteral,
  requestsLearningUpdate,
  requestsLegionBrief,
  requestsNoQuestion,
  resolveSandboxPath,
  runCursorCommand,
  runTaskCommand,
  saveAllowlist,
  savePendingCancelConfirmations,
  saveSessionsConfig,
  send,
  sessionStore,
  setApprovalPending,
  setBriefField,
  setImmediate,
  setTimeout,
  splitLines,
  splitRssItems,
  splitSentencesSimple,
  startBriefSession,
  stripCancelPrefix,
  stripCodeFences,
  stripListMarker,
  stripMarkdownFromText,
  stripTrailingPunct,
  stripTrailingSlash,
  stripWrappingQuotes,
  telegramNotify,
  toLowerAsciiish,
  toggleRule,
  truncateToWords,
  updateIntent,
  updateMind,
  upsertModel,
  url,
  verifyAndStripApprovalPin
});


async function handleRequest(req, res) {
  req.requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const { pathname, query } = parseUrl(req.url);
  const adminAuth = require('./lib/adminAuth');

  {
    const { checkApiAuth } = require('./lib/apiAuth');
    const denied = checkApiAuth(req, pathname, query, { dataDir: DATA_DIR });
    if (denied) return send(res, denied.status, denied.body);
  }

  // —— Admin auth/session (extracted: routes/admin.js) ——
  {
    const { tryHandleAdmin } = require('./routes/admin');
    if (await tryHandleAdmin(req, res, {
      pathname,
      send,
      readBody,
      adminAuth,
      dataDir: DATA_DIR,
      rootDir: __dirname,
      matchPath,
    })) return;
  }

  if (req.method === 'GET' && pathname === '/api/exports/reorder-csv') {
    const { getUrl } = require('./lib/legionRunPoller');
    const csvUrl = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/csv`;
    try {
      const upstream = await getUrl(csvUrl);
      if (upstream.statusCode !== 200) {
        return send(res, upstream.statusCode || 502, JSON.stringify({ ok: false, error: 'AusMaker CSV unavailable' }), 'application/json');
      }
      const data = JSON.parse(upstream.body || '{}');
      if (!data.success || !data.csv_content) {
        return send(res, 404, JSON.stringify({ ok: false, error: data.error || 'No CSV data' }), 'application/json');
      }
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reorder-report-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      });
      res.end(data.csv_content);
      return;
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Export failed' }), 'application/json');
    }
  }

  // P4.1: under PIKO_ENV_STRICT, unconfigured admin gate fails closed (503).
  {
    const denied = adminAuth.denyIfUnconfigured(pathname, req.method, DATA_DIR);
    if (denied && !(adminAuth.isMonitorBypass && adminAuth.isMonitorBypass(req, pathname, req.method))) {
      return send(res, denied.status, denied.body);
    }
  }

  if (adminAuth.isEnabled()) {
    if (adminAuth.isProtectedApiPath(pathname, req.method) && !adminAuth.isMonitorBypass(req, pathname, req.method)) {
      const session = adminAuth.getSessionFromRequest(req, DATA_DIR);
      // Operator automation: valid PIKO_API_KEY satisfies admin-protected API paths
      // (eval-gate, adapters, workers). Browser HQ still uses the session cookie.
      let apiKeyOk = false;
      if (!session) {
        try {
          const { keyMatches, presentedKey } = require('./lib/apiAuth');
          const { query: q } = parseUrl(req.url);
          apiKeyOk = keyMatches(presentedKey(req, q));
        } catch (_) { apiKeyOk = false; }
      }
      if (!session && !apiKeyOk) {
        return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized', login: '/admin/login' }));
      }
      if (session && session.role === 'client' && adminAuth.isOperatorOnlyApiPath(pathname)) {
        return send(res, 403, JSON.stringify({ ok: false, error: 'Operator access required' }));
      }
    }
    if (req.method === 'GET' && adminAuth.isProtectedPagePath(pathname)) {
      const session = adminAuth.getSessionFromRequest(req, DATA_DIR);
      if (session && session.role === 'client' && adminAuth.isOperatorOnlyPagePath(pathname)) {
        // Clients who wander into operator pages go back to their dashboard.
        const rawPrefix = String(req.headers['x-forwarded-prefix'] || '').trim();
        const prefix = isSafePathPrefix(rawPrefix) ? stripTrailingSlash(rawPrefix) : '';
        res.writeHead(302, { Location: `${prefix}/ios-dashboard` });
        res.end();
        return;
      }
      if (!session) {
        // When served behind a path-stripping proxy (e.g. /piko-ei/*), the
        // browser needs the public prefix back or it lands on the wrong app.
        const rawPrefix = String(req.headers['x-forwarded-prefix'] || '').trim();
        const prefix = isSafePathPrefix(rawPrefix) ? stripTrailingSlash(rawPrefix) : '';
        const next = encodeURIComponent(pathname);
        res.writeHead(302, { Location: `${prefix}/admin/login?next=${next}` });
        res.end();
        return;
      }
    }
  }

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

  if (await handleLaskoModerationRoute(req, res, pathname, { readBody, send, log })) return;

  // —— Chat routes (extracted: routes/chat.js; pipeline body still handleApiChat) ——
  if (pathname === '/api/chat' || pathname.startsWith('/api/chat/')) {
    const { tryHandleChat } = require('./routes/chat');
    if (await tryHandleChat(req, res, {
      pathname,
      send,
      readBody,
      sessionStore,
      isAutomationSession,
      parseUrl,
      adminAuth,
      handleApiChat,
    })) return;
  }

  if (req.method === 'POST' && pathname === '/api/ios-hub') {
    return handleIosHub(req, res);
  }

  // —— YOLO / HITL / upload (extracted: routes/yolo.js) ——
  {
    const { tryHandleYolo } = require('./routes/yolo');
    if (await tryHandleYolo(req, res, {
      pathname,
      send,
      readBody,
      parseUrl,
      checkYoloOrSessionAuth,
      yoloBridge,
      opsMonitor,
      pikoUpload,
      toLowerAsciiish,
    })) return;
  }

  if (req.method === 'GET' && pathname === '/api/notifications/recent') {
    try {
      const u = new URL(req.url, 'http://localhost');
      const limit = Math.min(100, Math.max(1, parseInt(u.searchParams.get('limit') || '40', 10) || 40));
      const { readMergedNotifications, getCategoryMeta } = require('./lib/notificationFeed');
      const { polishNotificationText } = require('./lib/operatorVoice');
      const items = readMergedNotifications(limit).map((n) => ({
        ...n,
        text: polishNotificationText(n.text),
      }));
      return send(res, 200, JSON.stringify({
        ok: true,
        items,
        categories: getCategoryMeta(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notifications failed' }));
    }
  }

  // —— Agents / missions / jobs (extracted: routes/agents.js) ——
  if (pathname === '/api/agents' || pathname.startsWith('/api/agents/')) {
    const { tryHandleAgents } = require('./routes/agents');
    if (await tryHandleAgents(req, res, {
      pathname,
      send,
      readBody,
      rootDir: __dirname,
      matchPath,
    })) return;
  }

  // —— Cultures / EI (extracted: routes/cultures.js) ——
  if (pathname.startsWith('/api/cultures') || pathname.startsWith('/api/ei/') || pathname === '/api/llm-usage') {
    const { tryHandleCultures } = require('./routes/cultures');
    if (await tryHandleCultures(req, res, {
      pathname,
      send,
      readBody,
      matchPath,
      rootDir: __dirname,
      getTenantBackgroundProfile,
      adminAuth,
      dataDir: DATA_DIR,
    })) return;
  }

  // —— Mobile sync / push (extracted: routes/mobile.js) ——
  if (pathname.startsWith('/api/mobile/')) {
    const { tryHandleMobile } = require('./routes/mobile');
    if (await tryHandleMobile(req, res, {
      pathname,
      send,
      readBody,
      parseUrl,
      healthApiKey: PIKO_HEALTH_API_KEY,
      port: PORT,
      ollamaModel: OLLAMA_MODEL,
      getMobileLanBaseURL,
      getMobilePublicBaseURL,
      buildIntentSnapshot,
      loadState,
      getCachedOllamaHealth,
      decideMobilePoll,
      proactiveEngine,
      getMobileReliabilityMetrics,
      upsertDeviceHeartbeat,
      registerPushToken,
      recordPushAck,
      toLiveActivityPayload,
      loadProactivePolicy,
      saveProactivePolicy,
      makeWeakEtag,
      parseIfMatchVersion,
      buildMobilePolicyPatch,
      loadMobilePreferences,
      saveMobilePreferences,
    })) return;
  }

  // —— Ops metrics/logs (extracted: routes/ops.js) ——
  if (req.method === 'GET' && (pathname === '/api/metrics' || pathname === '/api/ops/metrics' || pathname === '/api/logs')) {
    const { tryHandleOps } = require('./routes/ops');
    if (await tryHandleOps(req, res, {
      pathname,
      send,
      startTime,
      metrics,
      parseUrl,
      logPath: LOG_PATH,
      fs,
    })) return;
  }

  if (handleConversationQualityRoute(req, res, pathname, metrics, send)) return;

  // —— Webhooks (extracted: routes/webhooks.js) ——
  {
    const { tryHandleWebhooks } = require('./routes/webhooks');
    if (tryHandleWebhooks(req, res, {
      pathname,
      send,
      readBody,
      webhookSecret: PIKO_WEBHOOK_SECRET,
      telegramNotify,
      processWebhookEvent,
      postJsonToUrl,
      appendPendingNotification,
      legionBase: LEGION_ADAPTER_API_BASE,
      legionBearer: LEGION_ADAPTER_API_BEARER,
      log,
    })) return;
  }

  // —— Control panel (extracted: routes/control.js) ——
  {
    const { tryHandleControl } = require('./routes/control');
    if (await tryHandleControl(req, res, {
      pathname,
      send,
      readBody,
      parseUrl,
      matchPath,
      stripTrailingSlash,
      rootDir: __dirname,
      dataDir: DATA_DIR,
      legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
      sendLegionCommand,
      loadProactivePolicy,
      saveProactivePolicy,
      listLegateDecisions,
      findDecisionByTrace,
      executeDecisionAction,
      recordLegateObsEvent,
      loadLegateRollout,
      saveLegateRollout,
      canExecuteProductionAction,
      getLegateLinkReliability,
      getLegateObservability,
      getLegateSloSnapshot,
      getLegateTraceCorrelation,
      listLegateActionDeadLetters,
      replayDecisionActionDeadLetter,
      loadIntents,
      loadRules,
      createRule,
      updateRule,
      deleteRule,
      toggleRule,
      listDevices,
      getMobileReliabilityMetrics,
      listConnectors,
      getConnectorHealth,
      buildConnectorContext,
      invokeConnector,
      proactiveEngine,
      proactiveCycleRunner,
      loadLinkedAccounts,
      saveLinkedAccounts,
      gmailAccessToken: GMAIL_ACCESS_TOKEN,
      gmailRefreshToken: GMAIL_REFRESH_TOKEN,
      gmailClientId: GMAIL_CLIENT_ID,
      gmailClientSecret: GMAIL_CLIENT_SECRET,
      gmailOAuthScopes: GMAIL_OAUTH_SCOPES,
      gmailOAuthStateMap,
      slackClientId: SLACK_CLIENT_ID,
      slackClientSecret: SLACK_CLIENT_SECRET,
      slackOAuthScopes: SLACK_OAUTH_SCOPES,
      slackOAuthStateMap,
      notionClientId: NOTION_CLIENT_ID,
      notionClientSecret: NOTION_CLIENT_SECRET,
      notionOAuthStateMap,
      pikoBaseUrl: PIKO_BASE_URL,
      httpsRequest,
      persistEnvVar,
      clearEnvVar,
      envHasKey,
      upsertEnvLine,
      removeNewlines,
      loadRegistry,
      getModelOpsOverview,
      upsertModel,
      promoteModel,
      rollbackModel,
      getLatestGateEvaluation,
      modelGateBlockCandidate: MODEL_GATE_BLOCK_CANDIDATE,
      setCurrentModelOverride,
      eaAlertsFile: EA_ALERTS_FILE,
      loadMobilePreferences,
      saveMobilePreferences,
      ai,
      ollamaModel: OLLAMA_MODEL,
      sessionStore,
      log,
      moltbookApiKey: MOLTBOOK_API_KEY,
      fetchMoltbookProfile,
      fetchMoltbookPostsByPiko,
      loadAllowlist,
      pendingNotificationsFile: PENDING_NOTIFICATIONS_FILE,
      promptsDir: PROMPTS_DIR,
      learningDir: LEARNING_DIR,
      splitLines,
      splitMarkdownH2,
      startsWithYyyyMmDd,
      stripWrappingQuotes,
      stripMarkdownFromText,
      stripListMarker,
      replaceAllLiteral,
    })) return;
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


  if (req.method === 'GET' && pathname === '/api/observe/summary') {
    try {
      const { buildObserveSummary } = require('./lib/observeApi');
      const { checkLegionAdapterHealth } = require('./lib/legionAdapterHealth');
      const summary = await buildObserveSummary({
        dataDir: DATA_DIR,
        rootDir: __dirname,
        legionAdapterBase: LEGION_ADAPTER_API_BASE,
        checkAdapterHealth: checkLegionAdapterHealth,
        loadIntents,
      });
      return send(res, 200, JSON.stringify(summary));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'observe summary failed' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/mgmt/config') {
    if (!checkMgmtOperatorAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    try {
      const { loadSiteManifest } = require('./lib/siteManifest');
      const site = loadSiteManifest(__dirname);
      return send(res, 200, JSON.stringify({
        ok: true,
        tenant_id: site.tenant_id,
        site,
        env: {
          legion_adapter: LEGION_ADAPTER_API_BASE,
          ausmaker: AUSMAKER_BASE_URL,
          public_url: process.env.PIKO_PUBLIC_BASE_URL || process.env.PIKO_IOS_PUBLIC_URL || site.public?.url || null,
        },
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mgmt config failed' }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/mgmt/deploy/trigger') {
    if (!checkMgmtOperatorAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized — log in at /admin/login or pass API key' }));
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    const action = String(body.action || 'api-ping').trim().toLowerCase();
    const force = body.force === true || body.force === 1 || body.force === '1';
    const allTenants = body.all_tenants === true || body.allTenants === true;
    const { execFile } = require('child_process');
    const scriptMap = {
      'api-ping': path.join(__dirname, 'scripts', 'api-ping-site.js'),
      watch: path.join(__dirname, 'scripts', 'legion-watch.js'),
      'context-refresh': path.join(__dirname, 'scripts', 'context-refresh.js'),
    };
    const script = scriptMap[action];
    if (!script) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Unknown action', allowed: Object.keys(scriptMap) }));
    }
    return new Promise(async (resolve) => {
      const env = { ...process.env };
      if (action === 'context-refresh' && force) env.PIKO_CONTEXT_REFRESH_FORCE = '1';
      const runLocal = () => new Promise((resLocal) => {
        execFile(process.execPath, [script], { timeout: 120000, cwd: __dirname, env }, (err, stdout, stderr) => {
          let parsed = null;
          try { parsed = JSON.parse(String(stdout || '').trim().split('\n').pop()); } catch (_) { /* ignore */ }
          resLocal({
            ok: !err,
            stdout: String(stdout || '').slice(0, 2000),
            stderr: String(stderr || '').slice(0, 500),
            result: parsed,
            error: err ? (err.message || String(err)) : null,
          });
        });
      });

      const local = await runLocal();
      const peers = [];
      if (action === 'context-refresh' && allTenants) {
        try {
          const { loadRegistry } = require('./lib/tenantRegistry');
          const registry = loadRegistry(__dirname);
          const key = (process.env.PIKO_HQ_API_KEY || process.env.PIKO_HEALTH_API_KEY || '').trim();
          for (const t of (registry.tenants || [])) {
            if (!t || t.status !== 'live' || !t.observe_url) continue;
            let base = '';
            try {
              const u = new URL(t.observe_url);
              base = `${u.protocol}//${u.host}`;
            } catch (_) { continue; }
            // Skip self (same host:port as this process)
            const selfPort = String(process.env.PORT || 3000);
            if (base.includes(`127.0.0.1:${selfPort}`) || base.includes(`localhost:${selfPort}`)) continue;
            try {
              const headers = { 'Content-Type': 'application/json' };
              if (key) headers['x-api-key'] = key;
              const resp = await fetch(`${base}/api/mgmt/deploy/trigger`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: 'context-refresh', force: true }),
                signal: AbortSignal.timeout(90000),
              });
              const data = await resp.json().catch(() => ({}));
              peers.push({
                tenant_id: t.tenant_id,
                ok: resp.ok && data.ok !== false,
                status: resp.status,
                result: data.result || data,
              });
            } catch (e) {
              peers.push({ tenant_id: t.tenant_id, ok: false, error: e.message || String(e) });
            }
          }
        } catch (e) {
          peers.push({ ok: false, error: `peer_fanout: ${e.message || e}` });
        }
      }

      const ok = local.ok && peers.every((p) => p.ok !== false || !p.tenant_id);
      send(res, ok ? 200 : 503, JSON.stringify({
        ok: local.ok,
        action,
        forced: force,
        stdout: local.stdout,
        stderr: local.stderr,
        result: local.result,
        peers,
      }));
      resolve();
    });
  }

  if (req.method === 'GET' && pathname === '/api/hq/status') {
    try {
      const { buildHqStatus } = require('./lib/tenantRegistry');
      const status = await buildHqStatus(__dirname, DATA_DIR);
      return send(res, 200, JSON.stringify(status));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'hq status failed' }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/hq/registry') {
    if (!checkHqApiAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    try {
      const { loadRegistry } = require('./lib/tenantRegistry');
      const registry = loadRegistry(__dirname);
      return send(res, 200, JSON.stringify({ ok: true, registry }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'hq registry failed' }));
    }
  }

  const hqConfigMatch = pathname && matchPath(pathname, '/api/hq/tenants/:id/config-push');
  if (req.method === 'POST' && hqConfigMatch) {
    if (!checkHqApiAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    try {
      const { appendAuditLog } = require('./lib/tenantRegistry');
      appendAuditLog(DATA_DIR, {
        action: 'config-push',
        tenant_id: hqConfigMatch.id,
        key: body.key || null,
        value: body.value != null ? String(body.value).slice(0, 500) : null,
        actor: req.headers['x-actor'] || 'hq',
      });
      return send(res, 200, JSON.stringify({ ok: true, tenant_id: hqConfigMatch.id, logged: true }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'config-push failed' }));
    }
  }

  const hqReleaseMatch = pathname && matchPath(pathname, '/api/hq/tenants/:id/release');
  if (req.method === 'POST' && hqReleaseMatch) {
    if (!checkHqApiAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    const tenantId = hqReleaseMatch.id;
    const action = String(body.action || 'api-ping').trim().toLowerCase();
    const { execFile } = require('child_process');
    const scriptMap = {
      'api-ping': path.join(__dirname, 'scripts', 'api-ping-site.js'),
      'context-refresh': path.join(__dirname, 'scripts', 'context-refresh.js'),
    };
    const script = scriptMap[action];
    if (!script) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Unknown action', allowed: Object.keys(scriptMap) }));
    }
    return new Promise((resolve) => {
      execFile(process.execPath, [script], { timeout: 300000, cwd: __dirname }, async (err, stdout, stderr) => {
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '').trim().split('\n').pop()); } catch (_) { /* ignore */ }
        const ok = !err;
        try {
          const { appendReleaseLog, updateTenantFields } = require('./lib/tenantRegistry');
          appendReleaseLog(DATA_DIR, { tenant_id: tenantId, action, ok, actor: req.headers['x-actor'] || 'hq' });
          updateTenantFields(__dirname, tenantId, {
            last_release: new Date().toISOString(),
            last_release_action: action,
            last_release_ok: ok,
          });
        } catch (_) { /* ignore */ }
        send(res, ok ? 200 : 503, JSON.stringify({
          ok,
          tenant_id: tenantId,
          action,
          result: parsed,
          stdout: String(stdout || '').slice(0, 2000),
          stderr: String(stderr || '').slice(0, 500),
        }));
        resolve();
      });
    });
  }

  if (req.method === 'POST' && pathname === '/api/hq/tenants') {
    if (!checkHqApiAuth(req) && !checkMgmtOperatorAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    try {
      const { provisionTenant, appendAuditLog } = require('./lib/tenantRegistry');
      const result = provisionTenant(__dirname, {
        tenant_id: body.tenant_id,
        display_name: body.display_name,
        adapter_id: body.adapter_id,
        node_host: body.node_host,
        piko_port: body.piko_port,
        observe_lan_ip: body.observe_lan_ip,
      });
      try {
        appendAuditLog(DATA_DIR, {
          action: 'tenant-provision',
          tenant_id: result.tenant_id,
          adapter_id: result.row.adapter_id,
          node_host: result.row.node_host,
          actor: req.headers['x-actor'] || 'hq',
        });
      } catch (_) { /* ignore */ }
      return send(res, 200, JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'provision failed' }));
    }
  }

  const hqTenantSetupMatch = pathname && matchPath(pathname, '/api/hq/tenants/:id/setup');
  if (req.method === 'POST' && hqTenantSetupMatch) {
    if (!checkHqApiAuth(req) && !checkMgmtOperatorAuth(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    try {
      const { updateTenantSetup, appendAuditLog } = require('./lib/tenantRegistry');
      const row = updateTenantSetup(__dirname, hqTenantSetupMatch.id, body);
      try {
        appendAuditLog(DATA_DIR, {
          action: 'tenant-setup-update',
          tenant_id: hqTenantSetupMatch.id,
          fields: Object.keys(body || {}),
          actor: req.headers['x-actor'] || 'hq',
        });
      } catch (_) { /* ignore */ }
      return send(res, 200, JSON.stringify({ ok: true, tenant: row }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'setup update failed' }));
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

  // —— Health / site-context / command-centre (extracted: routes/ops.js) ——
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/api/site-context' || pathname === '/api/command-centre/clients')) {
    const { tryHandleOps } = require('./routes/ops');
    if (await tryHandleOps(req, res, {
      pathname,
      send,
      healthApiKey: PIKO_HEALTH_API_KEY,
      modelPrimary: MODEL_PRIMARY,
      ollamaModel: OLLAMA_MODEL,
      ai,
      healthTimeoutMs: OLLAMA_HEALTH_TIMEOUT_MS,
      ollamaSelfHealState,
      maybeTriggerOllamaSelfHeal,
      rootDir: __dirname,
      legionAdapterBase: LEGION_ADAPTER_API_BASE,
    })) return;
  }

  // —— AusMaker telemetry (read-only) ——
  // Purpose: surface compact business signals for Sovereign HUD without duplicating AusMaker logic in Python/iOS.
  if (req.method === 'GET' && pathname === '/api/ausmaker/telemetry') {
    try {
      const { query } = parseUrl(req.url);
      const period = String((query && query.period) || 'today').trim().toLowerCase();
      const safePeriod = ['today', 'week', 'month'].includes(period) ? period : 'today';
      const base = stripTrailingSlash(AUSMAKER_BASE_URL);

      const { getUrl } = require('./lib/legionRunPoller');

      async function fetchSalesSummary(p) {
        const res = await getUrl(`${base}/api/sales/summary?period=${encodeURIComponent(p)}`);
        if (res.statusCode !== 200) return { ok: false, statusCode: res.statusCode, data: null };
        try { return { ok: true, statusCode: res.statusCode, data: JSON.parse(res.body || '{}') }; } catch (_) { return { ok: false, statusCode: res.statusCode, data: null }; }
      }

      // Multi-period momentum (T/W/M). Keep the existing `sales` object as the requested period payload for backward compatibility.
      const salesToday = await fetchSalesSummary('today');
      const salesWeek = await fetchSalesSummary('week');
      const salesMonth = await fetchSalesSummary('month');
      const salesPeriodPayload = safePeriod === 'week' ? salesWeek : (safePeriod === 'month' ? salesMonth : salesToday);
      const sales = salesPeriodPayload.ok ? salesPeriodPayload.data : null;
      const sales_periods = {
        today: salesToday.ok && salesToday.data ? (Number(salesToday.data.total_units_sold) || 0) : 0,
        week: salesWeek.ok && salesWeek.data ? (Number(salesWeek.data.total_units_sold) || 0) : 0,
        month: salesMonth.ok && salesMonth.data ? (Number(salesMonth.data.total_units_sold) || 0) : 0,
      };

      // Forecast cached is cheaper and enough for “inventory health” heuristics.
      const forecastRes = await getUrl(`${base}/api/forecast/cached`);
      let forecast = null;
      if (forecastRes.statusCode === 200) {
        try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
      }

      const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
      const reorderCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder').length : 0;
      const reviewCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'review').length : 0;
      const orderedCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'ordered').length : 0;

      // Simple health heuristic for HUD:
      // - RED if any reorder items exist
      // - YELLOW if any review items exist
      // - GREEN otherwise
      let health = 'GREEN';
      if (reorderCount > 0) health = 'RED';
      else if (reviewCount > 0) health = 'YELLOW';

      // Best-effort “operational sync” timestamp. AusMaker cached forecast includes last_synced_at in the cache key inputs,
      // and may include `_cached_at` in some code paths. We surface whatever exists.
      const sync_ts = (forecast && (forecast.last_synced_at || forecast.last_synced || forecast._cached_at || forecast.timestamp)) || null;

      return send(res, 200, JSON.stringify({
        ok: true,
        source: 'ausmaker',
        baseUrl: base,
        period: safePeriod,
        sales: sales,
        sales_periods,
        forecast: {
          has_cached: !!forecast,
          reorderCount,
          reviewCount,
          orderedCount,
        },
        sync_ts,
        health,
        updated_at: new Date().toISOString(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Telemetry failed' }));
    }
  }

  // —— AusMaker drill-down: reorder list (read-only) ——
  // Purpose: “Zoom” for HUD RED state — list the SKUs driving reorderCount without loading the full forecast into chat context.
  if (req.method === 'GET' && pathname === '/api/ausmaker/reorders') {
    try {
      const { query } = parseUrl(req.url);
      const limit = Math.min(200, Math.max(1, parseInt((query && query.limit) || '50', 10) || 50));
      const base = stripTrailingSlash(AUSMAKER_BASE_URL);
      const { getUrl } = require('./lib/legionRunPoller');

      const forecastRes = await getUrl(`${base}/api/forecast/cached`);
      if (forecastRes.statusCode === 204) {
        return send(res, 200, JSON.stringify({ ok: true, count: 0, items: [], note: 'No cached forecast yet (204). Run a low stock scan to prime the cache.' }));
      }
      if (forecastRes.statusCode !== 200) {
        return send(res, 502, JSON.stringify({ ok: false, error: `AusMaker forecast cached returned ${forecastRes.statusCode}`, statusCode: forecastRes.statusCode }));
      }
      let forecast = null;
      try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
      const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
      const reorderItems = Array.isArray(recs)
        ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder')
        : [];

      const items = reorderItems.slice(0, limit).map((r) => {
        const sku = (r.shopify_sku || r.sku || r.cin7_sku || r.SKU || '').toString().trim();
        return {
          sku,
          cin7_sku: (r.cin7_sku || '').toString().trim() || undefined,
          shopify_sku: (r.shopify_sku || r.sku || '').toString().trim() || undefined,
          flag: (r.flag || '').toString(),
          current_inventory: r.current_inventory ?? r.soh ?? undefined,
          on_order: r.on_order ?? undefined,
          forecasted_demand: r.forecasted_demand ?? r.total_forecasted_units ?? undefined,
          recommended_quantity: r.recommended_quantity ?? r.quantity ?? r.qty ?? undefined,
        };
      }).filter((x) => x.sku);

      return send(res, 200, JSON.stringify({
        ok: true,
        count: reorderItems.length,
        limit,
        items,
        updated_at: new Date().toISOString(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Reorders drill-down failed' }));
    }
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
  const corpusDocMatch = pathname && matchPath(pathname, '/api/corpus/documents/*');
  if (req.method === 'PUT' && corpusDocMatch) {
    if (!canEditCorpus(req)) return send(res, 403, JSON.stringify({ error: 'Corpus edit not allowed from this client' }));
    const docName = decodeURIComponent(corpusDocMatch.rest);
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


  if (req.method === 'GET' && pathname === '/api/widget') {
    const widget = { tensions: 0, nextReminder: null, moltbook: null };
    const generatedAt = new Date().toISOString();
    try {
      const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
      if (fs.existsSync(tensionsPath)) {
        const raw = fs.readFileSync(tensionsPath, 'utf8');
        widget.tensions = splitLines(raw).filter((l) => { const t=l.trim(); return t.startsWith('- '); }).length;
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
        const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#') && !l.toLowerCase().startsWith('- max '));
        dashboard.learning.tensionsCount = lines.length;
        dashboard.learning.firstTension = lines[0] ? lines[0].slice(2).trim().slice(0, 80) : null;
        try { const stat = fs.statSync(tensionsPath); dashboard.tensionsUpdatedDaysAgo = Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)); } catch (_) {}
      } else {
        dashboard.learning.tensionsCount = 0;
        dashboard.learning.firstTension = null;
      }
      if (fs.existsSync(stickyPath)) {
        const raw = fs.readFileSync(stickyPath, 'utf8');
        const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#'));
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
          const blocks = splitMarkdownH2(raw);
          for (let i = 1; i < blocks.length; i++) {
            const headLine = splitLines(blocks[i])[0] || '';
            if (startsWithYyyyMmDd(headLine) && headLine[10] === ':') {
              const d = headLine.slice(0, 10);
              const title = headLine.slice(11).trim().slice(0, 60);
              if (d >= cutoffStr) notesLast7Days++;
              if (!lastNoteDate || d > lastNoteDate) {
                lastNoteDate = d; lastNoteTitle = title;
                const linesB = splitLines(blocks[i]);
                let bi = 1;
                while (bi < linesB.length && linesB[bi].trim() === '') bi++;
                const body = linesB.slice(bi).join('\n').trim().slice(0, 220);
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
          dashboard.researchTopics = splitLines(raw).map((l) => l.trim()).filter(Boolean);
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

  if (req.method === 'GET' && (pathname === '/piko_state.json' || pathname === '/api/piko-state.json')) {
    try {
      if (!fs.existsSync(PIKO_STATE_MANIFEST_PATH)) {
        return send(res, 404, JSON.stringify({
          ok: false,
          error: 'Manifest not found',
          path: PIKO_STATE_MANIFEST_PATH,
          hint: 'Run piko_core.generate_app_manifest() on the host that owns the Legion DB, or set PIKO_STATE_MANIFEST_PATH.',
        }));
      }
      const raw = fs.readFileSync(PIKO_STATE_MANIFEST_PATH, 'utf8');
      return send(res, 200, raw, 'application/json; charset=utf-8');
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'read failed' }));
    }
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

  // —— Phase 3: Control UI dashboard ——

  // —— Phase 3: Chart SVG ——
  if (req.method === 'GET' && pathname === '/api/chart') {
    const { query } = parseUrl(req.url);
    const type = (query && query.type) || 'bar';
    const dataStr = (query && query.data) || '';
    const values = dataStr.split(',').flatMap((p) => p.split(';')).flatMap((p) => collapseWhitespace(p).split(' ')).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
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

  // —— Static HTML / MIME fall-through (extracted: routes/static.js) ——
  {
    const { tryHandleStatic } = require('./routes/static');
    if (await tryHandleStatic(req, res, {
      pathname,
      send,
      publicDir: PUBLIC_DIR,
    })) return;
  }
}

// —— Unified heartbeat (every 5 min): tensions, Moltbook, learning dir ——
function checkTensions() {
  try {
    const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      const count = splitLines(raw).filter((l) => { const t=l.trim(); return t.startsWith('- '); }).length;
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

// Nightly history dump: write sessionStore conversations to HISTORY_DIR/YYYY-MM-DD.txt
function dumpHistory(forDate) {
  try {
    const { dumpHistory: writeDump } = require('./lib/historyDump');
    const filePath = writeDump(forDate, HISTORY_DIR);
    console.log('[history] Dumped to', filePath);
  } catch (e) {
    console.error('[history] Dump failed:', e.message);
  }
}

let lastDumpDate = new Date().toISOString().slice(0, 10);

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Piko WebChat http://0.0.0.0:${PORT} (Ollama: ${OLLAMA_MODEL})`);
  console.log(`[tenant] ${TENANT_BG.display_name} (${TENANT_BG.tenant_id}) background jobs profile=${TENANT_BG.profileId}`);
  try {
    const bootAdmin = require('./lib/adminAuth');
    if (bootAdmin.mustFailClosed(DATA_DIR)) bootAdmin.logUnconfiguredOnce();
  } catch (_) { /* ok */ }
  try {
    const { startAgentWorker } = require('./lib/agentWorker');
    startAgentWorker(__dirname);
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] agent worker:', e.message);
  }
  // P3.1d: tenant-gated scheduler registry (campaign + previously ungated crons).
  const { createScheduler, cultureOnly, always, jobEnabled } = require('./lib/scheduler');
  const bootScheduler = createScheduler({
    rootDir: __dirname,
    getTenantProfile: () => getTenantBackgroundProfile(__dirname),
  });
  const { isJobEnabled } = require('./lib/operationsOverrides');
  const TENANT_JOB_BY_OPS_ID = {
    'proactive-cycle': 'proactive_cycle',
    'intent-poller': 'intent_poller',
    'legion-watch': 'legion_watch',
    'api-ping': 'api_ping',
    'legion-backup': 'legion_backup',
    'context-refresh': 'context_refresh',
    'nightly-wisdom': 'nightly_wisdom',
    'nightly-quant': 'nightly_quant',
    'daily-memory-summarize': 'daily_memory_summarize',
    'rabbit-hole-daily': 'rabbit_hole_daily',
    'meta-reflection-weekly': 'meta_reflection_weekly',
    'ea-lookin': 'ea_lookin',
  };
  const runExternalOpScript = (jobId, scriptRel) => {
    const tenantJob = TENANT_JOB_BY_OPS_ID[jobId];
    if (tenantJob && !isBackgroundJobEnabled(tenantJob, __dirname)) return;
    if (!isJobEnabled(jobId)) return;
    const cwd = __dirname;
    exec(`node ${scriptRel}`, { cwd, env: process.env, timeout: 300000 }, (err) => {
      if (err) log('error', 'ops_external', { jobId, message: err.message });
    });
  };
  bootScheduler.register({
    id: 'campaign_cycle_enqueue',
    intervalMs: 60 * 1000,
    tenantGate: cultureOnly,
    fn: async () => {
      const { dueForCycle } = require('./lib/eiResearchCampaign');
      if (!dueForCycle()) return;
      const { enqueueAgentJob } = require('./lib/agentOrchestrator');
      const { listJobs } = require('./lib/agentJobs');
      const pending = listJobs(60)
        .some((j) => j.type === 'campaign_cycle' && ['pending', 'running'].includes(j.status));
      if (pending) return;
      enqueueAgentJob('campaign_cycle', { source: 'scheduler' }, { rootDir: __dirname });
      console.log('[campaign] enqueued research campaign cycle');
    },
  });
  if (isBackgroundJobEnabled('friday_closer', __dirname)) {
    try {
      const { startFridayCloser } = require('./scripts/fridayCloser');
      startFridayCloser();
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Friday Closer:', e.message);
    }
  }
  if (isBackgroundJobEnabled('proactive_thinker', __dirname)) {
    try {
      const { startProactiveLoop } = require('./scripts/proactiveThinker');
      startProactiveLoop();
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Proactive Thinker:', e.message);
    }
  }
  if (isBackgroundJobEnabled('manifest_refresh', __dirname)) {
    try {
      startManifestRefreshLoop();
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[boot] Manifest refresh:', e.message);
    }
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
  if (isBackgroundJobEnabled('unified_heartbeat', __dirname)) runUnifiedHeartbeat();
  if (isBackgroundJobEnabled('proactive_cycle', __dirname)) {
    proactiveCycleRunner.run('boot', { skipIfBusy: true }).catch((e) => {
      log('error', 'proactive_cycle_boot', { code: e.code || '', message: e.message });
    });
  }
  // P3.1d — all boot crons/intervals register here (tenantGate + structured scheduler_run).
  bootScheduler.register({
    id: 'unified_heartbeat',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('unified_heartbeat', __dirname),
    fn: async () => { runUnifiedHeartbeat(); },
  });
  bootScheduler.register({
    id: 'tripwire_eval',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('tripwire', __dirname),
    fn: async () => {
      const { evaluateTripwires } = require('./lib/tripwireEngine');
      await evaluateTripwires(async (alertMessage) => {
        console.log('[TRIPWIRE TRIGGERED]:', alertMessage.slice(0, 120) + (alertMessage.length > 120 ? '…' : ''));
        await telegramNotify(alertMessage, { category: 'tripwire', title: 'Scheduled check', severity: 'warn', source: 'tripwireEngine' });
      });
    },
  });
  bootScheduler.register({
    id: 'ausmaker_watchman',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('ausmaker_watchman', __dirname),
    fn: async () => {
      const AUSMAKER_WATCH_FILE = path.join(DATA_DIR, 'ausmaker-watchman.json');
      const cooldownHours = Math.max(0.25, Number(process.env.PIKO_AUSMAKER_ALERT_COOLDOWN_HOURS || 4));
      const now = Date.now();
      let prev = { health: null, lastAlertAt: 0 };
      try {
        if (fs.existsSync(AUSMAKER_WATCH_FILE)) {
          prev = Object.assign(prev, JSON.parse(fs.readFileSync(AUSMAKER_WATCH_FILE, 'utf8') || '{}'));
        }
      } catch (_) { /* ok */ }
      const base = stripTrailingSlash(AUSMAKER_BASE_URL);
      const { getUrl } = require('./lib/legionRunPoller');
      const forecastRes = await getUrl(`${base}/api/forecast/cached`);
      let forecast = null;
      if (forecastRes.statusCode === 200) {
        try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
      }
      const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
      const reorderCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder').length : 0;
      const reviewCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'review').length : 0;
      const orderedCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'ordered').length : 0;
      let health = 'GREEN';
      if (reorderCount > 0) health = 'RED';
      else if (reviewCount > 0) health = 'YELLOW';
      const salesRes = await getUrl(`${base}/api/sales/summary?period=today`);
      let salesTodayUnits = 0;
      try {
        if (salesRes.statusCode === 200) {
          const s = JSON.parse(salesRes.body || '{}');
          salesTodayUnits = Number(s.total_units_sold) || 0;
        }
      } catch (_) { /* ok */ }
      const syncTs = (forecast && (forecast.last_synced_at || forecast._cached_at || forecast.timestamp)) || null;
      const wasRed = String(prev.health || '').toUpperCase() === 'RED';
      const isRed = String(health).toUpperCase() === 'RED';
      const cooledDown = (now - Number(prev.lastAlertAt || 0)) >= cooldownHours * 3600 * 1000;
      if (!wasRed && isRed && cooledDown) {
        const msg = [
          '⚠️ **SOVEREIGN ALERT: AUSMAKER AT RISK**',
          '',
          'Inventory health is now **RED**.',
          `- Reorders Required: **${reorderCount}**`,
          `- Reviews Pending: **${reviewCount}**`,
          `- Ordered (awaiting): **${orderedCount}**`,
          `- Sales Today (units): **${Math.round(salesTodayUnits)}**`,
          syncTs ? `- Last Sync: **${String(syncTs)}**` : null,
        ].filter(Boolean).join('\n');
        await telegramNotify(msg);
        prev.lastAlertAt = now;
      }
      prev.health = health;
      prev.reorderCount = reorderCount;
      prev.reviewCount = reviewCount;
      prev.orderedCount = orderedCount;
      prev.salesTodayUnits = salesTodayUnits;
      prev.sync_ts = syncTs;
      prev.updated_at = new Date().toISOString();
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(AUSMAKER_WATCH_FILE, JSON.stringify(prev, null, 2), 'utf8');
      } catch (_) { /* ok */ }
    },
  });
  bootScheduler.register({
    id: 'daily_digest',
    cronExpr: '* * * * *',
    tenantGate: jobEnabled('tripwire', __dirname),
    fn: async () => {
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
    },
  });
  bootScheduler.register({
    id: 'urgency_engine',
    cronExpr: '*/30 9-17 * * *',
    tenantGate: jobEnabled('urgency_engine', __dirname),
    fn: async () => {
      const { runInternalMonologue } = require('./lib/urgencyEngine');
      await runInternalMonologue(async (msg) => await telegramNotify(msg));
    },
  });
  bootScheduler.register({
    id: 'weekly_po',
    cronExpr: '0 16 * * 4',
    tenantGate: jobEnabled('weekly_po', __dirname),
    fn: async () => {
      const { flushWeeklyPO } = require('./lib/tripwireEngine');
      await flushWeeklyPO(async (reportMessage) => {
        await telegramNotify(reportMessage);
      });
    },
  });
  bootScheduler.register({
    id: 'history_dump',
    cronExpr: '* * * * *',
    tenantGate: jobEnabled('history_dump', __dirname),
    fn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (today > lastDumpDate) {
        dumpHistory(lastDumpDate);
        lastDumpDate = today;
      }
    },
  });
  bootScheduler.register({
    id: 'proactive_cycle',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('proactive_cycle', __dirname),
    fn: async () => {
      if (!isJobEnabled('proactive-cycle')) return;
      await proactiveCycleRunner.run('scheduler', { skipIfBusy: true });
    },
  });
  bootScheduler.register({
    id: 'intent_poller',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('intent_poller', __dirname),
    fn: async () => {
      if (!isJobEnabled('intent-poller')) return;
      await new Promise((resolve) => {
        exec('node scripts/intent-poller.js', { cwd: __dirname, env: process.env, timeout: 60000 }, (err) => {
          if (err) log('error', 'intent_poller', { message: err.message }, null);
          resolve();
        });
      });
    },
  });
  bootScheduler.register({
    id: 'legion_watch',
    cronExpr: '*/5 * * * *',
    tenantGate: jobEnabled('legion_watch', __dirname),
    fn: async () => { runExternalOpScript('legion-watch', 'scripts/legion-watch.js'); },
  });
  bootScheduler.register({
    id: 'api_ping',
    cronExpr: '*/15 * * * *',
    tenantGate: jobEnabled('api_ping', __dirname),
    fn: async () => { runExternalOpScript('api-ping', 'scripts/api-ping-site.js'); },
  });
  bootScheduler.register({
    id: 'legion_backup',
    cronExpr: '30 2 * * *',
    tenantGate: jobEnabled('legion_backup', __dirname),
    fn: async () => {
      if (!isJobEnabled('legion-backup')) return;
      await new Promise((resolve) => {
        exec('bash scripts/legion-backup-onbox.sh', { cwd: __dirname, env: process.env, timeout: 300000 }, (err) => {
          if (err) log('error', 'legion_backup', { message: err.message });
          resolve();
        });
      });
    },
  });
  bootScheduler.register({
    id: 'context_refresh',
    cronExpr: '0 6,12,18 * * *',
    tenantGate: jobEnabled('context_refresh', __dirname),
    fn: async () => { runExternalOpScript('context-refresh', 'scripts/context-refresh.js'); },
  });
  // Continuous mind loop — processes due intents every 60s when ReAct agent enabled
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
  bootScheduler.register({
    id: 'nightly_wisdom',
    cronExpr: '0 2 * * *',
    tenantGate: jobEnabled('nightly_wisdom', __dirname),
    fn: async () => {
      if (!isJobEnabled('nightly-wisdom')) return;
      await require('./scripts/nightly_wisdom').runNightlyWisdom();
    },
  });
  bootScheduler.register({
    id: 'ei_platform_eval',
    cronExpr: '30 3 * * *',
    tenantGate: jobEnabled('ei_platform_eval', __dirname),
    fn: async () => {
      const { isAgentOrchEnabled, enqueueAgentJob } = require('./lib/agentOrchestrator');
      if (!isAgentOrchEnabled(__dirname)) return;
      const queued = enqueueAgentJob('ei_platform_eval', {
        source: 'cron:nightly',
        notify: true,
        notify_telegram: true,
      }, { rootDir: __dirname });
      log('info', 'ei_platform_eval', { queued: queued.ok, job_id: queued.job && queued.job.id }, null);
    },
  });
  bootScheduler.register({
    id: 'ei_engineering_queue',
    cronExpr: '*/15 * * * *',
    tenantGate: jobEnabled('ei_engineering_queue', __dirname),
    fn: async () => {
      const { tickEngineeringQueue } = require('./lib/eiEngineeringQueue');
      const out = tickEngineeringQueue(__dirname);
      if (out.processed > 0) log('info', 'ei_engineering_queue', out, null);
    },
  });
  bootScheduler.register({
    id: 'ei_stance_synthesis',
    cronExpr: '15 4 * * *',
    tenantGate: jobEnabled('ei_stance_synthesis', __dirname),
    fn: async () => {
      const { runStanceSynthesis } = require('./lib/eiStancePositions');
      const out = await runStanceSynthesis({});
      log('info', 'ei_stance_synthesis', {
        rebuilt: out.rebuilt,
        skipped: (out.skipped || []).length,
      }, null);
    },
  });
  bootScheduler.register({
    id: 'ei_quarantine_cleanup',
    cronExpr: '30 5 * * *',
    tenantGate: jobEnabled('ei_quarantine_cleanup', __dirname),
    fn: async () => {
      const { purgeExpiredQuarantine } = require('./lib/culturesCorpusApi');
      const out = purgeExpiredQuarantine({});
      if (out.purged > 0) log('info', 'ei_quarantine_cleanup', out, null);
    },
  });
  bootScheduler.register({
    id: 'nightly_quant',
    cronExpr: '0 1 * * *',
    tenantGate: jobEnabled('nightly_quant', __dirname),
    fn: async () => {
      if (!isJobEnabled('nightly-quant')) return;
      const { getConfig } = require('./lib/configManager');
      if (getConfig().nightlyQuantEnabled === false) {
        console.log('[CRON] Nightly Quant Agent disabled in piko_config.json');
        return;
      }
      console.log('[CRON] Waking up Quant Agent for nightly batch forecast...');
      const { deploySubAgent } = require('./lib/legionSwarm');
      const { notifyAdmin } = require('./lib/notifyAdmin');
      const taskContext = 'Deploy the quant agent to run our statistical forecasts and write all SKUs to the database.';
      try {
        const result = await deploySubAgent('quant', taskContext);
        if (result && !result.startsWith('Error:') && !result.includes('Failed after')) {
          await notifyAdmin('Overnight forecasts are done — stock predictions for the whole catalogue are refreshed and ready for today.', {
            category: 'nightly_quant',
            title: 'Overnight forecasts',
            severity: 'info',
            source: 'cron:nightly_quant',
          });
        } else {
          console.error('[CRON] Quant Agent failed:', result || 'No result');
          await notifyAdmin("Last night's forecast run didn't finish, so today's stock predictions may be a day old. Piko will retry tonight automatically.", {
            category: 'nightly_quant',
            title: 'Overnight forecasts',
            severity: 'error',
            source: 'cron:nightly_quant',
            meta: { error: (result || '').slice(0, 500) },
          });
        }
      } catch (e) {
        console.error('[CRON] Quant Agent failed:', e.message);
        await notifyAdmin("Last night's forecast run didn't finish, so today's stock predictions may be a day old. Piko will retry tonight automatically.", {
          category: 'nightly_quant',
          title: 'Overnight forecasts',
          severity: 'error',
          source: 'cron:nightly_quant',
          meta: { error: e.message || 'Unknown error' },
        }).catch(() => {});
      }
    },
  });
  // P3.2c: enqueue-only — heavy belief/memory/retro work runs in the agent worker.
  bootScheduler.register({
    id: 'belief-consolidation',
    cronExpr: '0 3 * * *',
    tenantGate: always,
    fn: async () => {
      if (!isJobEnabled('belief-consolidation')) return;
      const { enqueueAgentJob } = require('./lib/agentOrchestrator');
      const { listJobs } = require('./lib/agentJobs');
      const pending = listJobs(60).some((j) => j.type === 'belief_consolidation'
        && ['pending', 'running'].includes(j.status));
      if (pending) return;
      enqueueAgentJob('belief_consolidation', { source: 'scheduler' }, { rootDir: __dirname });
    },
  });
  bootScheduler.register({
    id: 'memory-consolidation',
    cronExpr: '0 3 * * 0',
    tenantGate: always,
    fn: async () => {
      if (!isJobEnabled('memory-consolidation')) return;
      const { enqueueAgentJob } = require('./lib/agentOrchestrator');
      const { listJobs } = require('./lib/agentJobs');
      const pending = listJobs(60).some((j) => j.type === 'memory_consolidation'
        && ['pending', 'running'].includes(j.status));
      if (pending) return;
      enqueueAgentJob('memory_consolidation', { source: 'scheduler' }, { rootDir: __dirname });
    },
  });
  bootScheduler.register({
    id: 'weekly-retro',
    cronExpr: '0 8 * * 0',
    tenantGate: always,
    fn: async () => {
      if (!isJobEnabled('weekly-retro')) return;
      const { enqueueAgentJob } = require('./lib/agentOrchestrator');
      const { listJobs } = require('./lib/agentJobs');
      const pending = listJobs(60).some((j) => j.type === 'weekly_retro'
        && ['pending', 'running'].includes(j.status));
      if (pending) return;
      enqueueAgentJob('weekly_retro', { source: 'scheduler' }, { rootDir: __dirname });
    },
  });
  bootScheduler.register({
    id: 'daily_memory_summarize',
    cronExpr: '0 0 * * *',
    tenantGate: jobEnabled('daily_memory_summarize', __dirname),
    fn: async () => { runExternalOpScript('daily-memory-summarize', 'scripts/daily-memory-summarize.js'); },
  });
  bootScheduler.register({
    id: 'rabbit_hole_daily',
    cronExpr: '0 23 * * *',
    tenantGate: jobEnabled('rabbit_hole_daily', __dirname),
    fn: async () => { runExternalOpScript('rabbit-hole-daily', 'scripts/rabbit-hole-daily.js'); },
  });
  bootScheduler.register({
    id: 'meta_reflection_weekly',
    cronExpr: '0 10 * * 0',
    tenantGate: jobEnabled('meta_reflection_weekly', __dirname),
    fn: async () => { runExternalOpScript('meta-reflection-weekly', 'scripts/meta-reflection-weekly.js'); },
  });
  bootScheduler.register({
    id: 'ea_lookin',
    cronExpr: '*/30 * * * *',
    tenantGate: jobEnabled('ea_lookin', __dirname),
    fn: async () => { runExternalOpScript('ea-lookin', 'scripts/ea-lookin.js'); },
  });

  try {
    const n = bootScheduler.startAll();
    console.log(`[scheduler] started ${n} jobs: ${bootScheduler.list().map((j) => j.id).join(', ')}`);
  } catch (e) {
    console.warn('[boot] scheduler start:', e.message);
  }

  console.log(`[heartbeat] tenant profile=${TENANT_BG.profileId}; shared jobs on; AusMaker ops ${TENANT_BG.isAusmaker ? 'enabled' : 'disabled'}`);
});
