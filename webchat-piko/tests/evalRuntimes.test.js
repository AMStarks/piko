const test = require('node:test');
const assert = require('node:assert/strict');
const { register, resolveEvalImpl } = require('../lib/evalRuntimes');

test('resolveEvalImpl: eval_impl > agent id > platform-eval default', () => {
  const byId = resolveEvalImpl({ id: 'ei-worker' });
  assert.equal(typeof byId, 'function');

  register('business-worker', async () => ({ status: 'ok', artifact_text: 'biz', result: {} }));
  const byImpl = resolveEvalImpl({ id: 'ausmaker-ops', eval_impl: 'business-worker' });
  assert.equal(typeof byImpl, 'function');

  // Unknown ids keep legacy behavior: fall back to the platform eval.
  const fallback = resolveEvalImpl({ id: 'ei-qa' });
  assert.equal(fallback, resolveEvalImpl({ id: 'totally-unknown' }));
  assert.notEqual(byId, fallback);
});

test('registered impl runs with uniform contract', async () => {
  register('echo-worker', async (agent, brief, ctx) => {
    ctx.onProgress({ stage: 'running', message: 'echoing' });
    return { status: 'ok', artifact_text: `echo: ${brief}`, result: { agent: agent.id } };
  });
  const impl = resolveEvalImpl({ id: 'x', eval_impl: 'echo-worker' });
  const events = [];
  const out = await impl({ id: 'x', eval_impl: 'echo-worker' }, 'hello', {
    rootDir: '/tmp', missionId: null, pikoUserId: null, plan: null,
    onProgress: (e) => events.push(e),
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.artifact_text, 'echo: hello');
  assert.equal(out.result.agent, 'x');
  assert.equal(events.length, 1);
});
