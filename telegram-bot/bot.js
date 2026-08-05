#!/usr/bin/env node
/**
 * Lightweight Telegram + Ollama bot with /cursor handled FIRST (before LLM).
 * Deploy to Optimus: /root/telegram-ollama-bot/bot.js
 * Token: set TELEGRAM_TOKEN env or replace below.
 *
 * LLM routing: PIKO_WEBCHAT_URL (WebChat gateway) first; fallback uses OLLAMA_URL / OLLAMA_MODEL /
 * OPENAI_API_KEY (Bearer) and OLLAMA_VISION_URL for /api/generate (Llava). All overrideable via env.
 */
const https = require('https');
const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

dns.setDefaultResultOrder('ipv4first');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';

// --- Environment configuration (no hardcoded inference hosts) ---
/** WebChat API: same Piko brain as browser. Set PIKO_WEBCHAT_URL empty to use Ollama direct fallback only. */
const PIKO_WEBCHAT_URL = (process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000').replace(/\/$/, '');
const PIKO_API_KEY = String(process.env.PIKO_API_KEY || '').trim();

/** Headers for spine /api/* — X-Piko-Key required once PIKO_API_AUTH=strict. */
function pikoApiHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (PIKO_API_KEY) headers['X-Piko-Key'] = PIKO_API_KEY;
  return headers;
}
/** OpenAI-compatible chat completions URL (Ollama /v1/chat/completions). */
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:70b-instruct-q4_K_M';
/** Native Ollama generate endpoint (e.g. Llava). Full URL. */
const OLLAMA_VISION_URL = process.env.OLLAMA_VISION_URL || 'http://localhost:11434/api/generate';
const MACBOOK_USER = 'starkers';
const MACBOOK_IP = '192.168.0.245';
const SSH_KEY = '/root/.ssh/id_optimus_to_macbook';
const CURSOR_WORKDIR = '/Users/starkers/Projects';
/** Default project for /task when none specified (subdir of CURSOR_WORKDIR). Override with PIKO_DEFAULT_PROJECT env. */
const DEFAULT_PROJECT = process.env.PIKO_DEFAULT_PROJECT || 'Piko';
/** Cursor CLI path on MacBook (non-interactive SSH has minimal PATH; use full path). */
const CURSOR_CLI = '/usr/local/bin/cursor';
/** Cursor Agent CLI for headless tasks (agent -p --force "task"). */
const AGENT_CLI = '/Users/starkers/.local/bin/agent';
const TASK_TIMEOUT_MS = 600000; // 10 min for autonomous tasks
/** When Mac is off: run Cursor on Optimus (wrapper uses Xvfb + timeout). */
const PROJECTS_OPTIMUS = process.env.PROJECTS_OPTIMUS || '/root/projects';
const CURSOR_OPTIMUS_SCRIPT = process.env.CURSOR_OPTIMUS_SCRIPT || '/root/run-cursor-optimus.sh';
/** Cursor agent on Optimus for /task fallback (e.g. agent or /root/.local/bin/agent). */
const AGENT_CLI_OPTIMUS = process.env.AGENT_CLI_OPTIMUS || 'agent';
/** Optional: PIKO_OPTIMUS_PROJECT_PATHS=Legion:/opt/legion so /task Legion runs in /opt/legion on Optimus. */
function getOptimusProjectDir(project) {
  const raw = process.env.PIKO_OPTIMUS_PROJECT_PATHS || '';
  const map = {};
  raw.split(',').forEach((pair) => {
    const [name, dir] = pair.trim().split(':').map((s) => s.trim());
    if (name && dir) map[name] = dir;
  });
  return map[project] || `${PROJECTS_OPTIMUS}/${project}`;
}
/** When set, /task runs only on Optimus (no Mac try). Use when Mac is rarely on or you want one path only. */
const TASK_OPTIMUS_ONLY = process.env.PIKO_TASK_OPTIMUS_ONLY === 'true' || process.env.PIKO_TASK_OPTIMUS_ONLY === '1';
/** When set, /cursor runs only on Optimus (no Mac try). Matches TASK_OPTIMUS_ONLY for a single path. */
const CURSOR_OPTIMUS_ONLY = process.env.PIKO_CURSOR_OPTIMUS_ONLY === 'true' || process.env.PIKO_CURSOR_OPTIMUS_ONLY === '1';
/** Env for running the Cursor agent on Optimus (agent script requires HOME; systemd may not pass PATH). */
const AGENT_ENV_OPTIMUS = {
  ...process.env,
  HOME: process.env.HOME || '/root',
  PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
};

/** Load system prompt. If PIKO_PROMPTS_DIR is set, use that (same as WebChat — one primary). Else bot dir. */
function loadSystemPrompt() {
  const defaultPrompt = 'You are ClawFriend, a witty and empathetic AI assistant. Respond naturally and concisely. No meta-commentary about messages or commands.';
  const dir = process.env.PIKO_PROMPTS_DIR
    ? path.resolve(process.env.PIKO_PROMPTS_DIR)
    : __dirname;
  let identity = '';
  let soul = '';
  let interests = '';
  try {
    identity = fs.readFileSync(path.join(dir, 'IDENTITY.md'), 'utf8').trim();
  } catch (_) {}
  try {
    soul = fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8').trim();
  } catch (_) {}
  try {
    interests = fs.readFileSync(path.join(dir, 'INTERESTS.md'), 'utf8').trim();
  } catch (_) {}
  const parts = [identity, soul, interests].filter(Boolean);
  if (parts.length) {
    return parts.join('\n\n').trim();
  }
  return defaultPrompt;
}
const SYSTEM_PROMPT = loadSystemPrompt();

const auth = require('./auth.js');
/** chatId -> sessionId for WebChat API (so /new starts fresh). If using Ollama fallback, unused. */
const sessionIds = new Map();
let lastUpdateId = 0;
let isPolling = false;

