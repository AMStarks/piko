/**
 * WP8 comprehension gateway — LLM reads first; code dispatches on structured output.
 *
 * Shadow mode (default): logs verdicts, does not drive routing until
 * PIKO_UNDERSTAND_AUTHORITATIVE=1 (WP8.2 cutover).
 *
 * Model pinned to Legate-class 27B — never falls through to 8B triage default.
 */
const crypto = require('crypto');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { isSlashCommand, parseSlashCommand } = require('./slashCommands');

const INTENTS = [
  'conversation',
  'status_question',
  'opinion_question',
  'musing',
  'work_order',
  'campaign_control',
  'agent_command',
  'schedule_request',
  'config_change',
  'feedback',
  'identity_capability',
  'learning_question',
];

const INTENT_SET = new Set(INTENTS);

const CONTROL_ACTIONS = new Set(['pause', 'resume', 'stop', 'start', 'run_now']);
const WORK_SCOPES = new Set(['single', 'all_by_author', 'topic']);
const SCHEDULE_KINDS = new Set(['daily', 'hourly', 'weekly', 'cron', 'in', 'at']);

const MUTATING_INTENTS = new Set([
  'work_order',
  'campaign_control',
  'agent_command',
  'schedule_request',
  'config_change',
]);

const FEW_SHOT_IDS = new Set([
  'fewshot-musing-osireion',
  'fewshot-work-petrie',
  'fewshot-status-campaign',
  'fewshot-control-selfcorrect',
  'fewshot-opinion-orion',
]);

function getUnderstandModel(opts = {}) {
  const pinned = opts.model
    || process.env.PIKO_UNDERSTAND_MODEL
    || process.env.PIKO_LEGATE_MODEL;
  if (!pinned) {
    throw new Error(
      'PIKO_UNDERSTAND_MODEL or PIKO_LEGATE_MODEL must be set — refuse 8B triage fallback',
    );
  }
  return pinned;
}

function isAuthoritative() {
  const v = process.env.PIKO_UNDERSTAND_AUTHORITATIVE;
  return v === '1' || v === 'true';
}

function isShadowEnabled() {
  const v = process.env.PIKO_UNDERSTAND_SHADOW;
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  // Auto-on when a Legate-class model is configured; stay off under node:test.
  if (process.env.NODE_TEST_CONTEXT) return false;
  return !!(process.env.PIKO_UNDERSTAND_MODEL || process.env.PIKO_LEGATE_MODEL);
}

function conversationFallback(extra = {}) {
  return {
    id: extra.id || crypto.randomBytes(8).toString('hex'),
    intent: 'conversation',
    confidence: 0,
    control: null,
    work: null,
    schedule: null,
    constraints: null,
    slots: {},
    is_question: false,
    needs_operator: false,
    failed: true,
    source: extra.source || 'fallback',
    model: extra.model || null,
    latency_ms: extra.latency_ms || 0,
    ...extra,
  };
}

function computeNeedsOperator(intent) {
  return MUTATING_INTENTS.has(intent);
}

function normalizeWork(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = WORK_SCOPES.has(raw.scope) ? raw.scope : 'single';
  const urls = Array.isArray(raw.urls)
    ? raw.urls.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    verb: String(raw.verb || '').trim().slice(0, 40) || null,
    title: String(raw.title || '').trim().slice(0, 200) || null,
    author: String(raw.author || '').trim().slice(0, 120) || null,
    topic: String(raw.topic || '').trim().slice(0, 200) || null,
    urls,
    scope,
  };
}

function normalizeControl(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').trim();
  if (!CONTROL_ACTIONS.has(action)) return null;
  return { action };
}

function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || '').trim();
  if (!SCHEDULE_KINDS.has(kind)) return null;
  return {
    kind,
    time: raw.time != null ? String(raw.time).trim().slice(0, 40) : null,
    cron: raw.cron != null ? String(raw.cron).trim().slice(0, 80) : null,
    in_minutes: Number.isFinite(Number(raw.in_minutes)) ? Number(raw.in_minutes) : null,
    note: raw.note != null ? String(raw.note).trim().slice(0, 200) : null,
  };
}

function normalizeConstraints(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    max_words: Number.isFinite(Number(raw.max_words)) ? Number(raw.max_words) : null,
    no_questions: raw.no_questions === true,
    brief: raw.brief === true,
  };
}

function normalizeSlots(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const slots = {};
  if (raw.nickname != null) slots.nickname = String(raw.nickname).trim().slice(0, 40);
  if (raw.task_ref != null) slots.task_ref = String(raw.task_ref).trim().slice(0, 40);
  if (raw.option_number != null && Number.isFinite(Number(raw.option_number))) {
    slots.option_number = Number(raw.option_number);
  }
  if (raw.sub_intent != null) slots.sub_intent = String(raw.sub_intent).trim().slice(0, 60);
  return slots;
}

