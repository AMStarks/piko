const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLookups,
  formatLookupReply,
  runLookups,
  buildCampaignStateBlock,
  synthesizeLookupReply,
} = require('../lib/legateTools');

test('normalizeLookups keeps known ids only including campaign/learning/activity', () => {
  assert.deepEqual(
    normalizeLookups(['authors', 'bogus', 'stats', 'campaign', 'learning', 'activity', 'authors']),
    ['authors', 'stats', 'campaign', 'learning', 'activity'],
  );
  assert.deepEqual(normalizeLookups('jobs'), ['jobs']);
  assert.deepEqual(normalizeLookups(null), []);
});

test('formatLookupReply merges preface with authors', () => {
  const text = formatLookupReply('Checking the corpus.', {
    lookups: ['authors'],
    authors: {
      ok: true,
      kept_items: 3,
      named_authors: [{ name: 'Christopher Dunn', count: 2 }],
      authors: [
        { name: 'Christopher Dunn', count: 2 },
        { name: '(unknown author)', count: 1 },
      ],
    },
  });
  assert.match(text, /Checking the corpus/);
  assert.match(text, /Christopher Dunn \(2\)/);
  assert.match(text, /kept items: 3/);
});

test('formatLookupReply includes campaign + learning sections', () => {
  const text = formatLookupReply('', {
    lookups: ['campaign', 'learning'],
    campaign: {
      ok: true,
      status: {
        enabled: true,
        paused: false,
        mode: 'active',
        cycle_count: 12,
        stats: { keeps: 4, unsures: 1 },
        pending_leads: 2,
        notes_count: 5,
        dossiers: { count: 2, stale: 0 },
        articles: { count: 0 },
        last_24h: { cycles: 3, seeks: 6, keeps: 2, leads_added: 1, idle_pct: 10 },
      },
    },
    learning: {
      ok: true,
      notes_count: 5,
      dossiers: { count: 2, stale: 0 },
      articles: { count: 0 },
      expertise: { petrie: { keeps: 2, notes: 1 } },
      recent_notes: [{ title: 'Abydos notes', author: 'Petrie' }],
      rag_files_approx: 0,
    },
  });
  assert.match(text, /Research campaign:\s*ACTIVE/i);
  assert.match(text, /Learning: notes=5/);
  assert.match(text, /Abydos notes/);
});

test('synthesizeLookupReply falls back when model invents numbers', async () => {
  const llmPath = require.resolve('../lib/llm');
  delete require.cache[llmPath];
  const llm = require('../lib/llm');
  const orig = llm.ollamaNativeChat;
  llm.ollamaNativeChat = async () => 'We are on cycle 742 with strong momentum.';
  delete require.cache[require.resolve('../lib/legateTools')];
  try {
    const { synthesizeLookupReply } = require('../lib/legateTools');
    const data = {
      lookups: ['campaign'],
      campaign: {
        ok: true,
        state_summary: 'ACTIVE — the campaign is running normally (not paused).',
        status: {
          enabled: true,
          paused: false,
          cycle_count: 555,
          stats: { keeps: 12 },
          pending_leads: 3,
        },
      },
    };
    const text = await synthesizeLookupReply('campaign status', data);
    assert.match(text, /555|ACTIVE|cycles/i);
    assert.doesNotMatch(text, /\b742\b/);
  } finally {
    llm.ollamaNativeChat = orig;
    delete require.cache[require.resolve('../lib/legateTools')];
    delete require.cache[llmPath];
  }
});

test('synthesizeLookupReply falls back to template when synthesis disabled', async () => {
  const prev = process.env.PIKO_LEGATE_SYNTHESIS;
  process.env.PIKO_LEGATE_SYNTHESIS = '0';
  try {
    const data = {
      lookups: ['jobs'],
      jobs: {
        ok: true,
        counts: { working: 0, running: 0, pending: 0 },
        active: [],
      },
    };
    const text = await synthesizeLookupReply('who is working?', data);
    assert.match(text, /Agents:/);
    assert.match(text, /No agents on a task/);
  } finally {
    if (prev === undefined) delete process.env.PIKO_LEGATE_SYNTHESIS;
    else process.env.PIKO_LEGATE_SYNTHESIS = prev;
  }
});

test('buildCampaignStateBlock returns grounded lines', () => {
  const block = buildCampaignStateBlock({ force: true });
  assert.match(block, /LIVE RESEARCH STATE/i);
  assert.match(block, /Campaign:/i);
});

test('runLookups returns only requested keys', () => {
  const out = runLookups(['jobs'], { rootDir: require('path').join(__dirname, '..') });
  assert.deepEqual(out.lookups, ['jobs']);
  assert.ok(out.jobs);
  assert.equal(out.authors, undefined);
  assert.equal(out.campaign, undefined);
});
