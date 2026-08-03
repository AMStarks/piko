/**
 * Intent orders: load, save, migrate (old shape → new), createIntent, updateIntent.
 * Shared by server.js and scripts/intent-poller.js.
 */
const fs = require('fs');
const path = require('path');
const { CronExpressionParser } = require('cron-parser');
const { parseDurationToken, parseHhMm, isAsciiDigit, collapseWhitespace } = require('./text');

function resolveDataDir() {
  const env = String(process.env.PIKO_DATA_DIR || '').trim();
  return env || path.join(__dirname, '..', 'data');
}
const DATA_DIR = path.join(__dirname, '..', 'data');
const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');

function getIntentsFilePath() {
  return path.join(resolveDataDir(), 'intents.json');
}

function loadIntents() {
  let arr = [];
  try {
    const raw = fs.readFileSync(getIntentsFilePath(), 'utf8');
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
    const dir = path.dirname(getIntentsFilePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getIntentsFilePath(), JSON.stringify(intents, null, 2), 'utf8');
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
      // legion_scheduled: optional pre-filled brief fields
      ...(i.briefFields && typeof i.briefFields === 'object' ? { briefFields: i.briefFields } : {}),
      ...(i.task_id != null || i.taskId != null ? { task_id: Number(i.task_id ?? i.taskId) } : {}),
      ...(i.mode ? { mode: String(i.mode) } : {}),
      ...(i.business_unit || i.businessUnit
        ? { business_unit: String(i.business_unit || i.businessUnit) }
        : {}),
      ...(i.enabled != null ? { enabled: !!i.enabled } : {}),
      ...(i.capability ? { capability: String(i.capability) } : {}),
      ...(i.adapterId || i.adapter_id ? { adapterId: String(i.adapterId || i.adapter_id) } : {}),
      ...(i.runbook_id ? { runbook_id: String(i.runbook_id) } : {}),
      ...(i.lastRunId ? { lastRunId: String(i.lastRunId) } : {}),
      ...(i.lastRunStatus ? { lastRunStatus: String(i.lastRunStatus) } : {}),
      ...(i.lastRunOutcome ? { lastRunOutcome: String(i.lastRunOutcome) } : {}),
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
    schedule = null,
    briefFields = null,
    task_id: taskIdSnake = null,
    taskId = null,
    mode = null,
    business_unit: businessUnitSnake = null,
    businessUnit = null,
    enabled = null,
    capability = null,
    adapterId = null,
    runbook_id: runbookIdSnake = null,
    runbookId = null,
    tags = null,
    _creationSource = 'slash',
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
    schedule: schedule || null,
    command,
    source,
    sessionId,
    snoozedUntil: null,
    lastFiredAt: null,
    tags: Array.isArray(tags) ? tags : [],
    ...(briefFields && typeof briefFields === 'object' ? { briefFields } : {}),
    ...(taskIdSnake != null || taskId != null
      ? { task_id: Number(taskIdSnake ?? taskId) }
      : {}),
    ...(mode ? { mode: String(mode) } : {}),
    ...(businessUnitSnake || businessUnit
      ? { business_unit: String(businessUnitSnake || businessUnit).trim() }
      : {}),
    ...(enabled != null ? { enabled: !!enabled } : {}),
    ...(capability ? { capability: String(capability) } : {}),
    ...(adapterId ? { adapterId: String(adapterId) } : {}),
    ...(runbookIdSnake || runbookId ? { runbook_id: String(runbookIdSnake || runbookId) } : {}),
  };
  intents.push(intent);
  saveIntents(intents);
  try {
    const { logActivity } = require('./activityLog');
    logActivity('intent_created', {
      intentId: id,
      type: intent.type,
      objective: title || description,
      schedule: schedule || null,
      source: _creationSource,
    });
  } catch (_) {}
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

/** Get pending intents only (status pending or unset). */
function getPendingIntents() {
  return loadIntents().filter((i) => i.status === 'pending' || !i.status);
}

/** Remove/cancel an intent by ID. Marks as cancelled (keeps in file for audit). */
function removeIntentById(id) {
  const u = updateIntent(id, { status: 'cancelled' });
  return u != null;
}

/** Parse duration string (e.g. 30m, 2h, 1d, 1w) to milliseconds. */
function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  const tok = parseDurationToken(str);
  if (!tok) return null;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return tok.value * (multipliers[tok.unit] || 0);
}

