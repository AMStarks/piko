const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-compound-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  delete require.cache[require.resolve('../lib/eiResearchCampaign')];
  delete require.cache[require.resolve('../lib/eiBibliography')];
  delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  try {
    return await fn(dir, require('../lib/eiResearchCampaign'), require('../lib/eiBibliography'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/eiResearchCampaign')];
    delete require.cache[require.resolve('../lib/eiBibliography')];
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  }
}

test('mineBibliographyLeads: queued without terminal → lead; keep/drop skipped; cap respected', async () => {
  await withTempData((dir, camp, biblio) => {
    const edgesPath = path.join(dir, 'bibliography_edges.jsonl');
    const lines = [
      { from_id: 1, candidate_author: 'Flinders Petrie', candidate_title: 'Abydos Part I', outcome: 'queued', why: 'cited' },
      { from_id: 1, candidate_author: 'Ignatius Donnelly', candidate_title: 'Atlantis Antediluvian', outcome: 'queued', why: 'cited' },
      { from_id: 1, candidate_author: 'Ignatius Donnelly', candidate_title: 'Atlantis Antediluvian', outcome: 'keep', keep_ids: [9] },
      { from_id: 2, candidate_author: 'J Bretz', candidate_title: 'Channeled Scabland', outcome: 'queued', why: 'cited' },
      { from_id: 2, candidate_author: 'J Bretz', candidate_title: 'Channeled Scabland', outcome: 'drop' },
      { from_id: 3, candidate_author: 'Klaus Schmidt', candidate_title: 'Göbekli Tepe', outcome: 'queued', why: 'open' },
      { from_id: 4, candidate_author: 'Charles Hapgood', candidate_title: 'Maps of the Ancient Sea Kings', outcome: 'seek_failed' },
      { from_id: 5, candidate_author: 'Extra One', candidate_title: 'Should Hit Cap A', outcome: 'queued' },
      { from_id: 5, candidate_author: 'Extra Two', candidate_title: 'Should Hit Cap B', outcome: 'queued' },
    ];
    fs.writeFileSync(edgesPath, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const state = camp.loadState();
    const added = camp.mineBibliographyLeads(state, 3);
    assert.equal(added, 3);
    const pending = state.leads.filter((l) => l.status === 'pending');
    assert.equal(pending.length, 3);
    assert.ok(pending.every((l) => l.source === 'bibliography'));
    const titles = pending.map((l) => l.title);
    assert.ok(titles.includes('Abydos Part I'));
    assert.ok(titles.includes('Göbekli Tepe') || titles.includes('Maps of the Ancient Sea Kings'));
    assert.ok(!titles.includes('Atlantis Antediluvian'));
    assert.ok(!titles.includes('Channeled Scabland'));
  });
});

test('cooldown aging + reformulateQuery alternates', async () => {
  await withTempData((dir, camp) => {
    const state = camp.loadState();
    const title = 'Sacred Science';
    const author = 'R. A. Schwaller de Lubicz';
    const q0 = camp.reformulateQuery({ title, author }, 0);
    const q1 = camp.reformulateQuery({ title, author }, 1);
    const q2 = camp.reformulateQuery({ title, author }, 2);
    assert.ok(q0.includes('PDF'));
    assert.ok(q1.includes('archive.org'));
    assert.ok(q2.includes('full text'));
    assert.notEqual(q0, q1);
    assert.notEqual(q1, q2);

    const { normalizeTitle } = require('../lib/eiGoalParse');
    state.attempted_queries[normalizeTitle(q0).slice(0, 160)] = new Date().toISOString();
    assert.equal(camp.queryOnCooldown(state, q0), true);
    assert.equal(camp.addLead(state, { title, author, source: 'reflection', why: 'retry' }), true);
    const added = state.leads[state.leads.length - 1];
    assert.ok(added.query.includes('archive.org') || added.retry_count >= 1);

    // Aged attempt is re-addable with original form
    const old = new Date(Date.now() - (camp.QUERY_COOLDOWN_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    const state2 = camp.loadState();
    state2.leads = [];
    state2.attempted_queries = { [normalizeTitle(q0).slice(0, 160)]: old };
    assert.equal(camp.queryOnCooldown(state2, q0), false);
    assert.equal(camp.addLead(state2, {
      title: 'Another Work', author: 'Flinders Petrie', query: q0, source: 'operator',
    }), true);
  });
});

test('idle streak ≥3 backs off dueForCycle; run_now / resetIdleStreak clears', async () => {
  await withTempData((dir, camp) => {
    const state = camp.loadState();
    state.enabled = true;
    state.paused = false;
    state.interval_minutes = 1;
    state.last_cycle_at = new Date().toISOString();
    state.idle_streak = 0;
    camp.saveState(state);
    assert.equal(camp.dueForCycle(), false);

    state.idle_streak = 3;
    state.last_cycle_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    camp.saveState(state);
    // With idle backoff (30m default), 2 minutes is not enough
    assert.equal(camp.dueForCycle(), false);
    assert.equal(camp.summarize().mode, 'idle (backing off)');
    assert.equal(camp.effectiveIntervalMinutes(), camp.IDLE_BACKOFF_MIN);

    state.last_cycle_at = new Date(Date.now() - (camp.IDLE_BACKOFF_MIN + 1) * 60 * 1000).toISOString();
    camp.saveState(state);
    assert.equal(camp.dueForCycle(), true);

    camp.resetIdleStreak();
    assert.equal(camp.loadState().idle_streak, 0);
    assert.equal(camp.summarize().mode, 'active');
  });
});

test('resetStaleRunningLeads restores pending and bumps retry', async () => {
  await withTempData((dir, camp) => {
    const state = camp.loadState();
    state.leads = [{
      id: 'lead_orion',
      status: 'running',
      query: '"The Orion Mystery" Bauval PDF',
      title: 'The Orion Mystery',
      author: 'Robert Bauval',
      thread: 'giza',
      source: 'operator',
      retry_count: 0,
      last_attempt_at: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
      added_at: new Date().toISOString(),
    }];
    const n = camp.resetStaleRunningLeads(state);
    assert.equal(n, 1);
    assert.equal(state.leads[0].status, 'pending');
    assert.equal(state.leads[0].retry_count, 1);
    assert.ok(state.leads[0].query.includes('archive.org'));
  });
});

test('cycle log + last24hStats aggregates', async () => {
  await withTempData((dir, camp) => {
    const now = new Date().toISOString();
    camp.appendCycleLog({
      ts: now, cycle: 1, seeks: 2, keeps: 1, unsures: 0,
      leads_added: 3, source_breakdown: { bibliography: 2 }, idle_streak: 0, duration_ms: 1000, error: null,
    });
    camp.appendCycleLog({
      ts: now, cycle: 2, seeks: 0, keeps: 0, unsures: 0,
      leads_added: 0, source_breakdown: {}, idle_streak: 1, duration_ms: 500, error: null,
    });
    const h = camp.last24hStats();
    assert.equal(h.cycles, 2);
    assert.equal(h.seeks, 2);
    assert.equal(h.keeps, 1);
    assert.equal(h.leads_added, 3);
    assert.equal(h.idle_pct, 50);
    assert.ok(fs.existsSync(camp.cycleLogPath()));
    const summary = camp.summarize();
    assert.equal(summary.last_24h.cycles, 2);
  });
});

test('migrateCampaignState prunes old attempted_queries', async () => {
  await withTempData((dir, camp) => {
    const state = camp.loadState();
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    const recent = new Date().toISOString();
    state.attempted_queries = { oldq: old, newq: recent };
    camp.migrateCampaignState(state);
    assert.equal(state.attempted_queries.oldq, undefined);
    assert.equal(state.attempted_queries.newq, recent);
    assert.equal(state.idle_streak, 0);
  });
});

test('queued-only bibliography edge is mined into a campaign lead', async () => {
  await withTempData(async (dir, camp, biblio) => {
    const edgesPath = path.join(dir, 'bibliography_edges.jsonl');
    fs.writeFileSync(edgesPath, `${JSON.stringify({
      from_id: 10, candidate_author: 'Arthur Posnansky', candidate_title: 'Tihuanacu',
      outcome: 'queued', why: 'queueOnly',
    })}\n`);
    const state = camp.loadState();
    assert.equal(camp.mineBibliographyLeads(state, 1), 1);
    assert.equal(state.leads[0].source, 'bibliography');
    assert.equal(state.leads[0].title, 'Tihuanacu');
    assert.ok(biblio.loadEdges().length >= 1);
  });
});
