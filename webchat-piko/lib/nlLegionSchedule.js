/**
 * Deterministic natural-language → legion_scheduled (no LLM).
 * Used when Ollama/router is down or to avoid 7B routing latency for common phrasing.
 */
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  hasWord,
  collapseWhitespace,
  extractDigitRuns,
  isAsciiDigit,
  isWhitespace,
  isAsciiLetter,
  startsWithIgnoreCase,
} = require('./text');

function to24Hour(h, m, ampm) {
  let hour = parseInt(h, 10);
  const min = m != null && m !== '' ? parseInt(m, 10) : 0;
  if (ampm) {
    const ap = String(ampm).toLowerCase();
    if (ap === 'pm' && hour !== 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseClockAt(text, startIdx) {
  const low = toLowerAsciiish(text);
  let i = startIdx;
  while (i < low.length && isWhitespace(low[i])) i += 1;
  let num = '';
  while (i < low.length && isAsciiDigit(low[i]) && num.length < 2) {
    num += low[i];
    i += 1;
  }
  if (!num) return null;
  let min = '';
  if (low[i] === ':') {
    i += 1;
    while (i < low.length && isAsciiDigit(low[i]) && min.length < 2) {
      min += low[i];
      i += 1;
    }
    if (min.length !== 2) return null;
  }
  while (i < low.length && isWhitespace(low[i])) i += 1;
  let ampm = '';
  if (low.slice(i, i + 2) === 'am' || low.slice(i, i + 2) === 'pm') {
    ampm = low.slice(i, i + 2);
    i += 2;
  }
  return { time: to24Hour(num, min || null, ampm || null), end: i, ampm, min };
}

function parseTimeWindow(text) {
  const low = toLowerAsciiish(text);
  for (const cue of ['between ', 'from ']) {
    const idx = low.indexOf(cue);
    if (idx < 0) continue;
    const a = parseClockAt(text, idx + cue.length);
    if (!a) continue;
    let rest = low.slice(a.end);
    let sepLen = 0;
    for (const sep of [' to ', ' - ', ' and ', '-', 'to', 'and']) {
      const s = rest.trimStart();
      if (s.startsWith(sep.trim()) || rest.includes(sep)) {
        const si = low.indexOf(sep.trim(), a.end);
        if (si >= a.end) {
          const b = parseClockAt(text, si + sep.trim().length);
          if (b) return { start: a.time, end: b.time };
        }
      }
    }
    // try common separators after first clock
    for (const sep of [' to ', '-', ' and ']) {
      const si = low.indexOf(sep, a.end);
      if (si >= 0 && si - a.end < 6) {
        const b = parseClockAt(text, si + sep.length);
        if (b) return { start: a.time, end: b.time };
      }
    }
  }
  return null;
}

function parseAtTime(text) {
  const low = toLowerAsciiish(text);
  for (const cue of ['at ', '@ ']) {
    let from = 0;
    while (from < low.length) {
      const idx = low.indexOf(cue, from);
      if (idx < 0) break;
      if (idx === 0 || !isAsciiLetter(low[idx - 1])) {
        const hit = parseClockAt(text, idx + cue.length);
        if (hit) return hit.time;
      }
      from = idx + cue.length;
    }
  }
  // bare am/pm clock
  for (let i = 0; i < low.length; i++) {
    if (!isAsciiDigit(low[i])) continue;
    if (i > 0 && (isAsciiDigit(low[i - 1]) || isAsciiLetter(low[i - 1]))) continue;
    const hit = parseClockAt(text, i);
    if (hit && hit.ampm) return hit.time;
  }
  return null;
}

/**
 * @param {string} message
 * @returns {{ schedule: string, objective: string } | null}
 */
function tryParseLegionScheduleFromNL(message) {
  const text = String(message || '').trim();
  if (!text || text.startsWith('/')) return null;
  const low = collapseWhitespace(toLowerAsciiish(text));

  if (includesAny(low, [
    'explain', 'describe', 'tell me about', 'tell me what',
    "what's", 'whats', 'what is', 'what does', 'how does', 'why does',
  ])) {
    return null;
  }
  if (text.trimEnd().endsWith('?') && !includesAny(low, ['schedule', 'set up', 'remind me to'])) {
    return null;
  }

  if (
    hasAnyWord(low, ['cancel', 'delete', 'remove', 'stop', 'unschedule', 'list', 'show', 'which'])
    || includesAny(low, ["what's", 'whats', 'what is'])
  ) {
    if (includesAny(low, ['schedule', 'scheduled', 'scheduling'])) return null;
  }

  try {
    const { parseTaskIdFromMessage } = require('./taskRead');
    if (parseTaskIdFromMessage(message) && hasAnyWord(low, ['move', 'reschedule', 'cancel', 'change', 'shift', 'unschedule'])) {
      return null;
    }
  } catch (_) {}

  const hasCadence = includesAny(low, [
    'every day', 'daily', 'each day', 'every morning', 'every evening',
    'every hour', 'hourly', 'weekly', 'every week',
  ]);
  const wantsSchedule =
    includesAny(low, ['schedule', 'scheduled', 'scheduling'])
    || includesAny(low, ['remind me to', 'set up a recurring', 'set up an automatic', 'set up a automatic'])
    || (hasAnyWord(low, ['run', 'notify', 'ping']) && hasCadence)
    || (includesAny(low, ['tell me', 'send me', 'alert me']) && hasCadence)
    || (
      hasAnyWord(low, ['check', 'monitor', 'track', 'watch', 'scan'])
      || includesAny(low, ['report on'])
    ) && hasCadence && !startsWithIgnoreCase(text, 'can you')
      && !startsWithIgnoreCase(text, 'could you')
      && !startsWithIgnoreCase(text, 'would you')
      && !startsWithIgnoreCase(text, 'please');

  if (!wantsSchedule) return null;

  let schedule = null;

  const inIdx = low.indexOf('in ');
  if (inIdx >= 0) {
    const after = low.slice(inIdx + 3);
    const runs = extractDigitRuns(after);
    if (runs.length && runs[0].index <= 1) {
      const rest = after.slice(runs[0].index + runs[0].text.length);
      if (includesAny(rest.trimStart().slice(0, 10), ['minute', 'minutes', 'min', 'mins'])) {
        schedule = `in ${runs[0].value}`;
      }
    }
  }

  if (!schedule && includesAny(low, ['every hour', 'hourly'])) {
    const win = parseTimeWindow(text);
    schedule = win
      ? `hourly ${win.start}-${win.end}`
      : 'hourly 06:00-23:00';
  }

  if (!schedule) {
    const atTime = parseAtTime(text);
    if (atTime && includesAny(low, ['daily', 'every day', 'each day', 'every morning', 'every evening', 'once a day'])) {
      schedule = `daily ${atTime}`;
    }
  }

  if (!schedule && low.includes('every morning')) {
    schedule = 'daily 08:00';
  }
  if (!schedule && includesAny(low, ['every evening', 'end of the day', 'end of day', 'eod', 'close of business'])) {
    schedule = 'daily 17:00';
  }
  if (!schedule && includesAny(low, ['daily', 'every day', 'each day', 'once a day'])) {
    schedule = 'daily 08:00';
  }

  if (!schedule) return null;

  let objective = text;
  if (startsWithIgnoreCase(objective, 'please ')) objective = objective.slice(7).trim();
  for (const p of ['can you ', 'could you ', 'would you ']) {
    if (startsWithIgnoreCase(objective, p)) {
      objective = objective.slice(p.length).trim();
      break;
    }
  }

  const stripLeading = [
    'schedule a ', 'schedule ',
    'set up a recurring ', 'set up a ', 'set up ',
    'remind me to ',
    'a daily update that ', 'a daily report that ', 'a daily task that ',
    'a daily job that ', 'a daily reminder that ',
    'daily update that ', 'daily report that ',
    'to run ', 'run ',
  ];
  for (const p of stripLeading) {
    if (startsWithIgnoreCase(objective, p)) {
      objective = objective.slice(p.length).trim();
      break;
    }
  }

  // strip cadence / time phrases from objective
  const dropPhrases = [
    'every day', 'daily', 'each day', 'once a day', 'every morning', 'every evening',
    'every hour', 'hourly', 'weekly', 'every week',
  ];
  let objLow = toLowerAsciiish(objective);
  for (const p of dropPhrases) {
    while (objLow.includes(p)) {
      const idx = objLow.indexOf(p);
      objective = (objective.slice(0, idx) + ' ' + objective.slice(idx + p.length)).trim();
      objLow = toLowerAsciiish(objective);
    }
  }
  // strip at/time mentions
  for (const cue of ['at ', '@ ']) {
    let guard = 0;
    while (guard++ < 5) {
      const idx = toLowerAsciiish(objective).indexOf(cue);
      if (idx < 0) break;
      const clock = parseClockAt(objective, idx + cue.length);
      if (!clock) break;
      objective = (objective.slice(0, idx) + ' ' + objective.slice(clock.end)).trim();
    }
  }
  const betIdx = toLowerAsciiish(objective).indexOf('between ');
  if (betIdx >= 0) {
    objective = objective.slice(0, betIdx).trim();
  }
  objective = collapseWhitespace(objective);

  if (startsWithIgnoreCase(objective, 'that ')) {
    objective = objective.slice(5).trim();
  }

  for (const p of ['tell me ', 'let me know ', 'notify me ', 'send me ', 'give me ', 'update me on ']) {
    if (startsWithIgnoreCase(objective, p)) {
      objective = objective.slice(p.length).trim();
      break;
    }
  }
  objective = collapseWhitespace(objective);

  const objL = toLowerAsciiish(objective);
  if (includesAny(objL, ['units were sold', 'units sold', 'how many units'])) {
    objective = 'daily units sold update';
  } else if (includesAny(objL, ['low stock', 'inventory scan', 'reorder'])) {
    objective = 'low stock scan';
  }

  if (!objective || objective.length < 4) {
    const hints = ['units sold', 'low stock', 'inventory', 'sales', 'forecast', 'load recent data', 'reorder', 'product change'];
    let found = '';
    for (const h of hints) {
      if (low.includes(h)) { found = h; break; }
    }
    objective = found || 'scheduled legion task';
  }

  return { schedule, objective: objective.slice(0, 200) };
}

/**
 * Register legion_scheduled intent; returns user-facing reply string.
 */
function buildLegionScheduleReply(opts) {
  const {
    schedule: rawSchedule,
    objective,
    key,
    reqSource,
    normalizeSchedule,
    loadIntents,
    createLegionScheduledWithTask,
  } = opts;
  const { formatTaskRef } = require('./legionTaskCreate');

  const normalizedSchedule = normalizeSchedule(rawSchedule);
  if (!normalizedSchedule) {
    return `Couldn't parse schedule "${rawSchedule}". Use \`/legion schedule daily 09:00 ${String(objective).slice(0, 40)}\` for daily tasks.`;
  }

  const intents = loadIntents();
  const existing = intents.find(
    (i) =>
      i &&
      i.type === 'legion_scheduled' &&
      (i.status === 'pending' || !i.status) &&
      i.schedule === normalizedSchedule &&
      (i.title === objective || (i.briefFields && i.briefFields.objective === objective)),
  );
  if (existing) {
    const ref = formatTaskRef(existing.task_id || existing.taskId);
    return `Already set up — ${ref}: ${objective} ${normalizedSchedule}.`;
  }

  let out;
  try {
    out = createLegionScheduledWithTask({
      schedule: normalizedSchedule,
      title: objective,
      objective,
      description: objective,
      mode: 'auto',
      source: reqSource,
      sessionId: key,
      _creationSource: 'nl_schedule_fastpath',
    });
  } catch (e) {
    return `Couldn't register that schedule: ${e.message || e}`;
  }

  const ref = formatTaskRef(out.task_id);
  try {
    const { logActivity } = require('./activityLog');
    logActivity('intent_created', {
      intentId: out.intent.id,
      task_id: out.task_id,
      type: 'legion_scheduled',
      objective,
      schedule: normalizedSchedule,
      source: 'nl_schedule_fastpath',
    });
  } catch (_) {}

  return `Done — ${ref} scheduled: ${objective} ${normalizedSchedule}. Reference this as ${ref} in chat.`;
}

module.exports = { tryParseLegionScheduleFromNL, buildLegionScheduleReply, to24Hour };
