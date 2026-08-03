/**
 * WP7.4 — dossier wanted-leads filter, bib backfill, starvation gate.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp74-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchCampaign|culturesCorpusApi|eiThreadDossiers|eiBibliography/.test(key)) {
      delete require.cache[key];
    }
  }
  try {
    return fn(dir, require('../lib/eiResearchCampaign'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('WP7.4 dossierWantedLeads filters before cap', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp74-dos-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const dossiersPath = require.resolve('../lib/eiThreadDossiers');
  delete require.cache[dossiersPath];
  try {
    const dossiers = require('../lib/eiThreadDossiers');
    const ddir = dossiers.dossiersDir();
    fs.mkdirSync(ddir, { recursive: true });
    fs.writeFileSync(path.join(ddir, 'giza.json'), JSON.stringify({
      thread: 'giza',
      wanted_sources: [
        { title: 'Cooled Book', author: 'Old Author', why: 'cooled' },
        { title: 'Fresh Book', author: 'New Author', why: 'fresh' },
        { title: 'Another Fresh', author: 'New Author 2', why: 'fresh2' },
      ],
    }, null, 2));
    const cooled = new Set(['Cooled Book']);
    const leads = dossiers.dossierWantedLeads(2, {
      filter: (l) => !cooled.has(l.title),
    });
    assert.equal(leads.length, 2);
    assert.equal(leads[0].title, 'Fresh Book');
    assert.equal(leads[1].title, 'Another Fresh');
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[dossiersPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WP7.4 backfill selects un-expanded items, records ids, respects cap', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp74-bf-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const prevCorpus = require.cache[corpusPath];
  require.cache[corpusPath] = {
    id: corpusPath,
    filename: corpusPath,
    loaded: true,
    exports: {
      culturesDataRoot: () => dir,
      listItems: () => ({
        ok: true,
        items: [
          { id: 10, title: 'A' },
          { id: 11, title: 'B' },
          { id: 12, title: 'C' },
        ],
      }),
      getItem: () => ({ ok: false }),
    },
  };
  delete require.cache[campaignPath];
  try {
    const campaign = require('../lib/eiResearchCampaign');
    const state = campaign.loadState();
    state.bib_backfill_done_ids = [10];
    const expanded = [];
    const out = await campaign.backfillBibliographyFromKeeps(state, {
      max: 2,
      expandFromItem: async (hid) => {
        expanded.push(hid);
        return { ok: true, queued: 1 };
      },
    });
    assert.equal(out.expanded, 2);
    assert.deepEqual(expanded, [11, 12]);
    assert.ok(state.bib_backfill_done_ids.includes(11));
    assert.ok(state.bib_backfill_done_ids.includes(12));
    assert.ok(state.bib_backfill_done_ids.includes(10));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    if (prevCorpus) require.cache[corpusPath] = prevCorpus;
    else delete require.cache[corpusPath];
    delete require.cache[campaignPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WP7.4 starvation_recovery reflect gate is true when idle + no eligible', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.idle_streak = 10;
    state.leads = [{
      id: 'c1',
      query: 'cooling query pdf',
      status: 'pending',
      access: 'speculative',
    }];
    campaign.stampAttempted(state, 'cooling query pdf', { days: 7 });
    const gate = campaign.shouldReflectThisCycle(state);
    assert.equal(gate.run, true);
    assert.equal(gate.reason, 'starvation_recovery');
  });
});
