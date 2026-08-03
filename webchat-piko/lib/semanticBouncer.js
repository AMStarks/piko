/**
 * Semantic Bouncer — LLM-first intent classification for state machine interruptions.
 * Uses context-switching logic: is the user answering the wizard, or switching to a new command?
 */
const { ollamaNativeChat } = require('./llm');
const { isWhitespace } = require('./text');

const BOUNCER_MODEL = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';

/** Strip ``` / ```json fences without regex (same coverage as prior replace). */
function stripCodeFences(s) {
  const t = String(s || '');
  let out = '';
  let i = 0;
  while (i < t.length) {
    if (i + 7 <= t.length && t.slice(i, i + 7).toLowerCase() === '```json') {
      i += 7;
      while (i < t.length && isWhitespace(t[i])) i += 1;
      continue;
    }
    if (t.startsWith('```', i)) {
      while (out.length && isWhitespace(out[out.length - 1])) out = out.slice(0, -1);
      i += 3;
      continue;
    }
    out += t[i];
    i += 1;
  }
  return out.trim();
}

/**
 * Classify user intent when they're in a wizard/form state (e.g. Legion Brief).
 * @param {string} message - User's message
 * @param {string} currentWizardQuestion - The exact question the wizard is waiting for (e.g. "What are the success criteria?")
 * @param {string} [model] - Optional model override
 * @returns {Promise<'escape'|'form_input'|'intent_override'>}
 */
async function classifyUserIntent(message, currentWizardQuestion, model) {
  const m = model || BOUNCER_MODEL;
  const prompt = `You are the Semantic Router. A Legion Brief Wizard is currently ACTIVE, and waiting for the user to answer this specific field: "${currentWizardQuestion || 'Unknown'}".

Analyze the user's message and classify it into ONE of these categories:

1. "form_input": The user is attempting to answer the active wizard question. This could be a short yes/no, or a long multi-paragraph explanation. As long as the semantic intent is to answer the question, classify it as form_input.
2. "intent_override": The user is completely ignoring the wizard question and giving a new command, asking a new question, or changing the subject (e.g. "Cancel this", "Deploy the quant agent", "What is our inventory?", "Run a forecast").
3. "escape": The user explicitly says to cancel, stop, abort, or quit the wizard.

User Message: "${String(message || '').slice(0, 600)}"

Respond STRICTLY with a valid JSON object: {"intent": "form_input"|"intent_override"|"escape"}`;

  try {
    const response = await ollamaNativeChat(m, [{ role: 'user', content: prompt }], {
      format: 'json',
      max_tokens: 50,
      temperature: 0.1,
    });
    if (!response || typeof response !== 'string') return 'form_input';
    const cleanJson = stripCodeFences(response || '');
    const parsed = JSON.parse(cleanJson);
    const intent = String(parsed?.intent || 'form_input').toLowerCase();
    if (['escape', 'form_input', 'intent_override'].includes(intent)) return intent;
    return 'form_input';
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[SEMANTIC ROUTER] Failed to parse intent, defaulting to form_input:', e.message);
    return 'form_input';
  }
}

module.exports = { classifyUserIntent };