/**
 * Compute next dueAt from schedule string (e.g. "daily 08:00", "hourly 06:00-23:00").
 * Returns ISO string or null if schedule is invalid.
 * Uses process timezone (set at boot). In Docker, set TZ=Australia/Sydney so 09:00 means local, not UTC.
 * Do not mutate process.env.TZ at runtime — V8 caches it and concurrent requests can race.
 */
function nextDueFromSchedule(schedule, fromDate = new Date()) {
  if (!schedule || typeof schedule !== 'string') return null;
  const s = collapseWhitespace(schedule.trim().toLowerCase());

  if (s.startsWith('daily ')) {
    const hhmm = parseHhMm(s.slice('daily '.length).trim());
    if (hhmm) {
      const next = new Date(fromDate);
      next.setHours(hhmm.h, hhmm.m, 0, 0);
      if (next <= fromDate) next.setDate(next.getDate() + 1);
      return next.toISOString();
    }
  }

  if (s.startsWith('hourly ')) {
    const rest = s.slice('hourly '.length).trim();
    const dash = rest.indexOf('-');
    if (dash > 0) {
      const start = parseHhMm(rest.slice(0, dash).trim());
      const end = parseHhMm(rest.slice(dash + 1).trim());
      if (start && end) {
        return calculateNextHourly(
          `${String(start.h).padStart(2, '0')}:${String(start.m).padStart(2, '0')}`,
          `${String(end.h).padStart(2, '0')}:${String(end.m).padStart(2, '0')}`,
          fromDate,
        );
      }
    }
  }

  // weekly HH:MM — next occurrence of weekday=Monday at HH:MM in local TZ.
  if (s.startsWith('weekly ')) {
    const hhmm = parseHhMm(s.slice('weekly '.length).trim());
    if (hhmm) {
      const next = new Date(fromDate);
      const dow = next.getDay();
      const daysUntilMonday = (1 + 7 - dow) % 7;
      next.setDate(next.getDate() + (daysUntilMonday === 0 ? 7 : daysUntilMonday));
      next.setHours(hhmm.h, hhmm.m, 0, 0);
      if (next <= fromDate) next.setDate(next.getDate() + 7);
      return next.toISOString();
    }
  }

  if (s.startsWith('cron ')) {
    try {
      const cronExpr = s.slice('cron '.length).trim();
      const interval = CronExpressionParser.parse(cronExpr, { currentDate: fromDate });
      const next = interval.next();
      return next.toISOString();
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[intents] cron parse failed:', e.message);
      return null;
    }
  }

  if (s.startsWith('in ')) {
    const num = s.slice(3).trim();
    let ok = num.length > 0;
    for (const ch of num) {
      if (!isAsciiDigit(ch)) { ok = false; break; }
    }
    if (ok) {
      const mins = Math.max(1, Math.min(1440, parseInt(num, 10)));
      const next = new Date(fromDate.getTime() + mins * 60 * 1000);
      return next.toISOString();
    }
  }

  return null;
}

/**
 * Create a ``legion_scheduled`` intent bound to a Legion mission row (task_id).
 * Used by iOS Command Center and seed scripts — same shape as intent-poller expects.
 */
function createLegionScheduleIntent(opts) {
  const taskId = Number(opts.task_id ?? opts.taskId);
  if (!Number.isFinite(taskId) || taskId < 1) {
    throw new Error('task_id must be a positive integer');
  }
  const schedule = String(opts.schedule || '').trim();
  if (!schedule) {
    throw new Error('schedule is required (e.g. daily 09:00, weekly 09:00, in 30)');
  }
  const title = String(opts.title || opts.objective || '').trim() || `Mission #${taskId}`;
  const mode = String(opts.mode || 'require_approval').trim().toLowerCase();
  const safeMode = mode === 'auto' ? 'auto' : 'require_approval';
  const businessUnit = String(opts.business_unit || opts.businessUnit || '').trim();
  let dueAt = opts.dueAt || null;
  if (!dueAt) {
    dueAt = nextDueFromSchedule(schedule, new Date());
  }
  if (!dueAt) {
    throw new Error(`Invalid schedule "${schedule}". Use daily HH:MM, weekly HH:MM, hourly HH:MM-HH:MM, cron …, or in N (minutes).`);
  }
  const objective = String(opts.objective || title).trim();
  const { buildScheduleCapabilityFields } = require('./legionScheduleExecution');
  const capFields = opts.capability
    ? {
      capability: String(opts.capability),
      adapterId: opts.adapterId || opts.adapter_id || undefined,
      ...(opts.runbook_id || opts.runbookId ? { runbook_id: String(opts.runbook_id || opts.runbookId) } : {}),
    }
    : buildScheduleCapabilityFields(objective, resolveDataDir());
  const briefFields = safeMode === 'auto'
    ? null
    : {
      objective,
      success_criteria: opts.success_criteria || 'Mission completed as scheduled',
      scope: opts.scope || 'Recurring Legion mission',
      constraints: opts.constraints || 'Scheduled via Piko Command Center',
      risk_level: opts.risk_level || 'low',
      priority: opts.priority || 'P2',
      deadline: opts.deadline || 'Ongoing',
      execution_mode: 'approval',
    };
  const intents = loadIntents();
  const existing = intents.find(
    (i) => i
      && i.type === 'legion_scheduled'
      && (i.status === 'pending' || !i.status)
      && Number(i.task_id || i.taskId || 0) === taskId
      && i.schedule === schedule,
  );
  if (existing) {
    return { intent: existing, duplicate: true };
  }
  const intentPayload = {
    type: 'legion_scheduled',
    title: objective,
    description: objective,
    dueAt,
    schedule,
    task_id: taskId,
    mode: safeMode,
    business_unit: businessUnit || undefined,
    enabled: opts.enabled != null ? !!opts.enabled : true,
    tags: ['legion_scheduled', ...(businessUnit.toLowerCase().includes('ausmaker') ? ['ausmaker'] : [])],
    source: opts.source || 'ios',
    sessionId: opts.sessionId || 'ios-legion-schedule',
    _creationSource: opts._creationSource || 'ios_legion_schedule',
    ...capFields,
  };
  if (briefFields) intentPayload.briefFields = briefFields;
  const intent = createIntent(intentPayload);
  return { intent, duplicate: false };
}

