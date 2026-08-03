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

test('isLegateChatEnabled: culture default on, explicit off', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: undefined,
  }, () => {
    const { isLegateChatEnabled } = require('../lib/legateChat');
    assert.equal(isLegateChatEnabled(path.join(__dirname, '..')), true);
  });
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '0',
  }, () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    const { isLegateChatEnabled } = require('../lib/legateChat');
    assert.equal(isLegateChatEnabled(path.join(__dirname, '..')), false);
  });
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-01',
    PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker',
    PIKO_LEGATE_CHAT: undefined,
  }, () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    const { isLegateChatEnabled } = require('../lib/legateChat');
    assert.equal(isLegateChatEnabled(path.join(__dirname, '..')), false);
  });
});

test('dispatchFromLegate enqueues chat_origin agent_run', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-q-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    delete require.cache[require.resolve('../lib/agentJobs')];
    const { dispatchFromLegate, formatDispatchAck, dispatchWorkOrder, historyForDecide } = require('../lib/legateChat');
    const operator = "Please find and add to Corpus Christopher Dunn's Lost Technologies of Ancient Egypt";
    assert.equal(
      dispatchWorkOrder(operator, { brief: 'Find PDFs, articles, and books by Christopher Dunn…' }),
      operator,
    );
    assert.deepEqual(
      historyForDecide([
        { role: 'assistant', content: 'Progress — ei-worker · … · starting' },
        { role: 'user', content: 'real ask' },
        { role: 'assistant', content: 'Legate review — accept' },
      ]).map((m) => m.content),
      ['real ask'],
    );
    const queued = dispatchFromLegate({
      mode: 'dispatch',
      agent_id: 'ei-worker',
      brief: 'Find PDFs, articles, and books by Christopher Dunn on Lost Technologies',
      reply: 'Putting a worker on that.',
      reason: 'corpus_ingest',
    }, { sessionKey: 's-test', rootDir: path.join(__dirname, '..'), message: operator });
    assert.equal(queued.ok, true);
    assert.equal(queued.job.payload.chat_origin, true);
    assert.equal(queued.job.payload.session_id, 's-test');
    assert.equal(queued.job.payload.agent_id, 'ei-worker');
    assert.equal(queued.job.payload.brief, operator);
    assert.equal(queued.job.payload.operator_message, operator);
    const ack = formatDispatchAck({ reply: 'Putting a worker on that.' }, queued);
    assert.doesNotMatch(ack, /^Job: job_/m, 'no bare job id line in operator chat');
    assert.match(ack, /\/agent stop job_/, 'cancel hint stays functional');
    assert.match(ack, /updates here/i);
  });
});

test('handleLegateChatTurn answer path runs lookups without dispatch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-ans-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_LEGATE_SYNTHESIS: '0',
  }, async () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    delete require.cache[require.resolve('../lib/legateTools')];
    delete require.cache[require.resolve('../lib/llm')];
    const legateChat = require('../lib/legateChat');
    const orig = legateChat.decideLegateTurn;
    legateChat.decideLegateTurn = async () => ({
      mode: 'answer',
      reply: 'Checking the corpus.',
      lookups: ['jobs'],
      agent_id: null,
      brief: null,
      reason: 'test',
      source: 'stub',
    });
    try {
      const out = await legateChat.handleLegateChatTurn('who is working?', {
        rootDir: path.join(__dirname, '..'),
        sessionKey: 's-lookup',
      });
      assert.equal(out.mode, 'answer');
      assert.match(out.reply, /Agents:/);
      assert.doesNotMatch(out.reply, /Job: job_/);
    } finally {
      legateChat.decideLegateTurn = orig;
    }
  });
});

test('agentsForLegateDecide restricts to planner-backed agents', () => {
  const { agentsForLegateDecide, resolveDispatchAgentId, LEGATE_DISPATCH_AGENTS } = require('../lib/legateChat');
  const filtered = agentsForLegateDecide([
    { id: 'ei-worker' },
    { id: 'ei-harvester' },
    { id: 'ei-scribe' },
    { id: 'ei-qa' },
    { id: 'ei-corpus' },
  ]);
  assert.deepEqual(filtered.map((a) => a.id).sort(), ['ei-qa', 'ei-worker']);
  assert.equal(LEGATE_DISPATCH_AGENTS.has('ei-harvester'), false);
  assert.equal(resolveDispatchAgentId('ei-harvester', filtered), 'ei-worker');
});

