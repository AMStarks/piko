const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractCitations,
  applyVerification,
  buildSourcesSection,
  appendSourcesSection,
  writeArticle,
} = require('../lib/eiArticleWriter');

test('extractCitations finds [Sids] and sentences', () => {
  const md = 'Giza shows precise casing. [S107] Mainstream dates it to Khufu. [S203] Extra text.';
  const { ids, sentences } = extractCitations(md);
  assert.ok(ids.includes(107));
  assert.ok(ids.includes(203));
  assert.ok(sentences.length >= 2);
});

test('applyVerification replaces not_found and sets needs_work over 20%', () => {
  const md = [
    'Claim one holds. [S107]',
    'Claim two holds. [S108]',
    'Claim three fails. [S109]',
    'Claim four fails. [S110]',
    'Claim five fails. [S111]',
  ].join(' ');
  const details = [
    { sentence: 'Claim one holds. [S107]', source_ids: [107], verdict: 'supported' },
    { sentence: 'Claim two holds. [S108]', source_ids: [108], verdict: 'partial' },
    { sentence: 'Claim three fails. [S109]', source_ids: [109], verdict: 'not_found' },
    { sentence: 'Claim four fails. [S110]', source_ids: [110], verdict: 'not_found' },
    { sentence: 'Claim five fails. [S111]', source_ids: [111], verdict: 'not_found' },
  ];
  const out = applyVerification(md, details);
  assert.equal(out.status, 'needs_work');
  assert.equal(out.verification.not_found, 3);
  assert.match(out.markdown, /\[unverified\]/);
  assert.doesNotMatch(out.markdown, /\[S109\]/);
});

test('applyVerification stays draft when not_found ≤ 20%', () => {
  const md = 'A. [S1] B. [S2] C. [S3] D. [S4] E. [S5]';
  // split won't create 5 sentences easily — feed details only
  const details = [
    { sentence: 'A. [S1]', source_ids: [1], verdict: 'supported' },
    { sentence: 'B. [S2]', source_ids: [2], verdict: 'supported' },
    { sentence: 'C. [S3]', source_ids: [3], verdict: 'supported' },
    { sentence: 'D. [S4]', source_ids: [4], verdict: 'supported' },
    { sentence: 'E. [S5]', source_ids: [5], verdict: 'not_found' },
  ];
  const out = applyVerification(md, details);
  assert.equal(out.status, 'draft');
  assert.equal(out.verification.not_found, 1);
});

test('buildSourcesSection uses resolver metadata', () => {
  const { section, sources } = buildSourcesSection([107, 203], (id) => ({
    title: id === 107 ? 'Fingerprints of the Gods' : 'Measure of a Monument',
    meta: { author: id === 107 ? 'Graham Hancock' : 'Schmitz' },
  }));
  assert.match(section, /## Sources/);
  assert.match(section, /\[S107\] Fingerprints of the Gods — Graham Hancock/);
  assert.match(section, /\[S203\] Measure of a Monument — Schmitz/);
  assert.equal(sources.length, 2);
});

test('appendSourcesSection strips prior Sources block', () => {
  const { markdown } = appendSourcesSection('Body text.\n\n## Sources\nold', [1], () => ({
    title: 'New',
    meta: { author: 'A' },
  }));
  assert.match(markdown, /Body text/);
  assert.match(markdown, /\[S1\] New — A/);
  assert.doesNotMatch(markdown, /old/);
});

test('writeArticle stubbed pipeline persists draft', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-article-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (/eiArticleWriter|eiThreadDossiers|eiCorpusNotes|culturesCorpusApi/.test(key)) {
      delete require.cache[key];
    }
  }
  try {
    const notesDir = path.join(dir, 'corpus_notes');
    const dossiersDir = path.join(dir, 'dossiers');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.mkdirSync(dossiersDir, { recursive: true });
    for (const id of [107, 203, 249]) {
      fs.writeFileSync(path.join(notesDir, `item_${id}.json`), JSON.stringify({
        harvest_id: id,
        title: `Work ${id}`,
        author: 'Author',
        summary: `Giza summary ${id}`,
        claims: [`Claim from ${id}`],
        sites: ['Giza'],
        people: [],
        open_questions: [],
      }));
    }
    fs.writeFileSync(path.join(dossiersDir, 'giza.json'), JSON.stringify({
      thread: 'giza',
      summary: 'Giza expert view',
      key_claims: [
        { claim: 'Water weathering', source_ids: [107], stance: 'alternative', status: 'single-source' },
        { claim: 'Fourth dynasty', source_ids: [203], stance: 'orthodox', status: 'single-source' },
      ],
      note_ids: [107, 203, 249],
      note_count: 3,
      evidence_gaps: [],
      wanted_sources: [],
      built_at: new Date().toISOString(),
    }));

    // Re-require after env set
    delete require.cache[require.resolve('../lib/eiArticleWriter')];
    const { writeArticle: wa } = require('../lib/eiArticleWriter');

    let stage = 0;
    const chatFn = async (_model, _msgs, opts = {}) => {
      stage += 1;
      if (opts.format === 'json' && stage === 1) {
        return JSON.stringify({
          title: 'Giza contested',
          sections: [{ heading: 'Evidence', claims: [{ text: 'Water weathering', source_ids: [107], contested: true }] }],
        });
      }
      if (opts.tag === 'eiArticleWriter.verify' || (opts.format === 'json' && stage >= 3)) {
        return JSON.stringify({ judgments: [{ i: 0, verdict: 'supported' }, { i: 1, verdict: 'supported' }] });
      }
      return 'Alternative authors argue water weathering. [S107] Mainstream archaeology dates the Sphinx to the Old Kingdom. [S203]';
    };
    const searchFn = async () => ([
      { harvest_id: 107, text: 'water weathering on the Sphinx enclosure', title: 'Work 107' },
      { harvest_id: 203, text: 'Old Kingdom dating of the Sphinx', title: 'Work 203' },
    ]);

    const out = await wa('Giza precision engineering', { chatFn, searchFn, thread: 'giza' });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(out.slug);
    assert.ok(fs.existsSync(out.path));
    assert.match(out.markdown, /\[S107\]/);
    assert.match(out.markdown, /## Sources/);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
  }
});
