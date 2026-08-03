const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeDigests,
  sampleWindows,
  dedupeCap,
  DEEP_MIN_CHARS,
  WINDOW_CHARS,
} = require('../lib/eiCorpusNotes');

test('dedupeCap is case-insensitive and caps length', () => {
  assert.deepEqual(
    dedupeCap(['Giza', 'giza', 'Abydos', '  ', 'GIZA', 'Heliopolis'], 3),
    ['Giza', 'Abydos', 'Heliopolis'],
  );
});

test('mergeDigests unions lists, dedupes, and applies caps', () => {
  const a = {
    claims: ['Claim A', 'claim a', 'Claim B'],
    people: ['Hapgood'],
    sites: ['Giza'],
    methods: ['cartography'],
    disagreements: ['X'],
    key_quotes: ['q1'],
    open_questions: ['q?'],
    summary: 'Window one summary about maps.',
  };
  const b = {
    claims: Array.from({ length: 25 }, (_, i) => `C${i}`),
    people: ['Hancock', 'hapgood'],
    sites: ['giza', 'Abydos'],
    methods: [],
    disagreements: [],
    key_quotes: ['q1', 'q2'],
    open_questions: Array.from({ length: 15 }, (_, i) => `Q${i}`),
    summary: 'Window two summary about evidence.',
  };
  const m = mergeDigests([a, b, null, {}]);
  assert.equal(m.claims.length, 20);
  assert.ok(m.claims.includes('Claim A'));
  assert.ok(m.claims.includes('Claim B'));
  assert.deepEqual(m.people, ['Hapgood', 'Hancock']);
  assert.deepEqual(m.sites, ['Giza', 'Abydos']);
  assert.equal(m.key_quotes.length, 2);
  assert.equal(m.open_questions.length, 10);
  assert.equal(m.window_summaries.length, 2);
  assert.equal(m.summary, '');
});

test('sampleWindows returns evenly spaced slices', () => {
  const text = 'A'.repeat(100000);
  const wins = sampleWindows(text, 4, WINDOW_CHARS);
  assert.equal(wins.length, 4);
  assert.ok(wins.every((w) => w.length === WINDOW_CHARS));
  // first starts at 0, last ends at text end
  assert.equal(wins[0], text.slice(0, WINDOW_CHARS));
  assert.equal(wins[3], text.slice(text.length - WINDOW_CHARS));
});

test('sampleWindows collapses short text to one window', () => {
  const text = 'short';
  assert.deepEqual(sampleWindows(text, 4, WINDOW_CHARS), ['short']);
});

test('DEEP_MIN_CHARS is 30k', () => {
  assert.equal(DEEP_MIN_CHARS, 30000);
});
