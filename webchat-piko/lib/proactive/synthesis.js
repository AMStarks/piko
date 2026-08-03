/**
 * Synthesis layer — rewrites proactive alerts into brotherly, dry tone.
 * Used for businessHealth candidates.
 */
const { ollamaNativeChat } = require('../llm');

const SYNTHESIS_MODEL = process.env.PIKO_SYNTHESIS_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:latest';

const SYNTHESIS_PROMPT = `You are Piko. Rewrite this business alert into a single short message.
- Use your dry, brotherly, anti-corporate tone.
- No alarm bells or corporate jargon.
- If it makes sense to offer help, end with: "Reply 'Yes' to draft the PO." or "Say 'do it' and I'll run it."
- Keep it under 2 sentences.
- Output ONLY the message, no quotes or preamble.

Alert: {SUMMARY}
Type: {TYPE}
Detail: {DETAIL}
`;

/**
 * Synthesize anomaly into brotherly message. Returns null on failure (use template fallback).
 * @param {object} anomaly - { type, summary, severity, detail }
 * @returns {Promise<string|null>}
 */
const {
  includesAny,
} = require('../text');

async function synthesizeMessage(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') return null;
  const summary = String(anomaly.summary || anomaly.detail || 'Anomaly detected').slice(0, 200);
  const type = String(anomaly.type || 'unknown').slice(0, 50);
  const detail = String(anomaly.detail || '').slice(0, 150);

  const prompt = SYNTHESIS_PROMPT
    .replace('{SUMMARY}', summary)
    .replace('{TYPE}', type)
    .replace('{DETAIL}', detail);

  try {
    const reply = await ollamaNativeChat(SYNTHESIS_MODEL, [{ role: 'user', content: prompt }], {
      temperature: 0.4,
      max_tokens: 120,
    });
    const out = String(reply || '').trim();
    return out.length > 0 ? out.slice(0, 300) : null;
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[synthesis]', e.message);
    }
    return null;
  }
}

/** Infer suggested Legion capability from anomaly type. */
function inferSuggestedAction(anomalyType) {
  const t = String(anomalyType || '').toLowerCase();
  if (includesAny(t, ['reorder', 'revenue', 'demand', 'spike', 'stagnant'])) return 'purchase_order.draft.create';
  if (includesAny(t, ['po_pending', 'po ready'])) return 'purchase_order.draft.create';
  return null;
}

module.exports = {
  synthesizeMessage,
  inferSuggestedAction,
};
