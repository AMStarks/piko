/**
 * WP7.6 — campaign control via chat requires operator.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

async function withLegateEnabled(fn) {
  const prev = process.env.PIKO_LEGATE_CHAT;
  process.env.PIKO_LEGATE_CHAT = '1';
  const legatePath = require.resolve('../lib/legateChat');
  const toolsPath = require.resolve('../lib/eiAgentTools');
  const prevLegate = require.cache[legatePath];
  const prevTools = require.cache[toolsPath];
  delete require.cache[legatePath];
  try {
    await fn({ legatePath, toolsPath });
  } finally {
    if (prev == null) delete process.env.PIKO_LEGATE_CHAT;
    else process.env.PIKO_LEGATE_CHAT = prev;
    if (prevTools) require.cache[toolsPath] = prevTools;
    else delete require.cache[toolsPath];
    if (prevLegate) require.cache[legatePath] = prevLegate;
    else delete require.cache[legatePath];
  }
}

test('WP7.6 isOperator:false refuses pause; campaign tool not called', async () => {
  await withLegateEnabled(async ({ toolsPath }) => {
    let toolCalls = 0;
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        runTool: async () => {
          toolCalls += 1;
          return { ok: true, artifact: 'should not run' };
        },
        TOOLS: {},
      },
    };
    delete require.cache[require.resolve('../lib/legateChat')];
    const legate = require('../lib/legateChat');
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async () => ({
      mode: 'control',
      control_action: 'pause',
      reply: 'Pausing.',
      lookups: [],
      source: 'llm',
    });
    try {
      const out = await legate.handleLegateChatTurn('pause the campaign', {
        rootDir: path.join(__dirname, '..'),
        isOperator: false,
      });
      assert.ok(out);
      assert.equal(out.mode, 'control_denied');
      assert.match(out.reply, /operator/i);
      assert.equal(toolCalls, 0);
    } finally {
      legate.decideLegateTurn = origDecide;
    }
  });
});

test('WP7.6 isOperator:true runs control action', async () => {
  await withLegateEnabled(async ({ toolsPath }) => {
    let toolCalls = 0;
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        runTool: async (name, args) => {
          toolCalls += 1;
          assert.equal(name, 'research_campaign');
          assert.equal(args.action, 'pause');
          return { ok: true, artifact: 'Campaign paused.' };
        },
        TOOLS: {},
      },
    };
    delete require.cache[require.resolve('../lib/legateChat')];
    const legate = require('../lib/legateChat');
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async () => ({
      mode: 'control',
      control_action: 'pause',
      reply: 'Pausing.',
      lookups: [],
      source: 'llm',
    });
    try {
      const out = await legate.handleLegateChatTurn('pause the campaign', {
        rootDir: path.join(__dirname, '..'),
        isOperator: true,
      });
      assert.ok(out);
      assert.equal(out.mode, 'control');
      assert.match(out.reply, /paused/i);
      assert.equal(toolCalls, 1);
    } finally {
      legate.decideLegateTurn = origDecide;
    }
  });
});

test('WP7.6 answer mode with isOperator:false is not control_denied', async () => {
  await withLegateEnabled(async () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    const legate = require('../lib/legateChat');
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async () => ({
      mode: 'answer',
      reply: 'Research is running.',
      lookups: [],
      source: 'llm',
    });
    try {
      const out = await legate.handleLegateChatTurn("how's research going?", {
        rootDir: path.join(__dirname, '..'),
        isOperator: false,
      });
      assert.ok(out);
      assert.notEqual(out.mode, 'control_denied');
    } finally {
      legate.decideLegateTurn = origDecide;
    }
  });
});
