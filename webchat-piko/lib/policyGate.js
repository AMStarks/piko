/**
 * Front Desk policy gate — triage route is law for work routing.
 *
 * Order of operations in server.js (see docs/FRONT_DESK_ROUTING.md):
 *   1. Safety / commands / confirmations (deterministic)
 *   2. 8B intent triage (resolveTriage)
 *   3. Policy gate by triage.route
 *   4. Lane executors (answerLocal, nlSchedule, actionRouter, chat/deep)
 *
 * Intent/routing decisions are model-led. This module does not inspect message
 * text with regex to choose work paths.
 */
const { fireProgressAck } = require('./frontDesk');

const WORK_LANES = new Set(['WORK_NOW', 'SCHEDULE_WORK']);

function isTriageEnabled() {
  const raw = process.env.PIKO_USE_INTENT_TRIAGE;
  return raw !== '0' && raw !== 'false';
}

/** @param {{ route?: string } | null} triage */
function allowsWorkRouting(triage) {
  if (!isTriageEnabled() || !triage || !triage.route) return true;
  return WORK_LANES.has(String(triage.route).toUpperCase());
}

/** @param {{ route?: string } | null} triage */
function allowsNlSchedule(triage) {
  if (!isTriageEnabled() || !triage) return true;
  return String(triage.route).toUpperCase() === 'SCHEDULE_WORK';
}

/** @param {{ route?: string } | null} triage */
function allowsWorkCircuits(triage) {
  if (!isTriageEnabled() || !triage) return true;
  return String(triage.route).toUpperCase() === 'WORK_NOW';
}

/** @param {{ route?: string } | null} triage */
function allowsActionRouter(triage) {
  return allowsWorkRouting(triage);
}

/** @param {{ route?: string } | null} triage */
function allowsCompoundOrchestrator(triage) {
  if (!isTriageEnabled() || !triage) return true;
  const route = String(triage.route).toUpperCase();
  return route === 'WORK_NOW' || route === 'DEEP_REASONING';
}

/** True when work-lane ack must not fire — local read/config will handle the turn. */
function shouldFireWorkLaneAck(message, triage) {
  if (!triage) return false;
  const route = String(triage.route || '').toUpperCase();
  if (route !== 'WORK_NOW' && route !== 'SCHEDULE_WORK') return false;
  try {
    const { isAnswerLocalQuery } = require('./answerLocal');
    if (isAnswerLocalQuery(message)) return false;
    const { resolveDialogueTurn } = require('./dialogueManager');
    const dialogue = resolveDialogueTurn(message, {});
    if (dialogue.suppressWorkAck) return false;
    if (
      dialogue.speechAct === 'permission'
      || dialogue.speechAct === 'howto'
      || dialogue.speechAct === 'clarify_mutate'
    ) {
      return false;
    }
    const { isConfigMutateIntent } = require('./configMutate');
    const { isLegionScheduleMutateIntent } = require('./legionScheduleMutate');
    const { isOperationsMutateIntent } = require('./operationsMutate');
    if (isConfigMutateIntent(message)) return false;
    if (isLegionScheduleMutateIntent(message)) return false;
    if (isOperationsMutateIntent(message)) return false;
    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Instant acknowledgment before heavy work.
 * Uses triage.route / triage.reason only — no message-text regex.
 */
function buildTriageAck(triage) {
  const route = String((triage && triage.route) || '').toUpperCase();
  const reason = String((triage && triage.reason) || '').toLowerCase();
  if (route === 'SCHEDULE_WORK') {
    return "Got it — I'll set that schedule up now.";
  }
  if (route === 'DEEP_REASONING') {
    return "Give me a moment — I'm thinking that through properly.";
  }
  if (route === 'WORK_NOW') {
    if (reason.includes('sales')) return "On it — pulling sales numbers now.";
    if (reason.includes('forecast')) return "On it — checking the forecast now.";
    if (reason.includes('stock') || reason.includes('inventory') || reason.includes('reorder')) {
      return "On it — checking inventory now.";
    }
    if (reason.includes('email') || reason.includes('mail')) return "On it — handling that email request.";
    if (reason.includes('search') || reason.includes('web')) return "On it — searching for that now.";
    return "On it — working on that now. Give me a moment.";
  }
  return null;
}

async function fireTriageAck(triage, userMessage, opts = {}) {
  const ack = buildTriageAck(triage);
  if (!ack) return null;
  const sessionId = String(opts.sessionId || '');
  const isTelegram = sessionId.startsWith('telegram') || opts.reqSource === 'telegram';
  if (isTelegram || process.env.PIKO_ASYNC_ACK_PUSH_TELEGRAM === '1') {
    try {
      const { sendToAdmin } = require('./telegramNotifier');
      sendToAdmin(ack, { parseMode: 'none' }).catch(() => {});
    } catch (_) {}
  }
  if (process.env.PIKO_LOG_PLANNER === '1') {
    console.log('[POLICY-GATE] Triage ack:', ack.slice(0, 80));
  }
  return ack;
}

/** Map triage route to a synthetic route for frontDesk progress acks. */
function triageToProgressRoute(triage) {
  const route = String((triage && triage.route) || '').toUpperCase();
  if (route === 'DEEP_REASONING') return { actionType: 'compound_task' };
  return null;
}

async function fireTriageProgressAck(triage, userMessage, opts = {}) {
  const synthetic = triageToProgressRoute(triage);
  if (!synthetic) return fireTriageAck(triage, userMessage, opts);
  const ack = await fireProgressAck(synthetic, userMessage, opts);
  return ack || (await fireTriageAck(triage, userMessage, opts));
}

module.exports = {
  WORK_LANES,
  isTriageEnabled,
  allowsWorkRouting,
  allowsNlSchedule,
  allowsWorkCircuits,
  allowsActionRouter,
  allowsCompoundOrchestrator,
  shouldFireWorkLaneAck,
  buildTriageAck,
  fireTriageAck,
  fireTriageProgressAck,
};
