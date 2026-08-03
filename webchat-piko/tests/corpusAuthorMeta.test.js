const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCreator,
  authorsFromTitle,
  authorsFromQuery,
  extractAuthors,
  enrichMeta,
} = require('../lib/corpusAuthorMeta');

test('normalizeCreator flips Last, First and strips dates', () => {
  assert.equal(
    normalizeCreator('Petrie, W. M. Flinders (William Matthew Flinders), 1853-1942'),
    'W. M. Flinders Petrie',
  );
});

test('authorsFromQuery stops before lowercase glue words', () => {
  const a = authorsFromQuery(
    'Research all articles written by Robert Schoch on the Sphinx, attempt to download available PDFs',
  );
  assert.deepEqual(a, ['Robert Schoch']);
});

test('extractAuthors prefers meta.creator when author missing', () => {
  const authors = extractAuthors('Abydos ..', {
    creator: 'Petrie, W. M. Flinders and Mackay, Ernest',
  });
  assert.ok(authors.length >= 1);
  assert.match(authors[0], /Petrie/i);
});

test('enrichMeta writes author fields', () => {
  const { meta, changed, authors } = enrichMeta(
    { kind: 'literature', creator: 'Dunn, Christopher' },
    'The Giza Power Plant',
  );
  assert.equal(changed, true);
  assert.equal(meta.author, 'Christopher Dunn');
  assert.ok(authors.includes('Christopher Dunn'));
});
