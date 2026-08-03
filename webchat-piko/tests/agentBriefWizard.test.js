const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('agent brief wizard clarify then confirm queues ei-worker', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-brief-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_EI_WORK_PLANNER_LLM: '0',
  }, async () => {
    const { startBrief, handleTurn, getAgentBrief } = require('../lib/agentBriefWizard');
    const started = await startBrief('Find Petrie texts as PDF', process.cwd(), 't1', tmp);
    assert.match(started.reply, /clarif|plan|worker|confirm/i);
    const session = getAgentBrief(tmp, 't1');
    assert.ok(session);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('agent brief cancel clears session', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-brief-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_AGENT_ORCH: '1',
    PIKO_EI_WORK_PLANNER_LLM: '0',
  }, async () => {
    const { startBrief, handleTurn, getAgentBrief } = require('../lib/agentBriefWizard');
    await startBrief('Find something', process.cwd(), 't2', tmp);
    const out = await handleTurn('cancel', process.cwd(), 't2', tmp);
    assert.match(out.reply, /cancel|reset|clear/i);
    assert.equal(getAgentBrief(tmp, 't2'), null);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('planner fallback is seek_files without keyword routing', async () => {
  await withEnv({ PIKO_EI_WORK_PLANNER_LLM: '0' }, async () => {
    const { planWorkRules } = require('../lib/eiWorkPlanner');
    const plan = planWorkRules('Please look for and add Christopher Dunn Lost Technologies of Ancient Egypt');
    assert.ok(plan.ok);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].tool, 'seek_files');
    assert.equal(plan.mode, 'fallback');
  });
});

test('Literature only does not invent Heliopolis focus from alias on', () => {
  const { sitesMentioned, extractFocus, aliasMatchesText } = require('../lib/eiResearchGoal');
  const { buildHarvestInput } = require('../lib/eiAgentTools');

  assert.equal(aliasMatchesText('Literature only.', 'on'), false);
  assert.equal(aliasMatchesText('temple at On near Cairo', 'on'), true);

  const combined = 'Find all Flinders Petrie texts.\nLiterature only.';
  assert.deepEqual(sitesMentioned(combined).map((s) => s.id), []);
  assert.equal(extractFocus(combined), null);

  const harvest = buildHarvestInput(combined, { seek_files: true, volume_job: true, require_document: true });
  assert.equal(harvest.focus, undefined);
  assert.ok(harvest.query.length > 0);
  assert.deepEqual(harvest.sources, ['web_pdf', 'archive_org']);
});
