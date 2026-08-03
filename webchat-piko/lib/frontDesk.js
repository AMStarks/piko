/**
 * Front Desk (8B) vs Back Office (70B) routing.
 * - 8B: fast acks, casual chat, action-router JSON
 * - 70B: synthesizing enterprise tool payloads into final replies
 */
const { ollamaNativeChat } = require('./llm');
const { includesAny, toLowerAsciiish } = require('./text');

const LEGION_HEAVY_CAPS = new Set([
  'inventory.low_stock.scan',
  'inventory.report.export',
  'sales.analysis.run',
  'purchase_order.draft.create',
]);

const CULTURE_CAPS = new Set([
  'research.scrape.run',
  'scribe.transcribe.image',
  'translation.critique',
  'culture.pipeline.run',
  'culture.corpus.search',
  'health.check',
]);

/** Caps with deterministic formatInventoryReply / buildSummary — skip 70B synthesis. */
const DETERMINISTIC_REPLY_CAPS = new Set([
  'inventory.low_stock.scan',
  'inventory.report.export',
]);

const TELEGRAM_PUSH_THRESHOLD_MS = Math.max(
  5000,
  parseInt(process.env.PIKO_TELEGRAM_PUSH_THRESHOLD_MS || '40000', 10),
);

const LEGION_FLOW_CAPABILITIES = new Set([
  ...LEGION_HEAVY_CAPS,
  'ausmaker.runbook.execute',
  ...CULTURE_CAPS,
]);

function isLegionFlowCapability(capability) {
  return LEGION_FLOW_CAPABILITIES.has(capability);
}

const HEAVY_ACTION_TYPES = new Set([
  'forecast_review',
  'legion_deploy_agent',
  'web_research_run',
  'python_execute',
  'run_capability',
]);

