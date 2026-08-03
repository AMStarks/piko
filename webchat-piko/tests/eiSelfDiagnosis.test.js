const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('resolveKind maps goal phrases', () => {
  const { resolveKind } = require('../lib/eiSelfDiagnosis');
  assert.equal(resolveKind('', 'run a self-diagnosis on duplicate keeps'), 'duplicate_keeps');
  assert.equal(resolveKind('', 'reflection rejection histogram'), 'reflection_rejections');
  assert.equal(resolveKind('scorecard', ''), 'scorecard');
});

test('planWorkRules routes self-diagnosis goals', () => {
  const { planWorkRules } = require('../lib/eiWorkPlanner');
  const plan = planWorkRules('Please run a self-diagnosis on duplicate keeps');
  assert.equal(plan.steps[0].tool, 'self_diagnosis');
  assert.equal(plan.steps[0].args.kind, 'duplicate_keeps');
});

test('diagnoseScorecard and notes_by_thread are read-only', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-selfdiag-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const mods = [
    '../lib/eiSelfDiagnosis',
    '../lib/eiResearchCampaign',
    '../lib/culturesCorpusApi',
  ].map((p) => require.resolve(p));
  for (const p of mods) delete require.cache[p];
  try {
    const before = fs.readdirSync(dir);
    const {
      diagnoseScorecard,
      diagnoseNotesByThread,
      diagnoseReflectionRejections,
      formatDiagnosisArtifact,
    } = require('../lib/eiSelfDiagnosis');
    const sc = diagnoseScorecard();
    assert.equal(sc.kind, 'scorecard');
    assert.equal(sc.ok, true);
    const notes = diagnoseNotesByThread();
    assert.equal(notes.kind, 'notes_by_thread');
    const rej = diagnoseReflectionRejections();
    assert.equal(rej.kind, 'reflection_rejections');
    assert.match(formatDiagnosisArtifact(sc), /Scorecard:/);
    // No new live data files beyond what loadState may create — scorecard reads only.
    // loadState does not write; ensure we didn't create notes/docs dirs.
    assert.ok(!fs.existsSync(path.join(dir, 'corpus_notes')));
    assert.ok(!before.includes('assets'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const p of mods) delete require.cache[p];
  }
});

test('runSelfDiagnosis duplicate_keeps via tool', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-selfdiag2-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const mods = [
    '../lib/eiSelfDiagnosis',
    '../lib/eiResearchCampaign',
    '../lib/culturesCorpusApi',
    '../lib/eiAgentTools',
  ].map((p) => require.resolve(p));
  for (const p of mods) delete require.cache[p];
  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'cultures_cache.sqlite'));
    db.exec(`
      CREATE TABLE harvest_items (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT, source_url TEXT,
        title TEXT, culture TEXT, official_text TEXT, image_path TEXT, image_url TEXT,
        meta_json TEXT, created_at TEXT, UNIQUE(source, source_id)
      );
      CREATE TABLE transcriptions (id INTEGER PRIMARY KEY, harvest_id INTEGER);
      CREATE TABLE critiques (id INTEGER PRIMARY KEY, harvest_id INTEGER);
    `);
    const ins = db.prepare(`
      INSERT INTO harvest_items (id, source, source_id, source_url, title, culture, meta_json, created_at)
      VALUES (?, 'archive_org', ?, ?, ?, 'egypt', '{}', datetime('now'))
    `);
    ins.run(1, 'a', 'https://archive.org/details/abydos1petr', 'old');
    ins.run(2, 'b', 'https://archive.org/download/abydos1petr/abydos1petr.pdf', 'new');
    db.close();
    for (const p of mods) delete require.cache[p];
    const { runTool } = require('../lib/eiAgentTools');
    const out = await runTool('self_diagnosis', { kind: 'duplicate_keeps' }, {});
    assert.equal(out.ok, true);
    assert.equal(out.tool, 'self_diagnosis');
    assert.ok(out.result.duplicate_groups >= 1);
    assert.match(out.artifact, /Duplicate URL groups/);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const p of mods) delete require.cache[p];
  }
});
