/**
 * WP3 routing acceptance table — regex may veto, never volunteer.
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

async function withMockDecide(llmReplyFactory, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-route-'));
  return withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_LEGATE_MODEL: 'qwen3.6:27b',
    PIKO_UNDERSTAND_MODEL: 'qwen3.6:27b',
  }, async () => {
    const llmPath = require.resolve('../lib/llm');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[llmPath];
    const llm = require('../lib/llm');
    const orig = llm.ollamaNativeChat;
    let calls = 0;
    llm.ollamaNativeChat = async (...args) => {
      calls += 1;
      return llmReplyFactory(calls, ...args);
    };
    delete require.cache[legatePath];
    try {
      const legate = require('../lib/legateChat');
      await fn(legate, { calls: () => calls, root: path.join(__dirname, '..') });
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
}

const STATUS_MESSAGES = [
  'campaign status',
  'campaign status please',
  "What's our campaign status?",
  "How's research going?",
  'Give me an update',
  'how are we doing on Giza?',
  'Status of the research campaign',
  'Give me an update on the campaign',
  'How is learning progressing?',
  'how is ingestion going?',
  'research campaign status',
  "what's the status of the campaign?",
];

const OPINION_MESSAGES = [
  'What do you make of the Osirion?',
  'do you think we should find more Petrie papers?',
  "what's your view on Hancock?",
  'Thoughts on Schoch?',
  'How do you read the Sphinx erosion debate?',
  'Do you buy the Younger Dryas impact theory?',
  "What's your take on Dunn's machining claims?",
];

const MUSING_MESSAGES = [
  'I might get into Petrie articles sometime',
  "I'd like to get a feel for the corpus",
  "I've been thinking about pyramid construction",
  'Maybe someday we dig into Mariette',
];

const WORK_MESSAGES = [
  'Please research Göbekli Tepe',
  "Can you look into West's theories?",
  "Find PDFs of Petrie's Giza survey",
  "Please find and add to Corpus Dunn's Lost Technologies",
  'Add Serpent in the Sky to the corpus',
];

const CONTROL_MESSAGES = [
  { msg: 'pause the campaign', action: 'pause' },
  { msg: 'run a cycle now', action: 'run_now' },
  { msg: 'start the research campaign', action: 'start' },
  { msg: 'resume the campaign', action: 'resume' },
  { msg: 'stop the campaign', action: 'stop' },
];

test('acceptance: status questions demote LLM dispatch → answer+campaign', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
    origLog(...args);
  };
  try {
    for (const msg of STATUS_MESSAGES) {
      logs.length = 0;
      await withMockDecide(
        () => JSON.stringify({
          mode: 'dispatch',
          reply: 'Putting ei-worker on that.',
          agent_id: 'ei-worker',
          lookups: [],
          reason: 'wrong',
        }),
        async ({ decideLegateTurn }, { root }) => {
          const out = await decideLegateTurn(msg, { rootDir: root });
          assert.equal(out.mode, 'answer', msg);
          assert.ok(out.lookups.includes('campaign'), msg);
          assert.equal(out.agent_id, null, msg);
          assert.equal(out.reason, 'campaign_status_floor', msg);
          assert.ok(logs.some((l) => /"event":"floor_override"/.test(l)), `floor_override for: ${msg}`);
        },
      );
    }
  } finally {
    console.log = origLog;
  }
});

test('acceptance: opinion questions demote LLM dispatch → answer (never dispatch)', async () => {
  for (const msg of OPINION_MESSAGES) {
    await withMockDecide(
      () => JSON.stringify({
        mode: 'dispatch',
        reply: 'On it.',
        agent_id: 'ei-worker',
        lookups: [],
        work_confirm: true,
        reason: 'wrong',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'answer', msg);
        assert.equal(out.agent_id, null, msg);
        assert.equal(out.reason, 'opinion_floor', msg);
      },
    );
  }
});

test('acceptance: musings demote LLM dispatch; regex never promotes answer→dispatch', async () => {
  for (const msg of MUSING_MESSAGES) {
    await withMockDecide(
      () => JSON.stringify({
        mode: 'dispatch',
        reply: 'On it.',
        agent_id: 'ei-worker',
        lookups: [],
        work_confirm: true,
        reason: 'wrong',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'answer', msg);
        assert.equal(out.agent_id, null, msg);
      },
    );
    // LLM says answer — stays answer (regex must not promote).
    await withMockDecide(
      () => JSON.stringify({
        mode: 'answer',
        reply: '',
        lookups: [],
        reason: 'musing',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'answer', msg);
        assert.equal(out.agent_id, null, msg);
      },
    );
  }
});

test('acceptance: work orders allow LLM dispatch through (regex does not block)', async () => {
  for (const msg of WORK_MESSAGES) {
    await withMockDecide(
      () => JSON.stringify({
        mode: 'dispatch',
        reply: 'Putting my researcher on that.',
        agent_id: 'ei-worker',
        lookups: [],
        work_confirm: true,
        reason: 'work',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'dispatch', msg);
        assert.equal(out.agent_id, 'ei-worker', msg);
        assert.doesNotMatch(out.reply, /\bei-worker\b/);
      },
    );
    // LLM says answer — stays answer (regex never promotes to dispatch).
    await withMockDecide(
      () => JSON.stringify({
        mode: 'answer',
        reply: 'Want me to go get that?',
        lookups: [],
        reason: 'clarify',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'answer', msg);
        assert.equal(out.agent_id, null, msg);
      },
    );
  }
});

test('acceptance: control messages use control path when LLM chooses control', async () => {
  for (const { msg, action } of CONTROL_MESSAGES) {
    await withMockDecide(
      () => JSON.stringify({
        mode: 'control',
        control_action: action,
        reply: `Updating (${action}).`,
        lookups: [],
        reason: 'control',
      }),
      async ({ decideLegateTurn }, { root }) => {
        const out = await decideLegateTurn(msg, { rootDir: root });
        assert.equal(out.mode, 'control', msg);
        assert.equal(out.control_action, action, msg);
        assert.equal(out.agent_id, null, msg);
      },
    );
  }
});

test('acceptance table size covers ≥30 messages', () => {
  const n = STATUS_MESSAGES.length
    + OPINION_MESSAGES.length
    + MUSING_MESSAGES.length
    + WORK_MESSAGES.length
    + CONTROL_MESSAGES.length;
  assert.ok(n >= 30, `expected ≥30 cases, got ${n}`);
});

test('invalid / empty decide JSON retries then honest fallback', async () => {
  await withMockDecide(
    () => '{}',
    async ({ decideLegateTurn, DECIDE_FAIL_REPLY }, { root, calls }) => {
      const out = await decideLegateTurn('Please research Göbekli Tepe', { rootDir: root });
      assert.equal(out.mode, 'answer');
      assert.equal(out.source, 'decide_fail');
      assert.equal(out.reply, DECIDE_FAIL_REPLY);
      assert.ok(calls() >= 2, 'should retry once');
    },
  );
});

test('malformed decide (missing mode) is failure not Got it', async () => {
  await withMockDecide(
    () => JSON.stringify({ reply: 'Got it.', lookups: [] }),
    async ({ decideLegateTurn, DECIDE_FAIL_REPLY }, { root }) => {
      const out = await decideLegateTurn('hello there', { rootDir: root });
      assert.equal(out.source, 'decide_fail');
      assert.equal(out.reply, DECIDE_FAIL_REPLY);
      assert.notEqual(out.reply, 'Got it.');
    },
  );
});

test('floors unavailable requires work_confirm for dispatch', () => {
  const {
    applyVetoFloors,
    __testSetFloorModule,
    DECIDE_FAIL_REPLY,
  } = require('../lib/legateChat');
  const realFloors = require('../lib/eiGoalParse');
  try {
    __testSetFloorModule(null, false);
    // Prevent reload from succeeding mid-call by pointing require cache at a thrower.
    const goalPath = require.resolve('../lib/eiGoalParse');
    const saved = require.cache[goalPath];
    require.cache[goalPath] = {
      id: goalPath,
      filename: goalPath,
      loaded: true,
      exports: new Proxy({}, { get() { throw new Error('floors down'); } }),
    };
    try {
      const parsed = { reply: 'On it.', lookups: [], work_confirm: false };
      const out = applyVetoFloors('Please research Göbekli Tepe', 'dispatch', parsed);
      assert.equal(out.mode, 'answer');
      assert.equal(out.floorsOk, false);
      assert.equal(out.reason, 'floors_unavailable_no_work_confirm');
      assert.equal(parsed.reply, DECIDE_FAIL_REPLY);

      const ok = applyVetoFloors('Please research Göbekli Tepe', 'dispatch', {
        reply: 'On it.',
        lookups: [],
        work_confirm: true,
      });
      assert.equal(ok.mode, 'dispatch');
      assert.equal(ok.floorsOk, false);
    } finally {
      if (saved) require.cache[goalPath] = saved;
      else delete require.cache[goalPath];
    }
  } finally {
    __testSetFloorModule(realFloors, true);
  }
});

test('applyVetoFloors demotes without promoting', () => {
  const { applyVetoFloors } = require('../lib/legateChat');
  const parsed = { reply: 'x', lookups: [] };
  const status = applyVetoFloors('campaign status', 'dispatch', { ...parsed });
  assert.equal(status.mode, 'answer');
  assert.equal(status.forcedStatusAnswer, true);

  const opinion = applyVetoFloors('do you think we should find more Petrie papers?', 'dispatch', { ...parsed, lookups: [] });
  assert.equal(opinion.mode, 'answer');
  assert.equal(opinion.forcedOpinionAnswer, true);

  // Answer stays answer — never promoted.
  const stay = applyVetoFloors("Please find Dunn's book", 'answer', { ...parsed });
  assert.equal(stay.mode, 'answer');
});

test('handleLegateChatTurn fallthrough omits campaign state injection flag', async () => {
  await withMockDecide(
    () => JSON.stringify({
      mode: 'answer',
      reply: '',
      lookups: [],
      reason: 'chat',
    }),
    async ({ handleLegateChatTurn }, { root }) => {
      const out = await handleLegateChatTurn('Tell me about the Osirion mythology', {
        rootDir: root,
        sessionKey: 's-ft',
      });
      assert.equal(out.fallthrough, true);
      assert.equal(out.inject_campaign_state, false);
      assert.equal(out.reply, null);
    },
  );
});

test('dispatch ack uses friendly agent name', async () => {
  await withMockDecide(
    () => JSON.stringify({
      mode: 'dispatch',
      reply: '',
      agent_id: 'ei-worker',
      work_confirm: true,
      reason: 'work',
    }),
    async ({ decideLegateTurn, formatDispatchAck, dispatchFromLegate }, { root }) => {
      const decision = await decideLegateTurn('Please research Göbekli Tepe', { rootDir: root });
      assert.equal(decision.mode, 'dispatch');
      assert.match(decision.reply, /my researcher/i);
      assert.doesNotMatch(decision.reply, /\bei-worker\b/);
      const queued = dispatchFromLegate(decision, {
        rootDir: root,
        sessionKey: 's-ack',
        message: 'Please research Göbekli Tepe',
      });
      const ack = formatDispatchAck(decision, queued);
      assert.doesNotMatch(ack, /\bei-worker\b/);
    },
  );
});
