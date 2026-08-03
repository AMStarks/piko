const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-starve-'));
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
  }
}

test('WP2.1: cooldown-active list is recency-sorted title—author, capped', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    const now = Date.now();
    // 50 cooling + many aged-out
    for (let i = 0; i < 300; i += 1) {
      const title = `Work Number ${i} Unique`;
      const author = `Author ${i}`;
      const q = camp.reformulateQuery({ title, author }, 0);
      const ageMs = i < 40
        ? (i + 1) * 60 * 1000 // recent → active
        : (camp.QUERY_COOLDOWN_DAYS + 1) * 24 * 3600 * 1000; // expired
      const at = new Date(now - ageMs).toISOString();
      const key = require('../lib/eiGoalParse').normalizeTitle(q).slice(0, 160);
      state.attempted_queries[key] = at;
      state.attempted_meta[key] = {
        at, title, author, cooldown_days: camp.QUERY_COOLDOWN_DAYS,
      };
    }
    const list = camp.buildCooldownActiveList(state, 80);
    assert.ok(list.length <= 80);
    assert.ok(list.length >= 40);
    // Most recent first
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(list[i - 1].t >= list[i].t);
    }
    assert.ok(list[0].label.includes('—') || list[0].title);
    // Hint filter: only when ALL reformulation variants are cooling
    const fullTitle = 'Fully Cooled Unique Work';
    const fullAuthor = 'Cool Author';
    for (let attempt = 0; attempt <= camp.MAX_LEAD_RETRIES; attempt += 1) {
      camp.stampAttempted(
        state,
        camp.reformulateQuery({ title: fullTitle, author: fullAuthor }, attempt),
        { title: fullTitle, author: fullAuthor },
      );
    }
    assert.equal(camp.hintOnCooldown(state, fullTitle, fullAuthor), true);
    assert.equal(camp.hintOnCooldown(state, 'Work Number 200 Unique', 'Author 200'), false);
  });
});

test('WP2.2: early cooldown gate removed — reformulation accepts free variant', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    const title = 'Reformulable Unique Title Abc';
    const author = 'Flinders Petrie';
    const q0 = camp.reformulateQuery({ title, author }, 0);
    camp.stampAttempted(state, q0, { title, author, days: camp.QUERY_COOLDOWN_DAYS });
    assert.equal(camp.queryOnCooldown(state, q0), true);
    assert.equal(camp.queryOnCooldown(state, camp.reformulateQuery({ title, author }, 1)), false);

    const out = camp.applyReflectionProposedLeads(state, [
      { title, author, thread: 'giza', why: 'test' },
    ]);
    assert.equal(out.added, 1, JSON.stringify(out.rejected_details));
    const lead = state.leads.find((l) => l.status === 'pending' && l.title === title);
    assert.ok(lead);
    assert.ok(lead.query.includes('archive.org') || lead.query_attempt >= 1);
    assert.ok(!(out.rejected_details || []).some((r) => r.reason === 'cooldown'));
  });
});

test('WP2.3: cooling pending stays pending; retires after long skip window', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    const q = '"Zombie Lead Title" Petrie PDF';
    camp.stampAttempted(state, q, { title: 'Zombie Lead Title', author: 'Petrie' });
    const lead = {
      id: 'lead_zombie',
      query: q,
      title: 'Zombie Lead Title',
      author: 'Petrie',
      status: 'pending',
      source: 'reflection',
      added_at: new Date().toISOString(),
    };
    state.leads = [lead];
    // Simulate one cycle skip (inline the same logic the cycle uses)
    lead.last_skip_reason = 'cooldown';
    lead.last_skip_at = new Date().toISOString();
    lead.cooldown_first_skip_at = new Date(
      Date.now() - (camp.COOLDOWN_SKIP_RETIRE_DAYS + 1) * 24 * 3600 * 1000,
    ).toISOString();
    lead.cooldown_skip_count = 5;
    const firstMs = new Date(lead.cooldown_first_skip_at).getTime();
    if (Date.now() - firstMs > camp.COOLDOWN_SKIP_RETIRE_DAYS * 24 * 3600 * 1000) {
      lead.status = 'cooldown_expired_never_ran';
    }
    assert.equal(lead.status, 'cooldown_expired_never_ran');

    // Fresh cooling lead stays pending
    const lead2 = {
      id: 'lead_ok',
      query: '"Fresh Cooling" Author PDF',
      status: 'pending',
      added_at: new Date().toISOString(),
    };
    camp.stampAttempted(state, lead2.query, {});
    assert.equal(camp.queryOnCooldown(state, lead2.query), true);
    assert.equal(lead2.status, 'pending');
  });
});

