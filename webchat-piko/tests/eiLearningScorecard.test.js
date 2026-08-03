const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-scorecard-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  // Clear module cache so culturesDataRoot / statePath pick up the temp dir.
  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const corpusApiPath = require.resolve('../lib/culturesCorpusApi');
  delete require.cache[campaignPath];
  delete require.cache[corpusApiPath];
  try {
    return fn(dir, require('../lib/eiResearchCampaign'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[campaignPath];
    delete require.cache[corpusApiPath];
  }
}

test('expertiseSnapshot keeps_by_via prefers lifetime stats over last-12 reports', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.stats.keeps_by_via_seed_url = 10;
    state.stats.keeps_by_via_seek = 20;
    state.stats.keeps_by_via_other = 3;
    // Reports would disagree if we still summed only last-12:
    state.reports = [{
      cycle: 1,
      seeks: [
        { via: 'seed_url', kept: 2 },
        { via: 'seek', kept: 3 },
      ],
    }];
    const snap = campaign.expertiseSnapshot(state);
    assert.equal(snap.keeps_by_via.seed_url, 10);
    assert.equal(snap.keeps_by_via.seek, 20);
    assert.equal(snap.keeps_by_via.other, 3);
  });
});

test('expertiseSnapshot keeps_by_via backfills from reports when lifetime unset', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.reports = [{
      cycle: 1,
      seeks: [
        { via: 'seed_url', kept: 2 },
        { via: 'seek', kept: 3 },
        { via: 'seek', keeps: 1 }, // legacy field
        { via: 'other_path', kept: 1 },
      ],
    }];
    const snap = campaign.expertiseSnapshot(state);
    assert.equal(snap.keeps_by_via.seed_url, 2);
    assert.equal(snap.keeps_by_via.seek, 4);
    assert.equal(snap.keeps_by_via.other, 1);
  });
});

test('learningScorecard computes north-star metrics from coverage + stats', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.cycle_count = 100;
    state.stats = {
      seeks: 50, keeps: 10, unsures: 0, expands: 0, reflections: 5,
      skipped_duplicates: 0,
      reflection_leads_added: 8,
      reflection_leads_sought: 10,
      reflection_leads_kept: 3,
      reflection_leads_proposed: 40,
    };
    state.thread_coverage = {
      giza: { keeps: 4, seeks: 10 },
      abydos: { keeps: 3, seeks: 5 },
      'gobekli-tepe': { keeps: 1, seeks: 2 },
      tiahuanaco: { keeps: 0, seeks: 1 },
      other: { keeps: 2, seeks: 4 },
    };
    const card = campaign.learningScorecard(state);
    assert.equal(card.ok, true);
    assert.equal(card.keeps_total, 10);
    assert.equal(card.attributed_keeps, 8); // 4+3+1+0 (+ other threads at 0 from DEFAULT)
    // dead threads: DEFAULT_THREADS + atlantis with keeps < 3, excluding other
    assert.ok(card.dead_thread_count >= 2);
    assert.equal(card.reflection_leads_added, 8);
    assert.equal(card.reflection_leads_sought, 10);
    assert.equal(card.reflection_leads_kept, 3);
    assert.equal(card.reflection_kept_sought_ratio, 0.3);
    assert.equal(card.reflection_survival_per_100_cycles, 3); // kept/cycles*100
    assert.equal(card.attributed_keep_pct, 80); // 8/10
    assert.ok(card.targets.notes_keep_ratio === 0.9);
  });
});

test('maybeAppendScorecardSnapshot writes once per week', () => {
  withTempData((dir, campaign) => {
    const state = campaign.loadState();
    state.cycle_count = 10;
    state.stats = { seeks: 1, keeps: 1, unsures: 0, expands: 0, reflections: 0, skipped_duplicates: 0 };
    const first = campaign.maybeAppendScorecardSnapshot(state);
    assert.equal(first.ok, true);
    assert.equal(first.skipped, false);
    assert.ok(fs.existsSync(campaign.scorecardPath()));
    const second = campaign.maybeAppendScorecardSnapshot(state);
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    const lines = fs.readFileSync(path.join(dir, 'learning_scorecard.jsonl'), 'utf8')
      .split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });
});

