/**
 * Intent orders: load, save, migrate (old shape → new), createIntent, updateIntent.
 * Shared by server.js and scripts/intent-poller.js.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');

function loadIntents() {
  let arr = [];
  try {
    const raw = fs.readFileSync(INTENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
  const migrated = migrateIntents(arr);
  if (migrated !== arr) saveIntents(migrated);
  return migrated;
}

function saveIntents(intents) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INTENTS_FILE, JSON.stringify(intents, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[intents] save failed:', e.message);
    return false;
  }
}

/** Normalize old shape to new: id, type, status, createdAt, updatedAt, dueAt, title, etc. */
function migrateIntents(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  const now = new Date().toISOString();
  let changed = false;
  const out = arr.map((i, idx) => {
    const id = i.id != null ? String(i.id) : `intent_${Date.now()}_${idx}`;
    let type = i.type || 'task';
    if (type === 'queue') {
      type = 'task';
      changed = true;
    }
    const status = i.status || 'pending';
    const createdAt = i.createdAt || i.addedAt || now;
    const updatedAt = i.updatedAt || now;
    const dueAt = i.dueAt || i.time || i.run || null;
    const title = i.title || i.task || i.message || i.text || '';
    const description = i.description || (i.task ? '' : (i.message || i.text || ''));
    const command = i.command || null;
    const source = i.source || null;
    const sessionId = i.sessionId || null;
    const snoozedUntil = i.snoozedUntil || null;
    const lastFiredAt = i.lastFiredAt || null;
    const schedule = i.schedule || null;
    const tags = Array.isArray(i.tags) ? i.tags : [];

    if (
      i.id !== id || i.type !== type || i.status !== status ||
      i.dueAt !== dueAt || i.title !== title || !i.updatedAt
    ) changed = true;

    return {
      id,
      type,
      status,
      createdAt,
      updatedAt,
      title: title || (description && description.slice(0, 80)) || '',
      description: description || '',
      dueAt,
      schedule,
      command,
      source,
      sessionId,
      snoozedUntil,
      lastFiredAt,
      tags,
      // keep legacy fields for backward compat during transition
      ...(i.time && !i.dueAt ? { time: i.time } : {}),
      ...(i.run && !i.dueAt ? { run: i.run } : {}),
      ...(i.task ? { task: i.task } : {}),
      ...(i.message ? { message: i.message } : {}),
    };
  });
  return changed ? out : arr;
}

function createIntent(opts) {
  const {
    type,
    title = '',
    description = '',
    dueAt = null,
    command = null,
    source = null,
    sessionId = null,
  } = opts;
  const now = new Date().toISOString();
  const intents = loadIntents();
  const id = `intent_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const intent = {
    id,
    type: type || 'task',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    title,
    description,
    dueAt,
    schedule: null,
    command,
    source,
    sessionId,
    snoozedUntil: null,
    lastFiredAt: null,
    tags: [],
  };
  intents.push(intent);
  saveIntents(intents);
  return intent;
}

function updateIntent(id, patch) {
  const intents = loadIntents();
  const idx = intents.findIndex((i) => i.id === id || String(i.id) === String(id));
  if (idx === -1) return null;
  intents[idx] = {
    ...intents[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveIntents(intents);
  return intents[idx];
}

/** Parse duration string (e.g. 30m, 2h, 1d, 1w) to milliseconds. */
function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d+)([smhdw])$/i.exec(str.trim());
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const unit = (m[2] || '').toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return value * (multipliers[unit] || 0);
}

module.exports = {
  loadIntents,
  saveIntents,
  migrateIntents,
  createIntent,
  updateIntent,
  parseDuration,
  INTENTS_FILE,
  DATA_DIR,
};
