/**
 * WP7.3 — addLead live-lead dedupe, speculative cap, retired-lead requeue.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp73-'));
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

test('WP7.3 terminal failed lead with expired cooldown → addLead accepts again', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const q = '"Readdable Book" Jane Doe PDF';
    state.leads.push({
      id: 'old1',
      query: q,
      title: 'Readdable Book',
      author: 'Jane Doe',
      status: 'failed',
      access: 'public_domain_likely',
      source: 'reflection',
      thread: 'other',
    });
    campaign.stampAttempted(state, q, { title: 'Readdable Book', author: 'Jane Doe', days: 2 });
    const key = Object.keys(state.attempted_queries).find((k) => /readdable/.test(k));
    assert.ok(key);
    state.attempted_queries[key] = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    state.attempted_meta[key].cooldown_days = 2;
    assert.equal(campaign.queryOnCooldown(state, q), false);
    const ok = campaign.addLead(state, {
      title: 'Readdable Book',
      author: 'Jane Doe',
      thread: 'other',
      source: 'reflection',
      why: 'retry after cool',
    });
    assert.equal(ok, true);
  });
});

test('WP7.3 terminal lead with active cooldown → still deduped', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const q = '"Cooling Book" John Smith PDF';
    state.leads.push({
      id: 'old2',
      query: q,
      title: 'Cooling Book',
      author: 'John Smith',
      status: 'failed',
      access: 'public_domain_likely',
      source: 'reflection',
      thread: 'other',
    });
    // Stamp all ladder variants so reformulation cannot slip through.
    for (let attempt = 0; attempt <= campaign.MAX_LEAD_RETRIES; attempt += 1) {
      const v = campaign.reformulateQuery(
        { title: 'Cooling Book', author: 'John Smith' },
        attempt,
      );
      campaign.stampAttempted(state, v, { title: 'Cooling Book', author: 'John Smith', days: 7 });
    }
    const ok = campaign.addLead(state, {
      title: 'Cooling Book',
      author: 'John Smith',
      thread: 'other',
      source: 'reflection',
    });
    assert.equal(ok, false);
  });
});

test('WP7.3 cooling speculative pending does not block new speculative proposals', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const stuckQ = '"Stuck Speculative" Modern Author PDF';
    state.leads.push({
      id: 'stuck',
      query: stuckQ,
      title: 'Stuck Speculative',
      author: 'Modern Author',
      status: 'pending',
      access: 'speculative',
      source: 'reflection',
      thread: 'other',
    });
    campaign.stampAttempted(state, stuckQ, {
      title: 'Stuck Speculative',
      author: 'Modern Author',
      days: 7,
    });
    // Novel speculative proposal — Modern-sounding author to classify speculative
    const out = campaign.applyReflectionProposedLeads(state, [{
      title: 'Fresh Speculative Work',
      author: 'Alice Contemporary',
      thread: 'other',
      why: 'new',
    }]);
    assert.ok(!out.rejected_details.some((d) => d.reason === 'speculative_cap'));
  });
});

test('WP7.3 cooldown_expired_never_ran requeues when query cools', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const q = '"Retired Book" Hapgood PDF';
    state.leads.push({
      id: 'ret1',
      query: q,
      title: 'Retired Book',
      author: 'Hapgood',
      status: 'cooldown_expired_never_ran',
      access: 'public_domain_likely',
      source: 'reflection',
      thread: 'flood-myths',
      cooldown_first_skip_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
      cooldown_skip_count: 5,
    });
    campaign.stampAttempted(state, q, { title: 'Retired Book', author: 'Hapgood', days: 2 });
    const key = Object.keys(state.attempted_queries).find((k) => k.includes('retired'));
    state.attempted_queries[key] = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    campaign.migrateCampaignState(state);
    const lead = state.leads.find((l) => l.id === 'ret1');
    assert.equal(lead.status, 'pending');
    assert.equal(lead.cooldown_first_skip_at, null);
  });
});

test('WP7.3 cooldown_expired_never_ran stays retired while cooling', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    const q = '"Still Cooling" Hapgood PDF';
    state.leads.push({
      id: 'ret2',
      query: q,
      title: 'Still Cooling',
      author: 'Hapgood',
      status: 'cooldown_expired_never_ran',
      access: 'public_domain_likely',
      source: 'reflection',
      thread: 'flood-myths',
    });
    campaign.stampAttempted(state, q, { title: 'Still Cooling', author: 'Hapgood', days: 7 });
    campaign.migrateCampaignState(state);
    assert.equal(state.leads.find((l) => l.id === 'ret2').status, 'cooldown_expired_never_ran');
  });
});
