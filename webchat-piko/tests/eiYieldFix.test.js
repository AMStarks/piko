const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeThreadId,
  migrateCampaignState,
  orderLeads,
  pickSeekBatches,
  seedDeadThreads,
  addLead,
  sanitizeLead,
} = require('../lib/eiResearchCampaign');

test('normalizeThreadId: pipes, unknown, valid', () => {
  assert.equal(normalizeThreadId('atlantis|cataclysm|flood-myths'), 'atlantis');
  assert.equal(normalizeThreadId('giza|abydos'), 'giza');
  assert.equal(normalizeThreadId('GIZA'), 'giza');
  assert.equal(normalizeThreadId('not-a-thread'), 'other');
  assert.equal(normalizeThreadId(''), 'other');
  assert.equal(normalizeThreadId('cataclysm'), 'cataclysm');
});

test('migrateCampaignState merges pipe keys and tags untagged leads', () => {
  const state = {
    thread_coverage: {
      giza: { keeps: 4, seeks: 10 },
      'atlantis|cataclysm|flood-myths': { keeps: 1, seeks: 1 },
      'giza|abydos': { keeps: 0, seeks: 2 },
    },
    leads: [
      {
        id: 'a', status: 'pending', query: '"Some Modern Book" Doe PDF',
        title: 'Some Modern Book', author: 'Jane Doe', thread: 'giza|abydos',
      },
      {
        id: 'b', status: 'pending', query: '"Atlantis" Donnelly PDF',
        title: 'Atlantis', author: 'Ignatius Donnelly', thread: 'atlantis',
        access: 'seeded',
      },
    ],
    attempted_queries: {},
  };
  migrateCampaignState(state);
  assert.equal(state.thread_coverage['atlantis|cataclysm|flood-myths'], undefined);
  assert.equal(state.thread_coverage['giza|abydos'], undefined);
  assert.equal(state.thread_coverage.atlantis.keeps, 1);
  assert.equal(state.thread_coverage.giza.seeks, 12); // 10+2
  assert.equal(state.leads[0].thread, 'giza');
  assert.ok(state.leads[0].access); // backfilled
  assert.equal(state.leads[1].access, 'seeded');
});

test('migrateCampaignState reattributes other keeps from matching notes', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-reattr-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const notesPath = require.resolve('../lib/eiCorpusNotes');
  const bibPath = require.resolve('../lib/eiBibliography');
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  for (const p of [campaignPath, notesPath, bibPath, corpusPath]) delete require.cache[p];
  try {
    const campaign = require('../lib/eiResearchCampaign');
    const { notePath } = require('../lib/eiCorpusNotes');
    fs.mkdirSync(path.dirname(notePath(9001)), { recursive: true });
    fs.writeFileSync(notePath(9001), JSON.stringify({
      harvest_id: 9001,
      title: 'The Pyramids and Temples of Gizeh',
      author: 'W. M. Flinders Petrie',
      summary: 'Survey of the Great Pyramid at Giza.',
      sites: ['Giza'],
      updated_at: new Date().toISOString(),
    }));
    const state = campaign.loadState();
    state.thread_coverage = {
      other: { keeps: 3, seeks: 5 },
      giza: { keeps: 1, seeks: 2 },
    };
    campaign.migrateCampaignState(state);
    assert.equal(state.thread_coverage.other.keeps, 2);
    assert.equal(state.thread_coverage.giza.keeps, 2);
    assert.ok(state.reattributed_harvest_ids.includes(9001));
    // Second migrate must not double-move
    campaign.migrateCampaignState(state);
    assert.equal(state.thread_coverage.other.keeps, 2);
    assert.equal(state.thread_coverage.giza.keeps, 2);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const p of [campaignPath, notesPath, bibPath, corpusPath]) delete require.cache[p];
  }
});

test('paginateCorpusItems walks offsets beyond first page', () => {
  const { paginateCorpusItems } = require('../lib/eiCorpusNotes');
  const calls = [];
  const listFn = (opts) => {
    calls.push(opts.offset);
    if (opts.offset === 0) {
      return { items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) };
    }
    if (opts.offset === 100) {
      return { items: Array.from({ length: 20 }, (_, i) => ({ id: 101 + i })) };
    }
    return { items: [] };
  };
  const items = paginateCorpusItems(listFn, { page: 100 });
  assert.equal(items.length, 120);
  assert.deepEqual(calls, [0, 100]);
});

