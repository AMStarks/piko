/**
 * P3 Tier 3 — chat-driven background job enable/disable (confirm before apply).
 */
const { normalizeApostrophes } = require('./queueRead');
const { findJobByMessage } = require('./operationsRegistry');
const { setJobEnabled } = require('./operationsOverrides');
const { updateConfig, DEFAULTS } = require('./configManager');
const { toLowerAsciiish, includesAny, hasAnyWord, collapseWhitespace } = require('./text');

const PENDING_TTL_MS = 5 * 60 * 1000;

function parseEnableDisable(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (includesAny(t, ['turn on', 'enable', 'start'])) return true;
  if (includesAny(t, ['turn off', 'disable', 'stop'])) return false;
  return null;
}

/**
 * @returns {null | object}
 */
function parseOperationsMutateIntent(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t || t.startsWith('/')) return null;

  if (includesAny(t, ['can i', 'am i able', 'is it possible', 'how do i', 'how can i'])) {
    return null;
  }

  if (!includesAny(t, ['turn on', 'turn off', 'enable', 'disable', 'stop', 'start'])) {
    return null;
  }

  const mentionsProactive = t.includes('proactive') || t.includes('proactive update') || t.includes('proactive updates');
  if (mentionsProactive && !hasAnyWord(t, ['engine', 'cycle', 'alert', 'alerts'])) {
    return null;
  }

  const job = findJobByMessage(message);
  if (!job || job.toggleType === 'none') return null;

  const enabled = parseEnableDisable(message);
  if (enabled == null) return null;

  return {
    type: 'operations_toggle',
    jobId: job.id,
    jobName: job.name,
    enabled,
    toggleType: job.toggleType,
    configKey: job.configKey || null,
    source: job.source,
    summary: `${enabled ? 'enable' : 'disable'} ${job.name}`,
  };
}

function isOperationsMutateIntent(message) {
  return parseOperationsMutateIntent(message) != null;
}

function formatOperationsMutateConfirm(intent) {
  const extra =
    intent.source === 'external'
      ? ' (preference saved; in-process runner will respect this when scheduled)'
      : '';
  return `I'll ${intent.summary}${extra}. Reply YES to confirm, or NO to cancel.`;
}

function formatOperationsMutateSuccess(intent) {
  const state = intent.enabled ? 'enabled' : 'disabled';
  if (intent.toggleType === 'config' && intent.configKey) {
    return `Done — ${intent.jobName} is now ${state} (piko_config.json → ${intent.configKey}).`;
  }
  return `Done — ${intent.jobName} is now ${state} (operations-overrides.json).`;
}

function executeOperationsMutation(intent) {
  if (!intent || intent.type !== 'operations_toggle') {
    return { ok: false, error: 'Invalid operations mutation' };
  }

  if (intent.toggleType === 'config' && intent.configKey) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, intent.configKey)) {
      return { ok: false, error: `Unknown config key: ${intent.configKey}` };
    }
    const detail = updateConfig(intent.configKey, intent.enabled);
    if (String(detail).startsWith('Error:')) return { ok: false, error: detail };
    return { ok: true, detail };
  }

  const result = setJobEnabled(intent.jobId, intent.enabled, { source: 'chat_mutate' });
  if (!result.ok) return result;

  if (intent.source === 'external' && intent.enabled) {
    return {
      ok: true,
      detail: `${intent.jobName} preference saved. External OS cron may still exist on the server — in-process scheduling respects this override.`,
    };
  }

  return {
    ok: true,
    detail: `${intent.jobName} → ${intent.enabled ? 'enabled' : 'disabled'}`,
  };
}

function operationsMutateHelpLines() {
  return [
    'Background jobs (in-process crons):',
    '• "Disable intent poller" / "Enable nightly wisdom"',
    '• "Turn off belief consolidation" / "Enable weekly retro"',
    '• "Disable rabbit hole" / "Enable daily memory summarize"',
    '',
    'Proactive idle memo & nightly quant use the runtime settings commands above.',
  ];
}

module.exports = {
  PENDING_TTL_MS,
  parseOperationsMutateIntent,
  isOperationsMutateIntent,
  formatOperationsMutateConfirm,
  formatOperationsMutateSuccess,
  executeOperationsMutation,
  operationsMutateHelpLines,
};
