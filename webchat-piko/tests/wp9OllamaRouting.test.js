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

test('getUnderstandOllamaBaseUrl uses PIKO_UNDERSTAND_OLLAMA_URL when set', async () => {
  await withEnv({
    PIKO_UNDERSTAND_OLLAMA_URL: 'http://192.168.0.190:11435',
  }, () => {
    delete require.cache[require.resolve('../lib/understand')];
    const { getUnderstandOllamaBaseUrl } = require('../lib/understand');
    assert.equal(getUnderstandOllamaBaseUrl(), 'http://192.168.0.190:11435');
  });
});

test('getUnderstandOllamaBaseUrl falls back to undefined (chat lane)', async () => {
  await withEnv({
    PIKO_UNDERSTAND_OLLAMA_URL: undefined,
  }, () => {
    delete require.cache[require.resolve('../lib/understand')];
    const { getUnderstandOllamaBaseUrl } = require('../lib/understand');
    assert.equal(getUnderstandOllamaBaseUrl(), undefined);
  });
});

test('getLegateOllamaBaseUrl uses PIKO_LEGATE_OLLAMA_URL when set', async () => {
  await withEnv({
    PIKO_LEGATE_OLLAMA_URL: 'http://192.168.0.190:11435',
  }, () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    const { getLegateOllamaBaseUrl } = require('../lib/legateChat');
    assert.equal(getLegateOllamaBaseUrl(), 'http://192.168.0.190:11435');
  });
});

test('getLegateOllamaBaseUrl falls back to undefined (chat lane)', async () => {
  await withEnv({
    PIKO_LEGATE_OLLAMA_URL: undefined,
  }, () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    const { getLegateOllamaBaseUrl } = require('../lib/legateChat');
    assert.equal(getLegateOllamaBaseUrl(), undefined);
  });
});

test('getOllamaBaseUrl honours explicit ollamaBaseUrl over chat lane', async () => {
  await withEnv({
    OLLAMA_URL: 'http://192.168.0.190:11434',
    PIKO_CHAT_OLLAMA_URL: undefined,
    PIKO_WORKER_OLLAMA_URL: 'http://127.0.0.1:11434',
  }, () => {
    delete require.cache[require.resolve('../lib/llm')];
    const { getOllamaBaseUrl } = require('../lib/llm');
    assert.equal(
      getOllamaBaseUrl({ ollamaBaseUrl: 'http://192.168.0.190:11435' }),
      'http://192.168.0.190:11435',
    );
    assert.equal(getOllamaBaseUrl({ priority: 'user' }), 'http://192.168.0.190:11434');
  });
});
