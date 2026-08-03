/**
 * LLM-based Legion capability inference when keyword matching fails.
 * Used when PIKO_LLM_CAPABILITY_INFERENCE=1 and no keyword match is found.
 */
const { ollamaNativeChat } = require('./llm');

const INFERENCE_PROMPT = `You are a capability classifier. Given a brief objective and a list of available Legion capabilities, pick the single best matching capability ID.

Available capabilities (use exactly these IDs):
{CAPABILITIES}

Brief objective: {OBJECTIVE}
Success criteria (if any): {SUCCESS_CRITERIA}

Respond with ONLY valid JSON: {"capability": "exact.capability.id"} or {"capability": ""} if none match.
If the objective clearly maps to one capability, return it. If ambiguous or no good match, return {"capability": ""}.
`;

/**
 * Infer Legion capability via LLM when keyword matching fails.
 * @param {object} fields - { objective, success_criteria }
 * @param {string[]} availableCapabilities - Capability IDs (e.g. ['inventory.low_stock.scan', 'sales.analysis.run'])
 * @param {string} model - Ollama model tag
 * @returns {Promise<string>} Capability ID or ''
 */
const {
  stripCodeFences,
} = require('./text');

async function inferLegionCapabilityViaLLM(fields, availableCapabilities, model) {
  const objective = String(fields && fields.objective || '').trim();
  const success = String(fields && fields.success_criteria || '').trim();
  if (!objective || !Array.isArray(availableCapabilities) || availableCapabilities.length === 0) {
    return '';
  }
  const capList = availableCapabilities.map((c) => `- ${c}`).join('\n');
  const prompt = INFERENCE_PROMPT
    .replace('{CAPABILITIES}', capList)
    .replace('{OBJECTIVE}', objective.slice(0, 500))
    .replace('{SUCCESS_CRITERIA}', success.slice(0, 300));

  try {
    const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      format: 'json',
      temperature: 0.1,
      max_tokens: 80,
    });
    if (!raw || typeof raw !== 'string') return '';
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);
    const cap = String(parsed && parsed.capability || '').trim();
    return availableCapabilities.includes(cap) ? cap : '';
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[legionCapabilityInference] LLM inference failed:', e.message);
    }
    return '';
  }
}

module.exports = {
  inferLegionCapabilityViaLLM,
  INFERENCE_PROMPT,
};
