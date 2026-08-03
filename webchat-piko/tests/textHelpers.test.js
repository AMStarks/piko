const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const text = require('../lib/text');

describe('lib/text', () => {
  it('collapses whitespace and trims', () => {
    assert.equal(text.collapseWhitespace('  a \t\n b  '), 'a b');
  });

  it('keeps Unicode letters in Göbekli', () => {
    const n = text.keepLettersDigitsSpaces('Göbekli Tepe!!!');
    assert.equal(n, 'Göbekli Tepe');
  });

  it('strips trailing punct including curly quotes', () => {
    assert.equal(text.stripTrailingPunct('hello.”'), 'hello');
  });

  it('extracts digit runs', () => {
    const runs = text.extractDigitRuns('cycle 42 keep 7');
    assert.deepEqual(runs.map((r) => r.value), [42, 7]);
  });

  it('parses HH:MM and rejects bad values', () => {
    assert.deepEqual(text.parseHhMm('09:30'), { h: 9, m: 30 });
    assert.equal(text.parseHhMm('25:00'), null);
    assert.equal(text.parseHhMm('9:3'), null);
  });

  it('parses duration tokens', () => {
    assert.deepEqual(text.parseDurationToken('5m'), { value: 5, unit: 'm' });
    assert.equal(text.parseDurationToken('5minutes'), null);
  });

  it('isSafeName rejects path tricks', () => {
    assert.equal(text.isSafeName('foo_bar'), true);
    assert.equal(text.isSafeName('..'), false);
    assert.equal(text.isSafeName('a/b'), false);
  });

  it('detects http urls without regex', () => {
    assert.equal(text.hasHttpUrl('see https://example.com/x'), true);
    assert.equal(text.hasHttpUrl('no link here'), false);
  });

  it('squeezes blank lines', () => {
    const out = text.squeezeBlankLines('a\n\n\n\nb');
    assert.equal(out, 'a\n\nb');
  });
});

