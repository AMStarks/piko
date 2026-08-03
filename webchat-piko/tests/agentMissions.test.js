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

test('planMissionRules splits and assigns the generalist ei-worker', async () => {
  await withEnv({
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_TENANT_ID: 'customer-03',
  }, () => {
    const { planMissionRules, splitGoalParts } = require('../lib/agentMissionPlanner');
    const parts = splitGoalParts('1. Explain Anubis\n2. Summarize Osiris myth');
    assert.equal(parts.length, 2);
    const plan = planMissionRules(
      '1. Explain Anubis in funerary belief\n2. Summarize Osiris myth briefly',
      path.join(__dirname, '..'),
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.children.length, 2);
    assert.ok(plan.children.every((c) => c.agent_id === 'ei-worker'));
  });
});

test('createMission plans without execute', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-mission-'));
  try {
    await withEnv({
      PIKO_DATA_DIR: tmp,
      PIKO_AGENT_ORCH: '1',
      PIKO_AGENT_REVIEW_MODE: 'rules',
      PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
      PIKO_TENANT_ID: 'customer-03',
      PIKO_AGENT_PLAN_MODE: 'rules',
    }, async () => {
      const { createMission, listMissions, readMission } = require('../lib/agentOrchestrator');
      const out = await createMission(
        'Explain Anubis in ancient Egyptian funerary belief in three sentences',
        { rootDir: path.join(__dirname, '..'), execute: false },
      );
      assert.equal(out.ok, true);
      assert.ok(out.mission.id.startsWith('m_'));
      assert.equal(out.mission.status, 'planned');
      assert.ok(out.mission.children.length >= 1);
      assert.equal(out.mission.children[0].agent_id, 'ei-worker');
      assert.ok(listMissions(5).some((m) => m.id === out.mission.id));
      assert.equal(readMission(out.mission.id).status, 'planned');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('executeMission runs children through review', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-mission-'));
  // Children are ei-worker now — stub the worker runtime, not the swarm.
  const workerRuntime = require('../lib/eiWorkerRuntime');
  const orig = workerRuntime.runEiWorker;
  workerRuntime.runEiWorker = async () => ({
    status: 'ok',
    pass: true,
    artifact_text: '[ei-worker / shared tool belt]\nGoal: Explain Anubis\nGoal fit: good — stub deliverable.',
    result: { ok: true, pass: true, goal_fit: { pass: true, summary: 'stub deliverable' } },
  });
  try {
    await withEnv({
      PIKO_DATA_DIR: tmp,
      PIKO_AGENT_ORCH: '1',
      PIKO_AGENT_REVIEW: '1',
      PIKO_AGENT_REVIEW_MODE: 'rules',
      PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
      PIKO_TENANT_ID: 'customer-03',
      PIKO_AGENT_PLAN_MODE: 'rules',
    }, async () => {
      const { createMission, executeMission } = require('../lib/agentOrchestrator');
      const planned = await createMission(
        'Explain Anubis in Egyptian funerary belief',
        { rootDir: path.join(__dirname, '..'), execute: false },
      );
      const out = await executeMission(planned.mission.id, { rootDir: path.join(__dirname, '..') });
      assert.ok(out.mission);
      assert.equal(out.mission.status, 'completed');
      assert.equal(out.mission.children[0].status, 'ok');
      assert.equal(out.mission.children[0].review.verdict, 'accept');
      assert.ok(out.mission.children[0].run_id);
    });
  } finally {
    workerRuntime.runEiWorker = orig;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
