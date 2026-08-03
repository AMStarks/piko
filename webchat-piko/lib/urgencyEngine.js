/**
 * Urgency Engine — evaluates business state every 30 mins during work hours.
 * Scores 0–10; if > 6, proactively notifies the user via Telegram.
 */
const AUSMAKER_BASE_URL = String(process.env.AUSMAKER_BASE_URL || process.env.PIKO_AUSMAKER_BASE_URL || 'http://127.0.0.1:5001').trim();

const URGENCY_SYSTEM_PROMPT = `You are Piko's internal subconscious. Review this live sales/inventory data. Score the urgency of this data from 0 to 10. (0 = normal operations, 10 = critical anomaly like a massive sales spike or stockout). If the score is > 6, draft a short proactive message to the user. Respond strictly in JSON: { "reasoning": "...", "urgency_score": 5, "message": null }`;

/**
 * Fetch sales and forecast data from AusMaker.
 */
const {
  stripTrailingSlash,
  stripCodeFences,
  extractJsonNumberField,
  extractJsonStringField,
} = require('./text');

async function gatherData() {
  const { getUrl } = require('./legionRunPoller');
  const base = stripTrailingSlash(AUSMAKER_BASE_URL);
  const salesUrl = `${base}/api/sales/summary?period=today`;
  const forecastUrl = `${base}/api/forecast/cached`;

  let sales = null;
  let forecast = null;

  try {
    const salesRes = await getUrl(salesUrl);
    if (salesRes.statusCode === 200) {
      sales = JSON.parse(salesRes.body || '{}');
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[URGENCY] Sales fetch failed:', e.message);
  }

  try {
    const forecastRes = await getUrl(forecastUrl);
    if (forecastRes.statusCode === 200) {
      forecast = JSON.parse(forecastRes.body || '{}');
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[URGENCY] Forecast fetch failed:', e.message);
  }

  return { sales, forecast };
}

/**
 * Run the internal monologue: gather data, score urgency, optionally notify.
 * @param {function(string): Promise<void>} sendCallback - e.g. (msg) => telegramNotify(msg)
 */
async function runInternalMonologue(sendCallback) {
  const { ollamaNativeChat } = require('./llm');
  const routerModel = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';

  const data = await gatherData();
  const dataStr = JSON.stringify(data, null, 2);

  const messages = [
    { role: 'system', content: URGENCY_SYSTEM_PROMPT },
    { role: 'user', content: `Live data:\n${dataStr}` },
  ];

  try {
    const raw = await ollamaNativeChat(routerModel, messages, {
      format: 'json',
      temperature: 0.2,
      max_tokens: 400,
    });

    if (!raw || typeof raw !== 'string') {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[URGENCY] No response from LLM');
      return;
    }

    const cleaned = stripCodeFences(raw);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // LLM sometimes returns truncated/malformed JSON (e.g. "Unterminated string"). Extract key fields.
      const score = extractJsonNumberField(cleaned, 'urgency_score');
      if (score != null) {
        const msgField = extractJsonStringField(cleaned, 'message');
        const reasonField = extractJsonStringField(cleaned, 'reasoning');
        parsed = {
          reasoning: (reasonField && reasonField.value != null ? String(reasonField.value) : '').slice(0, 200),
          urgency_score: score,
          message: msgField && msgField.isNull ? null
            : (msgField && msgField.value != null ? String(msgField.value).trim() || null : null),
        };
      } else {
        throw parseErr;
      }
    }
    const score = typeof parsed.urgency_score === 'number' ? parsed.urgency_score : 0;
    const message = parsed.message && String(parsed.message).trim() ? String(parsed.message).trim() : null;

    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log('[URGENCY ENGINE]', { reasoning: parsed.reasoning?.slice(0, 80), score, hasMessage: !!message });
    }

    if (score > 6 && message && typeof sendCallback === 'function') {
      await sendCallback(message);
    } else {
      console.log('[URGENCY ENGINE] Score too low. Staying silent.');
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[URGENCY] Monologue failed:', e.message);
  }
}

module.exports = { runInternalMonologue, gatherData };
