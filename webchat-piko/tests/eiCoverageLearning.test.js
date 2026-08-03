const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('buildSeekQueryPack builds author+topic queries and denylist', () => {
  const { buildSeekQueryPack, isSummaryMillUrl } = require('../lib/eiSeekQueryPack');
  const pack = buildSeekQueryPack('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  assert.equal(pack.named.isAuthorWorks, true);
  assert.match(pack.named.author || '', /Schoch/);
  assert.ok(pack.queries.length >= 2);
  assert.ok(pack.denylist_hosts.some((h) => /bookey/i.test(h)));
  assert.equal(isSummaryMillUrl('https://cdn.bookey.app/foo.pdf'), true);
  assert.equal(isSummaryMillUrl('https://archive.org/details/x'), false);
});

test('buildSeekQueryPack encodes seeds for Dunn singular ask', () => {
  const { buildSeekQueryPack, encodeHarvestQuery } = require('../lib/eiSeekQueryPack');
  const pack = buildSeekQueryPack("Please find Christopher Dunn's Lost Technologies of Ancient Egypt");
  assert.equal(pack.named.isSingularTitle, true);
  const enc = encodeHarvestQuery(pack);
  assert.match(enc, /Lost Technologies/);
});

test('known works assessCoverage reports missing titles', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-kw-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  try {
    const { ensureSkeletonFiles, assessCoverage } = require('../lib/eiKnownWorks');
    ensureSkeletonFiles();
    const r = assessCoverage('Graham Hancock', [
      { verdict: 'keep', title: 'Fingerprints of the Gods', author: 'Graham Hancock' },
    ]);
    assert.equal(r.known, true);
    assert.ok(r.kept.length >= 1);
    assert.ok(r.missing.some((m) => /Message of the Sphinx/i.test(m.expected)));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});

test('seedsForGoal returns Petrie archive URLs', () => {
  const { seedsForGoal } = require('../lib/eiSeedPack');
  const s = seedsForGoal('Please find all PDFs authored by W.M. Flinders Petrie regarding Ancient Egypt.');
  assert.ok(s.urls.length > 0);
  assert.ok(s.urls.some((u) => /archive\.org/i.test(u)));
});

test('coverageVoiceSummary distinguishes empty shelf', () => {
  const { coverageVoiceSummary } = require('../lib/eiAgentTools');
  assert.match(
    coverageVoiceSummary({ search_hits: 0, pdfs_probed_ok: 0, ingested_documents: 0 }, { counts: { keep: 0 } }),
    /Shelf empty/i,
  );
  assert.match(
    coverageVoiceSummary({ search_hits: 5, pdfs_probed_ok: 2, ingested_documents: 2 }, { counts: { keep: 0, drop: 2 } }),
    /none met the keep bar/i,
  );
});

test('listUnsureQueue reads review flags', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-uq-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  try {
    // Fresh module load with new data dir
    delete require.cache[require.resolve('../lib/eiCorpusFlags')];
    delete require.cache[require.resolve('../lib/eiUnsureQueue')];
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
    const { setFlag } = require('../lib/eiCorpusFlags');
    setFlag(999001, { flag: 'review', reason: 'thin stub' });
    setFlag(999002, { flag: 'keep', reason: 'ok' });
    const { listUnsureQueue } = require('../lib/eiUnsureQueue');
    const q = listUnsureQueue({ limit: 10 });
    assert.equal(q.ok, true);
    assert.ok(q.items.some((i) => i.harvest_id === 999001));
    assert.ok(!q.items.some((i) => i.harvest_id === 999002));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/eiCorpusFlags')];
    delete require.cache[require.resolve('../lib/eiUnsureQueue')];
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  }
});

test('planWorkRules uses ingest_url for pasted links', () => {
  const { planWorkRules } = require('../lib/eiWorkPlanner');
  const plan = planWorkRules('Please ingest https://archive.org/details/fingerprintsofgod00hanc into the corpus');
  assert.equal(plan.steps[0].tool, 'ingest_url');
  assert.match(plan.steps[0].args.url, /archive\.org/);
});

test('parseSeedList extracts URLs and named works', () => {
  const { parseSeedList, looksLikeSeedSnowball } = require('../lib/eiSeedSnowball');
  const msg = [
    'Ingest these sources, then expand bibliographies and iterate:',
    '1. https://archive.org/details/fingerprintsofgod00hanc',
    "2. Christopher Dunn's Lost Technologies of Ancient Egypt",
    '3. https://archive.org/details/petriepyramids01petruoft',
  ].join('\n');
  const parsed = parseSeedList(msg);
  assert.ok(parsed.seeds.filter((s) => s.kind === 'url').length >= 2);
  assert.ok(parsed.seeds.some((s) => s.kind === 'work' && /Dunn|Lost Technologies/i.test(s.title || s.query || '')));
  assert.equal(parsed.wantsIterate, true);
  assert.equal(looksLikeSeedSnowball(msg), true);
});

