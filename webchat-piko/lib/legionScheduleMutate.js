/**
 * P3 Tier 2 — chat-driven Legion queue reschedule/cancel by Task #N (confirm before apply).
 */
const { normalizeApostrophes } = require('./queueRead');
const { to24Hour } = require('./nlLegionSchedule');
const { parseTaskIdFromMessage, findIntentByTaskId } = require('./taskRead');
const { loadIntents, updateIntent, removeIntentById, nextDueFromSchedule } = require('./intents');
const { formatTaskRef } = require('./legionTaskCreate');
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  hasWord,
  collapseWhitespace,
  parseHhMm,
  isAsciiDigit,
  isWhitespace,
  isAsciiLetter,
} = require('./text');

const PENDING_TTL_MS = 5 * 60 * 1000;

function parseTimeFromMessage(message) {
  const text = String(message || '');
  const low = toLowerAsciiish(text);

  function tryParseAt(i) {
    let pos = i;
    while (pos < low.length && isWhitespace(low[pos])) pos += 1;
    let num = '';
    while (pos < low.length && isAsciiDigit(low[pos]) && num.length < 2) {
      num += low[pos];
      pos += 1;
    }
    if (!num) return null;
    let min = '';
    if (low[pos] === ':') {
      pos += 1;
      while (pos < low.length && isAsciiDigit(low[pos]) && min.length < 2) {
        min += low[pos];
        pos += 1;
      }
      if (min.length !== 2) return null;
    }
    while (pos < low.length && isWhitespace(low[pos])) pos += 1;
    let ampm = '';
    if (low.slice(pos, pos + 2) === 'am' || low.slice(pos, pos + 2) === 'pm') {
      ampm = low.slice(pos, pos + 2);
    }
    // Require am/pm for bare hour, or accept :MM / cue-prefixed
    if (!ampm && !min && i > 0) {
      // still ok when preceded by to/at/@
    }
    if (!ampm && !min) {
      // allow 24h-style only with leading cue; hour alone without ampm is weak
      const hour = Number(num);
      if (hour > 12) return to24Hour(num, null, null);
      return null;
    }
    return to24Hour(num, min || null, ampm || null);
  }

  for (const cue of ['to ', 'at ', '@ ', 'to', 'at', '@']) {
    let from = 0;
    const needle = cue.endsWith(' ') ? cue : cue;
    while (from < low.length) {
      const idx = low.indexOf(needle, from);
      if (idx < 0) break;
      if (idx === 0 || !isAsciiLetter(low[idx - 1])) {
        const afterCue = idx + (cue.endsWith(' ') ? cue.length : cue.length);
        // skip whitespace after bare to/at/@
        let p = afterCue;
        while (p < low.length && isWhitespace(low[p])) p += 1;
        const hit = tryParseAt(p);
        if (hit) return hit;
      }
      from = idx + needle.length;
    }
  }

  // Bare "10am" / "9:30 pm"
  for (let i = 0; i < low.length; i++) {
    if (!isAsciiDigit(low[i])) continue;
    if (i > 0 && (isAsciiDigit(low[i - 1]) || isAsciiLetter(low[i - 1]))) continue;
    const hit = tryParseAt(i);
    if (hit) return hit;
  }
  return null;
}

function objectiveLabel(intent) {
  return (
    (intent.briefFields && intent.briefFields.objective) ||
    intent.title ||
    intent.description ||
    'scheduled mission'
  ).slice(0, 80);
}

function buildRescheduleSchedule(existingSchedule, message) {
  const time = parseTimeFromMessage(message);
  if (!time) return null;
  const low = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  const existing = String(existingSchedule || '').trim().toLowerCase();

  if (hasWord(low, 'hourly') || existing.startsWith('hourly ')) {
    if (existing.startsWith('hourly ')) {
      const rest = existing.slice('hourly '.length);
      const dash = rest.indexOf('-');
      if (dash > 0) {
        const endPart = rest.slice(dash + 1).trim();
        if (parseHhMm(endPart)) return `hourly ${time}-${endPart}`;
      }
    }
    return `hourly ${time}-23:00`;
  }
  if (hasWord(low, 'weekly') || existing.startsWith('weekly ')) {
    return `weekly ${time}`;
  }
  if (existing.startsWith('cron ')) return null;
  return `daily ${time}`;
}

function resolvePendingIntent(taskId) {
  const intents = loadIntents();
  const intent = findIntentByTaskId(taskId, intents);
  if (!intent || intent.status === 'cancelled') return null;
  return intent;
}

