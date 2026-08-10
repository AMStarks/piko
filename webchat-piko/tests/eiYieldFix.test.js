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

test('reattributeOtherCoverageFromNotes is retired no-op', () => {
  const campaign = require('../lib/eiResearchCampaign');
  const state = {
    thread_coverage: { other: { keeps: 3, seeks: 5 }, giza: { keeps: 1, seeks: 2 } },
  };
  assert.equal(campaign.reattributeOtherCoverageFromNotes(state), 0);
  assert.equal(state.thread_coverage.other.keeps, 3);
  assert.equal(state.thread_coverage.giza.keeps, 1);
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

test('spine seek: dead floor <3, supporting gated, self-view outranks giza', () => {
  const {
    orderLeads: order,
    pickSeekBatches: pick,
    threadIsDead,
    allowSupportingLead,
    DEAD_THREAD_KEEP_FLOOR,
  } = require('../lib/eiResearchCampaign');
  assert.equal(DEAD_THREAD_KEEP_FLOOR, 3);
  assert.equal(threadIsDead({ thread_coverage: { 'self-view': { keeps: 2 } } }, 'self-view'), true);
  assert.equal(threadIsDead({ thread_coverage: { 'self-view': { keeps: 3 } } }, 'self-view'), false);
  const thin = { thread_coverage: { 'self-view': { keeps: 2 } }, cycle_count: 8 };
  assert.equal(allowSupportingLead(thin, { thread: 'tiahuanaco' }), false);
  assert.equal(allowSupportingLead(thin, { thread: 'self-view' }), true);
  const ready = { thread_coverage: { 'self-view': { keeps: 12 } }, cycle_count: 8 };
  assert.equal(allowSupportingLead(ready, { thread: 'tiahuanaco' }), true);
  const offCycle = { thread_coverage: { 'self-view': { keeps: 12 } }, cycle_count: 9 };
  assert.equal(allowSupportingLead(offCycle, { thread: 'tiahuanaco' }), false);

  const ordered = order([
    { id: 'g', source: 'thread_seed', access: 'seeded', thread: 'giza', added_at: '2026-08-10T01:00:00Z' },
    { id: 'sv', source: 'thread_seed', access: 'seeded', thread: 'self-view', added_at: '2026-08-10T02:00:00Z' },
    { id: 't', source: 'thread_seed', access: 'seeded', thread: 'tiahuanaco', added_at: '2026-08-10T00:00:00Z' },
  ]);
  assert.equal(ordered[0].id, 'sv');
  assert.equal(ordered[1].id, 'g');

  const picked = pick([
    { id: 't', source: 'catalog', access: 'seeded', thread: 'tiahuanaco', added_at: '2026-08-10T00:00:00Z' },
    { id: 'sv', source: 'thread_seed', access: 'seeded', thread: 'self-view', added_at: '2026-08-10T01:00:00Z' },
  ], 2, 0, thin);
  assert.deepEqual(picked.batch.map((l) => l.id), ['sv']);
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

test('orderLeads: Phase D — PD bib outranks speculative; speculative bib demoted', () => {
  const {
    orderLeads: order,
    PRIORITY_SOURCES,
    BIB_LEADS_PER_CYCLE,
  } = require('../lib/eiResearchCampaign');
  assert.ok(!PRIORITY_SOURCES.has('bibliography')); // bib ranked by access now
  assert.ok(BIB_LEADS_PER_CYCLE >= 5);
  const ordered = order([
    { id: 'r1', source: 'reflection', access: 'speculative', added_at: '2026-08-05T01:00:00Z' },
    { id: 'b_spec', source: 'bibliography', access: 'speculative', added_at: '2026-08-05T02:00:00Z' },
    { id: 'b_pd', source: 'bibliography', access: 'public_domain_likely', added_at: '2026-08-05T02:30:00Z' },
    { id: 's1', source: 'reflection', access: 'seeded', added_at: '2026-08-05T03:00:00Z' },
  ]);
  assert.equal(ordered[0].id, 'b_pd');
  assert.equal(ordered[1].id, 's1');
  assert.equal(ordered[2].id, 'r1');
  assert.equal(ordered[3].id, 'b_spec');
});

test('chaseFallbackForLead: topbib keep short-circuits; tla unused', async () => {
  const { chaseFallbackForLead, judgmentsFromChaseTool } = require('../lib/eiResearchCampaign');
  const calls = [];
  const runTool = async (tool, args) => {
    calls.push(tool);
    if (tool === 'chase_topbib') {
      return {
        ok: true,
        result: {
          chased: [{
            pointer: 'Abydos',
            kept: 1,
            mission_fit: {
              judgments: [{ harvest_id: 42, verdict: 'keep', purged: false }],
            },
          }],
        },
      };
    }
    return { ok: true, result: { chased: [] } };
  };
  const out = await chaseFallbackForLead(
    { title: 'Abydos', author: 'Petrie', query: '"Abydos" Petrie PDF', mission: 'find Abydos by Petrie' },
    runTool,
    {},
  );
  assert.deepEqual(calls, ['chase_topbib']);
  assert.equal(out.via, 'chase_topbib');
  assert.equal(out.keeps.length, 1);
  assert.equal(out.keeps[0].harvest_id, 42);

  const flat = judgmentsFromChaseTool({
    result: {
      chased: [
        { mission_fit: { judgments: [{ harvest_id: 1, verdict: 'keep' }, { harvest_id: 2, verdict: 'unsure' }] } },
        { mission_fit: { judgments: [{ harvest_id: 3, verdict: 'drop' }, { harvest_id: 4, verdict: 'keep', purged: true }] } },
      ],
    },
  });
  assert.equal(flat.keeps.length, 1);
  assert.equal(flat.unsures.length, 1);
});

test('chaseFallbackForLead: falls through to chase_tla when topbib empty', async () => {
  const { chaseFallbackForLead } = require('../lib/eiResearchCampaign');
  const calls = [];
  const runTool = async (tool) => {
    calls.push(tool);
    if (tool === 'chase_tla') {
      return {
        ok: true,
        result: {
          chased: [{
            mission_fit: {
              judgments: [{ harvest_id: 9, verdict: 'unsure' }],
            },
          }],
        },
      };
    }
    return { ok: true, result: { chased: [] } };
  };
  const out = await chaseFallbackForLead({ query: 'Pyramid Texts' }, runTool, {});
  assert.deepEqual(calls, ['chase_topbib', 'chase_tla']);
  assert.equal(out.via, 'chase_tla');
  assert.equal(out.unsures[0].harvest_id, 9);
});

test('A.1 advanceCooledPendingLeads moves cooled query to free variant', () => {
  const {
    advanceCooledPendingLeads,
    reformulateQuery,
    stampAttempted,
    eligiblePendingLeads,
  } = require('../lib/eiResearchCampaign');
  const title = 'Abydos Part I';
  const author = 'Flinders Petrie';
  const q0 = reformulateQuery({ title, author }, 0);
  const q1 = reformulateQuery({ title, author }, 1);
  const state = {
    leads: [{
      id: 'l1', status: 'pending', source: 'bibliography',
      title, author, query: q0, access: 'seeded',
    }],
    attempted_queries: {},
    attempted_meta: {},
  };
  stampAttempted(state, q0, { title, author, days: 7 });
  assert.equal(eligiblePendingLeads(state).length, 1); // free variant exists
  const n = advanceCooledPendingLeads(state);
  assert.equal(n, 1);
  assert.equal(state.leads[0].query, q1);
  assert.equal(state.leads[0].last_skip_reason, 'cooldown_variant_advance');
});

test('A.3 pruneBadPendingLeads drops garbage bib titles', () => {
  const { pruneBadPendingLeads, isGarbageLeadTitle } = require('../lib/eiResearchCampaign');
  assert.equal(isGarbageLeadTitle('(No título específico mencionado)'), true);
  assert.equal(isGarbageLeadTitle('Abydos Part I'), false);
  const state = {
    leads: [
      {
        id: 'g1', status: 'pending', source: 'bibliography',
        title: '(No título específico mencionado)', author: 'Someone', query: 'x',
      },
      {
        id: 'g2', status: 'pending', source: 'bibliography',
        title: 'Real Book', author: '', query: 'Real Book PDF',
      },
      {
        id: 'g3', status: 'pending', source: 'bibliography',
        title: 'Abydos', author: 'Petrie', query: 'Abydos Petrie archive.org', thread: 'abydos',
      },
      {
        id: 'g4', status: 'pending', source: 'bibliography',
        title: 'Muerte del padre Melchor Paez', author: 'Anon',
        query: 'Muerte del padre Melchor Paez PDF', thread: 'giza',
      },
    ],
  };
  const n = pruneBadPendingLeads(state);
  assert.ok(n >= 3);
  assert.equal(state.leads.find((l) => l.id === 'g3').status, 'pending');
  assert.equal(state.leads.find((l) => l.id === 'g1').status, 'pruned_bad');
  assert.equal(state.leads.find((l) => l.id === 'g4').status, 'pruned_bad');
});

test('B preferArchiveDetailsUrls and gapIngestUrlsFromSeekResult', () => {
  const {
    preferArchiveDetailsUrls,
    gapIngestUrlsFromSeekResult,
    reformulateQuery,
  } = require('../lib/eiResearchCampaign');
  const ordered = preferArchiveDetailsUrls([
    'https://example.com/a.pdf',
    'https://archive.org/details/foo',
    'https://archive.org/download/foo/foo.pdf',
  ]);
  assert.equal(ordered[0], 'https://archive.org/details/foo');
  const q0 = reformulateQuery({ title: 'X', author: 'Y' }, 0);
  assert.ok(q0.includes('archive.org'));
  const gaps = gapIngestUrlsFromSeekResult({
    items: [
      {
        title: '[gap] Something',
        source_url: 'https://archive.org/details/gap1',
        meta: { literature_role: 'web_pdf_gap' },
      },
      {
        title: 'Real keep',
        source_url: 'https://example.com/real.pdf',
        meta: {},
      },
    ],
  });
  assert.deepEqual(gaps, ['https://archive.org/details/gap1']);
});

test('C isEgyptologyThread', () => {
  const { isEgyptologyThread } = require('../lib/eiResearchCampaign');
  assert.equal(isEgyptologyThread('giza'), true);
  assert.equal(isEgyptologyThread('abydos'), true);
  assert.equal(isEgyptologyThread('heliopolis'), true);
  assert.equal(isEgyptologyThread('self-view'), true);
  assert.equal(isEgyptologyThread('premodern-reception'), true);
  assert.equal(isEgyptologyThread('cataclysm'), false);
  assert.equal(isEgyptologyThread('other'), false);
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

test('seedDeadThreads adds for premodern-reception; second call no-ops; giza skipped', () => {
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
        'premodern-reception': { keeps: 0, seeks: 13 },
        giza: { keeps: 4, seeks: 15 },
        abydos: { keeps: 0, seeks: 1 },
      },
    };
    const n1 = camp.seedDeadThreads(state);
    assert.ok(n1 >= 1, `expected ≥1 dead-thread seed, got ${n1}`);
    const recLeads = state.leads.filter((l) => l.thread === 'premodern-reception' && l.source === 'thread_seed');
    assert.ok(recLeads.length >= 1);
    assert.ok(recLeads.every((l) => l.access === 'seeded'));
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
        title: 'Manetho',
        author: 'W. G. Waddell',
        query: '"Manetho" Waddell Aegyptiaca PDF',
        added_at: '2026-07-31T01:00:00Z',
      }],
      attempted_queries: {},
      thread_coverage: { 'premodern-reception': { keeps: 0, seeks: 13 }, giza: { keeps: 4, seeks: 5 } },
    };
    const n = camp.seedDeadThreads(state);
    assert.ok(n >= 1);
    const manetho = state.leads.find((l) => /Manetho/i.test(l.title || ''));
    assert.equal(manetho.thread, 'premodern-reception');
    assert.equal(manetho.source, 'thread_seed');
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

test('planWorkRules keep-researching passes topic; research_campaign starts PM', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-yield-rc-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|eiResearchPm|eiWorkPlanner|culturesCorpusApi/.test(key)) delete require.cache[key];
  }
  try {
    const { planWorkRules } = require('../lib/eiWorkPlanner');
    const plan = planWorkRules('Keep researching Younger Dryas megaflood geology');
    assert.equal(plan.steps[0].tool, 'research_campaign');
    assert.equal(plan.steps[0].args.action, 'run_now');
    assert.match(plan.steps[0].args.topic || '', /Younger Dryas/i);

    const camp = require('../lib/eiResearchCampaign');
    const statePath = require('path').join(dir, 'research_campaign.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      enabled: true, paused: false, topic: 'baseline topic', leads: [],
      attempted_queries: {}, thread_coverage: {}, stats: {},
    }));
    const { TOOLS } = require('../lib/eiAgentTools');
    const pm = require('../lib/eiResearchPm');
    process.env.PIKO_RESEARCH_PM_INGEST = '0';
    process.env.PIKO_RESEARCH_PM_DIGEST = '0';
    process.env.PIKO_EI_SEEKER_LLM = '0';
    process.env.PIKO_RESEARCH_PM_CONFIRM_LLM = '0';
    const out = await TOOLS.research_campaign.run({
      action: 'start',
      topic: 'Keep researching Younger Dryas megaflood geology',
    }, { goal: 'Keep researching Younger Dryas megaflood geology' });
    assert.equal(out.ok, true);
    const pmState = pm.loadState();
    assert.equal(pmState.enabled, true);
    assert.equal(pmState.paused, false);
    assert.match(pmState.topic || '', /Younger Dryas/i);
    const after = camp.loadState();
    assert.equal(after.enabled, false);
    assert.equal(after.paused, true);
    assert.equal(camp.dueForCycle(), false);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('Phase D: scoreBibLead boosts PD/Egyptology; junk/speculative score low', () => {
  const { scoreBibLead, BIB_MIN_RANK, isBibJunkTitle } = require('../lib/eiResearchCampaign');
  assert.ok(isBibJunkTitle('Publisher Information'));
  assert.ok(isBibJunkTitle('Editor of Everyman\'s Library'));
  const pd = scoreBibLead({
    title: 'Abydos Part I',
    author: 'Flinders Petrie',
    thread: 'abydos',
    source: 'bibliography',
  });
  const junk = scoreBibLead({
    title: 'Publisher Information',
    author: 'Someone',
    thread: 'other',
    source: 'bibliography',
  });
  const speculative = scoreBibLead({
    title: 'Fresh Speculative Work Alpha',
    author: 'Alice Contemporary',
    thread: 'other',
    source: 'bibliography',
  });
  assert.ok(pd >= BIB_MIN_RANK, `pd=${pd}`);
  assert.ok(junk < BIB_MIN_RANK, `junk=${junk}`);
  assert.ok(speculative < BIB_MIN_RANK, `spec=${speculative}`);
});

test('Phase D: reflection rejects ungrounded speculative; accepts PD', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-phase-d-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|eiSeedPack|culturesCorpusApi/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    const state = camp.loadState();
    const out = camp.applyReflectionProposedLeads(state, [
      { title: 'Fresh Speculative Work Gamma', author: 'Alice Contemporary', thread: 'other', why: 'noise' },
      { title: 'The Pyramids and Temples of Gizeh', author: 'Flinders Petrie', thread: 'other', why: 'PD classic' },
    ]);
    const reasons = (out.rejected_details || []).map((r) => r.reason);
    assert.ok(reasons.includes('not_grounded'), reasons.join(','));
    const pending = state.leads.filter((l) => l.status === 'pending');
    assert.ok(pending.some((l) => /Petrie/i.test(l.author || '') && l.thread === 'giza'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const key of Object.keys(require.cache)) {
      if (/eiResearchCampaign/.test(key)) delete require.cache[key];
    }
  }
});