test('buildSeedQuery uses quoted title + primary surname, keeps Unicode', () => {
  const { buildSeedQuery } = require('../lib/eiSeedSnowball');
  assert.equal(
    buildSeedQuery("Hamlet's Mill", 'Giorgio de Santillana and Hertha von Dechend'),
    '"Hamlet\'s Mill" Santillana PDF',
  );
  assert.match(buildSeedQuery('Göbekli Tepe', 'Klaus Schmidt'), /Göbekli Tepe/);
});

test('normalizeTitle keeps Unicode letters', () => {
  const { normalizeTitle } = require('../lib/eiGoalParse');
  assert.equal(normalizeTitle('Göbekli Tepe'), 'göbekli tepe');
});

test('parseSeedList splits multi-title Author — Title lines', () => {
  const { parseSeedList } = require('../lib/eiSeedSnowball');
  const p = parseSeedList([
    'Ingest these, then iterate:',
    'Charles Hapgood — Maps of the Ancient Sea Kings and The Path of the Pole',
  ].join('\n'));
  const titles = p.seeds.map((s) => s.title);
  assert.ok(titles.includes('Maps of the Ancient Sea Kings'), JSON.stringify(titles));
  assert.ok(titles.includes('The Path of the Pole'), JSON.stringify(titles));
});

test('seedsForGoal returns Hapgood direct PDF', () => {
  const { seedsForGoal } = require('../lib/eiSeedPack');
  const s = seedsForGoal('Please find and add to Corpus the book Maps of the Ancient Sea Kings by Charles Hapgood.');
  assert.ok(s.urls.some((u) => /HapgoodCharlesHutchins/i.test(u)), JSON.stringify(s.urls));
});

test('parseSeedList handles Author — Title and semicolon-collapsed lists', () => {
  const { parseSeedList } = require('../lib/eiSeedSnowball');
  const lines = parseSeedList([
    'Ingest these, then iterate:',
    'Charles Hapgood — Maps of the Ancient Sea Kings',
    "Giorgio de Santillana — Hamlet's Mill",
    'John Anthony West — Serpent in the Sky',
  ].join('\n'));
  assert.ok(lines.seeds.length >= 3);
  assert.ok(lines.seeds.some((s) => /Hapgood/i.test(s.author || '') && /Maps of the Ancient/i.test(s.title || '')));

  const collapsed = parseSeedList(
    "Charles Hapgood — Maps of the Ancient Sea Kings; Giorgio de Santillana — Hamlet's Mill; John Anthony West — Serpent in the Sky",
  );
  assert.ok(collapsed.seeds.length >= 3, `expected >=3 got ${collapsed.seeds.length}`);
});

test('planWorkRules routes seed lists to seed_snowball', () => {
  const { planWorkRules } = require('../lib/eiWorkPlanner');
  const { looksLikeWorkOrder } = require('../lib/eiGoalParse');
  const msg = [
    'Ingest these, then iterate bibliographies:',
    'https://archive.org/details/a',
    'https://archive.org/details/b',
  ].join('\n');
  assert.equal(looksLikeWorkOrder(msg), true);
  const plan = planWorkRules(msg);
  assert.equal(plan.steps[0].tool, 'seed_snowball');
  assert.match(plan.steps[0].args.list, /archive\.org\/details\/a/);
});

test('seed_snowball is a registered tool', () => {
  const { getTool, listTools } = require('../lib/eiAgentTools');
  assert.ok(getTool('seed_snowball'));
  assert.ok(listTools().some((t) => t.name === 'seed_snowball'));
});

test('chunkText splits long documents', () => {
  const { chunkText } = require('../lib/eiCorpusRag');
  const chunks = chunkText('word '.repeat(500), 100, 20);
  assert.ok(chunks.length > 3);
});

test('research campaign: lifecycle, dedupe ledger, lead management', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-camp-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  try {
    delete require.cache[require.resolve('../lib/eiResearchCampaign')];
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
    const camp = require('../lib/eiResearchCampaign');

    // Start seeds leads from standing threads
    const started = camp.startCampaign({ interval_minutes: 30 });
    assert.equal(started.ok, true);
    assert.equal(started.status.enabled, true);
    assert.ok(started.status.pending_leads > 5);

    // Pause blocks cycles; resume restores
    camp.pauseCampaign();
    assert.equal(camp.dueForCycle(), false);
    camp.resumeCampaign();
    assert.equal(camp.dueForCycle(), true);

    // Dedupe: same lead query cannot be added twice
    const st = camp.loadState();
    const first = camp.addLead(st, { query: '"Sacred Science" Schwaller PDF' });
    const dupe = camp.addLead(st, { query: '"Sacred Science" Schwaller PDF' });
    assert.equal(first, true);
    assert.equal(dupe, false);

    // Cooldown ledger blocks recently-attempted queries
    st.attempted_queries[' '.trim() || 'x'] = undefined;
    st.attempted_queries['sacred science schwaller pdf'] = new Date().toISOString();
    camp.saveState(st);
    assert.equal(camp.queryOnCooldown(camp.loadState(), '"Sacred Science" Schwaller PDF'), true);

    // Stop disables
    camp.stopCampaign();
    assert.equal(camp.loadState().enabled, false);
    assert.equal(camp.dueForCycle(), false);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/eiResearchCampaign')];
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  }
});

