/**
 * Intent triage: one narrow 8B classifier for front-desk routing.
 *
 * Model-only lane assignment. No regex intent overrides.
 * Instant-greeting templates live in instantChat.js (outside routing guard).
 */
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');

const TRIAGE_LABELS = [
  'CHAT_FAST',
  'CHAT_LIGHT',
  'ANSWER_LOCAL',
  'WORK_NOW',
  'SCHEDULE_WORK',
  'DEEP_REASONING',
  'CLARIFY',
];

const CHAT_LANES = new Set(['CHAT_FAST', 'CHAT_LIGHT']);

function getTriageModel(model) {
  return model || process.env.PIKO_TRIAGE_MODEL || process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b';
}

function buildTriagePrompt() {
  const { getUniversalIdentityHeader } = require('./pikoIdentity');
  const identity = getUniversalIdentityHeader(require('path').join(__dirname, '..'));
  return `${identity}

You are Piko's front-desk intent triage classifier.

Classify the latest user message into exactly ONE route label.

Allowed route labels:
- CHAT_FAST: Pure greeting, thanks, goodbye, short acknowledgement, or casual opener. No work requested.
- CHAT_LIGHT: Normal conversation, small talk, light opinion, emotional check-in, "want to chat", or conversational follow-up. No tool, schedule, reminder, or business data requested.
- ANSWER_LOCAL: User asks about Piko's identity, capabilities, agents, current queue/status already inside Piko, or local memory/state. Can answer without external tools or 70B reasoning.
- WORK_NOW: User asks Piko to do work now: run/check/list/fetch/analyse current data, scan inventory, get sales, get forecast, stock on hand / SOH for a SKU, send email, parse document, search web, execute code.
- SCHEDULE_WORK: User asks Piko to do work later, repeatedly, at a time, daily/hourly/weekly, remind them, set an alert/tripwire, or change an automation schedule.
- DEEP_REASONING: User asks for careful thinking, strategy, architecture, tradeoffs, diagnosis, judgement, or a complex plan. Not a tool execution request.
- CLARIFY: The request is too ambiguous to safely classify.

Critical distinctions:
- "How are you?" is CHAT_FAST or CHAT_LIGHT, never sales/work.
- "How are sales?" is WORK_NOW.
- "What's in the queue?" is ANSWER_LOCAL.
- "Tell me stock on hand for 48SCOTCH-MED" is WORK_NOW (live inventory lookup).
- "SOH for G10B1" / "how many units of X" is WORK_NOW.
- "Review this papyrus translation" is WORK_NOW (culture translation critique — never inventory).
- "Transcribe these hieroglyphs" / "run the scribe on this stela" is WORK_NOW.
- "Harvest British Museum hieroglyph images" / "scrape Egyptian primary sources" is WORK_NOW.
- "Let's chat about why the Rosetta Stone matters" is CHAT_LIGHT when no scrape/transcribe/critique is requested.
- Never treat hieroglyph / papyrus / Gardiner / Rosetta / ancient Egypt research as inventory, sales, Cin7, or Shopify work.
- "When did sales last sync?" and "sales sync status" are ANSWER_LOCAL (read cache status, not run sync).
- "Task #4", "what's Task #4?", "explain Task #6", and "status of task 4" are ANSWER_LOCAL (read scheduled mission detail).
- "Run low stock scan" is WORK_NOW.
- "Schedule low stock scan daily at 9" is SCHEDULE_WORK.
- "Can we talk?" is CHAT_LIGHT.
- "Think through whether this is ready" is DEEP_REASONING.
- If a message combines chat and work, choose the work route.
- If a message says "every", "daily", "hourly", "weekly", "tomorrow", "at 5pm", "remind", "schedule", or "alert me if", choose SCHEDULE_WORK only when creating/changing/removing automation — not when merely asking what cron/background jobs/queue items exist (those are ANSWER_LOCAL).
- Questions about existing cron jobs, background tasks, queue, or what is running now are ANSWER_LOCAL (read status), not SCHEDULE_WORK.
- "Explain what X is", "what does X do", "tell me about X" when X is a queued/scheduled job name are ANSWER_LOCAL (read/explain), never SCHEDULE_WORK.
- Identity questions like "who are you?" are ANSWER_LOCAL, not chat.
- "What can you do?", "what else do you do?", "any other tasks?", "things you complete", "can you deploy agents?", and "do you have agents?" are ANSWER_LOCAL (capabilities), not CHAT_LIGHT.
- Strategy, architecture, tradeoffs, implications, "walk me through risks", or "analyse whether" = DEEP_REASONING.
- Business inventory phrases like "needs reordering", "needs ordering", "low stock", "reorder flag", "stock on hand" are WORK_NOW.
- Calculations with numbers, margins, trendlines, forecasts, or data analysis are WORK_NOW, because code/tools should compute them.
- Architecture/tradeoff/implication/review/brittle/system design questions are DEEP_REASONING.
- Vague references like "that", "it", or "the thing" without clear recent context are CLARIFY.
- "Can you sort that out?", "fix it", "handle that", "do that", and similar unresolved references are CLARIFY unless the message itself names the work.

Return ONLY valid JSON:
{"route":"CHAT_FAST|CHAT_LIGHT|ANSWER_LOCAL|WORK_NOW|SCHEDULE_WORK|DEEP_REASONING|CLARIFY","confidence":0.0-1.0,"reason":"short phrase"}

Examples:
User: "Hey Piko"
{"route":"CHAT_FAST","confidence":0.99,"reason":"pure greeting"}
User: "How are you?"
{"route":"CHAT_FAST","confidence":0.98,"reason":"social check-in"}
User: "Want to chat for a bit?"
{"route":"CHAT_LIGHT","confidence":0.96,"reason":"conversation invite"}
User: "What can you do?"
{"route":"ANSWER_LOCAL","confidence":0.95,"reason":"capability question"}
User: "Can you confirm if you can deploy agents to do work for you?"
{"route":"ANSWER_LOCAL","confidence":0.98,"reason":"agent capability question"}
User: "What's in the queue?"
{"route":"ANSWER_LOCAL","confidence":0.97,"reason":"local queue state"}
User: "How are sales today?"
{"route":"WORK_NOW","confidence":0.99,"reason":"current sales data requested"}
User: "Hi Piko - tell me stock on hand for 48SCOTCH-MED"
{"route":"WORK_NOW","confidence":0.99,"reason":"stock on hand lookup"}
User: "SOH 48SCOTCH-MED"
{"route":"WORK_NOW","confidence":0.99,"reason":"stock on hand lookup"}
User: "What needs reordering?"
{"route":"WORK_NOW","confidence":0.99,"reason":"inventory data requested"}
User: "Review this papyrus translation against the museum text"
{"route":"WORK_NOW","confidence":0.98,"reason":"translation critique work"}
User: "Transcribe the hieroglyphs in this image to Gardiner signs"
{"route":"WORK_NOW","confidence":0.99,"reason":"vision scribe work"}
User: "Harvest a few Egyptian primary sources from the British Museum"
{"route":"WORK_NOW","confidence":0.98,"reason":"research scrape work"}
User: "Let's chat about why the Rosetta Stone matters"
{"route":"CHAT_LIGHT","confidence":0.9,"reason":"culture conversation no tools"}
User: "Run a low stock scan now"
{"route":"WORK_NOW","confidence":0.99,"reason":"immediate inventory scan"}
User: "Check inventory every hour from 6am to 11pm"
{"route":"SCHEDULE_WORK","confidence":0.99,"reason":"recurring scheduled work"}
User: "Remind me tomorrow to call James"
{"route":"SCHEDULE_WORK","confidence":0.99,"reason":"one-off reminder"}
User: "Help me think through whether this pilot is ready"
{"route":"DEEP_REASONING","confidence":0.97,"reason":"strategic judgement requested"}
User: "Do the thing"
{"route":"CLARIFY","confidence":0.65,"reason":"ambiguous request"}
User: "Can you sort that out?"
{"route":"CLARIFY","confidence":0.70,"reason":"ambiguous reference"}
User: "Am I able to adjust the background tasks?"
{"route":"ANSWER_LOCAL","confidence":0.97,"reason":"config/permission question not schedule mutation"}
User: "Move the low stock scan to 10am daily"
{"route":"SCHEDULE_WORK","confidence":0.98,"reason":"explicit schedule change command"}`;
}