function heavySynthesisEnabled() {
  const raw = (process.env.PIKO_HEAVY_SYNTHESIS || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function localSynthesisEnabled() {
  const raw = (process.env.PIKO_LOCAL_SYNTHESIS || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function asyncAckEnabled() {
  const raw = (process.env.PIKO_ASYNC_ACK || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function getHeavyModel() {
  return (
    String(process.env.PIKO_HEAVY_MODEL || process.env.PIKO_LEGION_MODEL || '').trim()
    || process.env.OLLAMA_MODEL
    || 'llama3:70b-instruct-q4_K_M'
  );
}

/** 8B-class model for grounded local meta answers (faster than 70B). */
function getLocalSynthModel() {
  return (
    process.env.PIKO_LOCAL_SYNTH_MODEL ||
    process.env.PIKO_ROUTER_MODEL ||
    process.env.PIKO_CASUAL_MODEL ||
    process.env.OLLAMA_MODEL ||
    'llama3.1:8b'
  );
}

function getFrontDeskModel() {
  return process.env.PIKO_CASUAL_MODEL || process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b';
}

function routeNeedsAsyncAck(route) {
  if (!route || !asyncAckEnabled()) return false;
  if (route.actionType === 'legion_deploy_agent' && route.role === 'quant') return false;
  if (route.actionType === 'run_capability') {
    if (route.capability === 'inventory.csv.generate') return false;
    if (route.capability === 'system.intents.read' || route.capability === 'system.operations.read') return false;
    if (route.capability === 'system.intents.manage') return false;
    if (LEGION_HEAVY_CAPS.has(route.capability)) return true;
    if (CULTURE_CAPS.has(route.capability) && route.capability !== 'culture.corpus.search' && route.capability !== 'health.check') return true;
    if (route.capability === 'business.metrics.aggregate') return true;
    if (route.capability === 'web.research.run') return true;
    return false;
  }
  if (route.actionType === 'compound_task') return true;
  return HEAVY_ACTION_TYPES.has(route.actionType);
}

function routeNeedsHeavySynthesis(route) {
  if (!route || !heavySynthesisEnabled()) return false;
  if (route.actionType === 'run_capability') {
    if (DETERMINISTIC_REPLY_CAPS.has(route.capability)) return false;
    if (route.capability === 'inventory.csv.generate') return false;
    if (route.capability === 'system.intents.read' || route.capability === 'system.operations.read') return false;
    if (route.capability === 'system.intents.manage') return false;
    if (LEGION_HEAVY_CAPS.has(route.capability)) return true;
    if (CULTURE_CAPS.has(route.capability) && route.capability !== 'culture.corpus.search' && route.capability !== 'health.check') return true;
    if (route.capability === 'business.metrics.aggregate') return true;
    if (route.capability === 'web.research.run') return true;
    return false;
  }
  return ['forecast_review', 'legion_deploy_agent', 'web_research_run', 'python_execute'].includes(route.actionType);
}

function buildProgressAck(route, userMessage) {
  const cap = route && route.capability;
  const action = route && route.actionType;
  if (action === 'run_capability' && cap === 'inventory.low_stock.scan') {
    return "On it — running a low-stock scan across AusMaker now. Give me a minute.";
  }
  if (action === 'run_capability' && cap === 'inventory.report.export') {
    return "Pulling the full reorder report — this can take a moment.";
  }
  if (action === 'run_capability' && cap === 'sales.analysis.run') {
    return "Crunching sales analysis — I'll have numbers for you shortly.";
  }
  if (action === 'run_capability' && cap === 'purchase_order.draft.create') {
    return "Drafting the purchase order from live stock data — one sec.";
  }
  if (action === 'run_capability' && cap === 'ausmaker.runbook.execute') {
    const label = (route.opts && route.opts.label) || 'AusMaker runbook';
    return `Running ${label} — one moment.`;
  }
  if (action === 'run_capability' && cap === 'business.metrics.aggregate') {
    return "Pulling business metrics from AusMaker — hang tight.";
  }
  if (action === 'run_capability' && cap === 'web.research.run') {
    return "Searching the web — I'll synthesize what I find.";
  }
  if (action === 'run_capability' && (cap === 'research.scrape.run' || cap === 'culture.pipeline.run')) {
    return "Harvesting primary sources into the cultures cache — give me a minute.";
  }
  if (action === 'run_capability' && cap === 'scribe.transcribe.image') {
    return "Running the vision scribe on that image — one moment.";
  }
  if (action === 'run_capability' && cap === 'translation.critique') {
    return "Scholar critique in progress against the museum text — this may take a bit.";
  }
  if (action === 'run_capability' && cap === 'culture.corpus.search') {
    return "Searching the local culture corpus — one sec.";
  }
  if (action === 'forecast_review') {
    return `Reviewing the forecast for ${route.sku || 'that SKU'} — give me a moment.`;
  }
  if (action === 'legion_deploy_agent') {
    const role = route.role || 'sub';
    return `Spinning up the ${role} agent for the heavy lift — this may take a minute or two.`;
  }
  if (action === 'web_research_run') {
    return "Searching and reading sources — I'll summarise shortly.";
  }
  if (action === 'python_execute') {
    return "Writing and running analysis code — give me a moment.";
  }
  if (action === 'sales_summary_get') {
    return "Pulling today's sales numbers from AusMaker — one sec.";
  }
  if (action === 'compound_task') {
    return "That's a multi-step one — I'm breaking it down and working through it. Give me a minute.";
  }
  if (
    userMessage &&
    includesAny(toLowerAsciiish(userMessage), ['forecast', 'inventory', 'sales', 'reorder', 'metrics'])
  ) {
    return "Working on that now — give me a minute.";
  }
  return "On it — pulling the data now. Give me a moment.";
}

function isTelegramSession(opts = {}) {
  const sessionId = String(opts.sessionId || opts.key || '');
  return sessionId.startsWith('telegram') || opts.reqSource === 'telegram';
}

/** Push final reply to Telegram when the HTTP delegate likely timed out. */
function pushTelegramFinalIfSlow(opts, reply, requestStartedAt) {
  if (!reply || !isTelegramSession(opts)) return;
  const elapsed = requestStartedAt ? Date.now() - requestStartedAt : 0;
  if (elapsed < TELEGRAM_PUSH_THRESHOLD_MS) return;
  try {
    const { sendToAdmin } = require('./telegramNotifier');
    sendToAdmin(String(reply).slice(0, 4090), { parseMode: 'none' }).catch(() => {});
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log(`[FRONT-DESK] Telegram slow-path push (${(elapsed / 1000).toFixed(1)}s)`);
    }
  } catch (_) {}
}

async function fireProgressAck(route, userMessage, opts = {}) {
  if (!routeNeedsAsyncAck(route)) return null;
  const ack = buildProgressAck(route, userMessage);
  if (!ack) return null;

  const pushTelegram = isTelegramSession(opts) || process.env.PIKO_ASYNC_ACK_PUSH_TELEGRAM === '1';

  if (pushTelegram) {
    try {
      const { sendToAdmin } = require('./telegramNotifier');
      sendToAdmin(ack, { parseMode: 'none' }).catch(() => {});
    } catch (_) {}
  }

  if (process.env.PIKO_LOG_PLANNER === '1') {
    console.log('[FRONT-DESK] Progress ack:', ack.slice(0, 80));
  }
  return ack;
}

function serializeToolPayload(toolResult) {
  if (toolResult == null) return '';
  if (typeof toolResult === 'string') return toolResult.slice(0, 12000);
  try {
    return JSON.stringify(toolResult, null, 2).slice(0, 12000);
  } catch (_) {
    return String(toolResult).slice(0, 12000);
  }
}

/**
 * 70B reads raw tool output and drafts the user-facing reply.
 */
/**
 * 70B answers meta/self/config questions from retrieved local facts (no tool execution).
 */
async function synthesizeLocalReply(opts = {}) {
  const {
    userMessage = '',
    facts = {},
    route = '',
    formattedFallback = '',
    history = [],
    maxTokens = 850,
    background = false,
  } = opts;

  const payload = serializeToolPayload(facts);
  const fallback = String(formattedFallback || '').trim();
  if (!payload && !fallback) return "I don't have local context for that right now.";

  const historySnippet = (history || [])
    .slice(-4)
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 350)}`)
    .join('\n');

  const speechAct = facts.speechAct || 'explain';
  const compoundNote =
    facts.compound && facts.compoundUnits?.length > 1
      ? `This is a COMPOUND message with ${facts.compoundUnits.length} parts — answer each part.`
      : '';

  const { withUniversalIdentity } = require('./pikoIdentity');
  const promptBody = `Answer the user's question using ONLY the supplied LOCAL FACTS JSON.

Speech act: ${speechAct} (list | explain | permission | howto | follow_up — answer accordingly)
${compoundNote}

Rules:
1. Answer the ACTUAL question for this speech act. For permission: yes/no + how. For explain: plain English. For list: concise list.
2. Use ONLY facts in LOCAL FACTS. Never invent tasks, schedules, revenue numbers, or capabilities.
3. Do NOT claim you scheduled, changed, or executed anything unless the user explicitly commanded a change.
4. Distinguish clearly:
   - proactive/runtime settings (editable FROM CHAT via configGuidance.chatMutations — user says command, Piko confirms)
   - user Legion queue jobs (Task #N — schedule/cancel in chat)
   - server crons in piko-operations.json (catalog only — NOT chat-editable; do not tell user to edit this file for proactive settings)
   - named agents (agentOrchestration) when enabled — you CAN deploy/start/stop them; explain how from howTo
5. For permission/how-to about adjusting background tasks, automation, or proactive behaviour: answer YES for chat-editable settings and quote examples from configGuidance.chatMutations. Do NOT default to editing piko-operations.json.
6. If they ask whether you can deploy agents / put agents on work: if agentOrchestration.enabled, say yes and list howTo + agent ids. Never claim you are "just a chat mate" with no workers.
7. If they ask about a Proactive Update or 6am message, explain proactiveSystems.idleMemo from the facts.
8. If lastDiscussed is in facts, use it for follow-up references ("that", "it", "the 6am thing").
9. No markdown headers. No meta-commentary about models, routing, or tools.
10. Keep it concise but complete (under ~8 sentences unless listing jobs). Address every part of a compound question.
${historySnippet ? `\nRecent conversation:\n${historySnippet}\n` : ''}

User message: "${String(userMessage || '').slice(0, 600)}"
Context route: ${route || 'local'}

LOCAL FACTS:
${payload}

Write the reply to the user:`;

  const prompt = withUniversalIdentity(promptBody);

  try {
    const model = getLocalSynthModel();
    const timeoutMs = background
      ? Math.max(60000, Number(process.env.PIKO_LOCAL_SYNTH_ASYNC_TIMEOUT_MS || 180000))
      : Math.max(15000, Number(process.env.PIKO_LOCAL_SYNTH_TIMEOUT_MS || 45000));
    const t0 = Date.now();
    const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      max_tokens: maxTokens,
      temperature: 0.35,
      timeoutMs,
      priority: 'user',
    });
    const ms = Date.now() - t0;
    const text = (raw && String(raw).trim()) || '';
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log(`[FRONT-DESK] Local synthesis (${model}) in ${(ms / 1000).toFixed(1)}s (${text.length} chars)`);
    }
    if (text.length > 20) return text.slice(0, 4000);
  } catch (e) {
    console.warn('[FRONT-DESK] Local synthesis failed, using fallback:', e.message);
  }
  return fallback || "I have the facts but couldn't phrase a clean answer — try again in a moment.";
}

/** Natural clarifying question — options are fixed in bundle; 8B only phrases them. */
async function synthesizeClarifyTurn(opts = {}) {
  const {
    userMessage = '',
    bundle = {},
    history = [],
    templateFallback = '',
    maxTokens = 500,
  } = opts;

  const optionsJson = JSON.stringify(
    {
      reason: bundle.reason,
      options: (bundle.options || []).map((o) => ({
        n: o.n,
        label: o.label,
        detail: o.detail,
      })),
      note: bundle.note || null,
    },
    null,
    2,
  );

  const historySnippet = (history || [])
    .slice(-4)
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 300)}`)
    .join('\n');

  const prompt = `You are Piko — dry, capable, brotherly. The user's request was ambiguous. Ask a clarifying question in natural conversational prose.

Rules:
1. Use ONLY the options in CLARIFY_OPTIONS — do not invent extra choices or capabilities.
2. Weave the options in as 1, 2, 3 (and 4 if present) in flowing sentences — not a rigid brochure. Short numbered lines mid-reply are fine if they read naturally.
3. One clarifying turn only — do not execute anything yet.
4. Invite them to pick a number OR answer in their own words.
5. No markdown headers. No meta-talk about models or routing.
6. Keep it under ~6 sentences unless the topic needs a touch more room.
${historySnippet ? `\nRecent conversation:\n${historySnippet}\n` : ''}

User message: "${String(userMessage || '').slice(0, 600)}"

CLARIFY_OPTIONS:
${optionsJson}

Write your clarifying reply:`;

  const fallback = String(templateFallback || '').trim();
  try {
    const model = getLocalSynthModel();
    const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      max_tokens: maxTokens,
      temperature: 0.4,
      timeoutMs: Math.max(8000, Number(process.env.PIKO_LOCAL_SYNTH_TIMEOUT_MS || 45000)),
      priority: 'user',
    });
    const text = (raw && String(raw).trim()) || '';
    if (text.length > 40) return text.slice(0, 2000);
  } catch (e) {
    console.warn('[FRONT-DESK] Clarify synthesis failed, using fallback:', e.message);
  }
  return fallback || "I want to make sure I've got this right — run it now, schedule it, or something else?";
}

async function synthesizeToolReply(opts = {}) {
  const {
    userMessage = '',
    toolResult,
    formattedFallback = '',
    hint = '',
    maxTokens = 900,
  } = opts;

  const payload = serializeToolPayload(toolResult);
  const fallback = String(formattedFallback || payload || '').trim();
  if (!payload && !fallback) return "I ran that but didn't get usable data back.";

  const prompt = `You are Piko — dry, capable, brotherly. The user asked:
"${String(userMessage || '').slice(0, 500)}"

You executed an internal tool. Below is the authoritative output (JSON or structured text). Your job is to turn it into a clear, conversational reply.

Rules:
1. Use ONLY numbers, SKUs, dates, and facts present in the tool output. Never invent data.
2. If the output shows an error, Traceback, or failure — say so plainly and quote the key error.
3. No markdown headers like "**Result:**". No meta-commentary about tools, steps, or models.
4. Be concise but complete — lead with the headline (e.g. how many need reorder), then key details.
5. If the user asked for a list and there are many items, summarise top items and mention the total count.
${hint ? `\nContext: ${hint}` : ''}

TOOL OUTPUT:
${payload || fallback}

Write the reply to the user:`;

  try {
    const model = getHeavyModel();
    const t0 = Date.now();
    const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      max_tokens: maxTokens,
      temperature: 0.35,
      timeoutMs: Math.max(30000, Number(process.env.PIKO_HEAVY_SYNTH_TIMEOUT_MS || 120000)),
    });
    const ms = Date.now() - t0;
    const text = (raw && String(raw).trim()) || '';
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log(`[FRONT-DESK] 70B synthesis completed in ${(ms / 1000).toFixed(1)}s (${text.length} chars)`);
    }
    if (text.length > 20) return text.slice(0, 4000);
  } catch (e) {
    console.warn('[FRONT-DESK] Heavy synthesis failed, using fallback:', e.message);
  }
  return fallback || "I got the data but couldn't turn it into a clean summary — try again in a moment.";
}