/** Telegram API from Optimus needs family: 4 (IPv4) or Node times out. */
function telegramRequest(path, method, body) {
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}${path}`,
    method,
    family: 4,
    headers: body ? { 'Content-Type': 'application/json' } : {}
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
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

/** WebChat API timeout: Piko + piko:finetune can take 2+ min cold; allow 3 min. */
const WEBCHAT_TIMEOUT_MS = Number(process.env.PIKO_WEBCHAT_TIMEOUT_MS) || 180000;
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(WEBCHAT_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/** Stream WebChat SSE; onChunk(delta) per chunk, onEdit(fullText) when we have new content (throttled); resolves with full reply or throws. */
function webchatStream(webchatUrl, message, sessionId, onEdit) {
  const u = new URL(webchatUrl.replace(/\/$/, '') + '/api/chat');
  const lib = u.protocol === 'https:' ? https : http;
  const opts = {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname,
    method: 'POST',
    headers: pikoApiHeaders({ Accept: 'text/event-stream' }),
  };
  const body = JSON.stringify({ message, sessionId, stream: true });
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      if (res.statusCode !== 200) {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => reject(new Error(res.statusCode + ' ' + (d || res.statusMessage))));
        return;
      }
      const ctype = String(res.headers && (res.headers['content-type'] || res.headers['Content-Type']) || '').toLowerCase();
      // WebChat sometimes responds with JSON even when stream=true (e.g. fast-path replies or early returns).
      // In that case, treat it as a normal response rather than failing with "Empty stream".
      if (!ctype.includes('text/event-stream')) {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d || '{}');
            if (j && typeof j.reply === 'string') return resolve(j.reply);
            if (j && typeof j.error === 'string') return reject(new Error(j.error));
          } catch (_) {}
          return resolve((d || '').trim());
        });
        return;
      }
      let buf = '';
      let full = '';
      let lastEdit = 0;
      const EDIT_INTERVAL_MS = 600;
      const flushEdit = () => {
        if (full && onEdit && Date.now() - lastEdit >= EDIT_INTERVAL_MS) {
          lastEdit = Date.now();
          onEdit(full).catch(() => {});
        }
      };
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const j = JSON.parse(line.slice(6));
              if (j.content) {
                full += j.content;
                flushEdit();
              }
              if (j.done && j.reply != null) {
                full = j.reply;
                if (onEdit) onEdit(full).catch(() => {});
                resolve(full);
                return;
              }
            } catch (_) {}
          }
        }
      });
      res.on('end', () => {
        if (full && !req.destroyed) resolve(full);
        else if (!full) reject(new Error('Empty stream'));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(WEBCHAT_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function sendMessage(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  await telegramRequest('/sendMessage', 'POST', body);
}

/** Send a message and return its message_id (for later editMessage). */
async function sendMessageWithId(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  const res = await telegramRequest('/sendMessage', 'POST', body);
  const json = JSON.parse(res.data || '{}');
  const messageId = json.result && json.result.message_id;
  return { messageId };
}

async function editMessage(chatId, messageId, text) {
  const body = JSON.stringify({ chat_id: chatId, message_id: messageId, text: String(text).slice(0, 4096) });
  await telegramRequest('/editMessageText', 'POST', body);
}

/** Dismiss Telegram callback spinner (required for good UX on mobile). */
async function answerCallbackQuery(callbackQueryId, opts = {}) {
  const o = { callback_query_id: callbackQueryId };
  if (opts.text) o.text = String(opts.text).slice(0, 200);
  if (opts.show_alert) o.show_alert = true;
  await telegramRequest('/answerCallbackQuery', 'POST', JSON.stringify(o));
}

/** Append HITL footer, clear inline keyboard. Plain text only (avoids Markdown parse errors on prior body). */
async function editMessageHitlFooter(chatId, messageId, baseText, footerLine) {
  const newText = (String(baseText || '').trim() + '\n\n' + footerLine).slice(0, 4096);
  const body = JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    reply_markup: { inline_keyboard: [] },
  });
  const { data } = await telegramRequest('/editMessageText', 'POST', body);
  const j = JSON.parse(data || '{}');
  if (j.ok) return;
  if (/message is not modified|not modified/i.test(String(j.description || ''))) {
    const mk = JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
    await telegramRequest('/editMessageReplyMarkup', 'POST', mk);
    return;
  }
  throw new Error(j.description || data || 'editMessageText failed');
}

async function sendChatAction(chatId, action) {
  const body = JSON.stringify({ chat_id: chatId, action });
  await telegramRequest('/sendChatAction', 'POST', body);
}

/** Get Telegram file download URL from file_id */
async function getFileUrl(fileId) {
  const body = JSON.stringify({ file_id: fileId });
  const res = await telegramRequest('/getFile', 'POST', body);
  const json = JSON.parse(res.data || '{}');
  const fp = json.result && json.result.file_path;
  if (!fp) throw new Error('No file_path in getFile response');
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fp}`;
}

/** Vision: process photo via Ollama Llava. Run `ollama pull llava` first. */
const VISION_TIMEOUT_MS = Number(process.env.PIKO_VISION_TIMEOUT_MS) || 45000;

