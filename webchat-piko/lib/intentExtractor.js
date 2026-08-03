/**
 * Natural language intent extraction for Piko.
 * Converts phrases like "remind me to run low stock scan every morning at 9"
 * into structured JSON for createIntent().
 */
const { ollamaNativeChat } = require('./llm');

const INTENT_EXTRACTOR_PROMPT = `You are a strict JSON data extractor for scheduling requests.
Convert the user's message into valid JSON. Use 24-hour time.

CRITICAL RULES FOR "schedule":
- If the user says "every hour", "hourly", or a time range like "6am to 11pm" / "between 6am and 11pm", you MUST output "hourly HH:MM-HH:MM". NEVER use "daily" for hourly requests.
- Only use "daily HH:MM" when the user wants ONCE per day at a single time (e.g. "every morning at 9").
- "6am to 11pm" = "hourly 06:00-23:00". "between X and Y" = hourly window.
- For "weekdays at 5pm", "Mon-Fri at 17:00", "first of month", use "cron" format: "cron 0 17 * * 1-5" (min hour dom month dow). Weekdays=1-5, weekends=0,6. First of month="cron 0 9 1 * *".

Examples (follow exactly):
User: "every hour between 6am and 11pm for load recent data"
{"type":"legion_scheduled","schedule":"hourly 06:00-23:00","dueAt":null,"objective":"load recent data"}

User: "ensure Load Recent Data is run every hour between 6am to 11pm daily"
{"type":"legion_scheduled","schedule":"hourly 06:00-23:00","dueAt":null,"objective":"Load Recent Data"}

User: "remind me to run low stock scan every morning at 9"
{"type":"legion_scheduled","schedule":"daily 09:00","dueAt":null,"objective":"low stock scan"}

User: "run low stock scan weekdays at 5pm"
{"type":"legion_scheduled","schedule":"cron 0 17 * * 1-5","dueAt":null,"objective":"low stock scan"}

User: "schedule load recent data for the first of every month at 9am"
{"type":"legion_scheduled","schedule":"cron 0 9 1 * *","dueAt":null,"objective":"load recent data"}

User: "{USER_MESSAGE}"

Respond with ONLY valid JSON (e.g. {"type":"legion_scheduled","schedule":"hourly 06:00-23:00","dueAt":null,"objective":"Load Recent Data"}):
`;

/**
 * Extract intent from natural language. Returns { type, schedule, dueAt, objective } or null on failure.
 * @param {string} userMessage - Raw user message
 * @param {string} model - Ollama model tag (e.g. ollama/piko:finetune)
 * @returns {Promise<{ type: string, schedule?: string, dueAt?: string, objective: string } | null>}
 */
const {
  stripCodeFences,
} = require('./text');

async function extractIntentFromMessage(userMessage, model) {
  const prompt = INTENT_EXTRACTOR_PROMPT.replace('{USER_MESSAGE}', String(userMessage || '').slice(0, 500));
  try {
    const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      format: 'json',
      temperature: 0.1,
      max_tokens: 200,
    });
    if (process.env.PIKO_LOG_PLANNER === '1') console.log('[EXTRACTOR RAW]:', raw);
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);
    if (process.env.PIKO_LOG_PLANNER === '1') console.log('[EXTRACTOR PARSED]:', parsed);
    const type = String(parsed.type || 'task').toLowerCase();
    const objective = String(parsed.objective || '').trim();
    if (!objective) return null;
    const schedule = parsed.schedule ? String(parsed.schedule).trim() : null;
    const dueAt = parsed.dueAt ? String(parsed.dueAt).trim() : null;
    return { type, schedule, dueAt, objective };
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[intentExtractor] parse failed:', e.message);
    }
    return null;
  }
}

module.exports = { extractIntentFromMessage, INTENT_EXTRACTOR_PROMPT };
