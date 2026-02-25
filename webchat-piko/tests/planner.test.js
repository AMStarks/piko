/**
 * Phase 2.1: Planner tests. Run with: node --test tests/planner.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createResponsePlan, formatPlanForPrompt, DEPTH_CONFIDENCE_THRESHOLD } = require('../lib/planner');

describe('createResponsePlan', () => {
  it('returns medium verbosity when no depth belief and not a greeting', () => {
    const plan = createResponsePlan({ userBeliefs: [], mind: {}, userMessage: 'what is that?' });
    assert.strictEqual(plan.verbosity, 'medium');
    assert.ok(['low', 'medium', 'high'].includes(plan.verbosity));
  });

  it('returns low verbosity and warm tone for short greeting-like messages', () => {
    const plan = createResponsePlan({ userBeliefs: [], mind: {}, userMessage: 'hi' });
    assert.strictEqual(plan.verbosity, 'low');
    assert.strictEqual(plan.tone, 'warm');
    assert.strictEqual(plan.follow_up_questions, 0);
    assert.ok(plan.reason && plan.reason.includes('greeting'));
  });

  it('returns high verbosity when user has depth/structure belief >= threshold', () => {
    const plan = createResponsePlan({
      userBeliefs: [
        { proposition: 'User prefers depth and structure in explanations', confidence: 0.8 },
      ],
      mind: {},
      userMessage: 'explain that',
    });
    assert.strictEqual(plan.verbosity, 'high');
    assert.ok(plan.reason && plan.reason.includes('belief'));
  });

  it('keeps medium verbosity when depth belief below threshold', () => {
    const plan = createResponsePlan({
      userBeliefs: [
        { proposition: 'User prefers depth', confidence: 0.5 },
      ],
      mind: {},
      userMessage: 'explain that',
    });
    assert.strictEqual(plan.verbosity, 'medium');
  });

  it('returns object with verbosity, tone, follow_up_questions, challenge_level', () => {
    const plan = createResponsePlan({ userBeliefs: [], mind: {}, userMessage: 'tell me more' });
    assert.ok(typeof plan.verbosity === 'string');
    assert.ok(typeof plan.tone === 'string');
    assert.ok(typeof plan.follow_up_questions === 'number');
    assert.ok(typeof plan.challenge_level === 'string');
    assert.ok(typeof plan.assume_familiarity === 'boolean');
  });
});

describe('formatPlanForPrompt', () => {
  it('formats plan as one-line string with verbosity and tone', () => {
    const plan = { verbosity: 'high', tone: 'analytical', follow_up_questions: 1, challenge_level: 'moderate', assume_familiarity: true, proactivity: null };
    const line = formatPlanForPrompt(plan);
    assert.ok(line.includes('verbosity high'));
    assert.ok(line.includes('tone analytical'));
    assert.ok(line.includes('Response plan'));
  });
});
