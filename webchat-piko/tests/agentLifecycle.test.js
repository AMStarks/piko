/**
 * WP5 — agent lifecycle: cancel, timeout, pending cap, goal-fit, planner
 * validation, article wait, escalation, review floor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTmpData(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp5-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  for (const key of Object.keys(require.cache)) {
    if (/agentJobs|agentRegistry|agentWorker|notificationFeed|eiEngineeringQueue/.test(key)) {
      delete require.cache[key];
    }
  }
  return Promise.resolve()
    .then(() => fn(tmp))
    .finally(() => {
      if (prev == null) delete process.env.PIKO_DATA_DIR;
      else process.env.PIKO_DATA_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    });
}

test('WP5.1 runSteps aborts at next step boundary', async () => {
  const { runSteps } = require('../lib/eiWorkerRuntime');
  let calls = 0;
  let abort = false;
  const steps = [
    { tool: 'health', args: {}, why: 'ping' },
    { tool: 'seek_files', args: { query: 'x' }, why: 'work' },
    { tool: 'harvest', args: { query: 'y' }, why: 'more' },
  ];
  const results = await runSteps(steps, {
    shouldAbort: () => abort,
    runToolFn: async (tool) => {
      calls += 1;
      if (tool === 'health') abort = true;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, artifact: `${tool} ok`, result: { ok: true } };
    },
  });
  assert.equal(calls, 1);
  assert.ok(results.some((s) => s.cancelled));
  assert.ok(results.length <= 2);
});

test('WP5.1 late cancel after success → done + cancel_after_complete', async () => {
  await withTmpData(async () => {
    process.env.PIKO_AGENT_ORCH = '1';
    const { enqueueJob, claimNextPending, cancelJob, readJob } = require('../lib/agentJobs');
    const { tick } = require('../lib/agentWorker');
    const queued = enqueueJob({
      type: 'agent_run',
      payload: { agent_id: 'ei-worker', brief: 'finish me', chat_origin: false },
    });
    assert.equal(queued.ok, true);
    // Claim happens inside tick; cancel after processOne starts but finishes ok.
    let cancelArmed = false;
    await tick(path.join(__dirname, '..'), {
      timeoutMs: 10_000,
      processOne: async (job) => {
        cancelJob(job.id);
        cancelArmed = true;
        return { ok: true, reply_snip: 'done work' };
      },
    });
    assert.equal(cancelArmed, true);
    const done = readJob(queued.job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.error, null);
    assert.equal(done.cancel_after_complete, true);
    assert.equal(done.result.cancel_after_complete, true);
    assert.notEqual(done.error, 'cancelled');
  });
});

test('WP5.2 hanging processOne times out and clears busy', async () => {
  await withTmpData(async () => {
    process.env.PIKO_AGENT_ORCH = '1';
    const { enqueueJob, readJob } = require('../lib/agentJobs');
    const worker = require('../lib/agentWorker');
    const queued = enqueueJob({
      type: 'agent_run',
      payload: {
        agent_id: 'ei-worker',
        brief: 'hang forever',
        chat_origin: true,
        session_id: 'sess_wp5_timeout',
        operator_message: 'hang forever',
      },
    });
    await worker.tick(path.join(__dirname, '..'), {
      timeoutMs: 80,
      processOne: () => new Promise(() => { /* never resolves */ }),
    });
    const done = readJob(queued.job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.error, 'timeout');
    assert.equal(done.result.timeout, true);
    // busy must be clear so a second tick can claim work
    const next = enqueueJob({
      type: 'agent_run',
      payload: { agent_id: 'ei-worker', brief: 'after timeout' },
    });
    let ran = false;
    await worker.tick(path.join(__dirname, '..'), {
      timeoutMs: 5_000,
      processOne: async () => {
        ran = true;
        return { ok: true };
      },
    });
    assert.equal(ran, true);
    assert.equal(readJob(next.job.id).status, 'done');
  });
});

test('WP5.2 reapStaleRunning orphans old running jobs', async () => {
  await withTmpData(async () => {
    const {
      enqueueJob, claimNextPending, reapStaleRunning, readJob, writeJob,
    } = require('../lib/agentJobs');
    const q = enqueueJob({ type: 'agent_run', payload: { brief: 'stale' } });
    const running = claimNextPending();
    assert.equal(running.id, q.job.id);
    writeJob({
      ...readJob(running.id),
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }, 'running');
    const reaped = reapStaleRunning({ timeoutMs: 1000, graceMs: 0 });
    assert.equal(reaped.length, 1);
    assert.equal(readJob(running.id).error, 'orphaned_timeout');
  });
});

