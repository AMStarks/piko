const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetTenantBackgroundProfileCache } = require('../lib/tenantBackgroundJobs');
const { stopAgentWorker } = require('../lib/agentWorker');

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
      stopAgentWorker();
      for (const k of Object.keys(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetTenantBackgroundProfileCache();
    });
}

test('enqueue and claim job', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-jobs-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, () => {
    const { enqueueJob, claimNextPending, readJob, completeJob } = require('../lib/agentJobs');
    const q = enqueueJob({ type: 'agent_run', payload: { agent_id: 'ei-health', brief: 'ping' }, tenant_id: 'customer-03' });
    assert.equal(q.ok, true);
    assert.equal(q.job.status, 'pending');
    const claimed = claimNextPending();
    assert.ok(claimed);
    assert.equal(claimed.id, q.job.id);
    assert.equal(claimed.status, 'running');
    completeJob(claimed, { ok: true }, null);
    const done = readJob(q.job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.result.ok, true);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('worker processes agent_run job with stub', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-worker-'));
  const orch = require('../lib/agentOrchestrator');
  const orig = orch.runAgent;
  orch.runAgent = async () => ({
    ok: true,
    reply: 'stub',
    run: { id: 'run_stub', status: 'ok', review: { verdict: 'accept' } },
  });
  try {
    await withEnv({
      PIKO_DATA_DIR: tmp,
      PIKO_AGENT_ORCH: '1',
      PIKO_AGENT_WORKER: '0',
      PIKO_TENANT_ID: 'customer-03',
      PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    }, async () => {
      const { enqueueAgentJob } = require('../lib/agentOrchestrator');
      const { tick } = require('../lib/agentWorker');
      const { readJob } = require('../lib/agentJobs');
      const q = enqueueAgentJob('agent_run', { agent_id: 'ei-health', brief: 'ping' }, { rootDir: path.join(__dirname, '..') });
      assert.equal(q.ok, true);
      await tick(path.join(__dirname, '..'));
      const done = readJob(q.job.id);
      assert.equal(done.status, 'done');
      assert.equal(done.result.ok, true);
      assert.equal(done.result.run.id, 'run_stub');
    });
  } finally {
    orch.runAgent = orig;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('worker does not start when orch off', () => {
  resetTenantBackgroundProfileCache();
  delete process.env.PIKO_AGENT_ORCH;
  delete process.env.PIKO_AGENT_ORCH_AUTO;
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'ausmaker';
  const { startAgentWorker } = require('../lib/agentWorker');
  const out = startAgentWorker(path.join(__dirname, '..'));
  assert.equal(out.started, false);
  stopAgentWorker();
  resetTenantBackgroundProfileCache();
});
