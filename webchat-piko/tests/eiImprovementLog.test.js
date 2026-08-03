const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prevEi = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const prevData = process.env.PIKO_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-findings-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-findings-data-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  process.env.PIKO_DATA_DIR = dataDir;
  const mods = [
    '../lib/eiImprovementLog',
    '../lib/eiResearchCampaign',
    '../lib/eiEngineeringQueue',
    '../lib/culturesCorpusApi',
  ].map((p) => require.resolve(p));
  for (const p of mods) delete require.cache[p];
  try {
    return fn(dir, require('../lib/eiImprovementLog'));
  } finally {
    if (prevEi == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prevEi;
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    for (const p of mods) delete require.cache[p];
  }
}

function unhealthyCard() {
  return {
    at: '2026-08-01T12:00:00.000Z',
    cycle_count: 525,
    keeps_total: 53,
    notes_count: 51,
    notes_keep_ratio: 0.96,
    attributed_keep_pct: 92.5,
    reflection_survival_per_100_cycles: 0.19,
    dead_thread_count: 1,
    by_thread: {
      giza: { keeps: 17, notes: 12, notes_keep_ratio: 0.706 },
      abydos: { keeps: 11, notes: 5, notes_keep_ratio: 0.455 },
      tiahuanaco: { keeps: 1, notes: 0, notes_keep_ratio: 0 },
      'flood-myths': { keeps: 9, notes: 12, notes_keep_ratio: 1.333 },
      other: { keeps: 4, notes: 0, notes_keep_ratio: 0 },
    },
    targets: {
      notes_keep_ratio: 0.9,
      attributed_keep_pct: 70,
      reflection_survival_per_100_cycles: 5,
      dead_thread_count: 0,
    },
  };
}

test('buildDailyFindings surfaces the live weaknesses', () => {
  withTempData((_dir, log) => {
    const state = {
      idle_streak: 9,
      leads: [],
      reports: [
        {
          reflection: {
            added: 0,
            rejected_details: [
              { title: 'a', reason: 'cooldown' },
              { title: 'b', reason: 'cooldown' },
              { title: 'c', reason: 'in_corpus' },
              { title: 'd', reason: 'sanitize' },
            ],
          },
        },
      ],
    };
    const findings = log.buildDailyFindings(unhealthyCard(), state);
    const ids = findings.map((f) => f.id);
    assert.ok(ids.includes('reflection_survival_low'));
    assert.ok(ids.includes('dead_threads'));
    assert.ok(ids.includes('threads_under_digested'));
    assert.ok(ids.includes('reflection_rejections_dominant'));
    assert.ok(ids.includes('campaign_idle_no_leads'));
    // Healthy metrics must NOT appear
    assert.ok(!ids.includes('notes_keep_ratio_low'));
    assert.ok(!ids.includes('attribution_low'));
    const deadFinding = findings.find((f) => f.id === 'dead_threads');
    assert.match(deadFinding.summary, /tiahuanaco/);
    const rej = findings.find((f) => f.id === 'reflection_rejections_dominant');
    assert.equal(rej.evidence.reasons.cooldown, 2);
  });
});

test('healthy card produces no warn findings', () => {
  withTempData((_dir, log) => {
    const card = {
      ...unhealthyCard(),
      reflection_survival_per_100_cycles: 6,
      by_thread: {
        giza: { keeps: 17, notes: 17, notes_keep_ratio: 1 },
      },
    };
    const state = { idle_streak: 0, leads: [{ status: 'pending' }], reports: [] };
    const findings = log.buildDailyFindings(card, state);
    assert.equal(findings.filter((f) => f.severity === 'warn').length, 0);
  });
});

test('maybeAppendDailyFindings writes once per day and readRecentFindings returns it', () => {
  withTempData((dir, log) => {
    const state = { idle_streak: 9, leads: [], reports: [] };
    const first = log.maybeAppendDailyFindings(state, { card: unhealthyCard() });
    assert.equal(first.ok, true);
    assert.equal(first.skipped, false);
    assert.ok(state.last_findings_at);
    assert.ok(fs.existsSync(path.join(dir, 'improvement_findings.jsonl')));

    const second = log.maybeAppendDailyFindings(state, { card: unhealthyCard() });
    assert.equal(second.skipped, true);
    assert.equal(second.reason, 'within_day');

    const read = log.readRecentFindings(5);
    assert.equal(read.ok, true);
    assert.equal(read.entries.length, 1);
    assert.ok(read.entries[0].findings_count >= 2);
    assert.ok(read.entries[0].scorecard.reflection_survival_per_100_cycles === 0.19);

    // force writes again
    const forced = log.maybeAppendDailyFindings(state, { card: unhealthyCard(), force: true });
    assert.equal(forced.skipped, false);
    assert.equal(log.readRecentFindings(5).entries.length, 2);
  });
});
