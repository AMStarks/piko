const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('reapOrphanedRunning closes stranded running jobs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-jobs-'));
  process.env.PIKO_DATA_DIR = tmp;
  delete require.cache[require.resolve('../lib/agentJobs')];
  delete require.cache[require.resolve('../lib/agentRegistry')];
  const { enqueueJob, claimNextPending, reapOrphanedRunning, readJob, cancelJob } = require('../lib/agentJobs');

  // Simulate two jobs stranded mid-run by a process restart.
  const a = enqueueJob({ type: 'agent_run', payload: { agent_id: 'ei-worker', brief: 'stranded one' } }).job;
  const b = enqueueJob({ type: 'agent_run', payload: { agent_id: 'ei-worker', brief: 'stranded cancelled' } }).job;
  // Claim order follows filename sort, not enqueue order — compare as a set.
  const claimed = [claimNextPending().id, claimNextPending().id].sort();
  assert.deepEqual(claimed, [a.id, b.id].sort());
  cancelJob(b.id);
  assert.equal(readJob(a.id).status, 'running');

  const reaped = reapOrphanedRunning();
  assert.equal(reaped.length, 2);

  const ra = readJob(a.id);
  assert.equal(ra.status, 'done');
  assert.equal(ra.error, 'orphaned_by_restart');
  assert.equal(ra.result.orphaned, true);

  const rb = readJob(b.id);
  assert.equal(rb.status, 'done');
  assert.equal(rb.error, 'cancelled');
  assert.equal(rb.cancelled, true);

  // Idempotent: nothing left to reap.
  assert.equal(reapOrphanedRunning().length, 0);

  delete process.env.PIKO_DATA_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});
