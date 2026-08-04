const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('agentWorker drain + standalone', () => {
  let dir;
  let prevData;
  let prevStandalone;
  let prevOrch;
  let prevWorker;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-worker-p32-'));
    prevData = process.env.PIKO_DATA_DIR;
    prevStandalone = process.env.PIKO_WORKER_STANDALONE;
    prevOrch = process.env.PIKO_AGENT_ORCH;
    prevWorker = process.env.PIKO_AGENT_WORKER;
    process.env.PIKO_DATA_DIR = dir;
    process.env.PIKO_AGENT_ORCH = '1';
    process.env.PIKO_AGENT_WORKER = '1';
    fs.mkdirSync(path.join(dir, 'agent-jobs', 'pending'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'agent-jobs', 'running'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'agent-jobs', 'done'), { recursive: true });
  });

  after(() => {
    if (prevData === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevStandalone === undefined) delete process.env.PIKO_WORKER_STANDALONE;
    else process.env.PIKO_WORKER_STANDALONE = prevStandalone;
    if (prevOrch === undefined) delete process.env.PIKO_AGENT_ORCH;
    else process.env.PIKO_AGENT_ORCH = prevOrch;
    if (prevWorker === undefined) delete process.env.PIKO_AGENT_WORKER;
    else process.env.PIKO_AGENT_WORKER = prevWorker;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  beforeEach(() => {
    delete process.env.PIKO_WORKER_STANDALONE;
    const {
      stopAgentWorker, clearDrain,
    } = require('../lib/agentWorker');
    stopAgentWorker();
    clearDrain(path.join(__dirname, '..'));
  });

  it('isStandaloneWorkerMode reads PIKO_WORKER_STANDALONE', () => {
    const { isStandaloneWorkerMode } = require('../lib/agentWorker');
    assert.equal(isStandaloneWorkerMode(), false);
    process.env.PIKO_WORKER_STANDALONE = '1';
    assert.equal(isStandaloneWorkerMode(), true);
  });

  it('requestDrain creates drain file; tick skips claim', async () => {
    const {
      requestDrain, isDrainActive, tick, drainPath, clearDrain,
    } = require('../lib/agentWorker');
    const root = path.join(__dirname, '..');
    clearDrain(root);
    assert.equal(isDrainActive(root), false);
    const p = requestDrain(root);
    assert.equal(p, drainPath(root));
    assert.equal(fs.existsSync(p), true);
    assert.equal(isDrainActive(root), true);
    // Should return without throwing / claiming even if pending exists.
    await tick(root);
    clearDrain(root);
    assert.equal(isDrainActive(root), false);
  });

  it('startAgentWorker with STANDALONE=1 returns reaper-only', () => {
    process.env.PIKO_WORKER_STANDALONE = '1';
    const { startAgentWorker, stopAgentWorker } = require('../lib/agentWorker');
    const out = startAgentWorker(path.join(__dirname, '..'));
    assert.equal(out.started, false);
    assert.equal(out.reason, 'standalone');
    assert.equal(out.reaper, true);
    stopAgentWorker();
  });
});
