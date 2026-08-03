const test = require('node:test');
const assert = require('node:assert/strict');

// WP9 regression: the session chat model (8B) must never reach decideLegateTurn.
// If it does, decide downgrades from the Legate 27B and, with split-lane routing,
// loads the 8B onto the 27B Ollama instance — evicting the resident model.
test('handleLegateChatTurn does not forward session chat model to decide', async () => {
  process.env.PIKO_LEGATE_CHAT = '1';
  const legate = require('../lib/legateChat');
  const original = legate.decideLegateTurn;
  let captured = null;
  legate.decideLegateTurn = async (message, opts) => {
    captured = opts;
    return {
      mode: 'answer',
      reply: 'ok',
      agent_id: null,
      brief: null,
      control_action: null,
      lookups: [],
      reason: 'test',
      source: 'test',
    };
  };
  try {
    const out = await legate.handleLegateChatTurn('hello there', {
      rootDir: __dirname,
      model: 'llama3.1:8b',
      isOperator: true,
    });
    assert.equal(out.reply, 'ok');
    assert.ok(captured, 'decideLegateTurn was called');
    assert.equal(captured.model, undefined, 'session chat model must not be forwarded');
    assert.equal(captured.isOperator, true, 'other opts still forwarded');
  } finally {
    legate.decideLegateTurn = original;
    delete process.env.PIKO_LEGATE_CHAT;
  }
});
