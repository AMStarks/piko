/**
 * WP7.2 — legacy metaless cooldown stamps remediated to FAIL_COOLDOWN_DAYS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp72-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('WP7.2 metaless key stamped 3 days ago → off cooldown after migration', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const key = 'old failed seek pdf';
    state.attempted_queries[key] = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    // no attempted_meta
    campaign.migrateCampaignState(state);
    assert.equal(state.attempted_meta[key].cooldown_days, campaign.FAIL_COOLDOWN_DAYS);
    assert.equal(state.attempted_meta[key].legacy_remediated, true);
    assert.equal(campaign.queryOnCooldown(state, key), false);
  });
});

test('WP7.2 metaless key stamped 1 day ago → still on cooldown (2-day window)', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const key = 'recent failed seek pdf';
    state.attempted_queries[key] = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    campaign.migrateCampaignState(state);
    assert.equal(campaign.queryOnCooldown(state, key), true);
  });
});

test('WP7.2 key with existing cooldown_days:7 → untouched', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const key = 'kept title author pdf';
    state.attempted_queries[key] = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    state.attempted_meta[key] = {
      at: state.attempted_queries[key],
      title: 'Kept Title',
      author: 'Author',
      cooldown_days: 7,
    };
    campaign.migrateCampaignState(state);
    assert.equal(state.attempted_meta[key].cooldown_days, 7);
    assert.equal(state.attempted_meta[key].legacy_remediated, undefined);
  });
});

test('WP7.2 migration is idempotent', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const key = 'idempotent key pdf';
    state.attempted_queries[key] = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    campaign.migrateCampaignState(state);
    const first = JSON.stringify(state.attempted_meta[key]);
    campaign.migrateCampaignState(state);
    assert.equal(JSON.stringify(state.attempted_meta[key]), first);
  });
});
