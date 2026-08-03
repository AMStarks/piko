const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const floors = require('../lib/eiFloors');

describe('lib/eiFloors (no regex)', () => {
  it('detects status questions', () => {
    assert.equal(floors.isCampaignStatusQuestion("How's the campaign going?"), true);
    assert.equal(floors.isCampaignStatusQuestion('Give me an update'), true);
  });

  it('detects opinion questions', () => {
    assert.equal(floors.isOpinionQuestion('What do you make of Göbekli Tepe?'), true);
  });

  it('detects musings without treating them as work', () => {
    assert.equal(floors.isSoftMusing("I've been thinking about getting into the Osireion sometime"), true);
    assert.equal(floors.looksLikeWorkOrder("I've been thinking about getting into the Osireion sometime"), false);
  });

  it('detects work orders', () => {
    assert.equal(floors.looksLikeWorkOrder("Find Petrie's Giza survey and add it to the corpus"), true);
  });

  it('parses control and self-corrects to status', () => {
    assert.equal(floors.parseCampaignControlAction('Pause the campaign'), 'pause');
    assert.equal(
      floors.parseCampaignControlAction("Pause the campaign — actually no, just tell me how it's going"),
      null,
    );
  });

  it('maps understand intents', () => {
    const f = floors.floorsFromUnderstanding({
      failed: false,
      intent: 'musing',
      control: null,
    });
    assert.equal(f.musing, true);
    assert.equal(f.work, false);
  });
});
