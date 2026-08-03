/**
 * EI front-door intent — LLM classifies work vs Flag-policy vs chat.
 * No keyword / regex tripwires: the model understands the operator ask.
 */
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');

const {
  collapseWhitespace,
  normalizeApostrophes,
} = require('./text');

function normalize(text) {
  return collapseWhitespace(normalizeApostrophes(text));
}

function buildFrontDoorPrompt() {
  return `You classify Egyptian Insights chat turns for Piko.

Return JSON only:
{"lane":"work"|"flag_policy"|"chat"|"clarify","confidence":0.0-1.0,"reason":"short"}

lanes:
- work: operator wants Piko/agent to find, research, download, harvest, seek PDFs/texts/bibliography/sources, add a named book/volume, review corpus content, transcribe, etc. DOING research — not changing keep/drop rules.
- flag_policy: operator wants to change or inspect corpus Flag keep/drop/review *rules/policy* (always keep X, drop Y, prefer local assets, what are the flag rules).
- chat: conversation with no work and no policy change.
- clarify: genuinely ambiguous between work and flag_policy.

Examples:
- "research Petrie bibliography then find PDF copies of his works" → work
- "Please look for and add Christopher Dunn Lost Technologies of Ancient Egypt" → work
- "find all Flinders Petrie works as PDF" → work
- "harvest Abydos sources" → work
- "always keep Petrie in the flag rules" → flag_policy
- "what are the flag rules?" → flag_policy
- If both collect-sources verbs AND policy words appear, prefer work unless they clearly say flag rules / always keep / keep-drop policy.`;
}

/**
 * LLM front-door for EI. On LLM failure defaults to chat (no heuristic override).
 * @returns {Promise<{lane:string,confidence:number,reason:string,source:string}>}
 */
async function classifyEiFrontDoor(message, opts = {}) {
  const text = normalize(message);
  if (!text) {
    return { lane: 'chat', confidence: 1, reason: 'empty', source: 'empty' };
  }

  if (opts.llm === false) {
    return { lane: 'chat', confidence: 0.3, reason: 'llm_disabled', source: 'none' };
  }

  const model = opts.model
    || process.env.PIKO_EI_FRONT_DOOR_MODEL
    || process.env.PIKO_TRIAGE_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';

  try {
    const raw = await ollamaNativeChat(model, [
      { role: 'system', content: buildFrontDoorPrompt() },
      { role: 'user', content: text.slice(0, 600) },
    ], {
      format: 'json',
      temperature: 0,
      max_tokens: 80,
      num_ctx: 1024,
      timeoutMs: Math.max(1500, Number(process.env.PIKO_EI_FRONT_DOOR_TIMEOUT_MS || 8000)),
    });
    const parsed = extractJsonObject(raw) || {};
    let lane = String(parsed.lane || '').toLowerCase().trim();
    if (!['work', 'flag_policy', 'chat', 'clarify'].includes(lane)) lane = 'chat';
    return {
      lane,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
      reason: String(parsed.reason || lane).slice(0, 120),
      source: 'llm',
    };
  } catch (_) {
    return { lane: 'chat', confidence: 0.2, reason: 'llm_fail', source: 'none' };
  }
}

/** @deprecated No heuristic — always false. Kept so old callers do not throw. */
function looksLikeSourceWorkAsk() {
  return false;
}

/** @deprecated No heuristic — always false. Kept so old callers do not throw. */
function looksLikeFlagPolicyAsk() {
  return false;
}

module.exports = {
  classifyEiFrontDoor,
  looksLikeSourceWorkAsk,
  looksLikeFlagPolicyAsk,
  normalize,
};