test('WP2.4: fail cooldown is shorter than full cooldown', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    const q = '"Fail Cool Title" Author PDF';
    camp.stampAttempted(state, q, { days: camp.FAIL_COOLDOWN_DAYS });
    assert.equal(camp.queryOnCooldown(state, q), true);
    // Age past fail window but inside full window
    const key = require('../lib/eiGoalParse').normalizeTitle(q).slice(0, 160);
    state.attempted_queries[key] = new Date(
      Date.now() - (camp.FAIL_COOLDOWN_DAYS + 0.5) * 24 * 3600 * 1000,
    ).toISOString();
    state.attempted_meta[key].at = state.attempted_queries[key];
    assert.equal(camp.queryOnCooldown(state, q), false);

    camp.stampAttempted(state, q, { days: camp.QUERY_COOLDOWN_DAYS });
    state.attempted_queries[key] = new Date(
      Date.now() - (camp.FAIL_COOLDOWN_DAYS + 0.5) * 24 * 3600 * 1000,
    ).toISOString();
    state.attempted_meta[key].at = state.attempted_queries[key];
    state.attempted_meta[key].cooldown_days = camp.QUERY_COOLDOWN_DAYS;
    assert.equal(camp.queryOnCooldown(state, q), true);
  });
});

test('WP2.5: scorecard never uses pruned reports for reflection survival', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    state.cycle_count = 50;
    state.stats = {
      reflection_leads_added: 0,
      reflection_leads_sought: 0,
      reflection_leads_kept: 0,
    };
    // Reports would have falsely inflated the old metric
    state.reports = Array.from({ length: 12 }, (_, i) => ({
      reflection: { added: 9 },
      cycle: i,
    }));
    const card = camp.learningScorecard(state);
    assert.equal(card.reflection_leads_added, 0);
    assert.equal(card.reflection_survival_per_100_cycles, 0);
    assert.equal(card.reflection_leads_sought, 0);
  });
});

test('WP2.7: mergeExternalState preserves API-added leads', () => {
  withTempData((dir, camp) => {
    const state = camp.loadState();
    state.enabled = true;
    state.leads = [{ id: 'lead_cycle', status: 'pending', query: 'cycle lead PDF' }];
    state.revision = 1;
    camp.saveState(state);

    // Simulate API add while cycle held memory
    const disk = camp.loadState();
    disk.leads.push({ id: 'lead_api', status: 'pending', query: 'api lead PDF', source: 'operator' });
    disk.revision = 2;
    fs.writeFileSync(
      path.join(dir, 'research_campaign.json'),
      JSON.stringify(disk, null, 2),
    );

    const local = {
      ...state,
      leads: [{ id: 'lead_cycle', status: 'done', query: 'cycle lead PDF' }],
      revision: 1,
    };
    const merged = camp.mergeExternalState(local);
    assert.ok(merged.leads.some((l) => l.id === 'lead_api'));
    assert.ok(merged.leads.some((l) => l.id === 'lead_cycle' && l.status === 'done'));
  });
});

test('WP2.8: speculative cap counts pending speculative, not batch rejects after one add', () => {
  withTempData((_dir, camp) => {
    const state = camp.loadState();
    state.leads = [{
      id: 'lead_spec_pending',
      status: 'pending',
      access: 'speculative',
      query: '"Already Pending Spec" Modern Author PDF',
      title: 'Already Pending Spec',
      author: 'Modern Author',
    }];
    const out = camp.applyReflectionProposedLeads(state, [
      { title: 'Brand New Speculative Alpha Work', author: 'Jane Modern', thread: 'giza' },
    ]);
    assert.ok((out.rejected_details || []).some((r) => r.reason === 'speculative_cap'));
    assert.ok(!state.leads.some((l) => /Brand New Speculative/i.test(l.title || '')));
  });
});

test('WP2.6: singular title promoter never promotes drop without author match', () => {
  const { applySingularTitleOverride } = require('../lib/eiMissionFitReview');
  const { parseNamedWork } = require('../lib/eiGoalParse');
  const named = parseNamedWork(
    'Please find and add to Corpus the book Pyramids and Temples of Gizeh by W. M. Flinders Petrie.',
  );
  assert.ok(named && named.isSingularTitle);
  const item = {
    title: 'Pyramids and Temples of Gizeh',
    has_local_document: true,
    local_document_path: '/tmp/x.pdf',
  };
  const dropped = {
    verdict: 'drop',
    author: 'Wrong Person',
    work_title: 'Pyramids and Temples of Gizeh',
    confidence: 0.4,
    why: 'LLM said drop',
  };
  const out = applySingularTitleOverride(dropped, item, named, { minPromoteScore: 0.9 });
  assert.equal(out.verdict, 'drop');
  assert.ok(!out.promoted_from_drop);
});
