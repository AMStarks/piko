/**
 * P3 Tier 1 — chat-driven runtime config mutations (confirm before apply).
 * piko_config.json + proactive-policy.json only (no systemd/cron).
 */
const { normalizeApostrophes } = require('./queueRead');
const { updateConfig, DEFAULTS } = require('./configManager');
const { loadPolicy, savePolicy } = require('./proactivePolicy');
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  collapseWhitespace,
  extractDigitRuns,
} = require('./text');

const PENDING_TTL_MS = 5 * 60 * 1000;

const BOOL_TRUE = new Set(['on', 'true', 'yes', 'enable', 'enabled']);
const BOOL_FALSE = new Set(['off', 'false', 'no', 'disable', 'disabled']);
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parseBoolToken(token) {
  const t = toLowerAsciiish(String(token || '')).trim();
  if (BOOL_TRUE.has(t)) return true;
  if (BOOL_FALSE.has(t)) return false;
  return null;
}

function mentionsProactive(t) {
  return t.includes('proactive');
}

function extractHoursAfter(t, cue) {
  const idx = t.indexOf(cue);
  if (idx < 0) return null;
  const after = t.slice(idx + cue.length);
  const runs = extractDigitRuns(after);
  if (!runs.length) return null;
  // first digit run should be near the start of the remainder
  if (runs[0].index > 8) return null;
  const hours = runs[0].value;
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) return null;
  const rest = after.slice(runs[0].index + runs[0].text.length);
  if (!(rest.includes('hour') || rest.includes(' h') || rest.trimStart().startsWith('h'))) return null;
  return hours;
}

/**
 * @returns {null | { type: 'piko_config'|'proactive_policy', key?: string, value?: any, patch?: object, summary: string }}
 */
function parseConfigMutateIntent(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t) return null;

  if (
    includesAny(t, ['can i', 'am i able', 'is it possible', 'how do i', 'how can i'])
    && !hasAnyWord(t, ['turn', 'set', 'disable', 'enable'])
  ) {
    return null;
  }

  if (
    (includesAny(t, ['turn off', 'disable', 'stop']) && mentionsProactive(t))
    || (mentionsProactive(t) && includesAny(t, [' off', ' disabled']) && (t.includes('proactive off') || t.includes('proactive updates off') || t.includes('proactive update off') || t.endsWith('off') || t.includes('disabled')))
  ) {
    if (includesAny(t, ['turn off', 'disable', 'stop']) || t.includes('proactive off') || t.includes('proactive updates off') || t.includes('proactive update off') || t.includes('proactive disabled') || t.includes('proactive updates disabled')) {
      return {
        type: 'piko_config',
        key: 'proactiveUpdatesEnabled',
        value: false,
        summary: 'turn off Proactive Updates (idle memo)',
      };
    }
  }

  if (
    (includesAny(t, ['turn on', 'enable', 'start']) && mentionsProactive(t))
    || t.includes('proactive on') || t.includes('proactive updates on') || t.includes('proactive update on')
    || t.includes('proactive enabled') || t.includes('proactive updates enabled')
  ) {
    if (includesAny(t, ['turn on', 'enable', 'start']) || t.includes(' on') || t.includes('enabled')) {
      return {
        type: 'piko_config',
        key: 'proactiveUpdatesEnabled',
        value: true,
        summary: 'turn on Proactive Updates (idle memo)',
      };
    }
  }

  let hours = extractHoursAfter(t, 'proactive updates interval');
  if (hours == null) hours = extractHoursAfter(t, 'proactive update interval');
  if (hours == null) hours = extractHoursAfter(t, 'proactive interval');
  if (hours == null && mentionsProactive(t) && t.includes('every ')) {
    hours = extractHoursAfter(t, 'every ');
  }
  if (hours != null) {
    return {
      type: 'piko_config',
      key: 'proactiveIntervalHours',
      value: hours,
      summary: `set Proactive Update idle interval to ${hours} hour${hours === 1 ? '' : 's'}`,
    };
  }

  if (includesAny(t, ['turn off', 'disable']) && t.includes('nightly quant')) {
    return {
      type: 'piko_config',
      key: 'nightlyQuantEnabled',
      value: false,
      summary: 'turn off nightly quant forecasts',
    };
  }
  if (includesAny(t, ['turn on', 'enable']) && t.includes('nightly quant')) {
    return {
      type: 'piko_config',
      key: 'nightlyQuantEnabled',
      value: true,
      summary: 'turn on nightly quant forecasts',
    };
  }

  if (t.includes('po generate') || t.includes('po generate hour') || t.includes('po generate time') || (t.includes('po ') && (t.includes('hour') || t.includes('time')))) {
    const cues = ['po generate hour to ', 'po generate time to ', 'po generate hour ', 'po generate time ', 'set po generate hour to ', 'set po generate time to '];
    for (const cue of cues) {
      const idx = t.indexOf(cue);
      if (idx < 0) continue;
      const runs = extractDigitRuns(t.slice(idx + cue.length));
      if (runs.length && runs[0].index <= 2) {
        const h = runs[0].value;
        if (h >= 0 && h <= 23) {
          return {
            type: 'piko_config',
            key: 'poGenerateHour',
            value: h,
            summary: `set PO generate hour to ${h}:00`,
          };
        }
      }
    }
  }

  if (t.includes('po ') && t.includes('day')) {
    for (const day of WEEKDAYS) {
      if (t.includes(day)) {
        const Day = day.charAt(0).toUpperCase() + day.slice(1);
        return {
          type: 'piko_config',
          key: 'poGenerateDay',
          value: Day,
          summary: `set PO generate day to ${Day}`,
        };
      }
    }
  }

  if (
    includesAny(t, ['turn off', 'disable'])
    && (includesAny(t, ['business health', 'business-health']) || includesAny(t, ['proactive alert', 'proactive alerts']))
  ) {
    return {
      type: 'proactive_policy',
      patch: { categories: { businessHealth: false } },
      summary: 'turn off Business Health proactive alerts',
    };
  }

  if (includesAny(t, ['turn on', 'enable']) && includesAny(t, ['business health', 'business-health'])) {
    return {
      type: 'proactive_policy',
      patch: { categories: { businessHealth: true } },
      summary: 'turn on Business Health proactive alerts',
    };
  }

  if (t.includes('proactive') && t.includes('mode')) {
    const modes = [
      ['draft only', 'draft_only'],
      ['draft_only', 'draft_only'],
      ['full auto', 'full_auto'],
      ['full_auto', 'full_auto'],
      ['hybrid', 'hybrid'],
      ['auto', 'full_auto'],
      ['full', 'full_auto'],
      ['off', 'off'],
      ['draft', 'draft_only'],
    ];
    for (const [phrase, mode] of modes) {
      if (t.includes(phrase) && (t.includes('mode to ' + phrase) || t.includes('mode ' + phrase) || t.endsWith(phrase))) {
        return {
          type: 'proactive_policy',
          patch: { mode },
          summary: `set proactive policy mode to ${mode}`,
        };
      }
    }
  }

  return null;
}