test('WP5.3 pending cap rejects beyond limit', async () => {
  await withTmpData(async () => {
    process.env.PIKO_AGENT_PENDING_CAP = '2';
    delete require.cache[require.resolve('../lib/agentJobs')];
    const { enqueueJob, PENDING_CAP_PER_TYPE } = require('../lib/agentJobs');
    assert.equal(PENDING_CAP_PER_TYPE, 2);
    assert.equal(enqueueJob({ type: 'agent_run', payload: { n: 1 } }).ok, true);
    assert.equal(enqueueJob({ type: 'agent_run', payload: { n: 2 } }).ok, true);
    const over = enqueueJob({ type: 'agent_run', payload: { n: 3 } });
    assert.equal(over.ok, false);
    assert.equal(over.pending_cap, true);
    assert.match(over.error, /pending_cap/);
    // Different type still allowed
    assert.equal(enqueueJob({ type: 'campaign_cycle', payload: {} }).ok, true);
    delete process.env.PIKO_AGENT_PENDING_CAP;
  });
});

test('WP5.4 Osirion-style plan fails goal-fit (health only + failed substantive)', () => {
  const { assessGoalFit, isSubstantiveStep } = require('../lib/eiWorkerRuntime');
  const steps = [
    { tool: 'health', ok: true, artifact: 'ok' },
    { tool: 'thread_dossier', ok: false, artifact: 'unknown_thread', result: { error: 'unknown_thread' } },
    { tool: 'digest_item', ok: false, artifact: 'not_found', result: { error: 'not_found' } },
  ];
  assert.equal(isSubstantiveStep(steps[0]), false);
  assert.equal(isSubstantiveStep(steps[1]), true);
  const fit = assessGoalFit('Osirion dossier please', steps);
  assert.equal(fit.pass, false);
  assert.match(fit.summary, /failed|Substantive/i);
});

test('WP5.4 normalizePlan rejects invented thread ids', () => {
  const { normalizePlan } = require('../lib/eiWorkPlanner');
  const plan = normalizePlan({
    summary: 'bad thread',
    steps: [
      { tool: 'thread_dossier', args: { thread: 'atlantis-moonbase' }, why: 'invented' },
      { tool: 'health', args: {}, why: 'pad' },
    ],
  }, 'dossier for fake thread');
  // invented thread dropped; health alone may remain or empty depending on lint
  assert.ok(!plan.steps.some((s) => s.tool === 'thread_dossier'));
  assert.ok((plan.dropped_steps || []).some((d) => /unknown_thread/.test(d)));
  if (!plan.steps.length) {
    assert.equal(plan.ok, false);
    assert.equal(plan.error, 'empty_plan');
  }
});

test('WP5.4 normalizePlan empty after validation fails honestly', () => {
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  const prev = require.cache[corpusPath];
  require.cache[corpusPath] = {
    id: corpusPath,
    filename: corpusPath,
    loaded: true,
    exports: { getItem: () => ({ ok: false, error: 'not_found' }) },
  };
  delete require.cache[require.resolve('../lib/eiWorkPlanner')];
  try {
    const { normalizePlan } = require('../lib/eiWorkPlanner');
    const plan = normalizePlan({
      summary: 'ghost harvest',
      steps: [
        { tool: 'digest_item', args: { harvest_id: 999999 }, why: 'missing' },
      ],
    }, 'digest missing');
    assert.equal(plan.ok, false);
    assert.equal(plan.error, 'empty_plan');
    assert.match(plan.summary, /not_found|empty/i);
  } finally {
    if (prev) require.cache[corpusPath] = prev;
    else delete require.cache[corpusPath];
    delete require.cache[require.resolve('../lib/eiWorkPlanner')];
  }
});

test('WP5.5 write_article inline awaits draft', async () => {
  const writerPath = require.resolve('../lib/eiArticleWriter');
  const prev = require.cache[writerPath];
  let called = false;
  require.cache[writerPath] = {
    id: writerPath,
    filename: writerPath,
    loaded: true,
    exports: {
      writeArticle: async (topic) => {
        called = true;
        await new Promise((r) => setTimeout(r, 10));
        return {
          ok: true,
          slug: 'wp5-draft',
          status: 'draft',
          title: topic,
          body: 'Draft body about Osirion masonry.',
        };
      },
    },
  };
  delete require.cache[require.resolve('../lib/eiAgentTools')];
  process.env.PIKO_ARTICLE_INLINE = '1';
  try {
    const { TOOLS } = require('../lib/eiAgentTools');
    const out = await TOOLS.write_article.run({ topic: 'Osirion masonry' }, {});
    assert.equal(called, true);
    assert.equal(out.ok, true);
    assert.match(out.artifact, /wp5-draft|Article draft/i);
    assert.equal(out.result.slug, 'wp5-draft');
  } finally {
    if (prev) require.cache[writerPath] = prev;
    else delete require.cache[writerPath];
    delete require.cache[require.resolve('../lib/eiAgentTools')];
    delete process.env.PIKO_ARTICLE_INLINE;
  }
});

