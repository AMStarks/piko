/**
 * Deterministic Task #N detail reads — schedule, objective, last fired.
 */
const { listLegionScheduleIntents } = require('./intents');
const { normalizeApostrophes, isQueueReadQuery } = require('./queueRead');
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  hasWord,
  collapseWhitespace,
  extractDigitRuns,
  isAsciiDigit,
  isWhitespace,
  startsWithIgnoreCase,
  replaceAllLiteral,
} = require('./text');

function extractTaskIdNear(text, fromIdx) {
  let i = fromIdx;
  while (i < text.length && (isWhitespace(text[i]) || text[i] === '#')) i += 1;
  let num = '';
  while (i < text.length && isAsciiDigit(text[i])) {
    num += text[i];
    i += 1;
  }
  if (!num) return null;
  const id = parseInt(num, 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return id;
}

function parseTaskIdFromMessage(message) {
  const t = normalizeApostrophes(String(message || '')).trim();
  const low = toLowerAsciiish(t);

  let from = 0;
  while (from < low.length) {
    const idx = low.indexOf('task', from);
    if (idx < 0) break;
    const prev = idx > 0 ? low[idx - 1] : '';
    const prevOk = idx === 0 || !((prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9'));
    if (prevOk) {
      const id = extractTaskIdNear(low, idx + 4);
      if (id != null) return id;
    }
    from = idx + 4;
  }

  // "status|details|info of/for/on task N"
  for (const lead of ['status of task', 'status for task', 'status on task',
    'details of task', 'details for task', 'details on task',
    'detail of task', 'detail for task', 'detail on task',
    'info of task', 'info for task', 'info on task']) {
    const idx = low.indexOf(lead);
    if (idx === 0 || (idx > 0 && collapseWhitespace(low).startsWith(lead))) {
      const id = extractTaskIdNear(low, idx + lead.length);
      if (id != null) return id;
    }
    if (idx >= 0) {
      const id = extractTaskIdNear(low, idx + lead.length);
      if (id != null) return id;
    }
  }

  // "what's task N" / "what is task N"
  for (const lead of ["what's task", 'whats task', 'what is task']) {
    const idx = low.indexOf(lead);
    if (idx >= 0) {
      const id = extractTaskIdNear(low, idx + lead.length);
      if (id != null) return id;
    }
  }

  return null;
}

function isTaskDetailQuery(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t) return false;
  if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop', 'run', 'start', 'execute', 'trigger'])) return false;
  return parseTaskIdFromMessage(message) != null;
}

function hasTaskExplainContext(message) {
  if (isQueueReadQuery(message)) return false;
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (hasAnyWord(t, ['task', 'scheduled', 'mission', 'job', 'jobs', 'legion'])) return true;
  if (hasWord(t, 'queue') && (hasAnyWord(t, ['task', 'mission']) || extractDigitRuns(t).length)) return true;
  if (hasAnyWord(t, ['daily', 'hourly', 'weekly'])) return true;
  if (t.includes('(daily ')) return true;
  if (hasWord(t, 'explain')) {
    const label = parseTaskLabelFromExplainMessage(message);
    const lab = String(label || '').toLowerCase().trim();
    if (lab.length >= 4 && !startsWithIgnoreCase(lab, 'that') && !startsWithIgnoreCase(lab, 'it')
      && !startsWithIgnoreCase(lab, 'this') && !startsWithIgnoreCase(lab, 'what is that')
      && !startsWithIgnoreCase(lab, 'what is it')) {
      return true;
    }
  }
  for (const lead of ["what's ", 'whats ', 'what is ', 'what does ']) {
    const idx = t.indexOf(lead);
    if (idx >= 0) {
      let subject = t.slice(idx + lead.length);
      const q = subject.indexOf('?');
      if (q >= 0) subject = subject.slice(0, q);
      subject = subject.trim();
      if (subject.length >= 4 && !startsWithIgnoreCase(subject, 'that')
        && !startsWithIgnoreCase(subject, 'it') && !startsWithIgnoreCase(subject, 'this')) {
        return true;
      }
    }
  }
  return false;
}

function isTaskExplainQuery(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t) return false;
  if (isQueueReadQuery(message)) return false;
  if (parseTaskIdFromMessage(message) != null) return false;
  if (hasAnyWord(t, ['schedule', 'cancel', 'delete', 'remove']) || includesAny(t, ['set up', 'create', 'add'])) {
    // "schedule" as verb for create — fail closed for explain
    if (includesAny(t, ['set up', 'create', 'add']) || hasAnyWord(t, ['cancel', 'delete', 'remove'])) return false;
    if (hasWord(t, 'schedule') && !hasWord(t, 'scheduled')) return false;
  }
  const hasExplainCue =
    hasWord(t, 'explain')
    || includesAny(t, ["what's", 'whats', 'what is', 'what does', 'tell me about', 'tell me what', 'how does']);
  if (!hasExplainCue) return false;
  return hasTaskExplainContext(message);
}

function isTaskExplainByIdQuery(message) {
  if (!parseTaskIdFromMessage(message)) return false;
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop', 'run', 'start', 'execute', 'trigger'])) return false;
  return (
    hasWord(t, 'explain')
    || includesAny(t, ["what's", 'whats', 'what is', 'what does', 'tell me about', 'tell me what', 'how does'])
    || hasAnyWord(t, ['detail', 'details', 'describe'])
  );
}

function parseTaskLabelFromExplainMessage(message) {
  let t = normalizeApostrophes(String(message || '')).trim();
  const low = toLowerAsciiish(t);

  const prefixes = [
    'can you explain what ', 'could you explain what ', 'would you explain what ', 'please explain what ',
    'can you explain ', 'could you explain ', 'would you explain ', 'please explain ',
    'explain what ', 'explain ',
    "what's ", 'whats ', 'what is ', 'what does ',
    'tell me about ', 'tell me what ',
    'how does ',
  ];
  for (const p of prefixes) {
    if (low.startsWith(p)) {
      t = t.slice(p.length).trim();
      break;
    }
  }
  // strip trailing " is/does/mean/work/do?"
  for (const suf of [' is', ' does', ' mean', ' work', ' do']) {
    const ll = toLowerAsciiish(t);
    if (ll.endsWith(suf + '?')) { t = t.slice(0, -(suf.length + 1)).trim(); break; }
    if (ll.endsWith(suf)) { t = t.slice(0, -suf.length).trim(); break; }
  }
  if (t.endsWith('?')) t = t.slice(0, -1).trim();

  // strip trailing parenthetical
  const open = t.lastIndexOf('(');
  if (open >= 0 && t.endsWith(')')) {
    t = t.slice(0, open).trim();
  }

  // strip " daily at 9am" style tails
  const ll = toLowerAsciiish(t);
  for (const cue of [' daily at ', ' daily ', ' hourly ', ' weekly ']) {
    const idx = ll.indexOf(cue);
    if (idx >= 0) {
      t = t.slice(0, idx).trim();
      break;
    }
  }
  return t;
}

function findIntentByLabel(label, intents) {
  const needle = String(label || '').toLowerCase().trim();
  if (!needle || needle.length < 3) return null;
  const pending = (intents || []).filter((i) => i.status === 'pending' || !i.status);
  for (const intent of pending) {
    const objective = String(
      (intent.briefFields && intent.briefFields.objective) || intent.title || intent.description || intent.command || '',
    )
      .toLowerCase()
      .trim();
    if (!objective) continue;
    if (objective === needle || objective.includes(needle) || needle.includes(objective)) return intent;
  }
  const tokens = needle.split(' ').filter((w) => w.length > 2);
  let best = null;
  let bestScore = 0;
  for (const intent of pending) {
    const objective = String(
      (intent.briefFields && intent.briefFields.objective) || intent.title || intent.description || intent.command || '',
    )
      .toLowerCase()
      .trim();
    const score = tokens.filter((tok) => objective.includes(tok)).length;
    if (score > bestScore && score >= Math.min(2, tokens.length)) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

function describeObjective(objective, rootDir) {
  let whatItDoes = 'runs the configured Legion objective on that schedule.';
  try {
    const { inferCapabilityFromObjective } = require('./legionCapabilities');
    const { loadCapabilityRegistry } = require('./actionRouter');
    const capId = inferCapabilityFromObjective({ objective }, rootDir);
    const entry = loadCapabilityRegistry().find((c) => c.id === capId);
    if (entry && entry.description) {
      let core = String(entry.description);
      if (startsWithIgnoreCase(core, 'Piko-native:')) core = core.slice('Piko-native:'.length).trim();
      const useFor = core.indexOf(' Use for:');
      if (useFor >= 0) core = core.slice(0, useFor).trim();
      whatItDoes = core.endsWith('.') ? core : `${core}.`;
    }
  } catch (_) {}
  return whatItDoes;
}

function findIntentByTaskId(taskId, intents) {
  const id = Number(taskId);
  const scheduled = listLegionScheduleIntents({ task_id: id });
  if (scheduled.length) return scheduled[0];
  const all = (intents || []).filter((i) => Number(i.task_id || i.taskId || 0) === id);
  return all[0] || null;
}

function formatTaskExplainByIdReply(taskId, intents, rootDir) {
  const intent = findIntentByTaskId(taskId, intents);
  if (!intent) {
    return `No scheduled mission found for Task #${taskId}. Check the queue with "what's in the queue?"`;
  }
  const objective =
    (intent.briefFields && intent.briefFields.objective) || intent.title || intent.description || intent.command || 'Scheduled mission';
  const schedule = formatScheduleLabel(intent);
  const mode = String(intent.mode || 'require_approval').trim();
  const status = String(intent.status || 'pending').trim();
  const lastFired = intent.lastFiredAt ? replaceAllLiteral(String(intent.lastFiredAt).slice(0, 16), 'T', ' ') : 'never';
  const whatItDoes = describeObjective(objective, rootDir);
  return [
    `Task #${taskId} — "${String(objective).slice(0, 120)}" (${schedule}).`,
    `What it does: ${whatItDoes}`,
    `Mode: ${mode} · Status: ${status} · Last fired: ${lastFired}.`,
    `Reference it as Task #${taskId} in chat.`,
  ].join(' ');
}

function formatTaskExplainReply(message, intents, rootDir) {
  const taskId = parseTaskIdFromMessage(message);
  if (taskId != null) {
    return formatTaskExplainByIdReply(taskId, intents, rootDir);
  }
  const label = parseTaskLabelFromExplainMessage(message);
  const intent = findIntentByLabel(label, intents);
  if (!intent) {
    return `I couldn't match "${label || 'that task'}" to anything in your queue. Ask "what's in the queue?" for the list, or cite Task #N directly.`;
  }

  const intentTaskId = intent.task_id || intent.taskId;
  const objective =
    (intent.briefFields && intent.briefFields.objective) || intent.title || intent.description || intent.command || 'Scheduled mission';
  const schedule = formatScheduleLabel(intent);
  const mode = String(intent.mode || 'require_approval').trim();
  const status = String(intent.status || 'pending').trim();
  const lastFired = intent.lastFiredAt ? replaceAllLiteral(String(intent.lastFiredAt).slice(0, 16), 'T', ' ') : 'never';

  const whatItDoes = describeObjective(objective, rootDir);
  const ref = intentTaskId ? `Task #${intentTaskId}` : 'This job';
  return [
    `${ref} — "${String(objective).slice(0, 120)}" (${schedule}).`,
    `What it does: ${whatItDoes}`,
    `Mode: ${mode} · Status: ${status} · Last fired: ${lastFired}.`,
    intentTaskId ? `Reference it as Task #${intentTaskId} in chat.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatScheduleLabel(intent) {
  const schedule = String(intent.schedule || '').trim();
  if (schedule) return schedule;
  const due = intent.dueAt || intent.time || intent.run;
  if (due) return replaceAllLiteral(String(due).slice(0, 16), 'T', ' ');
  return 'Pending';
}

function formatTaskDetailReply(taskId, intents) {
  const id = Number(taskId);
  const all = (intents || []).filter((i) => Number(i.task_id || i.taskId || 0) === id);
  const scheduled = listLegionScheduleIntents({ task_id: id });
  const rows = scheduled.length ? scheduled : all;

  if (!rows.length) {
    return `No scheduled mission found for Task #${id}. Check the queue with "what's in the queue?" or ask me to schedule one.`;
  }

  const lines = [];
  for (const intent of rows.slice(0, 3)) {
    const objective =
      (intent.briefFields && intent.briefFields.objective) ||
      intent.title ||
      intent.description ||
      intent.command ||
      'Scheduled mission';
    const mode = String(intent.mode || 'require_approval').trim();
    const status = String(intent.status || 'pending').trim();
    const lastFired = intent.lastFiredAt ? replaceAllLiteral(String(intent.lastFiredAt).slice(0, 16), 'T', ' ') : 'never';
    const nextDue = intent.dueAt ? replaceAllLiteral(String(intent.dueAt).slice(0, 16), 'T', ' ') : '—';
    lines.push(
      `Task #${id}: ${String(objective).slice(0, 120)}`,
      `Schedule: ${formatScheduleLabel(intent)} · Mode: ${mode} · Status: ${status}`,
      `Last fired: ${lastFired} · Next due: ${nextDue}`,
    );
  }
  if (rows.length > 3) lines.push(`…plus ${rows.length - 3} more schedule row(s) for Task #${id}.`);
  return lines.join('\n');
}

module.exports = {
  parseTaskIdFromMessage,
  isTaskDetailQuery,
  isTaskExplainQuery,
  isTaskExplainByIdQuery,
  parseTaskLabelFromExplainMessage,
  findIntentByLabel,
  findIntentByTaskId,
  formatTaskDetailReply,
  formatTaskExplainReply,
  formatTaskExplainByIdReply,
};
