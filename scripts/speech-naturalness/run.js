#!/usr/bin/env node
/**
 * Speech naturalness harness: talk to the model for N turns or up to a duration.
 * Logs every turn so we can review and correct prompts, then revert if needed.
 *
 * Usage:
 *   node run.js --turns 500
 *   node run.js --duration 8   # 8 hours (with --delay between turns)
 *   PIKO_WEBCHAT_URL=https://optimus.example.com node run.js --turns 200
 *
 * Writes: data/naturalness-run-YYYYMMDD-HHMM.json (or --out path)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { buildPrompts } = require('./prompts.js');

const BASE_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const SESSION_ID = process.env.PIKO_NATURALNESS_SESSION || 'naturalness-test';
const DEFAULT_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 90000;

function parseArgs() {
  const args = process.argv.slice(2);
  let turns = null;
  let durationHours = null;
  let delayMs = DEFAULT_DELAY_MS;
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--turns' && args[i + 1] != null) {
      turns = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--duration' && args[i + 1] != null) {
      durationHours = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--delay' && args[i + 1] != null) {
      delayMs = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--out' && args[i + 1] != null) {
      outPath = args[i + 1];
      i++;
    }
  }
  if (turns == null && durationHours == null) turns = 100;
  return { turns, durationHours, delayMs, outPath };
}

function postChat(baseUrl, message, sessionId) {
  return new Promise((resolve, reject) => {
    const u = new URL((baseUrl || '').replace(/\/$/, '') + '/api/chat');
    const body = JSON.stringify({
      message: String(message),
      sessionId: String(sessionId),
    });
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        let reply;
        let error;
        try {
          const json = JSON.parse(data);
          reply = json.reply != null ? json.reply : (json.error ? String(json.error) : '');
          if (json.error) error = json.error;
        } catch (_) {
          reply = data.slice(0, 500);
          error = 'Invalid JSON';
        }
        resolve({
          statusCode: res.statusCode,
          reply: reply || '',
          error: error || (res.statusCode >= 400 ? data.slice(0, 200) : null),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultOutPath() {
  const now = new Date();
  const stamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `naturalness-run-${stamp}.json`);
}

async function main() {
  const { turns: maxTurns, durationHours, delayMs, outPath } = parseArgs();
  const out = outPath || defaultOutPath();
  const startTime = Date.now();
  const endTime =
    durationHours != null ? startTime + durationHours * 60 * 60 * 1000 : null;
  const turns = maxTurns != null ? maxTurns : 5000;
  const prompts = buildPrompts(turns);

  const log = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    sessionId: SESSION_ID,
    maxTurns,
    durationHours,
    delayMs,
    entries: [],
  };

  console.error(`Naturalness harness: ${BASE_URL} session=${SESSION_ID}`);
  if (durationHours != null) {
    console.error(`Run for up to ${durationHours} hours (or until interrupted)`);
  } else {
    console.error(`Run for ${turns} turns`);
  }
  console.error(`Delay between turns: ${delayMs}ms`);
  console.error(`Log: ${out}`);
  console.error('');

  let count = 0;
  for (let i = 0; i < prompts.length; i++) {
    if (endTime != null && Date.now() >= endTime) break;
    const userMessage = prompts[i];
    count++;
    process.stderr.write(`Turn ${count}/${prompts.length} … `);
    try {
      const result = await postChat(BASE_URL, userMessage, SESSION_ID);
      const entry = {
        turn: count,
        userMessage,
        reply: result.reply,
        statusCode: result.statusCode,
        error: result.error || undefined,
        timestamp: new Date().toISOString(),
      };
      log.entries.push(entry);
      if (result.statusCode >= 400) {
        process.stderr.write(`HTTP ${result.statusCode}\n`);
      } else {
        process.stderr.write(`${(result.reply || '').slice(0, 50).replace(/\n/g, ' ')}…\n`);
      }
    } catch (e) {
      log.entries.push({
        turn: count,
        userMessage,
        reply: '',
        error: e.message,
        timestamp: new Date().toISOString(),
      });
      process.stderr.write(`Error: ${e.message}\n`);
    }
    if (i < prompts.length - 1) await sleep(delayMs);
  }

  log.endedAt = new Date().toISOString();
  log.totalTurns = log.entries.length;
  fs.writeFileSync(out, JSON.stringify(log, null, 2), 'utf8');
  console.error(`\nDone. ${log.totalTurns} turns written to ${out}`);
  console.error(`Run: node check.js ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
