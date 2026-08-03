/**
 * LASKO / Halo Charter moderation — regex fast-path + Ollama 8B (Charter-tuned).
 * Called by POST /moderate from Halo indexer on Optimus.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ollamaNativeChat } = require('./llm');
const { evaluatePatterns } = require('./laskoModerationPatterns');

const CHARTER_PATH = path.join(__dirname, '..', 'charter', 'lasko-charter.json');
const EXAMPLES_PATH = path.join(__dirname, '..', 'charter', 'moderation-examples.json');

const MODEL_ID = process.env.LASKO_MODERATION_MODEL
  || process.env.PIKO_CASUAL_MODEL
  || process.env.OLLAMA_MODEL
  || 'llama3.1:8b';

const VALID_ACTIONS = new Set(['allow', 'soft_block', 'hard_block']);
const VALID_CATEGORIES = new Set([
  'illegal', 'violence', 'self_harm', 'spam', 'malware', 'pii', 'hate', 'sexual',
]);

let cachedCharter = null;
let cachedExamples = null;

const {
  extractBalancedJsonObject,
} = require('./text');

function loadCharter() {
  if (cachedCharter) return cachedCharter;
  try {
    if (fs.existsSync(CHARTER_PATH)) {
      cachedCharter = JSON.parse(fs.readFileSync(CHARTER_PATH, 'utf8'));
      return cachedCharter;
    }
  } catch (_) {}
  cachedCharter = { version: 'unknown', categories: [] };
  return cachedCharter;
}

function loadExamples() {
  if (cachedExamples) return cachedExamples;
  try {
    if (fs.existsSync(EXAMPLES_PATH)) {
      cachedExamples = JSON.parse(fs.readFileSync(EXAMPLES_PATH, 'utf8'));
      return cachedExamples;
    }
  } catch (_) {}
  cachedExamples = [];
  return cachedExamples;
}

function contentHashHex(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function buildSystemPrompt(charter) {
  const cats = (charter.categories || [])
    .map((c) => `${c.key} (${c.severity}): ${c.title}`)
    .join('; ');
  const tenets = (charter.tenets || [])
    .filter((t) => t.aiEnforced === true || t.aiEnforced === 'partial')
    .map((t) => `§${t.section} ${t.title}: ${t.summary}`)
    .join('\n');

  const examples = loadExamples()
    .map((ex) => `POST: "${ex.content}" → ${JSON.stringify({ action: ex.action, categories: ex.categories, reason: ex.reason })}`)
    .join('\n');

  return [
    `You are LASKO's text-only Charter moderator (${charter.title || 'The Charter'} v${charter.version || '?'}).`,
    'Apply ONLY the written Charter. Text posts and comments only.',
    '',
    'BLOCK (hard_block): credible threats, violence incitement, terrorism glorification, self-harm/suicide encouragement, illegal content, violent hate against protected groups, slurs/pejoratives targeting race/ethnicity/nationality/religion/orientation/sex/disability.',
    'BLOCK (soft_block): spam/scams, suspicious promo links, doxxing/private contact info, explicit sexual content.',
    'ALLOW: normal opinions, disagreement, humour, news discussion, project updates, mild profanity without targeting.',
    'DO NOT BLOCK: identity claims, unverified facts, copyright disputes, subtle rudeness without slurs/threats.',
    '',
    'Categories: ' + cats,
    '',
    'Tenets:',
    tenets,
    '',
    'Examples:',
    examples,
    '',
    'Reply with ONLY JSON: {"action":"allow"|"soft_block"|"hard_block","categories":["..."],"reason":"one short sentence"}',
  ].join('\n');
}

function buildUserPrompt(text) {
  return `Review this LASKO post text:\n\n"""${text}"""`;
}

function normalizeDecision(parsed) {
  const action = String(parsed.action || '').toLowerCase();
  if (!VALID_ACTIONS.has(action)) return null;
  const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
    .map((c) => String(c).toLowerCase().trim())
    .filter((c) => VALID_CATEGORIES.has(c));
  return {
    action,
    categories: [...new Set(categories)],
    reason: parsed.reason ? String(parsed.reason).slice(0, 280) : null,
  };
}

function parseOllamaDecision(raw) {
  const trimmed = String(raw || '').trim();
  const jsonMatch = extractBalancedJsonObject(trimmed);
  if (!jsonMatch) return null;
  try {
    return normalizeDecision(JSON.parse(jsonMatch));
  } catch (_) {
    return null;
  }
}

async function evaluateWithOllama(text, charter) {
  const timeoutMs = Math.max(
    5000,
    Number(process.env.LASKO_MODERATION_TIMEOUT_MS || process.env.PIKO_OLLAMA_TIMEOUT_MS || 25000)
  );
  // Aligned to the chat-lane default (8192) — mismatched num_ctx forces a
  // full 8B reload per switch on Ollama 0.23.
  const numCtx = Math.max(1024, Number(process.env.LASKO_MODERATION_NUM_CTX || 8192));
  const maxTokens = Math.max(48, Number(process.env.LASKO_MODERATION_MAX_TOKENS || 96));

  const messages = [
    { role: 'system', content: buildSystemPrompt(charter) },
    { role: 'user', content: buildUserPrompt(text) },
  ];

  const raw = await ollamaNativeChat(MODEL_ID, messages, {
    max_tokens: maxTokens,
    temperature: 0,
    top_p: 0.9,
    timeoutMs,
    format: 'json',
    num_ctx: numCtx,
  });

  const parsed = parseOllamaDecision(raw);
  if (!parsed) {
    throw new Error('Ollama returned unparseable moderation JSON');
  }
  return parsed;
}

/**
 * Full moderation pipeline: regex fast-path, then Charter-tuned 8B.
 */
