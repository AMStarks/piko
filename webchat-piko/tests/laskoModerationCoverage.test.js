const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePatterns } = require('../lib/laskoModerationPatterns');

/** Samples previously matched by the regex layer — must still block. */
const HARD_SAMPLES = [
  'link to child porn material',
  'csam trading forum',
  'I will kill you tonight',
  'gonna shoot him',
  'death to all traitors',
  'I want to kill myself',
  'how to commit suicide',
  'end my life tonight',
  'here is ransomware builder',
  'ssn number 123',
  'credit card number 4111111111111111',
];

const SOFT_SAMPLES = [
  'Buy now limited offer click here',
  'win money free crypto guaranteed returns',
  'claim airdrop whitelist spot',
  'see bit.ly/abc123',
  'explicit porn link',
  'email me at alice@example.com',
  'her number is 555-123-4567 call alice@x.com',
];

describe('lasko moderation phrase coverage (WP8.7)', () => {
  for (const sample of HARD_SAMPLES) {
    it(`hard-blocks: ${sample.slice(0, 40)}`, () => {
      const r = evaluatePatterns(sample);
      assert.equal(r.action, 'hard_block', sample);
    });
  }

  for (const sample of SOFT_SAMPLES) {
    it(`soft-blocks: ${sample.slice(0, 40)}`, () => {
      const r = evaluatePatterns(sample);
      assert.ok(r.action === 'soft_block' || r.action === 'hard_block', `${sample} → ${r.action}`);
    });
  }

  it('allows benign research chat', () => {
    const r = evaluatePatterns("What do you make of Petrie's Giza survey?");
    assert.equal(r.action, 'allow');
  });
});