async function processPhoto(chatId, msg) {
  const caption = (msg.caption || 'Please describe this image in detail.').trim();
  const photoId = msg.photo[msg.photo.length - 1].file_id;
  await sendChatAction(chatId, 'typing').catch(() => {});
  await sendMessage(chatId, '👀 Looking at the image...').catch(() => {});
  const fileUrl = await getFileUrl(photoId);
  const lib = fileUrl.startsWith('https') ? https : http;
  const imageBuffer = await new Promise((resolve, reject) => {
    const u = new url.URL(fileUrl);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', family: 4 };
    lib.get(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
  const base64Image = imageBuffer.toString('base64');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const ollamaRes = await fetch(OLLAMA_VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: 'llava', prompt: caption, images: [base64Image], stream: false }),
    });
    clearTimeout(timeoutId);
    if (!ollamaRes.ok) {
      return await sendMessage(chatId, 'Sorry, I couldn\'t process that image. Run `ollama pull llava` on the server.');
    }
    const llavaData = await ollamaRes.json();
    const response = (llavaData.response || '').trim() || 'I couldn\'t extract anything from that image.';
    await sendMessage(chatId, '👁️ **Vision Analysis:**\n' + response);

    // Memory injection: bridge vision result into webchat so follow-ups like "Any thoughts?" have context
    if (PIKO_WEBCHAT_URL) {
      const sessionId = process.env.PIKO_UNIFIED_SESSION_ID || ('telegram-' + String(chatId));
      const truncated = response.length > 2000 ? response.slice(0, 2000) + '…' : response;
      const cap = (caption || '').trim();
      const capPart = cap ? `with the caption "${cap.slice(0, 500)}"` : '(no caption)';
      const injectionText = `[SYSTEM MEMORY: The user sent a photo ${capPart}. The vision model analyzed it and replied: "${truncated}"]`;
      try {
        const injectRes = await fetch(PIKO_WEBCHAT_URL + '/api/chat/inject', {
          method: 'POST',
          headers: pikoApiHeaders(),
          body: JSON.stringify({ sessionId, role: 'assistant', content: injectionText }),
        });
        if (!injectRes.ok) console.error('[VISION] Inject failed:', injectRes.status);
      } catch (injectErr) {
        console.error('[VISION] Failed to inject vision memory into webchat:', injectErr.message);
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('[VISION] Ollama request timed out.');
      await sendMessage(chatId, '⚠️ I tried to look at the photo, but my vision model (llava) took too long to load into memory. Please try again.');
    } else {
      console.error('[VISION] Failed to process image:', err.message);
      await sendMessage(chatId, '⚠️ Sorry, my vision system encountered an error. Ensure Ollama is running `llava` locally.');
    }
  }
}

/** Voice: transcribe via Groq Whisper, then process as text. Requires GROQ_API_KEY. */
async function processVoice(chatId, msg) {
  if (!process.env.GROQ_API_KEY) {
    return await sendMessage(chatId, 'Voice notes require GROQ_API_KEY. Add it to .env and restart.');
  }
  await sendChatAction(chatId, 'typing').catch(() => {});
  const fileId = msg.voice.file_id;
  const fileUrl = await getFileUrl(fileId);
  const lib = fileUrl.startsWith('https') ? https : http;
  const buffer = await new Promise((resolve, reject) => {
    const u = new url.URL(fileUrl);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', family: 4 };
    lib.get(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
  const tempDir = path.join(__dirname, 'data');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `voice_${fileId.replace(/\W/g, '_')}.ogg`);
  fs.writeFileSync(tempPath, buffer);
  try {
    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-large-v3',
      response_format: 'text',
    });
    const text = (typeof transcription === 'string' ? transcription : (transcription && transcription.text) || '').trim();
    if (!text) return await sendMessage(chatId, 'I couldn\'t transcribe that voice note.');
    await sendMessage(chatId, '🎤 You said: "' + text + '"').catch(() => {});
    await processMessage(chatId, text, msg.reply_to_message || null);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function getUpdates() {
  if (isPolling) return;
  isPolling = true;
  const path = `/getUpdates?offset=${lastUpdateId + 1}&timeout=25`;
  try {
    const { statusCode, data } = await telegramRequest(path, 'GET');
    const json = JSON.parse(data);
    if (!json.ok) {
      console.error('[ERROR] getUpdates API:', json.description || data);
      return;
    }
    if (!Array.isArray(json.result)) return;
    for (const u of json.result) {
      lastUpdateId = u.update_id;
      if (u.callback_query) {
        (async () => {
          try {
            await handleLegionHitlCallback(u.callback_query);
          } catch (e) {
            console.error('[ERROR] callback_query:', e.message);
          }
        })();
        continue;
      }
      const msg = u.message;
      const chatId = msg && msg.chat ? msg.chat.id : null;
      if (msg && chatId) {
        if (msg.photo && Array.isArray(msg.photo) && msg.photo.length) {
          (async () => {
            try {
              await processPhoto(chatId, msg);
            } catch (e) {
              console.error('[ERROR] processPhoto:', e.message);
              await sendMessage(chatId, 'Error: ' + e.message).catch(() => {});
            }
          })();
        } else if (msg.voice) {
          (async () => {
            try {
              await processVoice(chatId, msg);
            } catch (e) {
              console.error('[ERROR] processVoice:', e.message);
              await sendMessage(chatId, 'Error: ' + e.message).catch(() => {});
            }
          })();
        } else if (msg.text) {
          const text = msg.text.trim();
          (async () => {
            try {
              await processMessage(chatId, text, msg.reply_to_message || null);
            } catch (e) {
              console.error('[ERROR] processMessage:', e.message);
              await sendMessage(chatId, 'Error: ' + e.message).catch(() => {});
            }
          })();
        }
      }
    }
  } catch (e) {
    console.error('[ERROR] getUpdates:', e.message || e.code || String(e));
  } finally {
    isPolling = false;
  }
}

/** Normalize /cursor command. In Telegram use single hyphen for flags: /cursor -version, /cursor -help (double hyphen may be stripped). */
function parseCursorCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (t === '/cursor') return { command: '--version' };
  if (t.startsWith('/cursor ')) return { command: t.slice(8).trim() || '--version' };
  if (t.startsWith('/cursor')) return { command: t.slice(7).trim() || '--version' };
  return null;
}

/** Allowed project name: single path segment, no path traversal. */
function isValidProjectName(name) {
  return /^[a-zA-Z0-9_.-]+$/.test(name) && name.length > 0 && !name.includes('..');
}

/**
 * Legion queue handoff (Rodimus). Does not replace /task (Cursor agent).
 * Examples: /legion audit … | /legion fix … | /legion refactor … | /legion task …
 */
function parseLegionCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (t === '/legion') return { taskType: 'legion', instruction: '' };
  if (!t.startsWith('/legion ')) return null;
  const rest = t.slice(8).trim();
  if (!rest) return { taskType: 'legion', instruction: '' };
  if (rest === 'fix') return { taskType: 'fix', instruction: '' };
  if (rest.startsWith('fix ')) return { taskType: 'fix', instruction: rest.slice(4).trim() };
  if (rest === 'refactor') return { taskType: 'scaffold', instruction: '' };
  if (rest.startsWith('refactor ')) return { taskType: 'scaffold', instruction: rest.slice(9).trim() };
  if (rest.startsWith('audit ')) return { taskType: 'audit', instruction: rest.slice(6).trim() };
  if (rest === 'attachment' || rest === 'integrate' || rest === 'api-attachment') {
    return {
      taskType: 'integration_audit',
      instruction:
        'Review every Cin7 and Shopify API for AusMaker. Run integration_survey(), confirm each hook is reachable, and report gaps.',
    };
  }
  if (rest.startsWith('attachment ')) {
    return { taskType: 'integration_audit', instruction: rest.slice(11).trim() };
  }
  if (rest.startsWith('task ')) return { taskType: 'task', instruction: rest.slice(5).trim() };
  return { taskType: 'legion', instruction: rest };
}