function validateUnderstanding(parsed, meta = {}) {
  const intentRaw = String(parsed.intent || '').trim().toLowerCase();
  const intent = INTENT_SET.has(intentRaw) ? intentRaw : null;
  if (!intent) {
    return conversationFallback({ ...meta, source: 'invalid_intent', parse_error: 'bad_intent' });
  }
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence)));
  const control = normalizeControl(parsed.control);
  const work = normalizeWork(parsed.work);
  const schedule = normalizeSchedule(parsed.schedule);
  const constraints = normalizeConstraints(parsed.constraints);
  const slots = normalizeSlots(parsed.slots);
  // Fail closed: mutating intents without required slots → conversation
  if (intent === 'campaign_control' && !control) {
    return conversationFallback({ ...meta, source: 'incomplete_control', parse_error: 'missing_control' });
  }
  if (intent === 'work_order' && !work) {
    return conversationFallback({ ...meta, source: 'incomplete_work', parse_error: 'missing_work' });
  }
  if (intent === 'schedule_request' && !schedule) {
    return conversationFallback({ ...meta, source: 'incomplete_schedule', parse_error: 'missing_schedule' });
  }
  return {
    id: meta.id,
    intent,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    control: intent === 'campaign_control' ? control : null,
    work: intent === 'work_order' ? work : null,
    schedule: intent === 'schedule_request' ? schedule : null,
    constraints,
    slots,
    is_question: parsed.is_question === true,
    needs_operator: computeNeedsOperator(intent),
    failed: false,
    source: meta.source || 'llm',
    model: meta.model || null,
    latency_ms: meta.latency_ms || 0,
  };
}

function buildUnderstandPrompt(ctx = {}) {
  const campaign = ctx.campaign_summary ? String(ctx.campaign_summary).slice(0, 300) : '(none)';
  const last = ctx.last_assistant ? String(ctx.last_assistant).slice(0, 400) : '(none)';
  const op = ctx.is_operator === true ? 'yes' : 'no';
  return `You are Piko's comprehension classifier for Egyptian Insights / Legion chat.
Read the user message carefully. Return ONLY valid JSON (no markdown).

Allowed intent values:
- conversation: chat, thanks, ack, unrelated talk
- status_question: campaign/research/learning progress or status (NOT control)
- opinion_question: ask for your take/thoughts/opinion
- musing: soft "sometime / maybe / get a feel / thinking about" — NOT a work order
- work_order: explicit find/add/ingest/download/harvest/seek of sources/PDFs/books
- campaign_control: pause/resume/stop/start/run the research campaign or cycle
- agent_command: agent job control in natural language (not slash commands)
- schedule_request: create/change recurring or timed work
- config_change: change settings/config
- feedback: praise/critique of a named thing
- identity_capability: who are you / what can you do / agents / jobs
- learning_question: what have you learned / rabbit hole / recent learning

Critical distinctions:
- "I've been thinking about getting into the Osireion sometime" → musing (NOT work_order)
- "Find Petrie's Giza survey and add it to the corpus" → work_order
- "How's the campaign going?" → status_question
- "Pause the campaign" → campaign_control action=pause
- "Pause the campaign — actually no, just tell me how it's going" → status_question (self-correction wins)
- "What do you make of the Orion correlation?" → opinion_question
- "How's it going?" without research/campaign anchors → conversation (or status only if campaign context is clear)
- Possessive titles like "Petrie's Pyramids" with find/add → work_order; contractions How's/It's are NOT possessives

JSON schema:
{
  "intent": "<one of allowed>",
  "confidence": 0.0-1.0,
  "control": null | {"action":"pause|resume|stop|start|run_now"},
  "work": null | {"verb":"find|add|…","title":"…","author":"…","topic":"…","urls":[],"scope":"single|all_by_author|topic"},
  "schedule": null | {"kind":"daily|hourly|weekly|cron|in|at","time":"HH:MM|null","cron":null,"in_minutes":null,"note":null},
  "constraints": null | {"max_words":null,"no_questions":false,"brief":false},
  "slots": {"nickname":null,"task_ref":null,"option_number":null,"sub_intent":null},
  "is_question": true|false
}

Context:
- user_is_operator: ${op}
- campaign_summary: ${campaign}
- last_assistant_turn: ${last}

Few-shot:
User: "I've been thinking about getting into the Osireion sometime"
{"intent":"musing","confidence":0.95,"control":null,"work":null,"schedule":null,"constraints":null,"slots":{},"is_question":false}
User: "Find Petrie's Giza survey PDF and add it to the corpus"
{"intent":"work_order","confidence":0.98,"control":null,"work":{"verb":"find","title":"Giza survey","author":"Petrie","topic":null,"urls":[],"scope":"single"},"schedule":null,"constraints":null,"slots":{},"is_question":false}
User: "How's the research campaign going?"
{"intent":"status_question","confidence":0.97,"control":null,"work":null,"schedule":null,"constraints":null,"slots":{},"is_question":true}
User: "Pause the campaign — actually no, just give me an update"
{"intent":"status_question","confidence":0.93,"control":null,"work":null,"schedule":null,"constraints":null,"slots":{},"is_question":true}
User: "What do you make of the Orion correlation?"
{"intent":"opinion_question","confidence":0.96,"control":null,"work":null,"schedule":null,"constraints":null,"slots":{},"is_question":true}`;
}