test('decideLegateTurn floors campaign-status questions to answer+campaign lookup', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-floor-'));
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
    // Model wrongly says dispatch — floor must override to answer + campaign.
    llm.ollamaNativeChat = async () => JSON.stringify({
      mode: 'dispatch',
      reply: 'Putting a worker on that.',
      agent_id: 'ei-worker',
      lookups: [],
      reason: 'model_error',
    });
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn } = require('../lib/legateChat');
      const out = await decideLegateTurn('campaign status', {
        rootDir: path.join(__dirname, '..'),
      });
      assert.equal(out.mode, 'answer');
      assert.ok(out.lookups.includes('campaign'));
      assert.equal(out.reason, 'campaign_status_floor');
      assert.equal(out.agent_id, null);
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('decideLegateTurn floors opinion questions to answer (never dispatch)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-opinion-'));
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
    // Model wrongly dispatches an opinion question — floor must force answer.
    llm.ollamaNativeChat = async () => JSON.stringify({
      mode: 'dispatch',
      reply: '',
      agent_id: 'ei-worker',
      lookups: [],
      reason: 'model_error',
    });
    delete require.cache[legatePath];
    try {
      const { decideLegateTurn } = require('../lib/legateChat');
      const out = await decideLegateTurn('What do you make of the Osirion?', {
        rootDir: path.join(__dirname, '..'),
      });
      assert.equal(out.mode, 'answer');
      assert.equal(out.reason, 'opinion_floor');
      assert.equal(out.agent_id, null);
      assert.deepEqual(out.lookups, []);
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('isOpinionQuestion matches musing, not work orders', () => {
  const { isOpinionQuestion, looksLikeWorkOrder } = require('../lib/eiGoalParse');
  assert.equal(isOpinionQuestion('What do you make of the Osirion?'), true);
  assert.equal(isOpinionQuestion('what do you think about Hancock?'), true);
  assert.equal(isOpinionQuestion("What's your take on the Sphinx erosion debate?"), true);
  assert.equal(isOpinionQuestion('Thoughts on Schoch?'), true);
  assert.equal(isOpinionQuestion('How do you read the Petrie survey data?'), true);
  assert.equal(isOpinionQuestion('Do you buy the Younger Dryas impact theory?'), true);
  // Not opinion
  assert.equal(isOpinionQuestion('Find and add Petrie to the corpus'), false);
  assert.equal(isOpinionQuestion('campaign status'), false);
  // Opinion phrasing always wins over work-order telemetry (WP3.2).
  const mixed = 'What do you make of Hancock? Also find his books and add them to the corpus';
  assert.equal(isOpinionQuestion(mixed), true);
  assert.equal(looksLikeWorkOrder(mixed), false);
});

test('decideLegateTurn catch path never silently dispatches', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-catch-'));
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
      const out = await decideLegateTurn(
        "Please find and add to Corpus Dunn's Lost Technologies",
        { rootDir: path.join(__dirname, '..') },
      );
      assert.equal(out.mode, 'answer');
      assert.equal(out.source, 'decide_fail');
      assert.equal(out.agent_id, null);
      assert.equal(out.reply, DECIDE_FAIL_REPLY);
    } finally {
      llm.ollamaNativeChat = orig;
      delete require.cache[legatePath];
      delete require.cache[llmPath];
    }
  });
});

test('deliverLegateProgressToChat appends session progress', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-p-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, async () => {
    delete require.cache[require.resolve('../lib/sessionStore')];
    delete require.cache[require.resolve('../lib/agentJobs')];
    delete require.cache[require.resolve('../lib/legateChat')];
    const { enqueueJob } = require('../lib/agentJobs');
    const { deliverLegateProgressToChat, formatProgressChatReply } = require('../lib/legateChat');
    const sessionStore = require('../lib/sessionStore');
    const queued = enqueueJob({
      type: 'agent_run',
      payload: {
        chat_origin: true,
        session_id: 'sess-progress',
        agent_id: 'ei-worker',
        brief: 'seek Dunn PDF',
      },
    });
    // move to running so progress can patch
    const { writeJob } = require('../lib/agentJobs');
    writeJob(queued.job, 'running');
    const line = formatProgressChatReply(queued.job, {
      stage: 'step_start',
      tool: 'seek_files',
      message: 'Step 1/1: searching open web',
    });
    assert.match(line, /^Update — /);
    assert.match(line, /searching open web/);
    assert.doesNotMatch(line, /ei-worker|job_/, 'no internal ids in progress lines');
    const out = await deliverLegateProgressToChat(queued.job, {
      stage: 'step_start',
      tool: 'seek_files',
      message: 'Step 1/1: searching open web',
    });
    assert.equal(out.delivered, true);
    const hist = sessionStore.getHistory('sess-progress');
    assert.ok(hist.some((m) => m.role === 'assistant' && /searching open web/.test(m.content)));
    const { readJob } = require('../lib/agentJobs');
    const job = readJob(queued.job.id);
    assert.ok(job.progress && job.progress.length >= 1);
    assert.match(job.progress_latest.message, /searching open web/);
  });
});

test('formatReviewChatReply does not claim success on escalate', () => {
  const { formatReviewChatReply } = require('../lib/legateChat');
  const reply = formatReviewChatReply(
    {
      id: 'job_x',
      payload: { agent_id: 'ei-worker', brief: 'add Dunn book', chat_origin: true },
    },
    {
      ok: false,
      run: {
        review: { verdict: 'escalate', summary: 'No full PDF ingested.' },
        artifact_text: 'thin keeps only',
      },
    },
  );
  assert.match(reply, /ran into trouble/i);
  assert.match(reply, /not counting this one as complete/i);
  assert.doesNotMatch(reply, /successfully located/i);
  assert.doesNotMatch(reply, /happy with the result/i);
});

test('deliverLegateReviewToChat appends session + notification', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-legate-d-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, async () => {
    delete require.cache[require.resolve('../lib/sessionStore')];
    delete require.cache[require.resolve('../lib/notificationFeed')];
    delete require.cache[require.resolve('../lib/legateChat')];
    const { deliverLegateReviewToChat } = require('../lib/legateChat');
    const sessionStore = require('../lib/sessionStore');
    const out = await deliverLegateReviewToChat(
      {
        id: 'job_review_1',
        payload: {
          chat_origin: true,
          session_id: 'sess-legate',
          agent_id: 'ei-worker',
          brief: 'bring Giza Power Plant into corpus',
        },
      },
      {
        ok: true,
        run: {
          review: { verdict: 'accept', summary: 'Full PDF kept in corpus.' },
          artifact_text: 'ingested 1 doc',
        },
      },
      { notifyTelegram: false },
    );
    assert.equal(out.delivered, true);
    const hist = sessionStore.getHistory('sess-legate');
    assert.ok(hist.some((m) => m.role === 'assistant' && /Full PDF kept in corpus/.test(m.content)));
    assert.ok(hist.some((m) => m.role === 'assistant' && /happy with the result/i.test(m.content)));
  });
});
