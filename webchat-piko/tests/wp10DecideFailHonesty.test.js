/**
 * WP10 F1/F2/F3 — decide-fail honesty + single-comprehension turns.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetTenantBackgroundProfileCache } = require('../lib/tenantBackgroundJobs');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  resetTenantBackgroundProfileCache();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetTenantBackgroundProfileCache();
    });
}

function opinionUnderstanding() {
  return {
    id: 'test',
    intent: 'opinion_question',
    confidence: 0.95,
    failed: false,
    control: null,
    work: null,
    needs_operator: false,
  };
}

function statusUnderstanding() {
  return {
    id: 'test',
    intent: 'status_question',
    confidence: 0.98,
    failed: false,
    control: null,
    work: null,
    needs_operator: false,
  };
}

test('F2: decideFailResult logs [decide_fail] with reason', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f2-'));
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
    origLog(...args);
  };
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
  }, async () => {
    const llmPath = require.resolve('../lib/llm');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[llmPath];
    const llm = require('../lib/llm');
    const orig = llm.ollamaNativeChat;
    llm.ollamaNativeChat = async () => { throw new Error('boom'); };
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn, DECIDE_FAIL_REPLY } = require('../lib/legateChat');
      const out = await decideLegateTurn('Please find Petrie', { rootDir: path.join(__dirname, '..') });
      assert.equal(out.source, 'decide_fail');
      assert.equal(out.reply, DECIDE_FAIL_REPLY);
      assert.ok(lines.some((l) => l.includes('[decide_fail]') && l.includes('boom')));
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
  console.log = origLog;
});

test('F1: invalid decide JSON + opinion understanding recovers (no DECIDE_FAIL_REPLY)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f1-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
  }, async () => {
    const llmPath = require.resolve('../lib/llm');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[llmPath];
    const llm = require('../lib/llm');
    const orig = llm.ollamaNativeChat;
    llm.ollamaNativeChat = async () => '{}';
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn, DECIDE_FAIL_REPLY } = require('../lib/legateChat');
      const out = await decideLegateTurn(
        'Have you come to any conclusions on the Osireion?',
        { rootDir: path.join(__dirname, '..'), understanding: opinionUnderstanding() },
      );
      assert.equal(out.source, 'understand_recover');
      assert.notEqual(out.reply, DECIDE_FAIL_REPLY);
      assert.equal(out.mode, 'answer');
      assert.ok(String(out.reason).includes('opinion_question'));
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('F1: decide throw + status understanding recovers with campaign lookups', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f1s-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
  }, async () => {
    const llmPath = require.resolve('../lib/llm');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[llmPath];
    const llm = require('../lib/llm');
    const orig = llm.ollamaNativeChat;
    llm.ollamaNativeChat = async () => { throw new Error('timeout'); };
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn, DECIDE_FAIL_REPLY } = require('../lib/legateChat');
      const out = await decideLegateTurn(
        'How is the campaign travelling?',
        { rootDir: path.join(__dirname, '..'), understanding: statusUnderstanding() },
      );
      assert.equal(out.source, 'understand_recover');
      assert.notEqual(out.reply, DECIDE_FAIL_REPLY);
      assert.ok(out.lookups.includes('campaign'));
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('F1: mutating intent still surfaces DECIDE_FAIL_REPLY on decide fail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f1m-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
  }, async () => {
    const llmPath = require.resolve('../lib/llm');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[llmPath];
    const llm = require('../lib/llm');
    const orig = llm.ollamaNativeChat;
    llm.ollamaNativeChat = async () => '{}';
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn, DECIDE_FAIL_REPLY } = require('../lib/legateChat');
      const out = await decideLegateTurn('Please find Petrie', {
        rootDir: path.join(__dirname, '..'),
        understanding: {
          intent: 'work_order',
          failed: false,
          confidence: 0.99,
        },
      });
      assert.equal(out.source, 'decide_fail');
      assert.equal(out.reply, DECIDE_FAIL_REPLY);
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('F3: opinion understanding skips decide entirely', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f3-'));
  // WP11: expert-opinion lane is default-on for culture — disable to assert WP10 fallthrough.
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
    PIKO_EXPERT_OPINION: '0',
  }, async () => {
    const understandPath = require.resolve('../lib/understand');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[understandPath];
    delete require.cache[legatePath];
    const understand = require('../lib/understand');
    const origUnderstand = understand.understand;
    const origAuth = understand.isAuthoritative;
    understand.understand = async () => opinionUnderstanding();
    understand.isAuthoritative = () => true;
    delete require.cache[legatePath];
    const legate = require('../lib/legateChat');
    let decideCalls = 0;
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async (...args) => {
      decideCalls += 1;
      return origDecide(...args);
    };
    try {
      const out = await legate.handleLegateChatTurn(
        'Have you come to any conclusions on the Osireion?',
        { rootDir: path.join(__dirname, '..'), isOperator: true },
      );
      assert.equal(decideCalls, 0, 'decide must not run for opinion');
      assert.equal(out.fallthrough, true);
      assert.equal(out.reply, null);
      assert.equal(out.decision.source, 'understand_skip_decide');
    } finally {
      understand.understand = origUnderstand;
      understand.isAuthoritative = origAuth;
      legate.decideLegateTurn = origDecide;
      delete require.cache[legatePath];
      delete require.cache[understandPath];
    }
  });
});

test('F3: status understanding skips decide and answers via lookups', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f3s-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
  }, async () => {
    const understandPath = require.resolve('../lib/understand');
    const legatePath = require.resolve('../lib/legateChat');
    const llmPath = require.resolve('../lib/llm');
    delete require.cache[understandPath];
    delete require.cache[llmPath];
    delete require.cache[legatePath];
    const understand = require('../lib/understand');
    const llm = require('../lib/llm');
    const origUnderstand = understand.understand;
    const origAuth = understand.isAuthoritative;
    const origChat = llm.ollamaNativeChat;
    understand.understand = async () => statusUnderstanding();
    understand.isAuthoritative = () => true;
    // synthesizeLookupReply may call 8B — return a short grounded line
    llm.ollamaNativeChat = async () => 'Campaign is active with recent cycles.';
    delete require.cache[legatePath];
    const legate = require('../lib/legateChat');
    let decideCalls = 0;
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async (...args) => {
      decideCalls += 1;
      return origDecide(...args);
    };
    try {
      const out = await legate.handleLegateChatTurn(
        'How is the campaign travelling?',
        { rootDir: path.join(__dirname, '..'), isOperator: true },
      );
      assert.equal(decideCalls, 0);
      assert.equal(out.mode, 'answer');
      assert.ok(out.reply && out.reply.length > 0);
      assert.ok(out.decision.lookups.includes('campaign'));
      assert.equal(out.decision.source, 'understand_skip_decide');
    } finally {
      understand.understand = origUnderstand;
      understand.isAuthoritative = origAuth;
      llm.ollamaNativeChat = origChat;
      legate.decideLegateTurn = origDecide;
      delete require.cache[legatePath];
      delete require.cache[understandPath];
      delete require.cache[llmPath];
    }
  });
});

test('F3: work_order still calls decide', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp10-f3w-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
  }, async () => {
    const understandPath = require.resolve('../lib/understand');
    const legatePath = require.resolve('../lib/legateChat');
    const llmPath = require.resolve('../lib/llm');
    delete require.cache[understandPath];
    delete require.cache[llmPath];
    delete require.cache[legatePath];
    const understand = require('../lib/understand');
    const llm = require('../lib/llm');
    const origUnderstand = understand.understand;
    const origAuth = understand.isAuthoritative;
    const origChat = llm.ollamaNativeChat;
    understand.understand = async () => ({
      intent: 'work_order',
      failed: false,
      confidence: 0.99,
      control: null,
      work: { verb: 'find', title: 'Giza survey' },
    });
    understand.isAuthoritative = () => true;
    llm.ollamaNativeChat = async () => JSON.stringify({
      mode: 'dispatch',
      reply: 'Putting my researcher on that.',
      agent_id: 'ei-worker',
      work_confirm: true,
      lookups: [],
      reason: 'work',
    });
    delete require.cache[legatePath];
    const legate = require('../lib/legateChat');
    let decideCalls = 0;
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async (...args) => {
      decideCalls += 1;
      return origDecide(...args);
    };
    try {
      const out = await legate.handleLegateChatTurn(
        "Please find Petrie's Giza survey report",
        { rootDir: path.join(__dirname, '..'), isOperator: true, sessionKey: 's-wp10' },
      );
      assert.equal(decideCalls, 1);
      assert.equal(out.mode, 'dispatch');
      assert.ok(out.reply);
    } finally {
      understand.understand = origUnderstand;
      understand.isAuthoritative = origAuth;
      llm.ollamaNativeChat = origChat;
      legate.decideLegateTurn = origDecide;
      delete require.cache[legatePath];
      delete require.cache[understandPath];
      delete require.cache[llmPath];
    }
  });
});

test('F5: DECIDE_FAIL_REPLY is neutral (no work-order invite)', () => {
  delete require.cache[require.resolve('../lib/legateChat')];
  const { DECIDE_FAIL_REPLY } = require('../lib/legateChat');
  assert.ok(!DECIDE_FAIL_REPLY.toLowerCase().includes('work order'));
  assert.ok(DECIDE_FAIL_REPLY.includes('say it another way') || DECIDE_FAIL_REPLY.includes("didn't quite catch"));
});
