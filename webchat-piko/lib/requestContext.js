/**
 * Phase 3.3: Request context for Ollama queue priority.
 * User requests get priority over background (intent-poller, piko-mind).
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithContext(ctx, fn) {
  return storage.run(ctx, fn);
}

function getContext() {
  return storage.getStore() || { priority: 'background' };
}

function getPriority() {
  return getContext().priority || 'background';
}

module.exports = { runWithContext, getContext, getPriority };
