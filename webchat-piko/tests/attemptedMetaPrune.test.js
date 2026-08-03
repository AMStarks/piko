const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('WP6.6 age prune and max-key prune drop attempted_meta with queries', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const prevMax = process.env.PIKO_EI_ATTEMPTED_MAX_KEYS;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-meta-prune-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  process.env.PIKO_EI_ATTEMPTED_MAX_KEYS = '3';

  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|culturesCorpusApi/.test(key)) delete require.cache[key];
  }

  try {
    const campaign = require('../lib/eiResearchCampaign');
    const state = campaign.loadState();
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const recent = new Date().toISOString();
    state.attempted_queries = {
      old_q: old,
      a: recent,
      b: recent,
      c: recent,
      d: recent,
    };
    state.attempted_meta = {
      old_q: { days: 7, title: 'old' },
      a: { days: 7, title: 'a' },
      b: { days: 7, title: 'b' },
      c: { days: 7, title: 'c' },
      d: { days: 7, title: 'd' },
      orphan: { days: 7, title: 'orphan' },
    };
    campaign.migrateCampaignState(state);
    assert.equal(state.attempted_queries.old_q, undefined);
    assert.equal(state.attempted_meta.old_q, undefined);
    assert.equal(state.attempted_meta.orphan, undefined);
    assert.ok(Object.keys(state.attempted_queries).length <= 3);
    for (const k of Object.keys(state.attempted_queries)) {
      assert.ok(state.attempted_meta[k], `meta kept for ${k}`);
    }
    // No meta without a query key
    for (const k of Object.keys(state.attempted_meta)) {
      assert.ok(state.attempted_queries[k], `query kept for meta ${k}`);
    }
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    if (prevMax == null) delete process.env.PIKO_EI_ATTEMPTED_MAX_KEYS;
    else process.env.PIKO_EI_ATTEMPTED_MAX_KEYS = prevMax;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
