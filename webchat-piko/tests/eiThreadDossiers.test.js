const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-dossier-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  // Clear require cache so notesDir/culturesDataRoot pick up env
  for (const key of Object.keys(require.cache)) {
    if (/eiCorpusNotes|eiBibliography|eiThreadDossiers|culturesCorpusApi/.test(key)) {
      delete require.cache[key];
    }
  }
  try {
    return await fn(dir);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const key of Object.keys(require.cache)) {
      if (/eiCorpusNotes|eiBibliography|eiThreadDossiers|culturesCorpusApi/.test(key)) {
        delete require.cache[key];
      }
    }
  }
}

test('notesForThread matches aliases case-insensitively', async () => {
  await withTempData((dir) => {
    const notesDir = path.join(dir, 'corpus_notes');
    fs.mkdirSync(notesDir, { recursive: true });
    const fixtures = [
      {
        harvest_id: 107,
        title: 'Fingerprints of the Gods',
        author: 'Graham Hancock',
        summary: 'Lost civilization thesis around Giza and the Sphinx.',
        claims: ['Sphinx water erosion predates dynastic Egypt'],
        sites: ['Giza'],
        people: [],
        open_questions: [],
      },
      {
        harvest_id: 271,
        title: 'Abydos',
        author: 'W. M. Flinders Petrie',
        summary: 'Excavation of the Osireion and early dynastic tombs.',
        claims: ['Osireion masonry differs from Seti temple'],
        sites: ['Abydos'],
        people: ['Petrie'],
        open_questions: [],
      },
      {
        harvest_id: 999,
        title: 'Unrelated cooking recipes',
        author: 'Chef',
        summary: 'How to bake bread.',
        claims: [],
        sites: [],
        people: [],
        open_questions: [],
      },
    ];
    for (const n of fixtures) {
      fs.writeFileSync(path.join(notesDir, `item_${n.harvest_id}.json`), JSON.stringify(n, null, 2));
    }
    const { notesForThread } = require('../lib/eiThreadDossiers');
    const giza = notesForThread('giza');
    assert.ok(giza.some((n) => n.harvest_id === 107));
    assert.ok(!giza.some((n) => n.harvest_id === 999));
    const abydos = notesForThread('abydos');
    assert.ok(abydos.some((n) => n.harvest_id === 271));
    assert.equal(notesForThread('nope').length, 0);
  });
});

test('postProcessDossier drops claims with unknown source_ids', async () => {
  await withTempData(() => {
    const { postProcessDossier } = require('../lib/eiThreadDossiers');
    const out = postProcessDossier({
      summary: 'Expert view.',
      key_claims: [
        { claim: 'Good claim', source_ids: [107, 203], stance: 'alternative', status: 'multi-source' },
        { claim: 'Bad claim', source_ids: [99999], stance: 'both', status: 'single-source' },
        { claim: 'No sources', source_ids: [], stance: 'orthodox' },
        { claim: 'Mixed', source_ids: [107, 42], stance: 'weird', status: 'weird' },
      ],
      evidence_gaps: ['Need Petrie survey', 'x', 'y', 'z', 'a', 'b', 'c'],
      wanted_sources: [
        { title: 'Maps of the Ancient Sea Kings', author: 'Charles Hapgood', why: 'cartography' },
        { title: '', author: 'Nobody' },
      ],
      orthodox_view: 'Mainstream dating',
      alternative_view: 'Older civilization',
    }, [107, 203], 'giza');
    assert.equal(out.key_claims.length, 2);
    assert.deepEqual(out.key_claims[0].source_ids, [107, 203]);
    assert.deepEqual(out.key_claims[1].source_ids, [107]);
    assert.equal(out.key_claims[1].stance, 'both');
    assert.equal(out.key_claims[1].status, 'single-source');
    assert.equal(out.evidence_gaps.length, 6);
    assert.equal(out.wanted_sources.length, 1);
    assert.equal(out.thread, 'giza');
  });
});

test('buildDossier with stub chatFn persists and marks stale correctly', async () => {
  await withTempData(async (dir) => {
    const notesDir = path.join(dir, 'corpus_notes');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(notesDir, 'item_107.json'), JSON.stringify({
      harvest_id: 107,
      title: 'Fingerprints of the Gods',
      author: 'Graham Hancock',
      summary: 'Giza chronology challenge.',
      claims: ['Water weathering on Sphinx'],
      sites: ['Giza'],
      people: ['Hancock'],
      open_questions: ['Age of Sphinx enclosure'],
    }, null, 2));
    const { buildDossier, loadDossier, dossierIsStale } = require('../lib/eiThreadDossiers');
    const chatFn = async () => JSON.stringify({
      summary: 'Giza remains contested.',
      key_claims: [
        { claim: 'Sphinx shows water weathering', source_ids: [107], stance: 'alternative', status: 'single-source' },
        { claim: 'Invented', source_ids: [555], stance: 'both', status: 'single-source' },
      ],
      orthodox_view: 'Old Kingdom construction',
      alternative_view: 'Much older enclosure',
      evidence_gaps: ['Need geological survey'],
      wanted_sources: [{ title: 'Pyramids and Temples of Gizeh', author: 'W. M. Flinders Petrie', why: 'survey baseline' }],
    });
    const out = await buildDossier('giza', { chatFn });
    assert.equal(out.ok, true);
    assert.equal(out.dossier.key_claims.length, 1);
    assert.equal(out.dossier.note_count, 1);
    const loaded = loadDossier('giza');
    assert.ok(loaded);
    assert.equal(dossierIsStale('giza'), false);
    fs.writeFileSync(path.join(notesDir, 'item_203.json'), JSON.stringify({
      harvest_id: 203,
      title: 'Measure of a Monument',
      author: 'Schmitz',
      summary: 'Great Pyramid metrology at Giza.',
      claims: [],
      sites: ['Giza'],
      people: [],
      open_questions: [],
    }, null, 2));
    assert.equal(dossierIsStale('giza'), true);
  });
});
