#!/usr/bin/env node
/**
 * Intent poller — cron every 5 min. Processes due reminders (append to pending-notifications),
 * due scheduled (POST /api/chat with command), optionally runs one queue item.
 * Uses lib/intents.js for load/save/migrate; respects status, snoozedUntil, dueAt, lastFiredAt.
 * Set PIKO_WEBCHAT_URL for scheduled/queue (e.g. http://localhost:3000).
 */
const path = require('path');
const { postChat } = require(path.join(__dirname, '..', 'lib', 'chatClient.js'));
const { loadIntents, saveIntents, updateIntent } = require(path.join(__dirname, '..', 'lib', 'intents.js'));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PENDING_FILE = path.join(DATA_DIR, 'pending-notifications.txt');
const WEBCHAT_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';

function appendPending(line) {
  const fs = require('fs');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(PENDING_FILE, line + '\n', 'utf8');
}

function postChatToPiko(message) {
  return postChat(WEBCHAT_URL, message, 'intent-poller');
}

function getDueAt(intent) {
  return intent.dueAt || intent.time || intent.run;
}

function shouldConsider(intent, now) {
  if (intent.status && intent.status !== 'pending') return false;
  if (intent.snoozedUntil && new Date(intent.snoozedUntil) > now) return false;
  return true;
}

function main() {
  const now = new Date();
  let intents = loadIntents();
  let processed = 0;

  // Due reminders: append to pending, set lastFiredAt and status done
  for (const r of intents) {
    if (r.type !== 'reminder' || !shouldConsider(r, now)) continue;
    const dueAt = getDueAt(r);
    if (!dueAt || new Date(dueAt) > now) continue;
    const text = '🔔 Reminder: ' + (r.title || r.message || r.text || '');
    appendPending(text);
    updateIntent(r.id, { lastFiredAt: now.toISOString(), status: 'done' });
    processed++;
  }

  // Due scheduled: POST command to /api/chat, set lastFiredAt
  for (const s of intents) {
    if (s.type !== 'scheduled' || !shouldConsider(s, now)) continue;
    const dueAt = getDueAt(s);
    if (!dueAt || new Date(dueAt) > now) continue;
    const cmd = (s.command || '').trim();
    if (cmd) {
      postChatToPiko(cmd).then(() => {}).catch((e) => console.error('[intent-poller] scheduled failed:', e.message));
    }
    updateIntent(s.id, { lastFiredAt: now.toISOString(), status: 'done' });
    processed++;
  }

  // Optional: run one queue item (server will mark it done when /queue next is called)
  if (process.env.PIKO_INTENT_POLLER_RUN_QUEUE === 'true') {
    const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
    if (queue.length > 0) {
      postChatToPiko('/queue next').then(() => {}).catch((e) => console.error('[intent-poller] queue next failed:', e.message));
    }
  }

  if (processed > 0) {
    console.log('[intent-poller] processed', processed, 'intent(s)');
  }
}

main();
