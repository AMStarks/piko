const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function withTempRoots(fn) {
  const prevData = process.env.PIKO_DATA_DIR;
  const prevEi = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-eng-'));
  const eiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-data-'));
  process.env.PIKO_DATA_DIR = dataDir;
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = eiDir;
  const mods = [
    '../lib/eiEngineeringQueue',
    '../lib/eiSeedPack',
    '../lib/eiResearchCampaign',
    '../lib/culturesCorpusApi',
  ].map((p) => require.resolve(p));
  for (const p of mods) delete require.cache[p];
  try {
    return await fn({ dataDir, eiDir, eng: require('../lib/eiEngineeringQueue') });
  } finally {
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevEi == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prevEi;
    for (const p of mods) delete require.cache[p];
  }
}

test('proposeImprovement rejects missing evidence and invalid category', async () => {
  await withTempRoots(async ({ eng }) => {
    assert.equal(eng.proposeImprovement({ category: 'nope', subject: 'x', evidence: { metric: 'm', value: 1 } }).ok, false);
    assert.equal(eng.proposeImprovement({ category: 'seed_pack_entry', subject: 'x' }).ok, false);
  });
});

test('proposeImprovement enqueues one proposal; auto-approve blocked', async () => {
  await withTempRoots(async ({ eng, dataDir }) => {
    const out = eng.proposeImprovement({
      category: 'seed_pack_entry',
      subject: 'Posnansky Tihuanacu',
      evidence: { metric: 'dead_thread_count', value: 2, detail: 'tiahuanaco lagging' },
      proposal: {
        seed: {
          authors: ['Arthur Posnansky'],
          title_hints: ['Tihuanacu'],
          thread: 'tiahuanaco',
          urls: ['https://archive.org/details/tihuanacucradle00posn'],
          ia_ids: ['tihuanacucradle00posn'],
        },
      },
    }, dataDir);
    assert.equal(out.ok, true);
    assert.equal(out.task.kind, 'improvement');
    assert.equal(out.task.auto_forbidden, true);

    const auto = await eng.processEngineeringTask(out.task.id, { rootDir: dataDir, auto: true });
    assert.equal(auto.ok, false);
    assert.match(auto.error, /human_approval/);

    const pending = eng.listEngineeringTasks(dataDir, { status: 'pending' });
    assert.ok(pending.some((t) => t.id === out.task.id));
  });
});

test('approving seed_pack_entry applies overlay; reject stamps reason', async () => {
  await withTempRoots(async ({ eng, dataDir, eiDir }) => {
    const out = eng.proposeImprovement({
      category: 'seed_pack_entry',
      subject: 'Squier Peru',
      evidence: { metric: 'dead_thread_count', value: 2 },
      proposal: {
        seed: {
          authors: ['E. George Squier'],
          title_hints: ['Peru Incidents of Travel'],
          thread: 'tiahuanaco',
          urls: ['https://archive.org/details/peruincidentsoft00squi'],
        },
      },
    }, dataDir);
    assert.equal(out.ok, true);

    const approved = await eng.processEngineeringTask(out.task.id, { rootDir: dataDir });
    assert.equal(approved.ok, true);
    assert.equal(approved.apply_result.ok, true);
    assert.ok(fs.existsSync(path.join(eiDir, 'seed_pack_overlay.json')));

    delete require.cache[require.resolve('../lib/eiSeedPack')];
    const { getSeeds } = require('../lib/eiSeedPack');
    assert.ok(getSeeds().some((s) => (s.authors || []).some((a) => /Squier/i.test(a))));

    const out2 = eng.proposeImprovement({
      category: 'pd_author_addition',
      subject: 'schmidt',
      evidence: { metric: 'reflection_survival_per_100_cycles', value: 0 },
      proposal: { author: 'schmidt' },
    }, dataDir);
    const rej = eng.rejectEngineeringTask(out2.task.id, dataDir, 'not yet');
    assert.equal(rej.ok, true);
    assert.equal(rej.task.reject_reason, 'not yet');
    assert.equal(rej.task.status, 'rejected');
  });
});

test('pending improvement cap and dedupe', async () => {
  await withTempRoots(async ({ eng, dataDir }) => {
    for (let i = 0; i < 3; i += 1) {
      const r = eng.proposeImprovement({
        category: 'code_fix_brief',
        subject: `fix-${i}`,
        evidence: { metric: 'notes_keep_ratio', value: 0.5 },
        proposal: { brief: `fix ${i}` },
        fix_brief: `fix ${i}`,
      }, dataDir);
      assert.equal(r.ok, true);
    }
    const capped = eng.proposeImprovement({
      category: 'code_fix_brief',
      subject: 'fix-3',
      evidence: { metric: 'notes_keep_ratio', value: 0.5 },
      proposal: {},
    }, dataDir);
    assert.equal(capped.ok, false);
    assert.equal(capped.error, 'pending_cap');
  });
});

