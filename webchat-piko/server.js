#!/usr/bin/env node
/**
 * Piko WebChat — serves chat UI and POST /api/chat → Ollama (Llama 3.1 8B).
 * Commands /cursor and /task run same logic as Telegram bot (parity). System prompt from prompts/IDENTITY.md + SOUL.md.
 * After /task, Piko uses discernment (Ollama) to decide if Cursor's result is satisfactory; if not, consults Grok (xAI) for a suggestion. Set GROK_API_KEY to enable.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
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

const DEFAULT_SYSTEM = 'You are ClawFriend (Piko), a witty, empathetic AI assistant. Respond naturally and concisely. No meta-commentary.';

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

const sessions = new Map();
const MAX_HISTORY = 30;
const SLICE_HISTORY = 20;

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

async function ollamaChat(messages) {
  const u = new URL(OLLAMA_URL);
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    messages,
    stream: false,
  });
  const opts = {
    hostname: u.hostname,
    port: u.port || 80,
    path: u.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  const { statusCode, data } = await httpRequest(opts, body);
  const json = JSON.parse(data);
  const reply = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  return reply;
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

async function runTaskCommand(taskCmd) {
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
  const body = await readBody(req);
  let json;
  try {
    json = JSON.parse(body || '{}');
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
  }
  const message = typeof json.message === 'string' ? json.message.trim() : '';
  if (!message) {
    return send(res, 400, JSON.stringify({ error: 'Missing message' }));
  }
  const sessionId = typeof json.sessionId === 'string' ? json.sessionId : null;
  // If PIKO_UNIFIED_SESSION_ID is set, WebChat and Telegram share one history (same key).
  const key = process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'default';

  // —— /new ——
  if (message === '/new') {
    sessions.delete(key);
    return send(res, 200, JSON.stringify({ reply: 'New session.' }));
  }
  // —— /status ——
  if (message === '/status') {
    const statusReply = (TASK_OPTIMUS_ONLY && CURSOR_OPTIMUS_ONLY)
      ? 'Piko is up. /cursor and /task run on Optimus only. /task "your task" in default project (Piko); /task Legion "task" in Legion (/opt/legion).'
      : 'Piko is up. /cursor -version or /cursor -help (single hyphen). /task "your task" runs in default project (Piko). /task OtherProject "your task" runs in that project. When Mac is off, Piko uses Optimus.';
    return send(res, 200, JSON.stringify({ reply: statusReply }));
  }
  // —— /task ——
  const taskCmd = parseTaskCommand(message);
  if (taskCmd && taskCmd.task) {
    const cursorOutput = await runTaskCommand(taskCmd);
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
      ]);
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

  // —— Chat (Ollama) ——
  let history = sessions.get(key) || [];
  history.push({ role: 'user', content: message });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-SLICE_HISTORY).map(({ role, content }) => ({ role, content })),
  ];
  try {
    const reply = await ollamaChat(messages);
    history.push({ role: 'assistant', content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    sessions.set(key, history);
    send(res, 200, JSON.stringify({ reply }));
  } catch (e) {
    console.error('[ERROR] Ollama:', e.message);
    send(res, 502, JSON.stringify({ error: 'Ollama error: ' + e.message }));
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
  const { pathname } = parseUrl(req.url);

  if (req.method === 'POST' && pathname === '/api/chat') {
    return handleApiChat(req, res);
  }

  if (req.method !== 'GET') {
    return send(res, 405, 'Method Not Allowed', 'text/plain');
  }

  const file = pathname === '/' ? '/index.html' : pathname;
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
});