function isConfigMutateIntent(message) {
  return parseConfigMutateIntent(message) != null;
}

function formatConfigMutateConfirm(intent) {
  return `I'll ${intent.summary}. Reply YES to confirm, or NO to cancel.`;
}

function formatConfigMutateSuccess(intent, detail) {
  if (intent.type === 'piko_config') {
    return `Done — ${intent.summary}. (${detail || 'saved to piko_config.json'})`;
  }
  return `Done — ${intent.summary}. (${detail || 'saved to proactive-policy.json'})`;
}

function executeConfigMutation(intent) {
  if (!intent || !intent.type) {
    return { ok: false, error: 'Invalid mutation intent' };
  }

  if (intent.type === 'piko_config') {
    if (!intent.key || !Object.prototype.hasOwnProperty.call(DEFAULTS, intent.key)) {
      return { ok: false, error: `Unknown config key: ${intent.key}` };
    }
    const result = updateConfig(intent.key, intent.value);
    if (String(result).startsWith('Error:')) {
      return { ok: false, error: result };
    }
    return { ok: true, detail: result, key: intent.key, value: intent.value };
  }

  if (intent.type === 'proactive_policy') {
    try {
      const current = loadPolicy();
      const next = JSON.parse(JSON.stringify(current));
      const patch = intent.patch || {};
      if (patch.mode != null) next.mode = patch.mode;
      if (patch.categories) {
        next.categories = { ...next.categories, ...patch.categories };
      }
      const saved = savePolicy(next);
      return {
        ok: true,
        detail: `mode=${saved.mode}, businessHealth=${saved.categories?.businessHealth}`,
        policy: saved,
      };
    } catch (e) {
      return { ok: false, error: e.message || 'Policy save failed' };
    }
  }

  return { ok: false, error: 'Unsupported mutation type' };
}

function configMutateHelpLines() {
  const { legionScheduleMutateHelpLines } = require('./legionScheduleMutate');
  const { operationsMutateHelpLines } = require('./operationsMutate');
  return [
    'You can ask me to change runtime settings directly (I\'ll confirm before applying):',
    '• "Turn off proactive updates" / "Enable proactive updates"',
    '• "Set proactive interval to 8 hours"',
    '• "Disable business health alerts" / "Enable business health"',
    '• "Set proactive mode to draft only" (or hybrid / full auto / off)',
    '• "Set PO generate day to Wednesday" / "Set PO generate hour to 16"',
    '',
    ...legionScheduleMutateHelpLines(),
    '',
    ...operationsMutateHelpLines(),
  ];
}

module.exports = {
  PENDING_TTL_MS,
  parseConfigMutateIntent,
  isConfigMutateIntent,
  formatConfigMutateConfirm,
  formatConfigMutateSuccess,
  executeConfigMutation,
  configMutateHelpLines,
  parseBoolToken,
};