test('starved campaign reflects during idle backoff (eifix_1ce3969e)', () => {
  withTempData((_dir, campaign) => {
    // (a) idle backoff + 0 pending leads → reflection still runs (recovery)
    const starved = { idle_streak: 40, leads: [], attempted_queries: {} };
    assert.deepEqual(
      campaign.shouldReflectThisCycle(starved),
      { run: true, reason: 'starvation_recovery' },
    );
    // (b) idle backoff with eligible pending leads → backoff skip preserved
    const idleWithLeads = {
      idle_streak: 40,
      leads: [{ status: 'pending', query: 'fresh unique query xyz PDF' }],
      attempted_queries: {},
    };
    assert.deepEqual(
      campaign.shouldReflectThisCycle(idleWithLeads),
      { run: false, reason: 'idle_backoff' },
    );
    // (b2) WP2.8: pending but all cooling → still starvation recovery
    const q = '"Cooling Title" Author PDF';
    const { normalizeTitle } = require('../lib/eiGoalParse');
    const coolingOnly = {
      idle_streak: 40,
      leads: [{ status: 'pending', query: q }],
      attempted_queries: { [normalizeTitle(q).slice(0, 160)]: new Date().toISOString() },
      attempted_meta: {},
    };
    assert.deepEqual(
      campaign.shouldReflectThisCycle(coolingOnly),
      { run: true, reason: 'starvation_recovery' },
    );
    // Not idle → always reflect
    assert.deepEqual(
      campaign.shouldReflectThisCycle({ idle_streak: 0, leads: [], attempted_queries: {} }),
      { run: true, reason: 'normal' },
    );
    // (c) idle streak resets as soon as reflection adds a lead
    const state = { idle_streak: 40 };
    campaign.updateIdleStreak(state, 0, 1); // 0 seeks, 1 lead from reflection
    assert.equal(state.idle_streak, 0);
    campaign.updateIdleStreak(state, 0, 0); // truly idle cycle increments
    assert.equal(state.idle_streak, 1);
  });
});

test('normalizeLookups accepts scorecard', () => {
  const { normalizeLookups } = require('../lib/legateTools');
  assert.deepEqual(normalizeLookups(['scorecard', 'learning']), ['scorecard', 'learning']);
});

test('applyReflectionProposedLeads records per-lead rejection reasons', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.stats = { seeks: 0, keeps: 0, unsures: 0, expands: 0, reflections: 0, skipped_duplicates: 0 };
    state.attempted_queries = {};
    state.attempted_meta = {};
    const coolTitle = 'Cooling Book Unique Xyz';
    const coolAuthor = 'Jane Doe';
    // Cool ALL reformulation variants → cooldown_all_variants
    for (let attempt = 0; attempt <= campaign.MAX_LEAD_RETRIES; attempt += 1) {
      const q = campaign.reformulateQuery({ title: coolTitle, author: coolAuthor }, attempt);
      campaign.stampAttempted(state, q, { title: coolTitle, author: coolAuthor });
    }

    const out = campaign.applyReflectionProposedLeads(state, [
      { title: coolTitle, author: coolAuthor, thread: 'giza' },
      { title: 'Ab', author: 'X', thread: 'giza' }, // missing_title (too short)
      { title: 'Some Modern Speculative Work Alpha', author: 'Jane Roe', thread: 'giza' },
      { title: 'Another Speculative Work Beta', author: 'John Roe', thread: 'giza' },
    ], { dossierGapAdded: 0 });

    assert.ok(out.rejected >= 2);
    const reasons = (out.rejected_details || []).map((r) => r.reason);
    assert.ok(reasons.includes('cooldown_all_variants'), reasons.join(','));
    assert.ok(reasons.includes('missing_title') || reasons.includes('sanitize'), reasons.join(','));
    assert.ok(reasons.includes('speculative_cap'), reasons.join(','));
    assert.equal(typeof out.rejected_details[0].title, 'string');
  });
});
