#!/usr/bin/env node
/**
 * Lightweight Telegram + Ollama bot with /cursor handled FIRST (before LLM).
 * Deploy to Optimus: /root/telegram-ollama-bot/bot.js
 * Token: set TELEGRAM_TOKEN env or replace below.
 */
const https = require('https');
const http = require('http');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

dns.setDefaultResultOrder('ipv4first');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
/** WebChat API: same Piko brain as browser. Set PIKO_WEBCHAT_URL to empty to use Ollama directly (fallback). */
const PIKO_WEBCHAT_URL = (process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000').replace(/\/$/, '');
const OLLAMA_URL = 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
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

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
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

async function sendMessage(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) });
  await telegramRequest('/sendMessage', 'POST', body);
}

async function sendChatAction(chatId, action) {
  const body = JSON.stringify({ chat_id: chatId, action });
  await telegramRequest('/sendChatAction', 'POST', body);
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
      const msg = u.message;
      if (msg && msg.text) {
        const chatId = msg.chat.id;
        const text = msg.text.trim();
        (async () => {
          try {
            await processMessage(chatId, text);
          } catch (e) {
            console.error('[ERROR] processMessage:', e.message);
            await sendMessage(chatId, 'Error: ' + e.message).catch(() => {});
          }
        })();
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
 * Parse /task [project] "description".
 * - /task "description" → default project, task = description
 * - /task ProjectName "description" → run in CURSOR_WORKDIR/ProjectName
 */
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

async function processMessage(chatId, message) {
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
  // If PIKO_UNIFIED_SESSION_ID is set, WebChat and Telegram share one history.
  const sessionId = process.env.PIKO_UNIFIED_SESSION_ID || sessionIds.get(chatId) || ('tg-' + String(chatId));
  if (PIKO_WEBCHAT_URL) {
    try {
      const u = new URL(PIKO_WEBCHAT_URL + '/api/chat');
      const body = JSON.stringify({ message, sessionId });
      const opts = { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
      const { statusCode, data } = await httpRequest(opts, body);
      const json = JSON.parse(data);
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
  const body = JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false });
  const u = new URL(OLLAMA_URL);
  const opts = { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
  try {
    const { statusCode, data } = await httpRequest(opts, body);
    const json = JSON.parse(data);
    const reply = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || 'No reply.';
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error('[ERROR] Ollama:', e.message);
    await sendMessage(chatId, 'Ollama error: ' + e.message);
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
