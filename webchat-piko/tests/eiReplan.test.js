/**
 * Phase 3 — bounded re-plan after step failure.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('eiWorkerRuntime replan', () => {
  const prev = process.env.PIKO_EI_REPLAN;

  before(() => { process.env.PIKO_EI_REPLAN = '1'; });
  after(() => {
    if (prev == null) delete process.env.PIKO_EI_REPLAN;
    else process.env.PIKO_EI_REPLAN = prev;
  });

  it('shouldReplan true when a step fails and no keeps', () => {
    const { shouldReplan } = require('../lib/eiWorkerRuntime');
    assert.equal(shouldReplan([{ ok: false, tool: 'seek_files' }]), true);
    assert.equal(shouldReplan([{ ok: true, tool: 'seek_files' }]), false);
    assert.equal(shouldReplan([{
      ok: false,
      mission_fit: { judgments: [{ verdict: 'keep', harvest_id: 1 }] },
    }]), false);
  });

  it('runEiWorker replans once then stops', async () => {
    delete require.cache[require.resolve('../lib/eiWorkerRuntime')];
    const { runEiWorker } = require('../lib/eiWorkerRuntime');
    let planCalls = 0;
    let toolCalls = 0;

    const out = await runEiWorker({
      goal: 'find nonexistent volume xyzzy-12345',
      llm: false,
      plan: {
        summary: 'first plan',
        mode: 'test',
        steps: [{ tool: 'seek_files', args: { query: 'xyzzy' }, why: 'first' }],
      },
      planWorkFn: async () => {
        planCalls += 1;
        return {
          summary: 'replan',
          mode: 'test',
          steps: [{ tool: 'seek_files', args: { query: 'xyzzy alt' }, why: 'retry' }],
        };
      },
      runToolFn: async (name, args) => {
        toolCalls += 1;
        return {
          ok: false,
          artifact: `Error: not found (${args.query || name})`,
          result: null,
          mission_fit: null,
        };
      },
    });

    assert.equal(planCalls, 1, 'exactly one re-plan call');
    assert.equal(toolCalls, 2, 'original + one replan step');
    assert.equal(out.result.replan && out.result.replan.status, 'ran');
    assert.equal(out.result.replan.added, 1);
    assert.ok(out.artifact_text.includes('Re-planned after step failure'));
    assert.equal(out.result.steps.filter((s) => s.replanned).length, 1);
  });

  it('empty replan records no_alternative', async () => {
    delete require.cache[require.resolve('../lib/eiWorkerRuntime')];
    const { runEiWorker } = require('../lib/eiWorkerRuntime');
    const out = await runEiWorker({
      goal: 'impossible',
      plan: {
        summary: 'first',
        mode: 'test',
        steps: [{ tool: 'seek_files', args: {}, why: 'x' }],
      },
      planWorkFn: async () => ({ summary: 'cannot', steps: [] }),
      runToolFn: async () => ({ ok: false, artifact: 'Error: boom', result: null }),
    });
    assert.equal(out.result.replan.status, 'no_alternative');
    assert.ok(out.artifact_text.includes('no viable alternative'));
  });

  it('does not replan when all steps ok', async () => {
    delete require.cache[require.resolve('../lib/eiWorkerRuntime')];
    const { runEiWorker } = require('../lib/eiWorkerRuntime');
    let planCalls = 0;
    const out = await runEiWorker({
      goal: 'status',
      plan: {
        summary: 'ok',
        mode: 'test',
        steps: [{ tool: 'research_campaign', args: { action: 'status' }, why: 'x' }],
      },
      planWorkFn: async () => { planCalls += 1; return { steps: [] }; },
      runToolFn: async () => ({ ok: true, artifact: 'ok', result: {} }),
    });
    assert.equal(planCalls, 0);
    assert.equal(out.result.replan, null);
  });
});
