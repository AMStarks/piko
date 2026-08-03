const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluateScorecardTriggers,
  maybeFileScorecardProposals,
  markFired,
  TRIGGER_COOLDOWN_MS,
  REFLECTION_SURVIVAL_TARGET,
} = require('../lib/eiScorecardTriggers');

function baseCard(overrides = {}) {
  return {
    at: '2026-08-01T12:00:00.000Z',
    cycle_count: 200,
    notes_keep_ratio: 0.96,
    reflection_survival_per_100_cycles: 0.19,
    dead_thread_count: 1,
    ...overrides,
  };
}

test('reflection_survival_low fires on synthetic regression', () => {
  const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
  const card = baseCard({ reflection_survival_per_100_cycles: 0.19, cycle_count: 200 });
  const prev = baseCard({
    at: '2026-07-25T12:00:00.000Z',
    reflection_survival_per_100_cycles: 0.2,
    cycle_count: 100,
  });
  const fired = evaluateScorecardTriggers(card, prev, state, {
    nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
  });
  assert.ok(fired.some((f) => f.ruleId === 'reflection_survival_low'));
  const r = fired.find((f) => f.ruleId === 'reflection_survival_low');
  assert.equal(r.category, 'code_fix_brief');
  assert.equal(r.evidence.metric, 'reflection_survival_per_100_cycles');
  assert.equal(r.evidence.value, 0.19);
  assert.match(r.evidence.detail, /"target":5/);
});

test('healthy metrics do not fire', () => {
  const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
  const card = baseCard({
    reflection_survival_per_100_cycles: REFLECTION_SURVIVAL_TARGET + 1,
    notes_keep_ratio: 0.95,
    dead_thread_count: 0,
  });
  const prev = baseCard({
    notes_keep_ratio: 0.94,
    dead_thread_count: 0,
    reflection_survival_per_100_cycles: 6,
  });
  const fired = evaluateScorecardTriggers(card, prev, state, {
    nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
  });
  assert.equal(fired.length, 0);
});

test('notes_keep_ratio_drop fires only on regression across target', () => {
  const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
  const nowMs = Date.parse('2026-08-01T12:00:00.000Z');
  // Already below — no fire without previous at/above
  assert.equal(
    evaluateScorecardTriggers(
      baseCard({ notes_keep_ratio: 0.8, reflection_survival_per_100_cycles: 10 }),
      baseCard({ notes_keep_ratio: 0.85 }),
      state,
      { nowMs },
    ).filter((f) => f.ruleId === 'notes_keep_ratio_drop').length,
    0,
  );
  // Drop across 0.9
  const drop = evaluateScorecardTriggers(
    baseCard({ notes_keep_ratio: 0.85, reflection_survival_per_100_cycles: 10, dead_thread_count: 0 }),
    baseCard({ notes_keep_ratio: 0.95, dead_thread_count: 0 }),
    state,
    { nowMs },
  );
  assert.ok(drop.some((f) => f.ruleId === 'notes_keep_ratio_drop'));
});

test('dead_thread_increase fires when count rises', () => {
  const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
  const fired = evaluateScorecardTriggers(
    baseCard({
      reflection_survival_per_100_cycles: 10,
      notes_keep_ratio: 0.95,
      dead_thread_count: 2,
    }),
    baseCard({ dead_thread_count: 1, notes_keep_ratio: 0.95 }),
    state,
    { nowMs: Date.parse('2026-08-01T12:00:00.000Z') },
  );
  assert.ok(fired.some((f) => f.ruleId === 'dead_thread_increase'));
  assert.equal(fired.find((f) => f.ruleId === 'dead_thread_increase').category, 'code_fix_brief');
});

test('cooldown prevents second fire within 7 days', () => {
  const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
  const nowMs = Date.parse('2026-08-01T12:00:00.000Z');
  markFired(state, 'reflection_survival_low', '2026-07-28T12:00:00.000Z', { last_cycle_count: 100 });
  const fired = evaluateScorecardTriggers(
    baseCard({ reflection_survival_per_100_cycles: 0.1, cycle_count: 250 }),
    baseCard({ cycle_count: 150 }),
    state,
    { nowMs },
  );
  assert.equal(fired.filter((f) => f.ruleId === 'reflection_survival_low').length, 0);

  // After cooldown window
  const later = evaluateScorecardTriggers(
    baseCard({ reflection_survival_per_100_cycles: 0.1, cycle_count: 250 }),
    baseCard({ cycle_count: 150 }),
    state,
    { nowMs: nowMs + TRIGGER_COOLDOWN_MS + 1000 },
  );
  assert.ok(later.some((f) => f.ruleId === 'reflection_survival_low'));
});

