/**
 * Per-session mutex so chat turns and async Legate progress/review appends
 * cannot interleave session history writes.
 */
const sessionLocks = new Map();

async function acquireSessionLock(sessionId, task) {
  const key = String(sessionId || '').trim() || '_default';
  if (!sessionLocks.has(key)) sessionLocks.set(key, Promise.resolve());
  const previousTask = sessionLocks.get(key);
  let release;
  const nextTask = new Promise((resolve) => { release = resolve; });
  sessionLocks.set(key, previousTask.then(() => nextTask));
  try {
    await previousTask;
    return await task();
  } finally {
    release();
  }
}

module.exports = { acquireSessionLock };
