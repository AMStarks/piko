/**
 * Clarify — detect ambiguity in code; speak naturally (8B); act on 1/2/3 or paraphrase.
 */
const { normalizeApostrophes } = require('./queueRead');
const { parseTaskIdFromMessage } = require('./taskRead');
const { getPending, setPending, clearPending } = require('./clarifyPending');
const { includesAny, toLowerAsciiish, collapseWhitespace, isAsciiLetter, isAsciiDigit } = require('./text');
const { parseOptionNumber } = require('./slashCommands');

function normClarify(message) {
  return collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || '')))).trim();
}

function isWordChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '_';
}

function hasWord(haystack, word) {
  const h = String(haystack || '');
  const w = String(word || '');
  if (!w) return false;
  let from = 0;
  while (from <= h.length - w.length) {
    const idx = h.indexOf(w, from);
    if (idx < 0) return false;
    const before = idx === 0 ? '' : h[idx - 1];
    const after = idx + w.length >= h.length ? '' : h[idx + w.length];
    const leftOk = !before || !isWordChar(before);
    const rightOk = !after || !isWordChar(after);
    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
  return false;
}

function hasAnyWord(haystack, words) {
  for (const w of words || []) {
    if (hasWord(haystack, w)) return true;
  }
  return false;
}

/** `\bat\s+\d` — "at" + whitespace + digit, word-bounded. */
function hasAtDigit(t) {
  let from = 0;
  while (from < t.length) {
    const idx = t.indexOf('at', from);
    if (idx < 0) return false;
    const before = idx === 0 ? '' : t[idx - 1];
    if (before && isWordChar(before)) {
      from = idx + 1;
      continue;
    }
    let j = idx + 2;
    let sawWs = false;
    while (j < t.length && (t[j] === ' ' || t[j] === '\t')) {
      sawWs = true;
      j += 1;
    }
    if (sawWs && j < t.length && isAsciiDigit(t[j])) return true;
    from = idx + 1;
  }
  return false;
}

function detectForecastScheduleAmbiguity(message) {
  const t = normClarify(message);
  const hasForecast =
    includesAny(t, ['reforecast', 'agent forecast', 'ai forecast', 'forecast bucket']) ||
    hasAnyWord(t, ['forecast', 'quant']);
  const hasCadence =
    includesAny(t, ['every night', 'every day', '1 am', '1am']) ||
    hasAnyWord(t, ['nightly', 'daily', 'schedule', 'scheduled']);
  const hasRunNow =
    includesAny(t, ['right now']) || hasAnyWord(t, ['now', 'immediately', 'today']);
  return hasForecast && (hasCadence || hasRunNow) && parseTaskIdFromMessage(message) == null;
}

function detectRunVsScheduleAmbiguity(message) {
  const t = normClarify(message);
  const hasSchedule =
    includesAny(t, ['every day', 'every hour']) ||
    hasAtDigit(t) ||
    hasAnyWord(t, ['schedule', 'daily', 'hourly', 'weekly', 'nightly', 'remind']);
  const hasRunNow =
    includesAny(t, ['do it', 'right now']) ||
    hasAnyWord(t, ['run', 'start', 'execute', 'trigger', 'now']);
  return hasSchedule && hasRunNow && !parseTaskIdFromMessage(message);
}

function shouldClarifyMutate(message, dialogue = {}) {
  if (dialogue.speechAct === 'clarify_mutate') return true;
  const t = normClarify(message);
  if (hasAnyWord(t, ['adjust', 'change', 'modify', 'configure']) && parseTaskIdFromMessage(message) == null) {
    if (hasAnyWord(t, ['background', 'proactive', 'cron', 'operation', 'operations'])) return true;
  }
  return false;
}

function shouldOfferClarify(message, opts = {}) {
  if (getPending(opts.sessionKey)) return false;
  const dialogue = opts.dialogue || {};
  if (shouldClarifyMutate(message, dialogue)) return true;
  if (detectForecastScheduleAmbiguity(message)) return true;
  if (detectRunVsScheduleAmbiguity(message)) return true;
  if (opts.triage && opts.triage.route === 'CLARIFY') return true;
  return false;
}

function buildClarifyBundle(message, opts = {}) {
  const dialogue = opts.dialogue || {};
  const triage = opts.triage || null;
  const t = normClarify(message);

  if (detectForecastScheduleAmbiguity(message)) {
    return {
      reason: 'forecast_schedule',
      originalMessage: message,
      options: [
        {
          n: 1,
          id: 'quant_run_now',
          label: 'run the quant agent once now',
          detail: 'reforecast all SKUs into agent_forecasts immediately',
        },
        {
          n: 2,
          id: 'enable_nightly_quant',
          label: 'enable the built-in 1 AM nightly quant job',
          detail: 'writes agent_forecasts every night (nightlyQuantEnabled)',
        },
        {
          n: 3,
          id: 'schedule_quant_legion',
          label: 'add a Legion queue job for quant forecasts',
          detail: 'e.g. daily at 1am as Task #N in your queue',
        },
      ],
      note: 'Dashboard uses agent_forecasts only when a SKU active_method is agent.',
    };
  }

  if (detectRunVsScheduleAmbiguity(message)) {
    return {
      reason: 'run_vs_schedule',
      originalMessage: message,
      options: [
        { n: 1, id: 'work_now', label: 'run it once, right now', detail: 'immediate execution' },
        { n: 2, id: 'schedule_work', label: 'set it up as a recurring schedule', detail: 'Legion queue job' },
      ],
    };
  }

  if (dialogue.speechAct === 'clarify_mutate' || shouldClarifyMutate(message, dialogue)) {
    const topic = dialogue.topic || 'settings';
    if (topic === 'task' || hasAnyWord(t, ['task', 'queue', 'mission'])) {
      return {
        reason: 'mutate_task',
        originalMessage: message,
        options: [
          { n: 1, id: 'topic_queue_move', label: 'move or reschedule a Task #N', detail: 'e.g. Move Task #6 to 10am' },
          { n: 2, id: 'topic_queue_cancel', label: 'cancel a queued mission', detail: 'e.g. Cancel Task #6' },
          { n: 3, id: 'topic_queue_create', label: 'schedule something new', detail: 'e.g. Schedule low stock scan daily at 9am' },
        ],
      };
    }
    if (topic === 'operations' || hasAnyWord(t, ['background', 'cron', 'job'])) {
      return {
        reason: 'mutate_operations',
        originalMessage: message,
        options: [
          { n: 1, id: 'topic_ops_toggle', label: 'turn a background job on or off', detail: 'intent poller, nightly wisdom, etc.' },
          { n: 2, id: 'topic_proactive_config', label: 'change proactive idle memo settings', detail: 'proactive updates on/off, interval' },
          { n: 3, id: 'topic_health_policy', label: 'change business health alerts', detail: 'businessHealth, proactive mode' },
        ],
      };
    }
    return {
      reason: 'mutate_general',
      originalMessage: message,
      options: [
        { n: 1, id: 'topic_proactive_config', label: 'proactive / runtime settings', detail: 'idle memo, interval, policy mode' },
        { n: 2, id: 'topic_queue_create', label: 'Legion queue (Task #N)', detail: 'schedule, move, cancel' },
        { n: 3, id: 'topic_ops_toggle', label: 'background cron jobs', detail: 'enable/disable in-process jobs' },
      ],
    };
  }

  return {
    reason: triage?.reason || 'general',
    originalMessage: message,
    options: [
      { n: 1, id: 'work_now', label: 'run something now', detail: 'scan, sales summary, forecast' },
      { n: 2, id: 'schedule_work', label: 'schedule recurring work', detail: 'daily/hourly Legion job' },
      { n: 3, id: 'explain_settings', label: 'explain or change a setting', detail: 'queue, proactive, background jobs' },
      { n: 4, id: 'chat', label: 'just chat', detail: 'no work' },
    ],
  };
}

function formatBundleTemplate(bundle) {
  const lines = [];
  for (const opt of bundle.options || []) {
    lines.push(`${opt.n}. ${opt.label} — ${opt.detail}`);
  }
  const tail = bundle.note ? `\n\n(${bundle.note})` : '';
  return (
    `I want to make sure I get this right.${lines.length ? ` You could mean:\n${lines.join('\n')}` : ''}` +
    `\n\nWhich is closest? Pick a number or tell me in your own words.${tail}`
  );
}

function parseClarifySelection(message, bundle) {
  if (!bundle || !Array.isArray(bundle.options)) return null;
  const t = normClarify(message);

  const n = parseOptionNumber(message);
  if (n) {
    const opt = bundle.options.find((o) => o.n === n);
    if (opt) return opt;
  }

  for (const opt of bundle.options) {
    const idLow = String(opt.id || '').split('_').join(' ');
    const labelLow = toLowerAsciiish(opt.label);
    if (t === String(opt.n) || t === `option ${opt.n}`) return opt;
    if (labelLow.length > 8 && t.includes(labelLow.slice(0, Math.min(20, labelLow.length)))) return opt;
    if (idLow.length > 6 && t.includes(idLow)) return opt;
    if (hasWord(t, 'nightly') && opt.id === 'enable_nightly_quant') return opt;
    if (
      (includesAny(t, ['right now']) || hasAnyWord(t, ['now', 'run'])) &&
      (opt.id === 'quant_run_now' || opt.id === 'work_now')
    ) {
      return opt;
    }
    if (
      hasAnyWord(t, ['schedule', 'recurring', 'legion']) &&
      (opt.id === 'schedule_quant_legion' || opt.id === 'schedule_work')
    ) {
      return opt;
    }
  }
  return null;
}

async function synthesizeClarifyReply(message, bundle, history = []) {
  const { synthesizeClarifyTurn } = require('./frontDesk');
  const fallback = formatBundleTemplate(bundle);
  try {
    const reply = await synthesizeClarifyTurn({
      userMessage: message,
      bundle,
      history,
      templateFallback: fallback,
    });
    if (reply && reply.length > 30) return reply;
  } catch (_) {}
  return fallback;
}

async function finalizeClarifyTurn(message, opts = {}) {
  const bundle = buildClarifyBundle(message, opts);
  const reply = await synthesizeClarifyReply(message, bundle, opts.history || []);
  return { reply, bundle };
}

function topicGuidanceReply(optionId) {
  const { formatLegionPermissionFallback } = require('./answerLocal');
  const { configMutateHelpLines } = require('./configMutate');
  const { operationsMutateHelpLines } = require('./operationsMutate');
  switch (optionId) {
    case 'topic_queue_move':
    case 'topic_queue_cancel':
    case 'topic_queue_create':
      return formatLegionPermissionFallback('Which Task should I change?', []);
    case 'topic_ops_toggle':
      return ['Background jobs you can toggle from chat:', '', ...operationsMutateHelpLines()].join('\n');
    case 'topic_proactive_config':
      return ['Proactive runtime settings (I\'ll confirm before applying):', '', ...configMutateHelpLines().slice(0, 6)].join('\n');
    case 'topic_health_policy':
      return 'Say e.g. "Disable business health alerts" or "Set proactive mode to draft only" — I\'ll confirm before applying.';
    case 'explain_settings':
      return 'Ask e.g. "Am I able to adjust the background tasks?" and I\'ll list what you can change from chat.';
    case 'chat':
      return 'No worries — what\'s on your mind?';
    default:
      return null;
  }
}

async function executeClarifyOption(option, pending, ctx = {}) {
  const original = pending.originalMessage || '';

  if (option.id === 'quant_run_now') {
    const { deploySubAgent } = require('./legionSwarm');
    const taskContext =
      original ||
      'Deploy the quant agent to reforecast all SKUs and write results to agent_forecasts.';
    const result = await deploySubAgent('quant', taskContext);
    const snippet = String(result || '').trim().slice(0, 800);
    return {
      route: 'clarify_executed',
      reply: snippet.startsWith('Error')
        ? `Quant run hit a snag: ${snippet}`
        : `Right — I've run the quant agent across the catalog. ${snippet || 'Forecasts should be in agent_forecasts now.'}`,
    };
  }

  if (option.id === 'enable_nightly_quant') {
    return {
      route: 'clarify_delegate',
      delegate: {
        type: 'config_mutate',
        intent: {
          type: 'piko_config',
          key: 'nightlyQuantEnabled',
          value: true,
          summary: 'enable nightly quant forecasts (1 AM job)',
        },
      },
      reply: null,
    };
  }

  if (option.id === 'schedule_quant_legion') {
    return {
      route: 'clarify_delegate',
      delegate: {
        type: 'legion_schedule',
        schedule: 'daily 01:00',
        objective: 'quant forecast all SKUs',
      },
      reply: null,
    };
  }

  if (option.id === 'work_now') {
    return {
      route: 'clarify_delegate',
      delegate: { type: 'replay', mode: 'work_now', message: original },
      reply: `Got it — running that now.`,
    };
  }

  if (option.id === 'schedule_work') {
    return {
      route: 'clarify_delegate',
      delegate: { type: 'replay', mode: 'schedule_work', message: original },
      reply: `Sure — I'll set that up as a schedule.`,
    };
  }

  const guidance = topicGuidanceReply(option.id);
  if (guidance) {
    return { route: 'clarify_guidance', reply: guidance };
  }

  return {
    route: 'clarify_unknown',
    reply: 'I didn\'t quite catch which you meant — say the number (1, 2, 3) or describe it briefly.',
  };
}

async function tryResolveClarifyPending(sessionKey, message, ctx = {}) {
  const pending = getPending(sessionKey);
  if (!pending) return null;

  const selection = parseClarifySelection(message, pending.bundle);
  if (!selection) return null;

  clearPending(sessionKey);
  const outcome = await executeClarifyOption(selection, pending, ctx);
  return { ...outcome, selection: selection.id };
}

/** @deprecated use finalizeClarifyTurn */
function buildClarifyReply(message, opts = {}) {
  return formatBundleTemplate(buildClarifyBundle(message, opts));
}

module.exports = {
  detectForecastScheduleAmbiguity,
  detectRunVsScheduleAmbiguity,
  shouldClarifyMutate,
  shouldOfferClarify,
  buildClarifyBundle,
  formatBundleTemplate,
  parseClarifySelection,
  synthesizeClarifyReply,
  finalizeClarifyTurn,
  executeClarifyOption,
  tryResolveClarifyPending,
  buildClarifyReply,
  setClarifyPending: setPending,
  clearClarifyPending: clearPending,
};