test('maybeFileScorecardProposals enqueues and respects pending_cap', async () => {
  const prevData = process.env.PIKO_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-trig-'));
  process.env.PIKO_DATA_DIR = dataDir;
  const engPath = require.resolve('../lib/eiEngineeringQueue');
  const trigPath = require.resolve('../lib/eiScorecardTriggers');
  delete require.cache[engPath];
  delete require.cache[trigPath];
  try {
    const eng = require('../lib/eiEngineeringQueue');
    const { maybeFileScorecardProposals: fileProps } = require('../lib/eiScorecardTriggers');

    const state = { scorecard_trigger_last_fired: {}, scorecard_trigger_meta: {} };
    const card = baseCard({ reflection_survival_per_100_cycles: 0.19, cycle_count: 200 });
    const previous = baseCard({ at: '2026-07-20T00:00:00.000Z', cycle_count: 50 });

    const first = fileProps(state, card, {
      previous,
      rootDir: dataDir,
      proposeImprovement: eng.proposeImprovement,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
    });
    assert.ok(first.fired.includes('reflection_survival_low'));
    assert.ok(first.results.some((r) => r.ok));
    assert.ok(state.scorecard_trigger_last_fired.reflection_survival_low);

    // Fill pending cap with two more dummy proposals
    for (let i = 0; i < 2; i += 1) {
      eng.proposeImprovement({
        category: 'reflection_prompt_line',
        subject: `filler-${i}`,
        evidence: { metric: 'x', value: i },
        proposal: { line: `extra ${i}` },
      }, dataDir);
    }
    // Cap is 3 improvements — one already from trigger; two fillers → full
    const pending = eng.listEngineeringTasks(dataDir, { status: 'pending' })
      .filter((t) => t.kind === 'improvement');
    assert.ok(pending.length >= 3);

    // Reset cooldown so rule would fire again, but pending_cap blocks enqueue
    state.scorecard_trigger_last_fired = {};
    state.scorecard_trigger_meta = {};
    const capped = fileProps(state, {
      ...card,
      at: '2026-08-08T12:00:00.000Z',
      notes_keep_ratio: 0.8,
      dead_thread_count: 3,
    }, {
      previous: { ...previous, notes_keep_ratio: 0.95, dead_thread_count: 1 },
      rootDir: dataDir,
      proposeImprovement: eng.proposeImprovement,
      nowMs: Date.parse('2026-08-08T12:00:00.000Z'),
    });
    assert.ok(capped.results.every((r) => !r.ok));
    assert.ok(capped.results.some((r) => r.error === 'pending_cap'));
    // WP4.5 / L6: suppressed enqueue must NOT burn the trigger cooldown.
    assert.equal(Object.keys(state.scorecard_trigger_last_fired).length, 0);
  } finally {
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    delete require.cache[engPath];
    delete require.cache[trigPath];
  }
});

test('maybeAppendScorecardSnapshot wires triggers (integration)', async () => {
  const prevData = process.env.PIKO_DATA_DIR;
  const prevEi = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-snap-'));
  const eiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-data-'));
  process.env.PIKO_DATA_DIR = dataDir;
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = eiDir;

  const mods = [
    '../lib/eiResearchCampaign',
    '../lib/eiEngineeringQueue',
    '../lib/eiScorecardTriggers',
    '../lib/culturesCorpusApi',
  ].map((p) => require.resolve(p));
  for (const p of mods) delete require.cache[p];

  try {
    const camp = require('../lib/eiResearchCampaign');
    const eng = require('../lib/eiEngineeringQueue');
    const state = camp.loadState();
    state.cycle_count = 200;
    state.stats = { ...(state.stats || {}), keeps: 10, reflection_leads_added: 0 };
    state.thread_coverage = { giza: { keeps: 5, seeks: 1 }, other: { keeps: 0, seeks: 0 } };
    state.last_scorecard_at = null;
    // Seed a previous snapshot so notes/dead rules have a baseline; reflection still fires.
    fs.mkdirSync(path.dirname(camp.scorecardPath()), { recursive: true });
    fs.writeFileSync(
      camp.scorecardPath(),
      `${JSON.stringify({
        at: '2026-07-20T00:00:00.000Z',
        cycle_count: 50,
        notes_keep_ratio: 0.95,
        reflection_survival_per_100_cycles: 0.2,
        dead_thread_count: 0,
      })}\n`,
      'utf8',
    );

    const out = camp.maybeAppendScorecardSnapshot(state, { force: true, rootDir: dataDir });
    assert.equal(out.ok, true);
    assert.equal(out.skipped, false);
    assert.ok(out.triggers);
    assert.ok(
      out.triggers.fired.includes('reflection_survival_low')
      || (out.triggers.results || []).some((r) => r.ruleId === 'reflection_survival_low' && r.ok),
    );
    const pending = eng.listEngineeringTasks(dataDir, { status: 'pending' })
      .filter((t) => t.kind === 'improvement');
    assert.ok(pending.length >= 1);
    assert.equal(pending[0].auto_forbidden, true);
  } finally {
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevEi == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prevEi;
    for (const p of mods) delete require.cache[p];
  }
});
