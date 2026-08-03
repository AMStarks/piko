const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetTenantBackgroundProfileCache } = require('../lib/tenantBackgroundJobs');

const {
  scoreSiteHarvest,
  parseEvalBrief,
  summarizeReport,
  REQUIRED_AGENTS,
} = require('../lib/eiPlatformEval');
const { buildFixBrief, enqueueFixTask, listEngineeringTasks } = require('../lib/eiEngineeringQueue');

test('parseEvalBrief handles JSON and text', () => {
  const j = parseEvalBrief('{"smoke":true,"harvest":false,"limit":3}');
  assert.equal(j.harvest, false);
  assert.equal(j.limit, 3);
  const t = parseEvalBrief('smoke only limit 8');
  assert.equal(t.harvest, false);
  assert.equal(t.limit, 8);
});

test('scoreSiteHarvest passes strong literature metrics', () => {
  const run = {
    id: 'run1',
    status: 'ok',
    review: { verdict: 'accept' },
    artifact_text: 'Quality: substantive=4 thin=0 literature=3 candidates=0 docs=2 max_chars=12000 live=4',
    result: {
      quality: {
        substantive_count: 4,
        thin_count: 0,
        literature_count: 3,
        candidate_count: 0,
        with_document: 2,
        max_text_chars: 12000,
      },
      live_count: 4,
    },
  };
  const scored = scoreSiteHarvest('abydos', run);
  assert.equal(scored.pass, true);
});

test('scoreSiteHarvest fails thin harvest and irrelevant hits', () => {
  const thin = scoreSiteHarvest('giza', {
    status: 'ok',
    artifact_text: 'Quality: substantive=1 thin=2 literature=1 candidates=0 docs=0 max_chars=400 live=1',
    result: {
      quality: {
        substantive_count: 1,
        thin_count: 2,
        literature_count: 1,
        with_document: 0,
        max_text_chars: 400,
      },
    },
  });
  assert.equal(thin.pass, false);

  const bad = scoreSiteHarvest('heliopolis', {
    status: 'ok',
    artifact_text: 'CIA reading room document Quality: substantive=3 docs=1 max_chars=9000',
    result: {
      quality: {
        substantive_count: 3,
        with_document: 1,
        max_text_chars: 9000,
      },
    },
  });
  assert.equal(bad.pass, false);
  assert.ok(bad.reasons.includes('irrelevant_hit'));
});

test('summarizeReport rolls up pass/fail', () => {
  const report = {
    smoke: [{ pass: true, id: 'registry_agents' }],
    harvests: [
      { site_id: 'abydos', score: { pass: true } },
      { site_id: 'giza', score: { pass: false } },
    ],
  };
  const s = summarizeReport(report);
  assert.equal(s.pass, false);
  assert.deepEqual(s.failed_sites, ['giza']);
});

test('engineering queue writes pending tasks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-eng-'));
  process.env.PIKO_DATA_DIR = tmp;
  const brief = buildFixBrief({ id: 'eval_x' }, { site_id: 'giza', reasons: ['substantive_1_lt_2'] });
  assert.match(brief, /eval_x/);
  const task = enqueueFixTask({
    eval_report_id: 'eval_x',
    site_id: 'giza',
    fix_brief: brief,
    files_hint: ['egyptian_insights/sources/archive_org.py'],
  }, path.join(__dirname, '..'));
  assert.ok(task.id);
  const pending = listEngineeringTasks(path.join(__dirname, '..'), { status: 'pending' });
  assert.ok(pending.some((t) => t.id === task.id));
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.PIKO_DATA_DIR;
});

test('ei-qa agent registered in builtin list', () => {
  const { BUILTIN_AGENTS } = require('../lib/agentRegistry');
  const qa = BUILTIN_AGENTS.find((a) => a.id === 'ei-qa');
  assert.ok(qa);
  assert.equal(qa.runtime, 'eval');
  for (const id of REQUIRED_AGENTS) {
    assert.ok(BUILTIN_AGENTS.some((a) => a.id === id), `missing ${id}`);
  }
});

test('rulesReview accepts platform eval pass', () => {
  const { rulesReview } = require('../lib/agentReview');
  const pass = rulesReview({
    agentId: 'ei-qa',
    status: 'ok',
    artifactText: '[ei-qa / ei.platform.eval]\nPlatform eval PASS',
    result: { pass: true },
  });
  assert.equal(pass.verdict, 'accept');
  const fail = rulesReview({
    agentId: 'ei-qa',
    status: 'needs_revision',
    artifactText: '[ei-qa / ei.platform.eval]\nPlatform eval FAIL',
    result: { pass: false },
  });
  assert.equal(fail.verdict, 'revise');
});