test('orderLeads: seeded after speculative still picked first; operator outranks', () => {
  const speculative = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`, source: 'reflection', access: 'speculative',
    added_at: `2026-07-31T0${i}:00:00.000Z`, query: `q${i}`,
  }));
  const seeded = {
    id: 'seed1', source: 'reflection', access: 'seeded',
    added_at: '2026-07-31T12:00:00.000Z', query: 'seeded',
  };
  const operator = {
    id: 'op1', source: 'operator', access: 'speculative',
    added_at: '2026-07-31T13:00:00.000Z', query: 'op',
  };
  const ordered = orderLeads([...speculative, seeded, operator]);
  assert.equal(ordered[0].id, 'op1');
  assert.equal(ordered[1].id, 'seed1');
  assert.equal(ordered[2].access, 'speculative');
});

test('pickSeekBatches: 2 normal + up to 2 seeded-extra', () => {
  const pending = [
    { id: 'a', access: 'speculative', source: 'reflection', added_at: '2026-07-31T01:00:00Z' },
    { id: 'b', access: 'speculative', source: 'reflection', added_at: '2026-07-31T02:00:00Z' },
    { id: 'c', access: 'seeded', source: 'thread_seed', added_at: '2026-07-31T03:00:00Z' },
    { id: 'd', access: 'seeded', source: 'reflection', added_at: '2026-07-31T04:00:00Z' },
    { id: 'e', access: 'seeded', source: 'reflection', added_at: '2026-07-31T05:00:00Z' },
    { id: 'f', access: 'seeded', source: 'reflection', added_at: '2026-07-31T06:00:00Z' },
  ];
  // thread_seed (c) + seeded (d) fill the normal batch of 2; e+f are seeded-extra
  const { batch, seededExtraLeads } = pickSeekBatches(pending, 2, 2);
  assert.equal(batch.length, 2);
  assert.ok(batch.some((l) => l.id === 'c'));
  assert.equal(seededExtraLeads.length, 2);
  assert.ok(seededExtraLeads.every((l) => l.access === 'seeded'));
  assert.ok(!seededExtraLeads.some((l) => batch.find((b) => b.id === l.id)));
});

test('sanitizeLead builds query for thread_seed title+author', () => {
  const r = sanitizeLead({
    title: 'Abydos',
    author: 'W. M. Flinders Petrie',
    thread: 'abydos',
    source: 'thread_seed',
  });
  assert.equal(r.ok, true);
  assert.match(r.lead.query, /Abydos/);
  assert.equal(r.lead.thread, 'abydos');
});

test('seedDeadThreads adds for cataclysm; second call no-ops; giza skipped', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-yield-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/culturesCorpusApi|eiSeedPack|eiResearchCampaign/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    const state = {
      leads: [],
      attempted_queries: {},
      thread_coverage: {
        cataclysm: { keeps: 0, seeks: 13 },
        giza: { keeps: 4, seeks: 15 },
        abydos: { keeps: 0, seeks: 1 },
      },
    };
    const n1 = camp.seedDeadThreads(state);
    assert.ok(n1 >= 1, `expected ≥1 dead-thread seed, got ${n1}`);
    const catLeads = state.leads.filter((l) => l.thread === 'cataclysm' && l.source === 'thread_seed');
    assert.ok(catLeads.length >= 1);
    assert.ok(catLeads.every((l) => l.access === 'seeded'));
    const n2 = camp.seedDeadThreads(state);
    assert.equal(n2, 0, 'second call should no-op when pending seeded exists');
    const gizaSeeds = state.leads.filter((l) => l.thread === 'giza' && l.source === 'thread_seed');
    assert.equal(gizaSeeds.length, 0);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('seedDeadThreads retargets mis-threaded pending seed to dead thread', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-yield-retarget-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/culturesCorpusApi|eiSeedPack|eiResearchCampaign/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    const state = {
      leads: [{
        id: 'x', status: 'pending', access: 'seeded', source: 'reflection',
        thread: 'other',
        title: 'Channeled Scabland',
        author: 'J Harlen Bretz',
        query: '"Channeled Scabland" Bretz PDF',
        added_at: '2026-07-31T01:00:00Z',
      }],
      attempted_queries: {},
      thread_coverage: { cataclysm: { keeps: 0, seeks: 13 }, giza: { keeps: 2, seeks: 5 } },
    };
    const n = camp.seedDeadThreads(state);
    assert.ok(n >= 1);
    const bretz = state.leads.find((l) => /Scabland/i.test(l.title || ''));
    assert.equal(bretz.thread, 'cataclysm');
    assert.equal(bretz.source, 'thread_seed');
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('clearRunningLockAtBoot clears stale lock; no-ops without state file', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-lock-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/culturesCorpusApi|eiResearchCampaign/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    // No state file yet — must not create one.
    assert.deepEqual(camp.clearRunningLockAtBoot(), { cleared: false });
    assert.equal(fs.existsSync(path.join(dir, 'research_campaign.json')), false);
    // Stale lock from an interrupted cycle — must clear.
    camp.saveState({
      ...camp.loadState(),
      enabled: true,
      running: true,
      running_since: new Date().toISOString(),
    });
    assert.deepEqual(camp.clearRunningLockAtBoot(), { cleared: true });
    const after = camp.loadState();
    assert.equal(after.running, false);
    assert.equal(after.running_since, null);
    // Idempotent.
    assert.deepEqual(camp.clearRunningLockAtBoot(), { cleared: false });
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('normalizePlan drops non-numeric harvest_id steps', () => {
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  const prev = require.cache[corpusPath];
  require.cache[corpusPath] = {
    id: corpusPath,
    filename: corpusPath,
    loaded: true,
    exports: {
      getItem: (hid) => (Number(hid) === 107
        ? { ok: true, item: { id: 107, title: 'Fingerprints' } }
        : { ok: false, error: 'not_found' }),
    },
  };
  delete require.cache[require.resolve('../lib/eiWorkPlanner')];
  try {
    const { normalizePlan } = require('../lib/eiWorkPlanner');
    const bad = normalizePlan({
      summary: 'expand',
      steps: [
        { tool: 'expand_from_item', args: { harvest_id: 'FINGERPRINTS OF THE GODS' }, why: 'bad' },
        { tool: 'expand_from_item', args: { harvest_id: 107 }, why: 'good' },
        { tool: 'digest_item', args: { harvest_id: 'https://archive.org/x' }, why: 'bad2' },
      ],
    }, 'expand from Fingerprints');
    assert.equal(bad.ok, true);
    assert.equal(bad.steps.length, 1);
    assert.equal(bad.steps[0].args.harvest_id, 107);
    assert.ok(bad.dropped_steps && bad.dropped_steps.length >= 2);
    assert.match(bad.summary, /dropped/);
  } finally {
    if (prev) require.cache[corpusPath] = prev;
    else delete require.cache[corpusPath];
    delete require.cache[require.resolve('../lib/eiWorkPlanner')];
  }
});

test('planWorkRules keep-researching passes topic; research_campaign queues leads', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-yield-rc-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|eiWorkPlanner|culturesCorpusApi/.test(key)) delete require.cache[key];
  }
  try {
    const { planWorkRules } = require('../lib/eiWorkPlanner');
    const plan = planWorkRules('Keep researching Younger Dryas megaflood geology');
    assert.equal(plan.steps[0].tool, 'research_campaign');
    assert.equal(plan.steps[0].args.action, 'start');
    assert.match(plan.steps[0].args.topic || '', /Younger Dryas/i);

    // Isolate campaign state file under temp data dir
    const camp = require('../lib/eiResearchCampaign');
    const statePath = require('path').join(dir, 'research_campaign.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      enabled: false, paused: false, topic: 'baseline topic', leads: [],
      attempted_queries: {}, thread_coverage: {}, stats: {},
    }));
    // culturesDataRoot uses EGYPTIAN_INSIGHTS_DATA_DIR — statePath in campaign is culturesDataRoot/research_campaign.json
    const beforeTopic = camp.loadState().topic;
    const { TOOLS } = require('../lib/eiAgentTools');
    const out = await TOOLS.research_campaign.run({
      action: 'start',
      topic: 'Keep researching Younger Dryas megaflood geology',
    }, { goal: 'Keep researching Younger Dryas megaflood geology' });
    assert.equal(out.ok, true);
    const after = camp.loadState();
    // Topic must NOT be overwritten (no "focus only on")
    assert.equal(after.topic, beforeTopic || after.topic);
    assert.ok((out.result && out.result.operator_leads_added) >= 0);
    assert.ok(after.leads.some((l) => l.source === 'operator' || l.status === 'pending'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});