function normalizeRoute(route) {
  const upper = String(route || '').trim().toUpperCase();
  return TRIAGE_LABELS.includes(upper) ? upper : 'CLARIFY';
}

function isChatLane(route) {
  return CHAT_LANES.has(normalizeRoute(route));
}

function collapseChatRoute(route) {
  return isChatLane(route) ? 'CHAT_FAST' : normalizeRoute(route);
}

/**
 * Soft policy after LLM triage: collapse chat lanes; low-confidence work stays as returned
 * by the model (prompt already covers CLARIFY). No regex overrides.
 */
function applyTriagePolicy(triage) {
  const result = { ...triage, route: normalizeRoute(triage.route) };
  if (isChatLane(result.route)) {
    result.route = collapseChatRoute(result.route);
    result.chatCollapsed = true;
  }
  return result;
}

function parseTriageResponse(raw) {
  const parsed = extractJsonObject(raw);
  const route = normalizeRoute(parsed.route);
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
  const reason = String(parsed.reason || '').trim().slice(0, 120);
  return { route, confidence, reason, raw: String(raw || '').trim() };
}

async function triageIntent(userMessage, opts = {}) {
  const model = getTriageModel(opts.model);
  const messages = [
    { role: 'system', content: buildTriagePrompt() },
    { role: 'user', content: String(userMessage || '').trim().slice(0, 500) },
  ];
  const raw = await ollamaNativeChat(model, messages, {
    format: 'json',
    temperature: 0,
    max_tokens: 80,
    num_ctx: Number(process.env.PIKO_TRIAGE_NUM_CTX || 2048),
    timeoutMs: Math.max(2000, Number(process.env.PIKO_TRIAGE_TIMEOUT_MS || 12000)),
  });
  return parseTriageResponse(raw);
}

async function resolveTriage(userMessage, opts = {}) {
  const raw = await triageIntent(userMessage, opts);
  return { ...applyTriagePolicy(raw), source: 'llm' };
}

module.exports = {
  TRIAGE_LABELS,
  buildTriagePrompt,
  parseTriageResponse,
  triageIntent,
  resolveTriage,
  applyTriagePolicy,
  isChatLane,
  collapseChatRoute,
};
