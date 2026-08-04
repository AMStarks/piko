#!/usr/bin/env node
/**
 * Standalone agent worker (P3.2a).
 * Usage: PIKO_AGENT_ORCH=1 PIKO_DATA_DIR=... node scripts/agent-worker.js
 *
 * Drain: SIGUSR1 or touch $PIKO_DATA_DIR/agent-jobs/.drain — stops new claims;
 * process exits when idle (no running jobs) after drain, or on SIGTERM/SIGINT.
 */
const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);

const {
  startStandaloneWorker,
  stopAgentWorker,
  requestDrain,
  clearDrain,
  isDrainActive,
  countRunningJobs,
  tick,
} = require('../lib/agentWorker');
const { isAgentOrchEnabled } = require('../lib/agentOrchestrator');

if (!isAgentOrchEnabled(root)) {
  console.error('[agent-worker] orch not enabled — set PIKO_AGENT_ORCH=1');
  process.exit(1);
}

// Fresh boot: clear a leftover drain from a previous deploy so we claim again.
if (process.env.PIKO_WORKER_CLEAR_DRAIN_ON_BOOT !== '0') {
  clearDrain(root);
}

const out = startStandaloneWorker(root);
console.log('[agent-worker]', out);

let exiting = false;
function shutdown(reason) {
  if (exiting) return;
  exiting = true;
  console.log(`[agent-worker] shutdown (${reason})`);
  stopAgentWorker();
  process.exit(0);
}

function beginDrain(signal) {
  const p = requestDrain(root);
  console.log(`[agent-worker] drain requested via ${signal || 'file'} → ${p}`);
}

process.on('SIGUSR1', () => beginDrain('SIGUSR1'));
process.on('SIGINT', () => {
  beginDrain('SIGINT');
});
process.on('SIGTERM', () => {
  beginDrain('SIGTERM');
});

// Exit when drained and idle (deploy can restart cleanly).
setInterval(() => {
  if (!isDrainActive(root)) return;
  if (countRunningJobs() > 0) return;
  // One more tick attempt is a no-op under drain; then exit.
  tick(root).catch(() => {}).finally(() => shutdown('drained_idle'));
}, 2000).unref?.();

// Keep alive
setInterval(() => {}, 1 << 30);
