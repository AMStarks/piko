const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPrimaryText, parseBrief } = require('../lib/eiTextScout');

const abydos = {
  id: 'abydos',
  label: 'Abydos / Oserion',
  aliases: ['abydos', 'oserion', 'umm el-qaab'],
};

test('parseBrief: free text gets safe defaults, JSON briefs parse fully', () => {
  // Keyword tripwires were removed on purpose — free-text briefs no longer
  // flip modes; structured control comes from JSON briefs (or the planner).
  const a = parseBrief('assess only Abydos primary texts');
  assert.equal(a.find, true);
  assert.equal(a.assess, true);
  assert.equal(a.sites, null);
  const j = parseBrief('{"find":false,"site":"giza","limit":6}');
  assert.equal(j.find, false);
  assert.deepEqual(j.sites, ['giza']);
  assert.equal(j.limit, 6);
});

test('assess accepts Petrie Abydos excavation OCR', () => {
  const item = {
    id: 1,
    title: 'Abydos ..',
    source: 'archive_org',
    kind: 'literature',
    site: 'abydos',
    has_document: true,
    official_text: 'Petrie excavation report Early Dynastic ivory labels at Umm el-Qaab Abydos hieroglyph inscriptions Old Kingdom context '.repeat(40),
  };
  const a = assessPrimaryText(item, abydos);
  assert.equal(a.verdict, 'accept');
  assert.ok(a.score >= 70);
});

test('assess rejects CIA reading-room noise', () => {
  const item = {
    id: 2,
    title: 'CIA Reading Room cia-rdp79b00752a000300070001-8: THE ADAM AND EVE STORY',
    source: 'archive_org',
    kind: 'literature',
    site: 'heliopolis',
    official_text: 'Central Intelligence Agency reading room document',
  };
  const heli = { id: 'heliopolis', aliases: ['heliopolis', 'iunu'] };
  const a = assessPrimaryText(item, heli);
  assert.equal(a.verdict, 'reject');
  assert.ok(Array.isArray(a.reasons) && a.reasons.length > 0, 'has a reject reason');
});

test('assess does not block Magicians of the Gods', () => {
  const item = {
    id: 201,
    title: "Magicians of the gods : the forgotten wisdom of Earth's lost civilisation",
    source: 'archive_org',
    kind: 'literature',
    site: 'giza',
    has_document: true,
    official_text: 'Graham Hancock Magicians of the gods pyramids of Giza lost civilisation forgotten wisdom '.repeat(30),
  };
  const giza = { id: 'giza', aliases: ['giza', 'gizeh', 'khufu'] };
  const a = assessPrimaryText(item, giza);
  assert.notEqual(a.verdict, 'reject');
  assert.ok(!a.reasons.includes('blocked_pseudohistory_or_irrelevant'));
});

test('assess rejects thin TLA stub without substance', () => {
  const item = {
    id: 3,
    title: 'Heilstatue Heliopolis',
    source: 'tla',
    kind: 'literature',
    site: 'heliopolis',
    official_text: 'short note',
  };
  const heli = { id: 'heliopolis', aliases: ['heliopolis', 'iunu'] };
  const a = assessPrimaryText(item, heli);
  assert.notEqual(a.verdict, 'accept');
});

test('ei-text-scout registered', () => {
  const { BUILTIN_AGENTS } = require('../lib/agentRegistry');
  const a = BUILTIN_AGENTS.find((x) => x.id === 'ei-text-scout');
  assert.ok(a);
  assert.equal(a.runtime, 'eval');
});
