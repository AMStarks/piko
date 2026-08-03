const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateUnderstanding,
  computeNeedsOperator,
  conversationFallback,
  FEW_SHOT_IDS,
} = require('../lib/understand');
const { understand } = require('../lib/understand');

describe('lib/understand', () => {
  it('computes needs_operator from intent enum only', () => {
    assert.equal(computeNeedsOperator('conversation'), false);
    assert.equal(computeNeedsOperator('status_question'), false);
    assert.equal(computeNeedsOperator('work_order'), true);
    assert.equal(computeNeedsOperator('campaign_control'), true);
  });

  it('validates happy-path JSON without regex', () => {
    const r = validateUnderstanding({
      intent: 'work_order',
      confidence: 0.9,
      work: { verb: 'find', title: 'Giza survey', author: 'Petrie', urls: [], scope: 'single' },
      is_question: false,
    }, { id: 't1', source: 'test' });
    assert.equal(r.failed, false);
    assert.equal(r.intent, 'work_order');
    assert.equal(r.needs_operator, true);
    assert.equal(r.work.author, 'Petrie');
  });

  it('fails closed on campaign_control without action', () => {
    const r = validateUnderstanding({
      intent: 'campaign_control',
      confidence: 0.9,
      control: null,
    }, { id: 't2' });
    assert.equal(r.failed, true);
    assert.equal(r.intent, 'conversation');
    assert.equal(r.needs_operator, false);
  });

  it('fails closed on unknown intent', () => {
    const r = validateUnderstanding({ intent: 'explode', confidence: 1 }, { id: 't3' });
    assert.equal(r.failed, true);
    assert.equal(r.intent, 'conversation');
  });

  it('slash commands short-circuit without model env', async () => {
    const r = await understand('/learning', {});
    assert.equal(r.source, 'slash');
    assert.equal(r.intent, 'learning_question');
    assert.equal(r.failed, false);
  });

  it('conversationFallback is safe default', () => {
    const r = conversationFallback({ id: 'x' });
    assert.equal(r.intent, 'conversation');
    assert.equal(r.failed, true);
    assert.equal(r.needs_operator, false);
  });

  it('tracks few-shot ids for scoring exclusion', () => {
    assert.equal(FEW_SHOT_IDS.has('fewshot-musing-osireion'), true);
  });
});
