const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planWorkRules,
  normalizePlan,
  lintPlan,
  buildPlanSchema,
  MAX_STEPS,
} = require('../lib/eiWorkPlanner');
const { reviewAgentOutput } = require('../lib/agentReview');

const ASK = "Please find and add to Corpus Christopher Dunn's Lost Technologies of Ancient Egypt";

test('buildPlanSchema constrains tool to enum', () => {
  const schema = buildPlanSchema(['seek_files', 'harvest']);
  assert.deepEqual(schema.properties.steps.items.properties.tool.enum, ['seek_files', 'harvest']);
  assert.equal(schema.properties.steps.maxItems, MAX_STEPS);
});

test('lintPlan drops argument-less harvest riding a singular seek', () => {
  const plan = {
    ok: true,
    summary: 'x',
    steps: [
      { tool: 'seek_files', args: { query: 'Lost Technologies of Ancient Egypt PDF' }, why: '' },
      { tool: 'harvest', args: {}, why: 'blind dump' },
    ],
    mode: 'llm',
  };
  const out = lintPlan(plan, ASK);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].tool, 'seek_files');
  assert.equal(out.linted, true);
});

test('lintPlan keeps harvest with real args and non-singular goals', () => {
  const plan = {
    ok: true,
    summary: 'x',
    steps: [
      { tool: 'seek_files', args: { query: 'petrie abydos' }, why: '' },
      { tool: 'harvest', args: { query: 'abydos ivory labels', literature_only: true }, why: '' },
    ],
    mode: 'llm',
  };
  assert.equal(lintPlan(plan, 'Find all works by Petrie about Abydos').steps.length, 2);
  assert.equal(lintPlan(plan, ASK).steps.length, 2);
});

test('lintPlan strips empty-args padding on plural asks too', () => {
  const plan = {
    ok: true,
    summary: 'x',
    steps: [
      { tool: 'seek_files', args: { query: 'all works by Robert Schoch PDF' }, why: '' },
      { tool: 'harvest', args: {}, why: 'pad' },
      { tool: 'find_literature', args: {}, why: 'pad' },
      { tool: 'search_corpus', args: {}, why: 'pad' },
    ],
    mode: 'llm',
  };
  const out = lintPlan(plan, 'Please find and add to Corpus all PDFs, articles, and books by Robert Schoch');
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].tool, 'seek_files');
});

test('lintPlan leaves a single argument-less step alone', () => {
  const plan = {
    ok: true,
    summary: 'x',
    steps: [{ tool: 'review_corpus', args: {}, why: '' }],
    mode: 'llm',
  };
  assert.equal(lintPlan(plan, 'Please review the corpus').steps.length, 1);
});

test('normalizePlan applies lint after named-work hints', () => {
  const plan = normalizePlan({
    summary: 's',
    steps: [
      { tool: 'seek_files', args: {}, why: '' },
      { tool: 'harvest', args: {}, why: '' },
    ],
    mode: 'llm',
  }, ASK);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].args.max_keeps, 1);
});

test('planWorkRules fallback is focused and capped for singular ask', () => {
  const plan = planWorkRules(ASK);
  assert.equal(plan.mode, 'fallback');
  assert.equal(plan.steps.length, 1);
  assert.match(plan.steps[0].args.query, /Lost Technologies/i);
  assert.equal(plan.steps[0].args.max_keeps, 1);
});

test('review llm mode: deterministic floor blocks before LLM', async () => {
  process.env.PIKO_AGENT_REVIEW_MODE = 'llm';
  try {
    const out = await reviewAgentOutput({
      brief: ASK,
      agentId: 'ei-worker',
      status: 'needs_revision',
      artifactText: '[ei-worker / shared tool belt]\nGoal fit: poor',
      result: { pass: false, goal_fit: { pass: false, summary: 'kept 0' } },
    });
    assert.notEqual(out.verdict, 'accept');
    assert.equal(out.mode, 'rules_floor');
    assert.ok(out.reasons.includes('deterministic_floor'));
  } finally {
    delete process.env.PIKO_AGENT_REVIEW_MODE;
  }
});
