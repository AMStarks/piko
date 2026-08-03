const test = require('node:test');
const assert = require('node:assert/strict');
const { createProactiveCycleRunner } = require('../lib/proactive/schedulerRunner');

test('skips overlapping runs when configured', async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let calls = 0;
  const runner = createProactiveCycleRunner({
    runCycle: async () => {
      calls += 1;
      if (calls === 1) return first;
      return { ok: true };
    },
    log: () => {},
    defaultTimeoutMs: 2000,
  });

  const p1 = runner.run('scheduler', { skipIfBusy: true });
  const p2 = runner.run('scheduler', { skipIfBusy: true });
  const out2 = await p2;
  assert.equal(out2.skipped, true);
  assert.equal(out2.reason, 'busy');
  resolveFirst({ source: 'scheduler' });
  const out1 = await p1;
  assert.equal(out1.ok, true);
  assert.equal(calls, 1);
});

test('times out long-running cycle by budget', async () => {
  const runner = createProactiveCycleRunner({
    runCycle: async () => new Promise(() => {}),
    log: () => {},
    defaultTimeoutMs: 20,
  });
  await assert.rejects(
    () => runner.run('scheduler', { skipIfBusy: true, timeoutMs: 20 }),
    (err) => err && err.code === 'PROACTIVE_CYCLE_TIMEOUT',
  );
});

test('exposes in-flight state while running', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runner = createProactiveCycleRunner({
    runCycle: async () => gate,
    log: () => {},
    defaultTimeoutMs: 1000,
  });
  const pending = runner.run('boot', { skipIfBusy: true });
  const state = runner.getState();
  assert.equal(state.inFlight, true);
  assert.equal(state.activeSource, 'boot');
  release({ ok: true });
  await pending;
  const after = runner.getState();
  assert.equal(after.inFlight, false);
});
