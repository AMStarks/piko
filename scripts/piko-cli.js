#!/usr/bin/env node
/**
 * Piko global CLI — piko chat, piko doctor, piko intents.
 * Env: PIKO_WEBCHAT_URL (default http://localhost:3000).
 * Run: node scripts/piko-cli.js chat "hello" | doctor | intents
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const REPO_ROOT = path.resolve(__dirname, '..');
const WEBCHAT_DIR = path.join(REPO_ROOT, 'webchat-piko');
const DATA_DIR = path.join(WEBCHAT_DIR, 'data');
const SKILLS_DIR = path.join(WEBCHAT_DIR, 'skills');

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function cmdChat(args) {
  const msg = args.join(' ').trim();
  if (!msg) {
    console.error('Usage: piko chat "your message"');
    process.exit(1);
  }
  const out = await request('/api/chat', 'POST', { message: msg });
  console.log(out.reply || out.error || out.raw || '');
}

async function cmdDoctor() {
  console.log('Piko doctor');
  console.log('- URL:', BASE);

  const [health, control] = await Promise.all([
    request('/api/health').catch(() => ({ ok: false })),
    request('/api/control').catch(() => ({})),
  ]);
  console.log('- Health:', health.ok ? 'OK' : (health.ollama || 'unreachable'));
  if (control.sessionsCount != null) console.log('- Sessions:', control.sessionsCount);
  if (control.intentsCount != null) console.log('- Intents:', control.intentsCount);
  if (control.queueLength != null) console.log('- Queue:', control.queueLength);
  if (control.nextReminderAt) console.log('- Next reminder:', control.nextReminderAt);
  if (control.nextScheduledRun) console.log('- Next scheduled:', control.nextScheduledRun);
  const moltbookPosts = control.moltbook && control.moltbook.posts;
  if (Array.isArray(moltbookPosts)) console.log('- Moltbook posts (Control):', moltbookPosts.length);

  console.log('');
  console.log('Local checks (repo root: ' + REPO_ROOT + '):');
  console.log('- OLLAMA_URL:', process.env.OLLAMA_URL || '(default http://localhost:11434/v1/chat/completions)');
  console.log('- PORT:', process.env.PORT || '3000');
  console.log('- CURSOR_API_KEY:', process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_BOT ? 'set' : '(not set, /task will skip)');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('- data dir:', DATA_DIR, 'OK');
  } catch (e) {
    console.log('- data dir:', DATA_DIR, 'MISSING or not writable');
  }
  try {
    const hasSkills = fs.existsSync(path.join(SKILLS_DIR, 'index.js'));
    console.log('- skills dir:', SKILLS_DIR, hasSkills ? 'OK (index.js present)' : 'no index.js');
  } catch (_) {
    console.log('- skills dir:', SKILLS_DIR, 'MISSING');
  }
  const statePath = path.join(DATA_DIR, 'moltbook-state.json');
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const n = (state.posts && state.posts.length) || 0;
      console.log('- Moltbook state:', n, 'posts');
      if (n < 2) console.log('  ⚠️  Fewer than 2 posts in state — "All posts" may show only 1 until poster runs and accumulates.');
    } catch (_) {
      console.log('- Moltbook state: file present but unreadable');
    }
  } else {
    console.log('- Moltbook state: no moltbook-state.json — run moltbook-poster.js');
  }
  console.log('');
  console.log('Intent poller (reminders/scheduled): add to crontab -e:');
  console.log('  */5 * * * * cd ' + WEBCHAT_DIR + ' && node scripts/intent-poller.js');
}

async function cmdIntents() {
  const out = await request('/api/intents');
  const intents = out.intents || [];
  if (intents.length === 0) {
    console.log('No intents.');
    return;
  }
  intents.forEach((i, idx) => {
    const type = i.type || '?';
    const line = type === 'reminder' ? `${i.time || ''} — ${(i.message || i.text || '').slice(0, 50)}` : type === 'queue' ? (i.task || i.message || '') : type === 'scheduled' ? `${i.run || ''} — ${(i.command || '').slice(0, 40)}` : JSON.stringify(i).slice(0, 60);
    console.log(`${idx + 1}. [${type}] ${line}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = (args[0] || '').toLowerCase();
  const rest = args.slice(1);

  if (cmd === 'chat') return cmdChat(rest);
  if (cmd === 'doctor') return cmdDoctor();
  if (cmd === 'intents') return cmdIntents();

  console.log('Usage: node scripts/piko-cli.js <chat|doctor|intents> [args]');
  console.log('  chat "message"  — POST to /api/chat, print reply');
  console.log('  doctor         — GET /api/health and /api/control, print status');
  console.log('  intents        — GET /api/intents, list intent orders');
  console.log('Set PIKO_WEBCHAT_URL (default http://localhost:3000)');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