/** Natural Legion queue when local dir or SSH target is configured (LEGION_NATURAL_QUEUE=0 to disable). */
function isLegionNaturalQueueEnabled() {
  if (!(process.env.LEGION_QUEUE_LOCAL_DIR || '').trim() && !(process.env.LEGION_QUEUE_SSH || '').trim()) {
    return false;
  }
  const v = (process.env.LEGION_NATURAL_QUEUE || '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

function legionQueueTargetLabel() {
  if ((process.env.LEGION_QUEUE_LOCAL_DIR || '').trim()) return 'Optimus';
  if ((process.env.LEGION_QUEUE_SSH || '').trim()) return 'Rodimus';
  return 'Legion';
}

/**
 * User replied to a Legion Telegram summary (CLARIFY/SUMMARY): bundle prior text + follow-up for Rodimus.
 */
function tryBuildLegionFollowUpInstruction(replyToMsg, userText) {
  if (!replyToMsg || typeof userText !== 'string' || !userText.trim()) return null;
  const prior = String(replyToMsg.text || replyToMsg.caption || '').trim();
  if (!prior) return null;
  const m = prior.match(/Legion — task `([a-zA-Z0-9_-]+)`/);
  if (!m) return null;
  const priorTaskId = m[1];
  if (!/^legion_[a-zA-Z0-9_-]+$/.test(priorTaskId)) return null;
  const priorCap = prior.length > 2800 ? prior.slice(0, 2800) + '\n… (truncated)' : prior;
  return (
    `Legion follow-up to prior task ${priorTaskId}. Prior Legion message:\n\n` +
    priorCap +
    `\n\nUser follow-up:\n${userText.trim()}`
  );
}

const {
  looksLikeIntegrationAttachmentRequest,
  looksLikePikoWorkerRequest,
  looksLikeLegionWorkRequest,
} = require('./lib/legionQueueRouting');

/** Push JSON task to local Legion queue dir (Optimus) or Rodimus via SSH. */
function enqueueLegionQueueLocal(payload) {
  const localDir = (process.env.LEGION_QUEUE_LOCAL_DIR || '').trim();
  if (!localDir) {
    return Promise.reject(new Error('LEGION_QUEUE_LOCAL_DIR is not set'));
  }
  if (!/^[/a-zA-Z0-9._-]+$/.test(localDir)) {
    return Promise.reject(new Error('LEGION_QUEUE_LOCAL_DIR must match /^[/a-zA-Z0-9._-]+$/'));
  }
  const id = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return Promise.reject(new Error('invalid task id'));
  const filePath = path.join(localDir, `${id}.json`);
  if (!filePath.startsWith(localDir)) {
    return Promise.reject(new Error('refusing unsafe local path'));
  }
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/** Push JSON task to Rodimus via SSH (Optimus bot must have key-based SSH to LEGION_QUEUE_SSH). */
function enqueueLegionQueueOnRodimus(payload) {
  const sshTarget = (process.env.LEGION_QUEUE_SSH || '').trim();
  const remoteDir = (process.env.LEGION_QUEUE_REMOTE_DIR || '/home/chief/legion/queue').trim();
  if (!sshTarget) {
    return Promise.reject(new Error('LEGION_QUEUE_SSH is not set (e.g. chief@192.168.0.180)'));
  }
  if (!/^[/a-zA-Z0-9._-]+$/.test(remoteDir)) {
    return Promise.reject(new Error('LEGION_QUEUE_REMOTE_DIR must match /^[/a-zA-Z0-9._-]+$/'));
  }
  const id = String(payload.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return Promise.reject(new Error('invalid task id'));
  const remotePath = `${remoteDir}/${id}.json`;
  if (!/^[/a-zA-Z0-9._-]+$/.test(remotePath)) {
    return Promise.reject(new Error('refusing unsafe remote path'));
  }
  const remoteShell = `mkdir -p '${remoteDir}' && cat > '${remotePath}'`;
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [sshTarget, remoteShell], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ssh exited with code ${code}`));
    });
  });
}

function enqueueLegionQueue(payload) {
  if ((process.env.LEGION_QUEUE_LOCAL_DIR || '').trim()) {
    return enqueueLegionQueueLocal(payload);
  }
  return enqueueLegionQueueOnRodimus(payload);
}

/** Parent task id from Legion notify buttons must fit Telegram callback_data (64 bytes UTF-8). */
function isLegionHitlParentTaskId(approved, taskId) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(taskId)) return false;
  const prefix = approved ? 'APPROVE_' : 'REJECT_';
  return Buffer.byteLength(prefix + taskId, 'utf8') <= 64;
}

async function handleLegionHitlCallback(callbackQuery) {
  const qid = callbackQuery.id;
  const raw = (callbackQuery.data || '').trim();
  await answerCallbackQuery(qid).catch(() => {});

  if (!raw.startsWith('APPROVE_') && !raw.startsWith('REJECT_')) return;
  console.log('[HITL] callback_query:', raw.slice(0, 72));

  const approved = raw.startsWith('APPROVE_');
  const parentTaskId = approved ? raw.slice(8) : raw.slice(7);
  if (!isLegionHitlParentTaskId(approved, parentTaskId)) {
    const cid = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
    if (cid) await sendMessage(cid, 'HITL callback ignored: invalid or oversized task id.').catch(() => {});
    return;
  }

  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const baseText = (msg.text || msg.caption || '').trim();
  const footer = approved ? '— HITL: APPROVED' : '— HITL: REJECTED';

  try {
    await editMessageHitlFooter(chatId, messageId, baseText, footer);
  } catch (err) {
    console.error('[HITL] editMessage failed:', err.message || err);
  }

  if (!approved) {
    await sendMessage(
      chatId,
      `Execution halted. Parent task ${parentTaskId} not sent to Legion queue (staging unchanged).`
    ).catch(() => {});
    return;
  }

  await sendMessage(
    chatId,
    `Queueing signed apply envelope for ${parentTaskId} on ${legionQueueTargetLabel()}…`
  ).catch(() => {});

  const childId = `hitl_apply_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  try {
    await enqueueLegionQueue({
      id: childId,
      type: 'hitl_apply',
      parent_task_id: parentTaskId,
      requested_by: String(chatId),
      status: 'queued',
      timestamp: new Date().toISOString(),
    });
    await sendMessage(
      chatId,
      `${legionQueueTargetLabel()} accepted queue file ${childId}. Legion will consume it on the next cycle.`
    ).catch(() => {});
  } catch (e) {
    console.error('[HITL] enqueue failed:', e.message);
    await sendMessage(chatId, `HITL apply dispatch failed: ${e.message}`).catch(() => {});
  }
}

/** Parse /task [project] "description" for Cursor agent (not Legion). */
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

/** Write TELEGRAM_NOTIFY_CHAT_ID to Optimus legion-queue .env (local queue mode). */
function appendOptimusLegionNotifyChatId(chatId) {
  const envPath = (process.env.LEGION_QUEUE_ENV_FILE || '/opt/legion-queue/.env').trim();
  const cid = String(chatId).replace(/\D/g, '');
  if (!cid) return Promise.reject(new Error('invalid chat id'));
  if (!envPath.startsWith('/') || envPath.includes('..')) {
    return Promise.reject(new Error('refusing unsafe LEGION_QUEUE_ENV_FILE'));
  }
  return new Promise((resolve, reject) => {
    try {
      let body = '';
      if (fs.existsSync(envPath)) {
        body = fs.readFileSync(envPath, 'utf8');
      }
      const line = `TELEGRAM_NOTIFY_CHAT_ID=${cid}`;
      if (/^TELEGRAM_NOTIFY_CHAT_ID=/m.test(body)) {
        body = body.replace(/^TELEGRAM_NOTIFY_CHAT_ID=.*$/m, line);
      } else {
        body = body.trimEnd() + (body.endsWith('\n') || !body ? '' : '\n') + line + '\n';
      }
      fs.writeFileSync(envPath, body, 'utf8');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/** Append TELEGRAM_NOTIFY_CHAT_ID on Rodimus via same SSH as /legion (chief-owned .env). */
function appendRodimusNotifyChatId(chatId) {
  const sshTarget = (process.env.LEGION_QUEUE_SSH || '').trim();
  const cid = String(chatId).replace(/\D/g, '');
  if (!sshTarget || !cid) {
    return Promise.reject(new Error('LEGION_QUEUE_SSH unset or invalid chat id'));
  }
  const remoteShell = `bash -c 'test -w /home/chief/legion/.env || exit 1; grep -q ^TELEGRAM_NOTIFY_CHAT_ID= /home/chief/legion/.env || echo TELEGRAM_NOTIFY_CHAT_ID=${cid} >> /home/chief/legion/.env'`;
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [sshTarget, remoteShell], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ssh exited with code ${code}`));
    });
  });
}

async function processMessage(chatId, message, replyToMsg = null) {
  const textTrim = typeof message === 'string' ? message.trim() : '';
  if (textTrim === '/chatid' || textTrim === '/mychatid' || textTrim === '/id') {
    let extra = '';
    if ((process.env.LEGION_QUEUE_LOCAL_DIR || '').trim()) {
      try {
        await appendOptimusLegionNotifyChatId(chatId);
        extra =
          '\n\nOptimus: TELEGRAM_NOTIFY_CHAT_ID saved to /opt/legion-queue/.env. Restarting legion-queue…';
        await execAsync('systemctl restart legion-queue.service').catch(() => {});
      } catch (e) {
        extra = `\n\nOptimus notify sync failed: ${e.message}\nAdd TELEGRAM_NOTIFY_CHAT_ID=${chatId} to /opt/legion-queue/.env manually.`;
      }
    } else {
      try {
        await appendRodimusNotifyChatId(chatId);
        extra =
          '\n\nRodimus: TELEGRAM_NOTIFY_CHAT_ID written to /home/chief/legion/.env (if it was missing). Restart Legion if needed: sudo systemctl restart legion.service on Rodimus.';
      } catch (e) {
        extra = `\n\nRodimus sync skipped: ${e.message}\nAdd TELEGRAM_NOTIFY_CHAT_ID=${chatId} to /home/chief/legion/.env manually.`;
      }
    }
    return await sendMessage(
      chatId,
      `Your Telegram chat id (numeric):\n${chatId}${extra}`
    );
  }

  const legionHealthSec = process.env.LEGION_HEALTH_HINT_SEC || '120';

  // —— /legion: explicit queue (optional; natural language also works) ——
  const legionCmd = parseLegionCommand(message);
  if (legionCmd) {
    const taskId = `legion_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      id: taskId,
      type: legionCmd.taskType,
      instruction: legionCmd.instruction || textTrim,
      requested_by: String(chatId),
      status: 'queued',
      timestamp: new Date().toISOString(),
    };
    try {
      await enqueueLegionQueue(payload);
      console.log(`[*] Legion queue: dispatched ${taskId} (${legionCmd.taskType})`);
      const where = legionQueueTargetLabel();
      return await sendMessage(
        chatId,
        `Queued on ${where}.\nID: ${taskId}\nType: ${legionCmd.taskType}\nLegion picks this up within ~${legionHealthSec}s. Legion will message you when done.`
      );
    } catch (e) {
      console.error('[ERROR] /legion queue:', e.message);
      return await sendMessage(
        chatId,
        `Legion queue failed: ${e.message}\nSet LEGION_QUEUE_LOCAL_DIR or LEGION_QUEUE_SSH on Optimus.`
      );
    }
  }

  // —— Reply to a Legion message → new Rodimus task (CLARIFY follow-up, etc.) ——
  const legionFollowUpInstr = tryBuildLegionFollowUpInstruction(replyToMsg, textTrim);
  if (legionFollowUpInstr && isLegionNaturalQueueEnabled()) {
    const taskId = `legion_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      id: taskId,
      type: 'conversation',
      instruction: legionFollowUpInstr,
      requested_by: String(chatId),
      status: 'queued',
      timestamp: new Date().toISOString(),
    };
    try {
      await enqueueLegionQueue(payload);
      console.log(`[*] Legion reply-follow-up queue: ${taskId}`);
      const where = legionQueueTargetLabel();
      return await sendMessage(
        chatId,
        `Sent your reply to Legion on ${where}.\nID: ${taskId}\nLegion will incorporate the prior message and your follow-up (usually within ~${legionHealthSec}s to start).`
      );
    } catch (e) {
      console.error('[ERROR] Legion reply-follow-up queue:', e.message);
      return await sendMessage(
        chatId,
        `Legion queue failed: ${e.message}\nSet LEGION_QUEUE_LOCAL_DIR or LEGION_QUEUE_SSH on Optimus.`
      );
    }
  }

  // —— Natural language → Rodimus queue (no /legion prefix) ——
  // AusMaker ops → Piko webchat (adapter) before Legion file queue
  if (PIKO_WEBCHAT_URL && looksLikePikoWorkerRequest(textTrim)) {
    const sessionId = process.env.PIKO_UNIFIED_SESSION_ID || ('telegram-' + String(chatId));
    try {
      const u = new URL(PIKO_WEBCHAT_URL.replace(/\/$/, '') + '/api/chat');
      const body = JSON.stringify({ message: textTrim, sessionId, stream: false });
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        method: 'POST',
        headers: pikoApiHeaders(),
      };
      const lib = u.protocol === 'https:' ? https : http;
      const { statusCode, data } = await new Promise((resolve, reject) => {
        const req = lib.request(opts, (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, data: d }));
        });
        req.on('error', reject);
        req.setTimeout(Math.min(WEBCHAT_TIMEOUT_MS, 120000), () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.write(body);
        req.end();
      });
      const json = JSON.parse(data || '{}');
      if (statusCode === 200 && json.reply != null && String(json.reply).trim()) {
        return await sendMessage(chatId, String(json.reply).trim());
      }
    } catch (workerErr) {
      console.error('[WARN] WebChat worker (pre-queue):', workerErr.message);
    }
  }

  if (isLegionNaturalQueueEnabled() && looksLikeIntegrationAttachmentRequest(textTrim)) {
    const taskId = `legion_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      id: taskId,
      type: 'integration_audit',
      instruction: textTrim,
      requested_by: String(chatId),
      status: 'queued',
      timestamp: new Date().toISOString(),
    };
    try {
      await enqueueLegionQueue(payload);
      console.log(`[*] Legion integration_audit queue: ${taskId}`);
      const where = legionQueueTargetLabel();
      return await sendMessage(
        chatId,
        `Queued Cin7/Shopify API attachment survey on ${where}.\nID: ${taskId}\nLegion will probe every catalogued hook and report here (starts within ~${legionHealthSec}s).`
      );
    } catch (e) {
      console.error('[ERROR] Legion integration_audit queue:', e.message);
    }
  }

  if (isLegionNaturalQueueEnabled() && looksLikeLegionWorkRequest(textTrim)) {
    const taskId = `legion_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      id: taskId,
      type: 'conversation',
      instruction: textTrim,
      requested_by: String(chatId),
      status: 'queued',
      timestamp: new Date().toISOString(),
    };
    try {
      await enqueueLegionQueue(payload);
      console.log(`[*] Legion natural queue: ${taskId}`);
      const where = legionQueueTargetLabel();
      return await sendMessage(
        chatId,
        `Sent to Legion on ${where}.\nID: ${taskId}\nI will analyze the codebase and reply here when finished (usually within ~${legionHealthSec}s to start).`
      );
    } catch (e) {
      console.error('[ERROR] Legion natural queue:', e.message);
      // Fall through to normal WebChat / Ollama chat
    }
  }

  // —— /task: autonomous task (agent -p --force) ——
  const taskCmd = parseTaskCommand(message);
  if (taskCmd && taskCmd.task) {
    if (!auth.isTaskAllowed()) {
      return await sendMessage(chatId, 'Task skipped: CURSOR_API_KEY not set on Optimus. Add it to the bot service (see PIKO_AUTONOMOUS_TASKS.md) and restart.');
    }
    const apiKey = process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_BOT;
    await sendChatAction(chatId, 'typing').catch(() => {});
    const taskEsc = taskCmd.task.replace(/'/g, "'\"'\"'");
    const keyEsc = apiKey.replace(/'/g, "'\"'\"'");
    const workdir = `${CURSOR_WORKDIR}/${taskCmd.project}`;
    const optimusWorkdir = getOptimusProjectDir(taskCmd.project);
    const innerCmd = `cd ${optimusWorkdir} && ${AGENT_CLI_OPTIMUS} --api-key '${keyEsc}' --model auto -p --force '${taskEsc}'`;
    // Run agent under script (PTY) so stdout is line-flushed and Node receives output; without this, exec() gets empty stdout
    const localCmd = `script -q -c ${JSON.stringify(innerCmd)} /dev/null`;
    const execOpts = { timeout: TASK_TIMEOUT_MS, env: AGENT_ENV_OPTIMUS, maxBuffer: 4 * 1024 * 1024 };
    const runOnOptimus = (prefix) => new Promise((resolve, reject) => {
      exec(localCmd, execOpts, (err, stdout, stderr) => {
        const outStr = (stdout && stdout.toString()) || '';
        const errStr = (stderr && stderr.toString()) || '';
        const output = (outStr || errStr || 'Done.').trim();
        const reply = output.length > 3800 ? output.slice(0, 3800) + '\n… (truncated)' : output;
        if (err) {
          console.error('[ERROR] /task Optimus failed:', err.message);
          const detail = (errStr || outStr || err.message || 'agent not installed or timed out').trim().slice(0, 800);
          sendMessage(chatId, 'Optimus task failed: ' + detail).then(resolve).catch(reject);
        } else {
          sendMessage(chatId, (prefix ? prefix + '\n' : '') + reply).then(resolve).catch(reject);
        }
      });
    });

    await sendMessage(chatId, `Running in ${taskCmd.project} (up to ~10 min). I'll reply when done.`).catch(() => {});

    if (TASK_OPTIMUS_ONLY) {
      return await runOnOptimus('');
    }

    const sshCmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${MACBOOK_USER}@${MACBOOK_IP} "cd ${workdir} && ${AGENT_CLI} --api-key '${keyEsc}' --model auto -p --force '${taskEsc}'"`;
    try {
      const { stdout, stderr } = await execAsync(sshCmd, { timeout: TASK_TIMEOUT_MS });
      const output = (stdout || stderr || 'Done.').trim();
      const reply = output.length > 4000 ? output.slice(0, 4000) + '\n… (truncated)' : output;
      return await sendMessage(chatId, 'Task finished:\n' + reply);
    } catch (err) {
      console.error('[ERROR] /task (Mac) failed:', err.message);
      return await runOnOptimus('Mac unreachable; ran on Optimus:');
    }
  }

  // —— /cursor (before any Ollama call) ——
  const cursor = parseCursorCommand(message);
  if (cursor) {
    await sendChatAction(chatId, 'typing').catch(() => {});
    const cmdArg = cursor.command.replace(/"/g, '\\"').replace(/`/g, '\\`');
    const localCmd = `${CURSOR_OPTIMUS_SCRIPT} ${PROJECTS_OPTIMUS} ${cmdArg}`;
    const runCursorOnOptimus = async (prefix) => {
      const { stdout, stderr } = await execAsync(localCmd, { timeout: 95000 });
      const output = (stdout || stderr || 'Done.').trim();
      const reply = output.length > 3800 ? output.slice(0, 3800) + '\n… (truncated)' : output;
      return await sendMessage(chatId, prefix ? prefix + '\n' + reply : reply);
    };
    if (CURSOR_OPTIMUS_ONLY) {
      try {
        return await runCursorOnOptimus('');
      } catch (e2) {
        return await sendMessage(chatId, 'Cursor (Optimus): ' + (e2.message || 'timed out or failed'));
      }
    }
    const sshCmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${MACBOOK_USER}@${MACBOOK_IP} "cd ${CURSOR_WORKDIR} && ${CURSOR_CLI} ${cmdArg}"`;
    try {
      const { stdout, stderr } = await execAsync(sshCmd, { timeout: 120000 });
      const output = (stdout || stderr || 'Done.').trim();
      const reply = output.length > 4000 ? output.slice(0, 4000) + '\n… (truncated)' : output;
      return await sendMessage(chatId, reply);
    } catch (err) {
      console.error('[ERROR] /cursor (Mac) failed:', err.message);
      try {
        return await runCursorOnOptimus('Mac unreachable; ran on Optimus:');
      } catch (e2) {
        return await sendMessage(chatId, 'Mac unreachable. Optimus fallback: ' + (e2.message || 'Cursor timed out or failed'));
      }
    }
  }

  // Other commands
  if (message === '/new') {
    sessionIds.set(chatId, 'tg-' + chatId + '-' + Date.now());
    return await sendMessage(chatId, 'New session.');
  }
  if (message === '/status') {
    const statusMsg = (TASK_OPTIMUS_ONLY && CURSOR_OPTIMUS_ONLY)
      ? 'Piko is up. /cursor and /task run on Optimus only. /task "your task" in default project (Piko); /task Legion "task" in Legion (/opt/legion).'
      : 'Piko is up. /cursor -version or /cursor -help (single hyphen). /task "your task" runs in default project (Piko). /task OtherProject "your task" runs in that project. When Mac is off, Piko uses Optimus.';
    return await sendMessage(chatId, statusMsg);
  }

  // Chat: prefer WebChat API (same Piko as browser), fallback to Ollama
  await sendChatAction(chatId, 'typing').catch(() => {});
  const sessionId = process.env.PIKO_UNIFIED_SESSION_ID || ('telegram-' + String(chatId));
  if (PIKO_WEBCHAT_URL) {
    // AusMaker worker intents: JSON /api/chat first (fast path); SSE stream can hang on ReAct mis-routes.
    if (looksLikePikoWorkerRequest(message)) {
      try {
        const u = new URL(PIKO_WEBCHAT_URL.replace(/\/$/, '') + '/api/chat');
        const body = JSON.stringify({ message, sessionId, stream: false });
        const opts = {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname,
          method: 'POST',
          headers: pikoApiHeaders(),
        };
        const lib = u.protocol === 'https:' ? https : http;
        const { statusCode, data } = await new Promise((resolve, reject) => {
          const req = lib.request(opts, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve({ statusCode: res.statusCode, data: d }));
          });
          req.on('error', reject);
          req.setTimeout(Math.min(WEBCHAT_TIMEOUT_MS, 120000), () => {
            req.destroy();
            reject(new Error('timeout'));
          });
          req.write(body);
          req.end();
        });
        const json = JSON.parse(data || '{}');
        if (statusCode === 200 && json.reply != null && String(json.reply).trim()) {
          await sendMessage(chatId, String(json.reply).trim());
          return;
        }
      } catch (workerErr) {
        console.error('[WARN] WebChat worker JSON:', workerErr.message);
      }
    }
    try {
      // Streaming: accumulate reply, then send one message when done (no placeholder)
      const reply = await webchatStream(PIKO_WEBCHAT_URL, message, sessionId, null);
      if (reply != null && reply.trim()) {
        await sendMessage(chatId, reply.trim());
        return;
      }
    } catch (streamErr) {
      console.error('[WARN] WebChat stream:', streamErr.message);
    }
    try {
      const u = new URL(PIKO_WEBCHAT_URL.replace(/\/$/, '') + '/api/chat');
      const body = JSON.stringify({ message, sessionId });
      const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST', headers: pikoApiHeaders() };
      const lib = u.protocol === 'https:' ? https : http;
      const { statusCode, data } = await new Promise((resolve, reject) => {
        const req = lib.request(opts, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ statusCode: res.statusCode, data: d })); });
        req.on('error', reject);
        req.setTimeout(WEBCHAT_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
      });
      const json = JSON.parse(data || '{}');
      if (statusCode === 200 && json.reply != null) {
        await sendMessage(chatId, json.reply);
        return;
      }
      throw new Error(json.error || 'API error');
    } catch (e) {
      console.error('[WARN] WebChat API:', e.message, '- using Ollama fallback');
    }
  }

  // Fallback: Ollama direct (if WebChat down or PIKO_WEBCHAT_URL unset)
  let history = []; // local fallback only; WebChat holds sessions
  history.push({ role: 'user', content: message });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-20).map(({ role, content }) => ({ role, content }))
  ];
  try {
    const reply = await callOllamaFallback(messages);
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error('[ERROR] Ollama:', e.message);
    await sendMessage(chatId, 'Ollama error: ' + e.message);
  }
}

/**
 * OpenAI-compatible POST to OLLAMA_URL with optional Bearer (Rodimus / LiteLLM alignment).
 * @param {Array<{role:string,content:string}>} messages
 * @returns {Promise<string>}
 */
function ollamaOpenAIChat(messages) {
  const body = JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false });
  const u = new URL(OLLAMA_URL);
  const lib = u.protocol === 'https:' ? https : http;
  const port = u.port || (u.protocol === 'https:' ? 443 : 80);
  const authKey = process.env.OPENAI_API_KEY || 'legion-rodimus-unified';
  const opts = {
    hostname: u.hostname,
    port,
    path: `${u.pathname}${u.search || ''}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authKey}`,
    },
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${(data || '').slice(0, 240)}`));
          return;
        }
        try {
          const json = JSON.parse(data || '{}');
          const reply = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || 'No reply.';
          resolve(reply);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(WEBCHAT_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function callOllamaFallback(messages) {
  try {
    return await ollamaOpenAIChat(messages);
  } catch (error) {
    console.error('[!] Ollama Fallback API Error:', error.message);
    throw error;
  }
}

// Single instance: only one process may poll getUpdates per token (Telegram allows only one getUpdates connection).
const LOCK_FILE = process.env.PIKO_BOT_LOCK_FILE || '/tmp/clawfriend-bot.lock';
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 0); // check if process exists (no kill)
          console.error('[ERROR] Another instance is already running (PID ' + pid + '). Only one instance of this bot may run per token. Stop the other (e.g. on your Mac: quit any terminal running node bot.js).');
          process.exit(1);
        } catch (_) {
          // PID no longer running, stale lock
        }
      }
      fs.unlinkSync(LOCK_FILE);
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
    process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });
  } catch (e) {
    console.error('[ERROR] Could not acquire lock:', e.message);
    process.exit(1);
  }
}

// Poll every 2s
if (!auth.isBotConfigured()) {
  console.error('[ERROR] TELEGRAM_TOKEN (or TELEGRAM_BOT_TOKEN) not set or placeholder. Set it and restart.');
  process.exitCode = 1;
  process.exit(1);
}
acquireLock();
setInterval(getUpdates, 2000);
getUpdates();
console.log('ClawFriend bot running. Chat:', PIKO_WEBCHAT_URL ? 'WebChat API (' + PIKO_WEBCHAT_URL + ')' : 'Ollama direct. /cursor handled first.');