async function moderateContent(content, context = {}) {
  const startedAt = Date.now();
  const text = (content || '').trim();
  const hash = context.contentHash || contentHashHex(text);
  const charter = loadCharter();
  const charterVersion = charter.version || 'unknown';

  const regexResult = evaluatePatterns(text);
  if (regexResult.action !== 'allow') {
    return {
      action: regexResult.action,
      categories: [...new Set(regexResult.hits.map((h) => h.category))],
      reason: regexResult.hits.map((h) => `${h.category}:${h.rule}`).slice(0, 3).join('; '),
      hits: regexResult.hits,
      model: 'regex-v2',
      modelId: 'regex-v2',
      charterVersion,
      latencyMs: Date.now() - startedAt,
      contentHash: hash,
      phase: context.phase || 'moderate',
    };
  }

  const skipOllama = process.env.LASKO_MODERATION_SKIP_OLLAMA === '1'
    || process.env.LASKO_MODERATION_SKIP_OLLAMA === 'true';
  if (skipOllama) {
    return {
      action: 'allow',
      categories: [],
      reason: null,
      hits: [],
      model: 'regex-v2',
      modelId: 'regex-v2',
      charterVersion,
      latencyMs: Date.now() - startedAt,
      contentHash: hash,
      phase: context.phase || 'moderate',
    };
  }

  const ai = await evaluateWithOllama(text, charter);
  return {
    action: ai.action,
    categories: ai.categories,
    reason: ai.reason,
    hits: [],
    model: MODEL_ID,
    modelId: MODEL_ID,
    charterVersion,
    latencyMs: Date.now() - startedAt,
    contentHash: hash,
    phase: context.phase || 'moderate',
  };
}

function verifyModerationSecret(req) {
  const secret = String(process.env.MODERATION_SHARED_SECRET || '').trim();
  if (!secret) return { ok: false, error: 'MODERATION_SHARED_SECRET not configured' };
  const provided = String(req.headers['x-moderation-secret'] || '').trim();
  if (!provided) return { ok: false, error: 'Missing X-Moderation-Secret' };
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid secret' };
  }
  return { ok: true };
}

function isModerationEnabled() {
  const flag = process.env.PIKO_LASKO_MODERATION_ENABLED;
  if (flag === '0' || flag === 'false') return false;
  return !!String(process.env.MODERATION_SHARED_SECRET || '').trim();
}

module.exports = {
  moderateContent,
  verifyModerationSecret,
  isModerationEnabled,
  loadCharter,
  loadExamples,
  contentHashHex,
  MODEL_ID,
  buildSystemPrompt,
  evaluatePatterns,
};
