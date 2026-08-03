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

test('cancel pending job immediately', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-cancel-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, () => {
    const { enqueueJob, cancelJob, readJob, jobCounts } = require('../lib/agentJobs');
    const q = enqueueJob({ type: 'agent_run', payload: { agent_id: 'ei-health', brief: 'ping' } });
    assert.equal(q.ok, true);
    const c = cancelJob(q.job.id);
    assert.equal(c.ok, true);
    assert.equal(c.immediate, true);
    const done = readJob(q.job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.cancelled, true);
    assert.equal(jobCounts().pending, 0);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cancel running job sets cancel_requested', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-cancel-run-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, () => {
    const { enqueueJob, claimNextPending, cancelJob, readJob } = require('../lib/agentJobs');
    const q = enqueueJob({ type: 'agent_run', payload: { agent_id: 'ei-health', brief: 'ping' } });
    const claimed = claimNextPending();
    assert.equal(claimed.id, q.job.id);
    const c = cancelJob(claimed.id);
    assert.equal(c.ok, true);
    assert.equal(c.pending_cancel, true);
    const job = readJob(claimed.id);
    assert.equal(job.status, 'running');
    assert.equal(job.cancel_requested, true);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('chat slash /agents and /agent run', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-chat-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, async () => {
    const root = path.join(__dirname, '..');
    const { tryHandleAgentChat } = require('../lib/agentChatCommands');
    const list = await tryHandleAgentChat('/agents', root);
    assert.ok(list && /ei-health|Available agents/i.test(list.reply));
    const run = await tryHandleAgentChat('/agent run ei-health ping spine', root);
    assert.ok(run && /Queued|Job:/i.test(run.reply));
    const status = await tryHandleAgentChat('/agents status', root);
    assert.ok(status && /Agents working/i.test(status.reply));
    const nl = await tryHandleAgentChat('how many agents are working?', root);
    assert.ok(nl && /Agents working/i.test(nl.reply));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('chat commands ignored when orch off', async () => {
  resetTenantBackgroundProfileCache();
  delete process.env.PIKO_AGENT_ORCH;
  delete process.env.PIKO_AGENT_ORCH_AUTO;
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'ausmaker';
  const { tryHandleAgentChat } = require('../lib/agentChatCommands');
  const out = await tryHandleAgentChat('/agents', path.join(__dirname, '..'));
  assert.equal(out, null);
  resetTenantBackgroundProfileCache();
});