test('double-approve is 409 and apply runs once', async () => {
  await withTempRoots(async ({ eng, dataDir, eiDir }) => {
    const out = eng.proposeImprovement({
      category: 'seed_pack_entry',
      subject: 'Once Only Seed',
      evidence: { metric: 'dead_thread_count', value: 2 },
      proposal: {
        seed: {
          authors: ['Once Author'],
          title_hints: ['Once Title'],
          thread: 'tiahuanaco',
          urls: ['https://archive.org/details/once-only-seed'],
        },
      },
    }, dataDir);
    assert.equal(out.ok, true);
    const first = await eng.processEngineeringTask(out.task.id, { rootDir: dataDir });
    assert.equal(first.ok, true);
    const overlay1 = JSON.parse(fs.readFileSync(path.join(eiDir, 'seed_pack_overlay.json'), 'utf8'));
    const n1 = (overlay1.seeds || overlay1 || []).length || Object.keys(overlay1).length;

    const second = await eng.processEngineeringTask(out.task.id, { rootDir: dataDir });
    assert.equal(second.ok, false);
    assert.equal(second.statusCode, 409);
    assert.equal(second.error, 'not_pending');
    const overlay2 = JSON.parse(fs.readFileSync(path.join(eiDir, 'seed_pack_overlay.json'), 'utf8'));
    const n2 = (overlay2.seeds || overlay2 || []).length || Object.keys(overlay2).length;
    assert.equal(n2, n1);
  });
});

test('failing apply leaves task in approved with apply_error', async () => {
  await withTempRoots(async ({ eng, dataDir }) => {
    const out = eng.proposeImprovement({
      category: 'reflection_prompt_line',
      subject: 'empty line fail',
      evidence: { metric: 'notes_keep_ratio', value: 0.5 },
      proposal: { line: '' },
    }, dataDir);
    assert.equal(out.ok, true);
    const applied = await eng.processEngineeringTask(out.task.id, { rootDir: dataDir });
    assert.equal(applied.ok, false);
    assert.equal(applied.error, 'apply_failed');
    assert.equal(applied.task.status, 'approved');
    assert.ok(applied.task.apply_error);
    assert.ok(fs.existsSync(path.join(dataDir, 'ei-engineering', 'approved', `${out.task.id}.json`)));
    assert.equal(fs.existsSync(path.join(dataDir, 'ei-engineering', 'done', `${out.task.id}.json`)), false);
  });
});

test('eval enqueue dedupes open tasks and caps pending', async () => {
  await withTempRoots(async ({ eng, dataDir }) => {
    const report = {
      id: 'eval_1',
      smoke: [{ id: 'spine_health', pass: false, detail: 'down' }],
      harvests: [{ site_id: 'giza', score: { pass: false, reasons: ['irrelevant_hit'] } }],
    };
    const first = eng.enqueueFixTasksFromEval(report, { rootDir: dataDir, maxPending: 10 });
    assert.equal(first.length, 2);
    const second = eng.enqueueFixTasksFromEval(report, { rootDir: dataDir, maxPending: 10 });
    assert.equal(second.length, 0);
    assert.ok(second.skipped.some((s) => s.reason === 'duplicate_open'));

    const report2 = {
      id: 'eval_2',
      smoke: [
        { id: 'abydos', pass: false, detail: 'x' },
        { id: 'heliopolis', pass: false, detail: 'y' },
      ],
      harvests: [],
    };
    const capped = eng.enqueueFixTasksFromEval(report2, { rootDir: dataDir, maxPending: 2 });
    // Already 2 pending from first report → cap blocks new ones
    assert.equal(capped.length, 0);
    assert.ok(capped.skipped.some((s) => s.reason === 'pending_cap'));
  });
});

test('moveTask is exclusive-create (dest exists fails)', async () => {
  await withTempRoots(async ({ eng, dataDir }) => {
    const out = eng.proposeImprovement({
      category: 'code_fix_brief',
      subject: 'atomic move',
      evidence: { metric: 'm', value: 1 },
      proposal: {},
      fix_brief: 'x',
    }, dataDir);
    const id = out.task.id;
    const root = path.join(dataDir, 'ei-engineering');
    fs.mkdirSync(path.join(root, 'approved'), { recursive: true });
    fs.writeFileSync(path.join(root, 'approved', `${id}.json`), '{"id":"pre"}\n');
    const moved = eng.moveTask(id, 'pending', 'approved', dataDir, { status: 'approved' });
    assert.equal(moved.error, 'dest_exists');
    assert.ok(fs.existsSync(path.join(root, 'pending', `${id}.json`)));
  });
});
