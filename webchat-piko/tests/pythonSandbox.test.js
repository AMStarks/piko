/**
 * Phase 1 — pythonSandbox host + docker modes.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('pythonSandbox', () => {
  const prev = {};

  before(() => {
    for (const k of [
      'PIKO_PYTHON_SANDBOX_MODE',
      'PIKO_PYTHON_SANDBOX_IMAGE',
      'PIKO_PYTHON_SANDBOX_NETWORK',
    ]) {
      prev[k] = process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    // Clear module cache so env re-reads on next require in other suites
    delete require.cache[require.resolve('../lib/pythonSandbox')];
  });

  it('host mode executes print(1+1) → 2', async () => {
    process.env.PIKO_PYTHON_SANDBOX_MODE = 'host';
    delete require.cache[require.resolve('../lib/pythonSandbox')];
    const { executePythonCode } = require('../lib/pythonSandbox');
    const out = await executePythonCode('print(1+1)');
    assert.equal(out.trim(), '2');
  });

  it('docker mode with missing image returns Error: (no host fallback)', async () => {
    process.env.PIKO_PYTHON_SANDBOX_MODE = 'docker';
    process.env.PIKO_PYTHON_SANDBOX_IMAGE = 'definitely-missing-image:nope';
    delete require.cache[require.resolve('../lib/pythonSandbox')];
    const { executePythonCode } = require('../lib/pythonSandbox');
    const out = await executePythonCode('print(1)');
    assert.match(out, /^Error:/);
    // Must not silently succeed as host would
    assert.notEqual(out.trim(), '1');
  });

  it('code >50KB rejected', async () => {
    process.env.PIKO_PYTHON_SANDBOX_MODE = 'host';
    delete require.cache[require.resolve('../lib/pythonSandbox')];
    const { executePythonCode } = require('../lib/pythonSandbox');
    const out = await executePythonCode('x' + 'y'.repeat(50001));
    assert.match(out, /50KB/i);
  });

  it('sandboxMode defaults to host', () => {
    delete process.env.PIKO_PYTHON_SANDBOX_MODE;
    delete require.cache[require.resolve('../lib/pythonSandbox')];
    const { sandboxMode } = require('../lib/pythonSandbox');
    assert.equal(sandboxMode(), 'host');
  });
});
