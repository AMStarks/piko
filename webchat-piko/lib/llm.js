/**
 * LiteLLM-backed LLM helper. Primary model (Ollama) with fallback to Claude/OpenAI.
 * Usage: const text = await ai(prompt); or await ai(prompt, { temperature: 0.3, max_tokens: 500 });
 */
const { completion } = require('litellm');

const _primary = process.env.MODEL_PRIMARY || process.env.OLLAMA_MODEL || 'ollama/llama3.1:latest';
const MODEL_PRIMARY = (_primary && !_primary.includes('/')) ? 'ollama/' + _primary : _primary;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions';

function normalizeOllamaBase(urlLike) {
  const raw = String(urlLike || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return '';
  }
}

/**
 * Chat/Legate vs worker inference split.
 * - user/chat: OLLAMA_URL (or PIKO_CHAT_OLLAMA_URL)
 * - worker/background: PIKO_WORKER_OLLAMA_URL when set, else same as chat
 */
function getOllamaBaseUrl(options = {}) {
  const explicit = normalizeOllamaBase(options.ollamaBaseUrl || options.baseUrl || '');
  if (explicit) return explicit;

  const lane = String(options.lane || '').toLowerCase();
  let priority = options.priority;
  if (!priority) {
    try {
      priority = require('./requestContext').getPriority();
    } catch (_) {
      priority = 'user';
    }
  }
  const useWorker = lane === 'worker'
    || lane === 'background'
    || priority === 'background'
    || options.worker === true;

  if (useWorker) {
    const worker = normalizeOllamaBase(
      process.env.PIKO_WORKER_OLLAMA_URL
      || process.env.OLLAMA_WORKER_URL
      || '',
    );
    if (worker) return worker;
  }

  const chat = normalizeOllamaBase(
    process.env.PIKO_CHAT_OLLAMA_URL
    || process.env.OLLAMA_URL
    || OLLAMA_URL,
  );
  return chat || 'http://localhost:11434';
}

function stripOllamaPrefix(model) {
  return String(model || '').startsWith('ollama/') ? String(model).slice('ollama/'.length) : String(model || '');
}

async function ollamaNativeChatRaw(model, messages, options = {}) {
  const baseUrl = getOllamaBaseUrl(options);
  const timeoutMs = Math.max(
    500,
    Number(options.timeoutMs ?? options.timeout_ms ?? process.env.PIKO_OLLAMA_TIMEOUT_MS ?? 45000)
  );
  const keepAlive = String(process.env.PIKO_OLLAMA_KEEP_ALIVE ?? '-1').trim();
  // Always send num_ctx: a request without one makes Ollama load the model at
  // the server default (32k on 0.23) — a 47GB footprint that evicts everything.
  // Keep this default aligned across call sites; every num_ctx CHANGE is a
  // full model reload (~15s) on Ollama 0.23, even shrinking.
  const defaultNumCtx = options.num_ctx ?? process.env.PIKO_OLLAMA_NUM_CTX ?? process.env.OLLAMA_NUM_CTX ?? 8192;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const payload = {
      model: stripOllamaPrefix(model),
      messages: Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages || '') }],
      stream: false,
      options: {
        temperature: options.temperature,
        top_p: options.top_p,
        repeat_penalty: options.repeat_penalty,
        num_predict: options.max_tokens,
      },
    };
    if (keepAlive) payload.keep_alive = (keepAlive === '-1' || keepAlive === '-1s') ? -1 : keepAlive;
    if (options.format != null) payload.format = options.format;
    // Hybrid-reasoning models (qwen3*) emit a thinking block that breaks JSON
    // format mode and doubles latency; keep it off unless explicitly requested.
    if (options.think != null) payload.think = options.think;
    else if (String(payload.model || '').toLowerCase().startsWith('qwen3')) payload.think = false;
    if (defaultNumCtx != null && defaultNumCtx !== '') payload.options.num_ctx = Number(defaultNumCtx);
    if (options.presence_penalty != null) payload.options.presence_penalty = options.presence_penalty;
    if (options.frequency_penalty != null) payload.options.frequency_penalty = options.frequency_penalty;
    // WP7.1: forward seed for starvation-recovery reflection variation.
    if (options.seed != null && Number.isFinite(Number(options.seed))) {
      payload.options.seed = Number(options.seed);
    }
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Ollama native error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(text);
    try {
      const { recordLlmUsage } = require('./llmUsage');
      recordLlmUsage({
        model: payload.model,
        prompt_tokens: json.prompt_eval_count || 0,
        completion_tokens: json.eval_count || 0,
        lane: options.lane || '',
        tag: options.tag || '',
        duration_ms: Date.now() - startedAt,
      });
    } catch (_) { /* never block replies on metering */ }
    const content = (json && json.message && json.message.content) || '';
    return typeof content === 'string' ? content : '';
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaNativeChat(model, messages, options = {}) {
  const useQueue = process.env.PIKO_OLLAMA_QUEUE === '1' || process.env.PIKO_OLLAMA_QUEUE === 'true';
  if (useQueue) {
    const { ollamaNativeChat: queuedChat } = require('./ollamaQueue');
    return queuedChat(model, messages, options);
  }
  return ollamaNativeChatRaw(model, messages, options);
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
  if (options.format != null) params.format = options.format;
  if (options.num_ctx != null) params.num_ctx = options.num_ctx;
  if (model.startsWith('ollama/')) {
    params.baseUrl = getOllamaBaseUrl(options);
    // Satisfy any internal check for apiKey (e.g. if request is ever routed via OpenAI-compatible path).
    if (params.apiKey == null) params.apiKey = process.env.OPENAI_API_KEY || 'ollama';
  }

  const ollamaOnly = process.env.PIKO_OLLAMA_ONLY === '1' || process.env.PIKO_OLLAMA_ONLY === 'true';
  const ollamaNativePreferred = process.env.PIKO_OLLAMA_NATIVE !== '0';
  const toTry = ollamaOnly ? [model] : [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  let lastError;
  for (const m of toTry) {
    const p = { ...params, model: m };
    if (m.startsWith('ollama/')) p.baseUrl = getOllamaBaseUrl(options);
    if (m.startsWith('ollama/') && ollamaNativePreferred) {
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
          return await ollamaNativeChatRaw(m, messages, p);
        } catch (e) {
          lastError = e;
          if (process.env.LITELLM_LOG) console.error('[llm-native-ollama]', m, attempt, e.message);
        }
      }
      continue;
    }
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
  if (options.num_ctx != null) params.num_ctx = options.num_ctx;
  if (normalized.startsWith('ollama/')) {
    params.baseUrl = getOllamaBaseUrl(options);
    if (params.apiKey == null) params.apiKey = process.env.OPENAI_API_KEY || 'ollama';
    const keepAlive = String(process.env.PIKO_OLLAMA_KEEP_ALIVE ?? '-1').trim();
    if (keepAlive) params.keep_alive = (keepAlive === '-1' || keepAlive === '-1s') ? -1 : keepAlive;
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

module.exports = {
  ai,
  aiStream,
  ollamaNativeChat,
  ollamaNativeChatRaw,
  getOllamaBaseUrl,
  MODEL_PRIMARY,
  FALLBACK_MODELS,
};
