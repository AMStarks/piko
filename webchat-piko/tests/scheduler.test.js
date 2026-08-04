/**
 * P3.1d — scheduler registry.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler, cultureOnly, ausmakerOnly, always } = require('../lib/scheduler');

describe('lib/scheduler', () => {
  it('skips ticks when tenantGate returns false', async () => {
    let ran = 0;
    const sched = createScheduler({
      getTenantProfile: () => ({ isCulture: false, profileId: 'ausmaker' }),
      log: () => {},
    });
    sched.register({
      id: 'culture_only_job',
      intervalMs: 60_000,
      tenantGate: cultureOnly,
      fn: async () => { ran += 1; },
    });
    await sched._tick(sched._registry[0]);
    assert.equal(ran, 0);
  });

  it('runs when tenantGate allows', async () => {
    let ran = 0;
    const sched = createScheduler({
      getTenantProfile: () => ({ isCulture: true, profileId: 'culture' }),
      log: () => {},
    });
    sched.register({
      id: 'culture_job',
      cronExpr: '*/5 * * * *',
      tenantGate: cultureOnly,
      fn: async () => { ran += 1; },
    });
    await sched._tick(sched._registry[0]);
    assert.equal(ran, 1);
  });

  it('always gate runs for any profile', async () => {
    let ran = 0;
    const sched = createScheduler({
      getTenantProfile: () => ({ isCulture: false }),
      log: () => {},
    });
    sched.register({
      id: 'always_job',
      intervalMs: 1000,
      tenantGate: always,
      fn: async () => { ran += 1; },
    });
    await sched._tick(sched._registry[0]);
    assert.equal(ran, 1);
  });

  it('list exposes registered ids', () => {
    const sched = createScheduler({ getTenantProfile: () => ({}), log: () => {} });
    sched.register({ id: 'a', intervalMs: 1000, fn: async () => {} });
    assert.deepEqual(sched.list().map((r) => r.id), ['a']);
  });

  it('ausmakerOnly skips culture profiles', async () => {
    let ran = 0;
    const sched = createScheduler({
      getTenantProfile: () => ({ isAusmaker: false, isCulture: true }),
      log: () => {},
    });
    sched.register({
      id: 'am',
      intervalMs: 1000,
      tenantGate: ausmakerOnly,
      fn: async () => { ran += 1; },
    });
    await sched._tick(sched._registry[0]);
    assert.equal(ran, 0);
  });
});