/**
 * @returns {null | object}
 */
function parseLegionScheduleMutateIntent(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t || t.startsWith('/')) return null;

  if (includesAny(t, ['can i', 'am i able', 'is it possible', 'how do i', 'how can i'])) {
    return null;
  }

  const taskId = parseTaskIdFromMessage(message);
  if (!taskId) return null;

  const intent = resolvePendingIntent(taskId);
  if (!intent) return null;

  const ref = formatTaskRef(taskId);
  const label = objectiveLabel(intent);
  const oldSchedule = String(intent.schedule || '').trim();

  if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop', 'unschedule'])) {
    return {
      type: 'legion_schedule_cancel',
      task_id: taskId,
      intent_id: intent.id,
      oldSchedule,
      objective: label,
      summary: `cancel ${ref} (${label})`,
    };
  }

  const wantsReschedule =
    hasAnyWord(t, ['move', 'reschedule', 'change', 'shift', 'set']) &&
    (parseTimeFromMessage(message) != null || hasAnyWord(t, ['daily', 'hourly', 'weekly']));
  if (!wantsReschedule) return null;

  const newSchedule = buildRescheduleSchedule(oldSchedule, message);
  if (!newSchedule || newSchedule === oldSchedule) return null;

  return {
    type: 'legion_schedule_reschedule',
    task_id: taskId,
    intent_id: intent.id,
    schedule: newSchedule,
    oldSchedule,
    objective: label,
    summary: `move ${ref} from ${oldSchedule || 'current schedule'} to ${newSchedule} (${label})`,
  };
}

function isLegionScheduleMutateIntent(message) {
  return parseLegionScheduleMutateIntent(message) != null;
}

function formatLegionScheduleMutateConfirm(intent) {
  return `I'll ${intent.summary}. Reply YES to confirm, or NO to cancel.`;
}

function formatLegionScheduleMutateSuccess(intent) {
  const ref = formatTaskRef(intent.task_id);
  if (intent.type === 'legion_schedule_cancel') {
    return `Done — cancelled ${ref} (${intent.objective}).`;
  }
  return `Done — ${ref} is now scheduled ${intent.schedule} (${intent.objective}).`;
}

function executeLegionScheduleMutation(intent) {
  if (!intent || !intent.intent_id) {
    return { ok: false, error: 'Invalid schedule mutation' };
  }

  if (intent.type === 'legion_schedule_cancel') {
    const ok = removeIntentById(intent.intent_id);
    if (!ok) return { ok: false, error: 'Could not cancel that schedule' };
    try {
      const { logActivity } = require('./activityLog');
      logActivity('intent_cancelled', {
        intentId: intent.intent_id,
        task_id: intent.task_id,
        source: 'legion_schedule_mutate',
      });
    } catch (_) {}
    return { ok: true, detail: `cancelled ${formatTaskRef(intent.task_id)}` };
  }

  if (intent.type === 'legion_schedule_reschedule') {
    const nextDue = nextDueFromSchedule(intent.schedule, new Date());
    if (!nextDue) {
      return { ok: false, error: `Invalid schedule: ${intent.schedule}` };
    }
    const updated = updateIntent(intent.intent_id, {
      schedule: intent.schedule,
      dueAt: nextDue,
    });
    if (!updated) return { ok: false, error: 'Could not update that schedule' };
    try {
      const { logActivity } = require('./activityLog');
      logActivity('intent_rescheduled', {
        intentId: intent.intent_id,
        task_id: intent.task_id,
        oldSchedule: intent.oldSchedule,
        newSchedule: intent.schedule,
        source: 'legion_schedule_mutate',
      });
    } catch (_) {}
    return { ok: true, detail: `${formatTaskRef(intent.task_id)} → ${intent.schedule}` };
  }

  return { ok: false, error: 'Unsupported mutation type' };
}

function legionScheduleMutateHelpLines() {
  return [
    'Legion queue (your scheduled missions):',
    '• "Move Task #6 to 10am" / "Reschedule Task #4 to daily 08:00"',
    '• "Cancel Task #6"',
  ];
}

module.exports = {
  PENDING_TTL_MS,
  parseLegionScheduleMutateIntent,
  isLegionScheduleMutateIntent,
  formatLegionScheduleMutateConfirm,
  formatLegionScheduleMutateSuccess,
  executeLegionScheduleMutation,
  legionScheduleMutateHelpLines,
};
