const test = require('node:test');
const assert = require('node:assert/strict');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

test('getOllamaBaseUrl splits chat vs worker', async () => {
  await withEnv({
    OLLAMA_URL: 'http://192.168.0.190:11434',
    PIKO_CHAT_OLLAMA_URL: undefined,
    PIKO_WORKER_OLLAMA_URL: 'http://127.0.0.1:11434',
    OLLAMA_WORKER_URL: undefined,
  }, () => {
    delete require.cache[require.resolve('../lib/llm')];
    const { getOllamaBaseUrl } = require('../lib/llm');
    assert.equal(getOllamaBaseUrl({ priority: 'user', lane: 'chat' }), 'http://192.168.0.190:11434');
    assert.equal(getOllamaBaseUrl({ priority: 'background', lane: 'worker' }), 'http://127.0.0.1:11434');
    assert.equal(getOllamaBaseUrl({ worker: true }), 'http://127.0.0.1:11434');
  });
});

test('getOllamaBaseUrl falls back to chat when worker unset', async () => {
  await withEnv({
    OLLAMA_URL: 'http://192.168.0.190:11434/v1/chat/completions',
    PIKO_WORKER_OLLAMA_URL: undefined,
    OLLAMA_WORKER_URL: undefined,
    PIKO_CHAT_OLLAMA_URL: undefined,
  }, () => {
    delete require.cache[require.resolve('../lib/llm')];
    const { getOllamaBaseUrl } = require('../lib/llm');
    assert.equal(getOllamaBaseUrl({ lane: 'worker' }), 'http://192.168.0.190:11434');
  });
});