function logUnderstanding(message, result, mode) {
  const hash = crypto.createHash('sha256').update(String(message || '')).digest('hex').slice(0, 12);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    mode,
    hash,
    id: result.id,
    intent: result.intent,
    confidence: result.confidence,
    failed: !!result.failed,
    needs_operator: !!result.needs_operator,
    control: result.control,
    latency_ms: result.latency_ms,
    model: result.model,
    source: result.source,
  });
  if (process.env.PIKO_UNDERSTAND_LOG === '0') return;
  console.log(`[understand] ${line}`);
}

function getUnderstandOllamaBaseUrl() {
  const raw = String(process.env.PIKO_UNDERSTAND_OLLAMA_URL || '').trim();
  return raw || undefined;
}

async function callUnderstandLlm(message, ctx, model) {
  const messages = [
    { role: 'system', content: buildUnderstandPrompt(ctx) },
    { role: 'user', content: String(message || '').trim().slice(0, 800) },
  ];
  const opts = {
    format: 'json',
    temperature: 0,
    max_tokens: 280,
    num_ctx: Number(process.env.PIKO_UNDERSTAND_NUM_CTX || 4096),
    timeoutMs: Math.max(3000, Number(process.env.PIKO_UNDERSTAND_TIMEOUT_MS || 45000)),
    purpose: 'chat',
  };
  const base = getUnderstandOllamaBaseUrl();
  if (base) opts.ollamaBaseUrl = base;
  const raw = await ollamaNativeChat(model, messages, opts);
  return raw;
}

/**
 * Comprehend a user message.
 * Slash commands short-circuit without LLM (deterministic grammar).
 */
async function understand(message, ctx = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const text = String(message || '').trim();
  const started = Date.now();

  if (!text) {
    const empty = conversationFallback({ id, source: 'empty', latency_ms: 0 });
    empty.failed = false;
    empty.source = 'empty';
    return empty;
  }

  if (isSlashCommand(text)) {
    const slash = parseSlashCommand(text);
    const intent = slash && (slash.kind === 'learning' || slash.kind === 'feedback' || slash.kind.startsWith('agent') || slash.kind.startsWith('legion'))
      ? (slash.kind === 'learning' ? 'learning_question'
        : slash.kind === 'feedback' || slash.kind === 'feedback_invalid' ? 'feedback'
          : 'agent_command')
      : 'conversation';
    const result = {
      id,
      intent,
      confidence: 1,
      control: null,
      work: null,
      schedule: null,
      constraints: null,
      slots: { slash },
      is_question: intent === 'learning_question',
      needs_operator: computeNeedsOperator(intent),
      failed: false,
      source: 'slash',
      model: null,
      latency_ms: Date.now() - started,
    };
    if (isShadowEnabled() || isAuthoritative()) logUnderstanding(text, result, isAuthoritative() ? 'auth' : 'shadow');
    return result;
  }

  let model;
  try {
    model = getUnderstandModel(ctx);
  } catch (e) {
    const fail = conversationFallback({ id, source: 'no_model', latency_ms: Date.now() - started });
    logUnderstanding(text, fail, 'fail');
    return fail;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callUnderstandLlm(text, ctx, model);
      const parsed = extractJsonObject(raw);
      const result = validateUnderstanding(parsed, {
        id,
        model,
        latency_ms: Date.now() - started,
        source: attempt === 0 ? 'llm' : 'llm_retry',
      });
      if (isShadowEnabled() || isAuthoritative()) {
        logUnderstanding(text, result, isAuthoritative() ? 'auth' : 'shadow');
      }
      return result;
    } catch (e) {
      lastErr = e;
    }
  }

  const fail = conversationFallback({
    id,
    model,
    latency_ms: Date.now() - started,
    source: 'llm_failed',
    parse_error: String(lastErr && lastErr.message || lastErr || 'unknown').slice(0, 160),
  });
  logUnderstanding(text, fail, 'fail');
  return fail;
}

/**
 * Shadow-only helper: run understand and compare to a regex-floor labeler.
 * Never used for dispatch.
 */
async function understandShadow(message, ctx = {}, floorLabeler) {
  const result = await understand(message, ctx);
  let floor = null;
  if (typeof floorLabeler === 'function') {
    try { floor = floorLabeler(message); } catch (_) { floor = { error: true }; }
  }
  return { understanding: result, floor, agree: floor && floor.intent === result.intent };
}

module.exports = {
  INTENTS,
  FEW_SHOT_IDS,
  MUTATING_INTENTS,
  getUnderstandModel,
  getUnderstandOllamaBaseUrl,
  isAuthoritative,
  isShadowEnabled,
  computeNeedsOperator,
  validateUnderstanding,
  buildUnderstandPrompt,
  understand,
  understandShadow,
  conversationFallback,
};
