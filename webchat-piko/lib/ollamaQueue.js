/**
 * Phase 3.3: In-process Ollama queue — serialize inference so only one runs at a time.
 * User requests prioritized over background. Gate with PIKO_OLLAMA_QUEUE=1.
 */
// Use raw to avoid circular require when llm.js delegates to us
let rawOllamaNativeChat;
function getRaw() {
  if (!rawOllamaNativeChat) {
    const llm = require('./llm');
    rawOllamaNativeChat = llm.ollamaNativeChatRaw || llm.ollamaNativeChat;
  }
  return rawOllamaNativeChat;
}

const ENABLED = process.env.PIKO_OLLAMA_QUEUE === '1' || process.env.PIKO_OLLAMA_QUEUE === 'true';

const userQueue = [];
const backgroundQueue = [];
let processing = false;

async function processNext() {
  if (processing) return;
  const next = userQueue.shift() || backgroundQueue.shift();
  if (!next) return;
  processing = true;
  try {
    const result = await getRaw()(next.model, next.messages, next.options);
    next.resolve(result);
  } catch (e) {
    next.reject(e);
  } finally {
    processing = false;
    if (userQueue.length > 0 || backgroundQueue.length > 0) processNext();
  }
}

function enqueue(model, messages, options, priority) {
  let effectivePriority = priority || options.priority;
  if (!effectivePriority) {
    try {
      effectivePriority = require('./requestContext').getPriority();
    } catch (_) {
      effectivePriority = 'background';
    }
  }
  return new Promise((resolve, reject) => {
    const item = { model, messages, options, resolve, reject };
    if (effectivePriority === 'user') {
      userQueue.push(item);
    } else {
      backgroundQueue.push(item);
    }
    processNext();
  });
}

async function ollamaNativeChat(model, messages, options = {}) {
  if (!ENABLED) return getRaw()(model, messages, options);
  const priority = options.priority;
  return enqueue(model, messages, options, priority);
}

module.exports = { ollamaNativeChat, ENABLED };