test('research_campaign is a registered tool and planWorkRules routes campaign asks', () => {
  const { getTool } = require('../lib/eiAgentTools');
  assert.ok(getTool('research_campaign'));
  const { planWorkRules } = require('../lib/eiWorkPlanner');
  const plan = planWorkRules('Pause the research campaign');
  assert.equal(plan.steps[0].tool, 'research_campaign');
  assert.equal(plan.steps[0].args.action, 'pause');
  const plan2 = planWorkRules('Start the research campaign and keep ingesting');
  assert.equal(plan2.steps[0].tool, 'research_campaign');
  assert.equal(plan2.steps[0].args.action, 'start');
  const { looksLikeWorkOrder } = require('../lib/eiGoalParse');
  assert.equal(looksLikeWorkOrder('Pause the research campaign'), true);
});

test('validateToolArgs coerces types, keeps extras, null → {}', () => {
  const { getTool, validateToolArgs } = require('../lib/eiAgentTools');
  const tool = getTool('search_corpus');
  assert.ok(tool);
  const v = validateToolArgs(tool, { query: 42, limit: '5', max_keeps: 1, note: 'x' });
  assert.equal(v.args.query, '42');
  assert.equal(v.args.limit, 5);
  assert.equal(v.args.max_keeps, 1);
  assert.equal(v.args.note, 'x');
  assert.ok(v.warnings.some((w) => /query/.test(w)));
  assert.ok(v.warnings.some((w) => /limit/.test(w)));

  const nan = validateToolArgs(tool, { limit: 'nope' });
  assert.equal('limit' in nan.args, false);
  assert.ok(nan.warnings.some((w) => /NaN/.test(w)));

  const empty = validateToolArgs(tool, null);
  assert.deepEqual(empty.args, {});
});

test('runTool attaches arg_warnings when coercing', async () => {
  const { runTool } = require('../lib/eiAgentTools');
  const out = await runTool('research_campaign', { action: 'status', interval_minutes: '30' });
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.arg_warnings));
  assert.ok(out.arg_warnings.some((w) => /interval_minutes/.test(w)));
});

test('runTool with null args does not throw', async () => {
  const { runTool } = require('../lib/eiAgentTools');
  const out = await runTool('research_campaign', null);
  assert.equal(out.ok, true);
  assert.equal(out.tool, 'research_campaign');
});

test('sanitizeLead rejects placeholders and Churchward/Antediluvian confusion', () => {
  const { sanitizeLead } = require('../lib/eiResearchCampaign');
  assert.equal(sanitizeLead({
    source: 'reflection',
    query: '"The Great Sphinx of Giza" Surname PDF',
  }).ok, false);
  assert.equal(sanitizeLead({
    source: 'reflection',
    title: 'Atlantis: The Antediluvian World',
    author: 'James Churchward',
  }).reason, 'churchward_antediluvian_confusion');
  const good = sanitizeLead({
    source: 'reflection',
    title: 'Sacred Science',
    author: 'R. A. Schwaller de Lubicz',
    why: 'gap',
  });
  assert.equal(good.ok, true);
  assert.match(good.lead.query, /Sacred Science/);
  assert.match(good.lead.mission, /Schwaller/);
  // thread seeds still accepted
  assert.equal(sanitizeLead({
    source: 'thread',
    query: 'Petrie "Pyramids and Temples of Gizeh" survey PDF',
  }).ok, true);
});

test('enforceAuthorConsistency demotes unknown author on named singular ask', () => {
  const { enforceAuthorConsistency } = require('../lib/eiMissionFitReview');
  const named = { author: 'James Churchward', isSingularTitle: true, isAuthorWorks: false };
  const out = enforceAuthorConsistency({
    verdict: 'keep',
    author: 'unknown',
    title: 'Atlantis the antediluvian world',
    why: 'title match',
  }, named, 'Please find and add to Corpus the book Atlantis by James Churchward.');
  assert.equal(out.verdict, 'unsure');
  assert.equal(out.demoted_from_keep, true);
});