/**
 * Create a ``legion_scheduled`` intent with a Legion ledger row (numeric task id) for referencing in chat/UI.
 */
function createLegionScheduledWithTask(opts) {
  const { createLegionTaskRowSync } = require('./legionTaskCreate');
  const objective = String(opts.objective || opts.title || '').trim() || 'Scheduled task';
  const title = String(opts.title || objective).trim().slice(0, 500);
  const businessUnit = String(opts.business_unit || opts.businessUnit || '').trim();
  let taskId = Number(opts.task_id ?? opts.taskId);
  if (!Number.isFinite(taskId) || taskId < 1) {
    const created = createLegionTaskRowSync({
      title,
      description: String(opts.description || objective).trim(),
      business_unit: businessUnit,
      status: 'pending',
    });
    if (!created.ok) {
      throw new Error(created.error || 'Could not create Legion task row for schedule');
    }
    taskId = created.task_id;
  }
  const schedule = String(opts.schedule || '').trim();
  if (!schedule) {
    throw new Error('schedule is required');
  }
  const mode = String(opts.mode || 'require_approval').trim().toLowerCase();
  const safeMode = mode === 'auto' ? 'auto' : 'require_approval';
  let dueAt = opts.dueAt || null;
  if (!dueAt) {
    dueAt = nextDueFromSchedule(schedule, new Date());
  }
  if (!dueAt) {
    throw new Error(`Invalid schedule "${schedule}"`);
  }
  let briefFields = null;
  if (safeMode !== 'auto') {
    briefFields = opts.briefFields && typeof opts.briefFields === 'object'
      ? { ...opts.briefFields }
      : {
        objective,
        success_criteria: opts.success_criteria || 'Task completed as scheduled',
        scope: opts.scope || 'Recurring Legion task',
        constraints: opts.constraints || 'Scheduled via Piko',
        risk_level: opts.risk_level || 'low',
        priority: opts.priority || 'P2',
        deadline: opts.deadline || 'Ongoing',
        execution_mode: 'approval',
      };
    briefFields.objective = briefFields.objective || objective;
  }

  const { buildScheduleCapabilityFields } = require('./legionScheduleExecution');
  const capFields = opts.capability
    ? {
      capability: String(opts.capability),
      adapterId: opts.adapterId || opts.adapter_id || undefined,
      ...(opts.runbook_id || opts.runbookId ? { runbook_id: String(opts.runbook_id || opts.runbookId) } : {}),
    }
    : buildScheduleCapabilityFields(objective, resolveDataDir());

  const intents = loadIntents();
  const existing = intents.find(
    (i) => i
      && i.type === 'legion_scheduled'
      && (i.status === 'pending' || !i.status)
      && Number(i.task_id || i.taskId || 0) === taskId
      && i.schedule === schedule,
  );
  if (existing) {
    return { intent: existing, duplicate: true, task_id: taskId };
  }

  const intentPayload = {
    type: 'legion_scheduled',
    title: objective,
    description: String(opts.description || objective).trim(),
    dueAt,
    schedule,
    task_id: taskId,
    mode: safeMode,
    business_unit: businessUnit || undefined,
    enabled: opts.enabled != null ? !!opts.enabled : true,
    tags: ['legion_scheduled', ...(businessUnit.toLowerCase().includes('ausmaker') ? ['ausmaker'] : [])],
    source: opts.source || 'piko',
    sessionId: opts.sessionId || 'piko-schedule',
    _creationSource: opts._creationSource || 'legion_scheduled_with_task',
    ...capFields,
  };
  if (briefFields) intentPayload.briefFields = briefFields;
  const intent = createIntent(intentPayload);
  return { intent, duplicate: false, task_id: taskId };
}