test('WP5.6 escalate re-enqueues once then files engineering item', async () => {
  await withTmpData(async (tmp) => {
    const { enqueueJob, readJob, listJobs } = require('../lib/agentJobs');
    const { handleJobEscalation } = require('../lib/agentWorker');
    const job = enqueueJob({
      type: 'agent_run',
      payload: {
        agent_id: 'ei-worker',
        brief: 'broken work',
        chat_origin: true,
        operator_message: 'broken work',
      },
    }).job;
    const result = {
      ok: false,
      run: {
        review: {
          verdict: 'escalate',
          summary: 'transient connector blip',
          reasons: ['timeout', 'transient'],
        },
      },
    };
    const first = handleJobEscalation(job, result, tmp);
    assert.equal(first.handled, true);
    assert.ok(first.requeued);
    const retried = readJob(first.requeued);
    assert.equal(retried.payload._escalation_retried, true);

    // Second escalate on the retry → notification + engineering queue
    const second = handleJobEscalation(retried, result, tmp);
    assert.equal(second.handled, true);
    assert.equal(second.requeued, null);
    const engRoot = path.join(tmp, 'engineering-queue', 'pending');
    // engineering queue may use dataDir under PIKO_DATA_DIR
    const pendingDir = fs.existsSync(engRoot)
      ? engRoot
      : path.join(tmp, 'ei-engineering', 'pending');
    // Find any escalation file under tmp
    const walk = (dir, acc = []) => {
      if (!fs.existsSync(dir)) return acc;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p, acc);
        else if (f.endsWith('.json')) acc.push(p);
      }
      return acc;
    };
    const files = walk(tmp).filter((p) => {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        return j.kind === 'escalation';
      } catch (_) {
        return false;
      }
    });
    assert.ok(files.length >= 1, 'expected engineering escalation task');
    void listJobs;
    void pendingDir;
  });
});

test('WP5.7 brief/artifact mismatch → revise', async () => {
  const { rulesReview, briefArtifactOverlap } = require('../lib/agentReview');
  assert.equal(
    briefArtifactOverlap(
      'Please digest Osirion water erosion evidence at Abydos',
      'System healthy. All services nominal. Queue depth zero.',
    ),
    false,
  );
  const out = rulesReview({
    brief: 'Please digest Osirion water erosion evidence at Abydos',
    artifactText: 'System healthy. All services nominal. Queue depth zero.',
    status: 'ok',
    agentId: 'ei-worker',
    result: { ok: true },
  });
  assert.equal(out.verdict, 'revise');
  assert.ok(out.reasons.includes('brief_artifact_mismatch'));
});

test('WP5.7 structured pass allows accept without overlap', () => {
  const { rulesReview } = require('../lib/agentReview');
  const out = rulesReview({
    brief: 'Please digest Osirion water erosion evidence at Abydos',
    artifactText: 'Completed worker steps with deliverable notes on site survey.',
    status: 'ok',
    agentId: 'ei-worker',
    result: { pass: true, goal_fit: { pass: true } },
  });
  assert.equal(out.verdict, 'accept');
});

test('WP7.5 timeout done record carries cancel_requested; isCancelRequested stays true', async () => {
  await withTmpData(async () => {
    process.env.PIKO_AGENT_ORCH = '1';
    const { enqueueJob, readJob } = require('../lib/agentJobs');
    const worker = require('../lib/agentWorker');
    const queued = enqueueJob({
      type: 'agent_run',
      payload: {
        agent_id: 'ei-worker',
        brief: 'hang for cancel',
        chat_origin: true,
        session_id: 'sess_wp7_zombie',
        operator_message: 'hang for cancel',
      },
    });
    await worker.tick(path.join(__dirname, '..'), {
      timeoutMs: 60,
      processOne: () => new Promise(() => { /* never resolves */ }),
    });
    const done = readJob(queued.job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.error, 'timeout');
    assert.equal(done.cancel_requested, true);
    assert.equal(worker.isCancelRequested(done), true);
    assert.equal(worker.isCancelRequested({ id: queued.job.id }), true);
  });
});
