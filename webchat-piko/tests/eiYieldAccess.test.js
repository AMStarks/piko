const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLeadAccess } = require('../lib/eiResearchCampaign');
const { seedsForThread, SEEDS } = require('../lib/eiSeedPack');
const { isJunkKeepTitle, isSummaryMillUrl } = require('../lib/eiSeekQueryPack');

test('classifyLeadAccess marks PD authors and years', () => {
  // Herodotus is on the PD list; may also be seeded — either is non-speculative
  const h = classifyLeadAccess({
    title: 'Histories',
    author: 'Herodotus',
    query: '"Histories" Herodotus PDF',
    mission: 'Please find and add to Corpus the book Histories by Herodotus.',
  });
  assert.ok(h === 'public_domain_likely' || h === 'seeded', h);
  assert.equal(
    classifyLeadAccess({ title: 'Some Modern Book', author: 'Jane Doe', query: '"Some Modern Book" Doe PDF' }),
    'speculative',
  );
  assert.equal(
    classifyLeadAccess({ title: 'Old Tract 1882', author: 'Someone', query: '"Old Tract" 1882 PDF' }),
    'public_domain_likely',
  );
});

test('classifyLeadAccess marks seeded when seed pack has URLs', () => {
  const access = classifyLeadAccess({
    title: 'Atlantis: The Antediluvian World',
    author: 'Ignatius Donnelly',
    mission: 'Please find and add to Corpus the book Atlantis: The Antediluvian World by Ignatius Donnelly.',
    query: '"Atlantis: The Antediluvian World" Donnelly PDF',
  });
  assert.equal(access, 'seeded');
});

test('seedsForThread returns tagged seeds', () => {
  const abydos = seedsForThread('abydos');
  assert.ok(abydos.length >= 1);
  assert.ok(abydos.every((s) => s.thread === 'abydos'));
  const cat = seedsForThread('cataclysm');
  assert.ok(cat.some((s) => (s.authors || []).some((a) => /bretz/i.test(a))));
  assert.ok(SEEDS.some((s) => s.thread === 'flood-myths'));
});

test('junk keep title patterns match course handouts', () => {
  assert.equal(isJunkKeepTitle('PDF G4210: Rise of Andean Civilization'), true);
  assert.equal(isJunkKeepTitle('Download the Book - The Great Pyramid of Giza'), true);
  assert.equal(isJunkKeepTitle('PDF The Deluge - Iapsop'), true);
  assert.equal(isJunkKeepTitle('Atlantis : the antediluvian world'), false);
  assert.equal(isSummaryMillUrl('https://cdn.bookey.app/foo.pdf'), true);
});