/** List pending legion_scheduled intents (optional filter by task_id). */
function listLegionScheduleIntents(opts = {}) {
  const taskFilter = opts.task_id != null || opts.taskId != null
    ? Number(opts.task_id ?? opts.taskId)
    : null;
  return loadIntents().filter((i) => {
    if (!i || i.type !== 'legion_scheduled') return false;
    if (i.status && i.status !== 'pending') return false;
    if (taskFilter != null && Number(i.task_id || i.taskId || 0) !== taskFilter) return false;
    return true;
  });
}

/** Helper: next run for hourly HH:MM-HH:MM window. Validates start < end; falls back to daily if invalid. */
function calculateNextHourly(startTimeStr, endTimeStr, now) {
  const [startH, startM] = startTimeStr.split(':').map(Number);
  const [endH, endM] = endTimeStr.split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  if (startMins >= endMins) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn(`[intents] Invalid hourly window ${startTimeStr}-${endTimeStr} — falling back to daily`);
    }
    return calculateNextDaily(startTimeStr, now);
  }

  const startToday = new Date(now);
  startToday.setHours(startH, startM, 0, 0);
  const endToday = new Date(now);
  endToday.setHours(endH, endM, 0, 0);

  if (now > endToday) {
    const tomorrowStart = new Date(startToday);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    return tomorrowStart.toISOString();
  }

  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next < startToday) return startToday.toISOString();
  if (next > endToday) {
    const tomorrowStart = new Date(startToday);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    return tomorrowStart.toISOString();
  }
  return next.toISOString();
}

function calculateNextDaily(timeStr, now) {
  const [h, m] = timeStr.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/**
 * Find pending intents matching any of the given descriptions (title, schedule, objective).
 * Used for multi-item cancel before confirmation.
 */
function findIntentsByDescriptions(descriptions) {
  if (!Array.isArray(descriptions) || descriptions.length === 0) return [];
  const intents = loadIntents();
  const pending = intents.filter((i) => i.status === 'pending' || !i.status);
  const matched = new Map();
  for (const desc of descriptions) {
    const d = String(desc || '').trim().toLowerCase();
    if (!d) continue;
    for (const i of pending) {
      if (matched.has(i.id)) continue;
      const title = (i.title || i.description || i.task || i.command || '').toLowerCase();
      const schedule = (i.schedule || '').toLowerCase();
      const obj = (i.briefFields && i.briefFields.objective ? i.briefFields.objective : '').toLowerCase();
      if (title.includes(d) || schedule.includes(d) || obj.includes(d) || d.includes(title) || d.includes(schedule)) {
        matched.set(i.id, i);
      }
    }
  }
  return Array.from(matched.values());
}

/**
 * Cancel intents matching the given descriptions. Marks as cancelled.
 * @param {string[]} descriptions - Phrases to match (title, schedule, objective)
 * @returns {{ cancelledCount: number, items: Array }}
 */
function cancelIntentByDescription(descriptions) {
  const toCancel = findIntentsByDescriptions(descriptions);
  for (const i of toCancel) {
    updateIntent(i.id, { status: 'cancelled' });
  }
  try {
    if (toCancel.length > 0) {
      const { logActivity } = require('./activityLog');
      logActivity('intent_cancelled', { count: toCancel.length, items: toCancel.map((x) => x.title || x.objective || x.id) });
    }
  } catch (_) {}
  return { cancelledCount: toCancel.length, items: toCancel };
}

module.exports = {
  loadIntents,
  saveIntents,
  migrateIntents,
  createIntent,
  createLegionScheduleIntent,
  createLegionScheduledWithTask,
  listLegionScheduleIntents,
  updateIntent,
  parseDuration,
  nextDueFromSchedule,
  getPendingIntents,
  removeIntentById,
  findIntentsByDescriptions,
  cancelIntentByDescription,
  INTENTS_FILE,
  DATA_DIR,
};
