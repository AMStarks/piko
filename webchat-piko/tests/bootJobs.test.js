const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler, cultureOnly, always, jobEnabled } = require('../lib/scheduler');
const { registerBootJobs, EXPECTED_JOB_IDS } = require('../lib/bootJobs');

describe('P5.2 bootJobs registration snapshot', () => {
  it('registers the same job ids as the pre-extract server.js set', () => {
    const scheduler = createScheduler({
      rootDir: __dirname,
      getTenantProfile: () => ({ profileId: 'test', tenant_id: 'test' }),
    });
    const ids = registerBootJobs(scheduler, {
      rootDir: __dirname + '/..',
      cultureOnly,
      jobEnabled,
      always,
      runUnifiedHeartbeat: () => {},
      telegramNotify: async () => {},
      DATA_DIR: '/tmp/piko-bootjobs-test',
      AUSMAKER_BASE_URL: 'http://127.0.0.1:9',
      stripTrailingSlash: (s) => {
        let t = String(s || '');
        while (t.endsWith('/')) t = t.slice(0, -1);
        return t;
      },
      dumpHistory: () => {},
      lastDumpDateRef: { value: '2026-01-01' },
      isJobEnabled: () => false,
      proactiveCycleRunner: { run: async () => {} },
      log: () => {},
    });
    assert.deepEqual(ids.slice().sort(), EXPECTED_JOB_IDS.slice().sort());
    assert.equal(ids.length, 27);
  });
});