test('Phase D: rethreadPendingOtherLeads + prune low-rank bib', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-phase-d2-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|culturesCorpusApi/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    const state = camp.loadState();
    state.leads = [
      {
        id: 'l1', status: 'pending', source: 'reflection', access: 'public_domain_likely',
        title: 'The Osireion at Abydos', author: 'Margaret Murray', thread: 'other',
        query: 'Osireion Abydos Murray archive.org',
      },
      {
        id: 'l2', status: 'pending', source: 'bibliography', access: 'speculative',
        title: 'Publisher Information', author: 'Acme Press', thread: 'other',
        query: 'Publisher Information Acme',
      },
      {
        id: 'l3', status: 'pending', source: 'bibliography', access: 'speculative',
        title: 'A Modern Speculative Essay', author: 'Alice Contemporary', thread: 'other',
        query: 'Modern Speculative Essay',
      },
    ];
    const n = camp.rethreadPendingOtherLeads(state);
    assert.ok(n >= 1);
    assert.equal(state.leads[0].thread, 'abydos');
    const pruned = camp.pruneBadPendingLeads(state);
    assert.ok(pruned >= 2);
    assert.equal(state.leads.find((l) => l.id === 'l2').status, 'pruned_bad');
    assert.equal(state.leads.find((l) => l.id === 'l3').status, 'pruned_low_rank');
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('items 1–4: guessThreadFromBlob expands Tiahuanaco / Göbekli / Squier', () => {
  const { guessThreadFromBlob } = require('../lib/eiResearchCampaign');
  assert.equal(guessThreadFromBlob('Heliopolis Kafr Ammar And Shurafa W.M. Flinders Petrie'), 'heliopolis');
  assert.equal(guessThreadFromBlob('The Pyramid Texts Index Samuel A. B. Mercer'), 'self-view');
  assert.equal(guessThreadFromBlob('Die altaegyptischen Pyramidentexte nach den Papierabdrucken Kurt Sethe'), 'self-view');
  assert.equal(guessThreadFromBlob('Die El-Amarna-Tafeln Knudtzon'), 'self-view');
  assert.equal(guessThreadFromBlob('Amarna djvu OCR Knudtzon'), 'self-view');
  assert.equal(guessThreadFromBlob('The pyramids and temples of Gizeh W. M. Flinders Petrie'), 'giza');
  assert.equal(guessThreadFromBlob('Posnansky Tiahuanacu monuments'), 'tiahuanaco');
  // Spanish Posnansky spelling (…acu) must match without author keyword
  assert.equal(guessThreadFromBlob('Tiahuanacu the Cradle of American Man'), 'tiahuanaco');
  assert.equal(guessThreadFromBlob('Squier Peru Incidents of Travel'), 'tiahuanaco');
  assert.equal(guessThreadFromBlob('Klaus Schmidt Gobekli Tepe'), 'gobekli-tepe');
  assert.equal(guessThreadFromBlob('Nevali Cori Neolithic'), 'gobekli-tepe');
});

test('items 1–4: chase demotion gates Egyptology-only every 4th cycle', () => {
  const {
    chaseIsDemoted, shouldChaseForLead, recordChaseAttempt,
  } = require('../lib/eiResearchCampaign');
  const state = {
    cycle_count: 8,
    stats: { chase_attempts: 0, chase_empty: 0, keeps_by_via_chase: 0 },
  };
  assert.equal(chaseIsDemoted(state), false);
  assert.equal(shouldChaseForLead(state, { thread: 'giza', source: 'bibliography' }, 'first'), true);
  assert.equal(shouldChaseForLead(state, { thread: 'tiahuanaco', source: 'reflection' }, 'fallback'), true);

  for (let i = 0; i < 10; i += 1) recordChaseAttempt(state, 0);
  assert.equal(state.stats.chase_attempts, 10);
  assert.equal(chaseIsDemoted(state), true);
  // Demoted + cycle 8 (%4===0): egyptology fallback ok; non-egypt blocked
  assert.equal(shouldChaseForLead(state, { thread: 'giza', source: 'reflection' }, 'fallback'), true);
  assert.equal(shouldChaseForLead(state, { thread: 'tiahuanaco', source: 'reflection' }, 'fallback'), false);
  state.cycle_count = 9;
  assert.equal(shouldChaseForLead(state, { thread: 'giza', source: 'reflection' }, 'fallback'), false);
});

test('items 1–4: seed pack + seedDeadThreads cover heliopolis and premodern-reception', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-dead-andes-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/culturesCorpusApi|eiSeedPack|eiResearchCampaign/.test(key)) delete require.cache[key];
  }
  try {
    const { seedsForThread } = require('../lib/eiSeedPack');
    assert.ok(seedsForThread('premodern-reception').length >= 2);
    assert.ok(seedsForThread('giza').length >= 1);
    const camp = require('../lib/eiResearchCampaign');
    const state = {
      leads: [],
      attempted_queries: {},
      attempted_meta: {},
      thread_coverage: {
        heliopolis: { keeps: 0, seeks: 5 },
        'premodern-reception': { keeps: 0, seeks: 5 },
        giza: { keeps: 10, seeks: 20 },
      },
    };
    const n = camp.seedDeadThreads(state);
    assert.ok(n >= 2, `expected ≥2 seeds, got ${n}`);
    const threads = new Set(state.leads.map((l) => l.thread));
    assert.ok(threads.has('heliopolis'));
    assert.ok(threads.has('premodern-reception'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('items 1–4: injectNoveltyLeads when reflection sterile', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-novelty-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/culturesCorpusApi|eiSeedPack|eiResearchCampaign/.test(key)) delete require.cache[key];
  }
  try {
    const camp = require('../lib/eiResearchCampaign');
    const state = camp.loadState();
    state.leads = [];
    state.thread_coverage = {
      tiahuanaco: { keeps: 0, seeks: 8 },
      'gobekli-tepe': { keeps: 0, seeks: 8 },
    };
    const out = camp.applyReflectionProposedLeads(state, [
      { title: 'Fresh Speculative Work Delta', author: 'Alice Contemporary', thread: 'other', why: 'noise' },
      { title: 'Another Speculative Essay', author: 'Bob Contemporary', thread: 'other', why: 'noise' },
    ]);
    assert.ok((out.novelty_injected || 0) >= 1, JSON.stringify(out));
    assert.ok(state.leads.some((l) => l.source === 'thread_seed' || l.access === 'seeded'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('items 1–4: rethreadOtherHarvestItems patches other→real thread', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-rethread-h-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  for (const p of [campaignPath, corpusPath]) delete require.cache[p];
  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'cultures_cache.sqlite'));
    db.exec(`
      CREATE TABLE harvest_items (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        title TEXT,
        culture TEXT,
        official_text TEXT,
        image_path TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT,
        UNIQUE(source, source_id)
      );
      CREATE TABLE transcriptions (id INTEGER PRIMARY KEY, harvest_id INTEGER);
      CREATE TABLE critiques (id INTEGER PRIMARY KEY, harvest_id INTEGER);
    `);
    db.prepare(`
      INSERT INTO harvest_items (id, source, source_id, source_url, title, culture, meta_json, created_at)
      VALUES (1, 'archive_org', 'posn1', 'https://archive.org/details/posn1',
        'Tiahuanacu the Cradle of American Man', 'andes',
        ?, datetime('now'))
    `).run(JSON.stringify({ thread: 'other', author: 'Arthur Posnansky', work_title: 'Tiahuanacu' }));
    db.prepare(`
      INSERT INTO harvest_items (id, source, source_id, source_url, title, culture, meta_json, created_at)
      VALUES (2, 'archive_org', 'other2', 'https://archive.org/details/other2',
        'Generic Modern Essay', 'misc',
        ?, datetime('now'))
    `).run(JSON.stringify({ thread: 'other', author: 'Someone' }));
    db.close();

    delete require.cache[campaignPath];
    delete require.cache[corpusPath];
    const camp = require('../lib/eiResearchCampaign');
    const api = require('../lib/culturesCorpusApi');
    const state = {
      thread_coverage: { other: { keeps: 2, seeks: 0 }, tiahuanaco: { keeps: 0, seeks: 0 } },
    };
    const out = camp.rethreadOtherHarvestItems(state, { limit: 10 });
    assert.ok(out.patched >= 1, JSON.stringify(out));
    const got = api.getItem(1);
    assert.equal(got.item.meta.thread, 'tiahuanaco');
    // Coverage counters are no longer mutated here — recomputeThreadCoverageKeeps owns them.
    assert.equal(state.thread_coverage.tiahuanaco.keeps, 0);
    assert.equal(state.thread_coverage.other.keeps, 2);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[campaignPath];
    delete require.cache[corpusPath];
  }
});
