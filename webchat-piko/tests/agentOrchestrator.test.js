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

test('EI culture lists researcher + culture-researcher, not quant', async () => {
  await withEnv({
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_TENANT_ID: 'customer-03',
    PIKO_AGENT_ORCH: undefined,
  }, () => {
    const { listAgents, getAgent } = require('../lib/agentRegistry');
    const agents = listAgents(path.join(__dirname, '..'));
    const ids = agents.map((a) => a.id).sort();
    assert.ok(ids.includes('researcher'));
    assert.ok(ids.includes('culture-researcher'));
    assert.ok(!ids.includes('quant'));
    assert.equal(getAgent('quant', path.join(__dirname, '..')), null);
    assert.ok(getAgent('culture-researcher', path.join(__dirname, '..')));
  });
});

test('AusMaker profile still sees quant', async () => {
  await withEnv({
    PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker',
    PIKO_TENANT_ID: 'customer-01',
    PIKO_AGENT_ORCH: undefined,
  }, () => {
    const { listAgents, getAgent } = require('../lib/agentRegistry');
    const agents = listAgents(path.join(__dirname, '..'));
    assert.ok(agents.some((a) => a.id === 'quant'));
    assert.ok(getAgent('quant', path.join(__dirname, '..')));
  });
});

test('rules review accept / escalate', () => {
  const { rulesReview } = require('../lib/agentReview');
  const ok = rulesReview({
    brief: 'Summarize Egyptian funerary texts and Anubis',
    artifactText: 'Anubis is associated with Egyptian funerary practice and mummification rites.',
    status: 'ok',
  });
  assert.equal(ok.verdict, 'accept');

  const bad = rulesReview({
    brief: 'anything',
    artifactText: 'Error: boom',
    status: 'failed',
  });
  assert.equal(bad.verdict, 'escalate');
});

test('orchestrator records run with review when orch on', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-agent-'));
  const swarm = require('../lib/legionSwarm');
  const orig = swarm.deploySubAgentRaw;
  swarm.deploySubAgentRaw = async () => 'Research Agent Report:\nEgyptian Insights note about Anubis and funerary texts.';

  try {
    await withEnv({
      PIKO_DATA_DIR: tmp,
      PIKO_AGENT_ORCH: '1',
      PIKO_AGENT_REVIEW: '1',
      PIKO_AGENT_REVIEW_MODE: 'rules',
      PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
      PIKO_TENANT_ID: 'customer-03',
    }, async () => {
      const { runAgent, isAgentOrchEnabled } = require('../lib/agentOrchestrator');
      assert.equal(isAgentOrchEnabled(path.join(__dirname, '..')), true);
      const out = await runAgent('culture-researcher', 'Summarize Egyptian funerary texts about Anubis');
      assert.equal(out.ok, true);
      assert.ok(out.run && out.run.id);
      assert.equal(out.run.agent_id, 'culture-researcher');
      assert.ok(out.run.review);
      assert.equal(out.run.review.verdict, 'accept');
      assert.ok(fs.existsSync(path.join(tmp, 'agent-runs', `${out.run.id}.json`)));
      assert.match(out.reply, /Piko review: accept/);
    });
  } finally {
    swarm.deploySubAgentRaw = orig;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('orch off by default on ausmaker', async () => {
  await withEnv({
    PIKO_AGENT_ORCH: undefined,
    PIKO_AGENT_ORCH_AUTO: undefined,
    PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker',
    PIKO_TENANT_ID: 'customer-01',
  }, () => {
    const { isAgentOrchEnabled } = require('../lib/agentOrchestrator');
    assert.equal(isAgentOrchEnabled(path.join(__dirname, '..')), false);
  });
});
