const test = require('node:test');
const assert = require('node:assert/strict');

const { extractDocumentText } = require('../lib/eiCorpusContentReview');
const { maybeSeedDirectToolPlan, maybeRunDirectToolPlan } = require('../lib/agentWorker');

test('extractDocumentText reads .txt documents verbatim', async () => {
  const text = 'Utterance 217.\nThe king ascends; word for word as written.\n';
  const out = await extractDocumentText({
    path: '/data/egyptian-insights/assets/documents/webtext_abc.txt',
    buffer: Buffer.from(text, 'utf8'),
  });
  assert.equal(out, text.trim());
});

test('extractDocumentText: pdf magic routes to pdf-parse (garbage → empty, not utf8 dump)', async () => {
  const out = await extractDocumentText({
    path: '/tmp/whatever.pdf',
    buffer: Buffer.from('%PDF-1.4 not really a pdf'),
  });
  assert.equal(typeof out, 'string');
  assert.ok(!out.includes('%PDF') || out === '');
});

test('maybeSeedDirectToolPlan pre-seeds ingest_url for pasted URL work orders', () => {
  const goal = 'Please ingest the Pyramid Texts, found here: https://sacred-texts.com/egy/pyt/';
  const plan = maybeSeedDirectToolPlan(goal);
  assert.ok(plan && plan.ok);
  assert.equal(plan.steps[0].tool, 'ingest_url');
  assert.equal(plan.steps[0].args.url, 'https://sacred-texts.com/egy/pyt/');
});

test('maybeRunDirectToolPlan executes pre-seeded plan via ei-worker tool belt', async () => {
  const calls = [];
  const fakeRunTool = async (tool, args) => {
    calls.push({ tool, args });
    return {
      ok: true,
      tool,
      artifact: 'Ingested 1 document (kept).',
      result: { mission_fit: { judgments: [{ verdict: 'keep', harvest_id: 999 }] } },
    };
  };
  const goal = 'Please ingest the Pyramid Texts, found here: https://sacred-texts.com/egy/pyt/';
  const out = await maybeRunDirectToolPlan(goal, { root: process.cwd(), runToolFn: fakeRunTool });
  assert.ok(out, 'expected a seeded tool plan result');
  assert.equal(out.run.agent_id, 'ei-worker');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'ingest_url');
  assert.equal(calls[0].args.url, 'https://sacred-texts.com/egy/pyt/');
  assert.equal(out.ok, true);
  assert.match(out.run.artifact_text, /ingest_url/);
  assert.ok(out.run.result.mission_fit || (out.run.result.plan && out.run.result.plan.steps));
});

test('maybeSeedDirectToolPlan leaves non-URL work orders to the normal agent path', () => {
  const out = maybeSeedDirectToolPlan('Find me early dynastic excavation reports for Abydos');
  assert.equal(out, null);
});

test('executeLegionAgent refuses raw URL queries for research.scrape.run', async () => {
  const { executeLegionAgent } = require('../lib/agentAdapterRuntime');
  const agent = {
    id: 'ei-harvester',
    adapter_id: 'egyptian-insights',
    legion_capability: 'research.scrape.run',
    default_input: { limit: 15, allow_stubs: false, require_image: true },
  };
  const out = await executeLegionAgent(
    agent,
    'Please ingest the Pyramid Texts, found here: https://sacred-texts.com/egy/pyt/',
  );
  assert.equal(out.status, 'failed');
  assert.match(out.artifact_text, /ingest_url/);
});

test('ingest_url harvest input includes web_text source', () => {
  const { buildHarvestInput } = require('../lib/eiAgentTools');
  const input = buildHarvestInput('SEED_URL:https://sacred-texts.com/egy/pyt/', {
    seek_files: true,
    volume_job: true,
    literature_only: true,
    require_image: false,
    require_document: true,
    sources: ['web_pdf', 'web_text'],
    limit: 3,
    skip_thin: true,
  });
  assert.deepEqual(input.sources, ['web_pdf', 'web_text']);
  assert.equal(input.require_document, true);
  assert.equal(input.require_image, false);
});
