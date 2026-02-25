/**
 * LiteLLM-backed LLM helper. Primary model (Ollama) with fallback to Claude/OpenAI.
 * Usage: const text = await ai(prompt); or await ai(prompt, { temperature: 0.3, max_tokens: 500 });
 */
const { completion } = require('litellm');

const _primary = process.env.MODEL_PRIMARY || process.env.OLLAMA_MODEL || 'ollama/llama3.1:latest';
const MODEL_PRIMARY = (_primary && !_primary.includes('/')) ? 'ollama/' + _primary : _primary;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';

function getOllamaBaseUrl() {
  try {
    const u = new URL(OLLAMA_URL);
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return 'http://localhost:11434';
  }
}

const FALLBACK_MODELS = [
  process.env.MODEL_FALLBACK_1 || 'anthropic/claude-3-5-sonnet-20241022',
  process.env.MODEL_FALLBACK_2 || 'openai/gpt-4o-mini',
].filter(Boolean);

/**
 * Non-stream completion. Tries primary (Ollama), then fallbacks. Returns assistant text.
 */
async function ai(prompt, options = {}) {
  const messages = typeof prompt === 'string'
    ? [{ role: 'user', content: prompt }]
    : Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }];
  const model = options.model || MODEL_PRIMARY;
  const temperature = options.temperature ?? 0.9;
  const max_tokens = options.max_tokens ?? 1000;

  const params = {
    model,
    messages,
    temperature,
    max_tokens,
    top_p: options.top_p ?? 0.92,
    repeat_penalty: options.repeat_penalty ?? 1.12,
  };
  if (options.min_p != null) params.min_p = options.min_p;
  else if (model.startsWith('ollama/')) params.min_p = 0.06;
  if (options.presence_penalty != null) params.presence_penalty = options.presence_penalty;
  if (options.frequency_penalty != null) params.frequency_penalty = options.frequency_penalty;
  if (model.startsWith('ollama/')) {
    params.baseUrl = getOllamaBaseUrl();
    // Satisfy any internal check for apiKey (e.g. if request is ever routed via OpenAI-compatible path).
    if (params.apiKey == null) params.apiKey = process.env.OPENAI_API_KEY || 'ollama';
  }

  const ollamaOnly = process.env.PIKO_OLLAMA_ONLY === '1' || process.env.PIKO_OLLAMA_ONLY === 'true';
  const toTry = ollamaOnly ? [model] : [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  let lastError;
  for (const m of toTry) {
    const p = { ...params, model: m };
    if (m.startsWith('ollama/')) p.baseUrl = getOllamaBaseUrl();
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
        const response = await completion(p);
        const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
        return typeof content === 'string' ? content : '';
      } catch (e) {
        lastError = e;
        if (process.env.LITELLM_LOG) console.error('[llm]', m, attempt, e.message);
      }
    }
  }
  throw lastError || new Error('No model responded');
}

/**
 * Stream completion. Calls onChunk(delta) for each piece; returns full reply.
 * options: { max_tokens, temperature, repeat_penalty, presence_penalty, frequency_penalty }.
 */
async function aiStream(messages, onChunk, model, options = {}) {
  const m = model || MODEL_PRIMARY;
  const normalized = (m && m.startsWith('ollama/')) ? m : `ollama/${m || 'llama3.1:latest'}`;
  const params = {
    model: normalized,
    messages: Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }],
    stream: true,
    temperature: options.temperature ?? 0.9,
    top_p: options.top_p ?? 0.92,
    repeat_penalty: options.repeat_penalty ?? 1.12,
    min_p: 0.06,
    max_tokens: options.max_tokens ?? 1000,
  };
  if (options.presence_penalty != null) params.presence_penalty = options.presence_penalty;
  if (options.frequency_penalty != null) params.frequency_penalty = options.frequency_penalty;
  if (normalized.startsWith('ollama/')) {
    params.baseUrl = getOllamaBaseUrl();
    if (params.apiKey == null) params.apiKey = process.env.OPENAI_API_KEY || 'ollama';
  }

  const stream = await completion(params);
  let full = '';
  for await (const part of stream) {
    const delta = (part && part.choices && part.choices[0] && part.choices[0].delta && part.choices[0].delta.content) || '';
    if (delta) {
      full += delta;
      if (onChunk) onChunk(delta);
    }
  }
  return full;
}

module.exports = { ai, aiStream, MODEL_PRIMARY, FALLBACK_MODELS };