async function finalizeToolReply(opts = {}) {
  const { route, userMessage, toolResult, formattedFallback } = opts;
  if (!routeNeedsHeavySynthesis(route)) {
    return String(formattedFallback || serializeToolPayload(toolResult) || '').trim();
  }
  const negotiateBulk =
    formattedFallback &&
    toLowerAsciiish(formattedFallback).includes('too many to list in this chat window');
  if (negotiateBulk) return formattedFallback;
  return synthesizeToolReply({
    userMessage,
    toolResult,
    formattedFallback,
    hint: route.capability || route.actionType || '',
  });
}

/**
 * Shared Legion capability execution: ack → dispatch → poll → 70B synthesis.
 */
async function runLegionCapabilityFlow(opts = {}) {
  const {
    route,
    message,
    sessionModel,
    dataDir,
    legionAdapterApiBase,
    reqSource,
    key,
    requestStartedAt,
  } = opts;

  const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });

  const { buildCapabilityInput, formatRunbookReply } = require('./ausmakerRunbook');
  const { dispatchLegionCapabilityRun } = require('./legionDispatch');
  const { checkLegionAdapterHealth, formatLegionAdapterUnavailable } = require('./legionAdapterHealth');
  const adapterHealth = await checkLegionAdapterHealth({ baseUrl: legionAdapterApiBase });
  if (!adapterHealth.ok) {
    return {
      ok: false,
      reply: formatLegionAdapterUnavailable(adapterHealth, route.capability),
      progressAck,
      adapterHealth,
    };
  }

  const input = buildCapabilityInput(route);
  const { resolveAdapterForCapability } = require('./legionDispatch');
  const adapterId = resolveAdapterForCapability(route.capability);
  const dispatch = await dispatchLegionCapabilityRun({
    adapterId,
    capability: route.capability,
    input,
    baseUrl: legionAdapterApiBase,
    piko_user_id: `${reqSource || 'chat'}:${key}`,
    execution_mode: 'auto',
    risk_level: 'low',
  });

  if (!dispatch.ok || !dispatch.runId) {
    const detail = dispatch.message || dispatch.code || 'dispatch failed';
    return {
      ok: false,
      reply: `${formatLegionAdapterUnavailable(adapterHealth, route.capability)} (${detail})`,
      progressAck,
      dispatch,
    };
  }

  const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./legionRunPoller');
  const { saveLegionResult } = require('./sharedContext');
  const polled = await pollLegionRun(dispatch.runId, legionAdapterApiBase);

  if (!polled.ok || !polled.result) {
    const reply = polled.status === 'timeout'
      ? "I've started it, but it's taking longer than expected. Try again in a minute."
      : (polled.error ? `Failed: ${polled.error}. Check Legion logs.` : "Didn't complete. Try again in a minute.");
    return { ok: false, reply, progressAck, runId: dispatch.runId };
  }

  saveLegionResult(dataDir, dispatch.capability, polled.result, { source: 'chat' });
  if (route.capability === 'purchase_order.draft.create') {
    try {
      const { savePoDraftFromResult } = require('./poWriteLadder');
      savePoDraftFromResult(dataDir, polled.result);
    } catch (_) {}
  }
  let formatted;
  if (route.capability === 'inventory.low_stock.scan' || route.capability === 'inventory.report.export') {
    formatted = formatInventoryReply(polled.result, route.capability, dataDir, message, route.opts || {});
  } else if (route.capability === 'ausmaker.runbook.execute') {
    formatted = formatRunbookReply(polled.result, {
      runbook_id: input.runbook_id,
      label: route.opts && route.opts.label,
    });
  } else if (route.capability === 'purchase_order.draft.create') {
    formatted = buildSummaryFromResult(polled.result, dispatch.capability, dataDir) || 'Purchase order draft ready.';
    formatted += ' Review lines, then `/legion approve submit from-draft dry` to log a dry-run submit (no Cin7 write).';
  } else {
    formatted = buildSummaryFromResult(polled.result, dispatch.capability, dataDir) || 'Done. No items flagged.';
  }

  const reply = await finalizeToolReply({
    route,
    userMessage: message,
    toolResult: polled.result,
    formattedFallback: formatted,
  });

  pushTelegramFinalIfSlow({ sessionId: key, reqSource, key }, reply, requestStartedAt);

  return { ok: true, reply, progressAck, runId: dispatch.runId, capability: dispatch.capability };
}

function getCodeGenModel() {
  const raw = (process.env.PIKO_HEAVY_CODE_GEN || '1').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    return process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b';
  }
  return getHeavyModel();
}

module.exports = {
  isLegionFlowCapability,
  heavySynthesisEnabled,
  localSynthesisEnabled,
  asyncAckEnabled,
  getHeavyModel,
  getLocalSynthModel,
  getFrontDeskModel,
  getCodeGenModel,
  routeNeedsAsyncAck,
  routeNeedsHeavySynthesis,
  isTelegramSession,
  pushTelegramFinalIfSlow,
  buildProgressAck,
  fireProgressAck,
  synthesizeLocalReply,
  synthesizeClarifyTurn,
  synthesizeToolReply,
  finalizeToolReply,
  runLegionCapabilityFlow,
  serializeToolPayload,
  LEGION_HEAVY_CAPS,
  DETERMINISTIC_REPLY_CAPS,
};
