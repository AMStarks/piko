/**
 * Webhook event processor — match rules and execute actions (Legion, DM, log).
 */
const { findRulesForEvent } = require('./webhookRules');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_LOG_FILE = path.join(DATA_DIR, 'webhook-events-log.json');
const MAX_LOG_ENTRIES = 500;

const {
  stripTrailingSlash,
  interpolateDoubleMustache,
} = require('./text');

function interpolateTemplate(template, payload) {
  if (!template || typeof template !== 'string') return '';
  return interpolateDoubleMustache(template, payload);
}

function appendEventLog(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let log = [];
    if (fs.existsSync(EVENTS_LOG_FILE)) {
      const raw = fs.readFileSync(EVENTS_LOG_FILE, 'utf8');
      try {
        log = JSON.parse(raw);
      } catch (_) {}
    }
    if (!Array.isArray(log)) log = [];
    log.unshift(entry);
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(0, MAX_LOG_ENTRIES);
    fs.writeFileSync(EVENTS_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
  } catch (_) {}
}

async function executeLegionAction(action, event, postJsonToUrl, options) {
  const adapterId = action.adapterId || 'ausmakersupplies';
  const capability = action.capability || 'inventory.low_stock.scan';
  const base = options.legionBase || 'http://127.0.0.1:8000';
  const endpoint = `${stripTrailingSlash(base)}/api/adapters/${encodeURIComponent(adapterId)}/run`;
  const input = { ...(event.payload || {}), ...(action.payloadOverride || {}) };
  const objective = event.eventType + (event.payload && event.payload.sku ? ` ${event.payload.sku}` : '');
  const payload = {
    capability,
    input: { ...input, objective: input.objective || objective },
    context: {
      trace_id: `wh_${Date.now()}`,
      source: 'webhook',
      event_type: event.eventType,
      requested_by: 'piko_webhook',
    },
  };
  const headers = options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {};
  const res = await postJsonToUrl(endpoint, payload, { timeoutMs: options.timeoutMs || 20000, headers });
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300 && res.body && res.body.ok,
    statusCode: res.statusCode,
    body: res.body,
  };
}

async function executeDmAction(action, event, sendTelegram, appendPending) {
  const template = action.template || 'Webhook: {{eventType}} — {{payload}}';
  const ctx = { payload: event.payload || {}, eventType: event.eventType, ...(event.payload || {}) };
  const message = interpolateTemplate(template, ctx);
  const channel = (action.channel || 'pending_file').toLowerCase();
  if (channel === 'telegram' && sendTelegram) {
    await sendTelegram(message).catch(() => {});
    return { ok: true, channel: 'telegram' };
  }
  if (appendPending) {
    appendPending(message);
    return { ok: true, channel: 'pending_file' };
  }
  return { ok: false, error: 'No DM channel configured' };
}

async function processWebhookEvent(event, options = {}) {
  const { postJsonToUrl, sendTelegram, appendPending, legionBase, bearer } = options;
  const eventType = String(event.eventType || '').trim() || 'unknown';
  const source = String(event.source || '').trim() || 'unknown';

  const rules = findRulesForEvent(eventType, source);
  const actionsExecuted = [];

  for (const rule of rules) {
    for (const action of rule.actions || []) {
      const act = action.type || 'log';
      try {
        if (act === 'legion' && postJsonToUrl) {
          const result = await executeLegionAction(action, event, postJsonToUrl, {
            legionBase,
            bearer,
            timeoutMs: 20000,
          });
          actionsExecuted.push({ ruleId: rule.id, type: 'legion', ...result });
        } else if (act === 'dm' && (sendTelegram || appendPending)) {
          const result = await executeDmAction(action, event, sendTelegram, appendPending);
          actionsExecuted.push({ ruleId: rule.id, type: 'dm', ...result });
        } else if (act === 'log' || act === 'noop') {
          actionsExecuted.push({ ruleId: rule.id, type: act, ok: true });
        }
      } catch (e) {
        actionsExecuted.push({ ruleId: rule.id, type: act, ok: false, error: e.message });
      }
    }
  }

  const logEntry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    at: new Date().toISOString(),
    source,
    eventType,
    payload: event.payload || {},
    rulesMatched: rules.length,
    actionsExecuted,
  };
  appendEventLog(logEntry);

  return { rulesMatched: rules.length, actionsExecuted };
}

module.exports = {
  processWebhookEvent,
  appendEventLog,
  interpolateTemplate,
};
