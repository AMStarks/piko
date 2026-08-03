/**
 * Python sandbox — executes raw Python code for complex math, data analysis, or chart generation.
 * Modes (PIKO_PYTHON_SANDBOX_MODE):
 *   host   (default) — host python via child_process (Quant needs pandas/numpy).
 *   docker — docker run --network none (no silent host fallback when mode=docker).
 */
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TIMEOUT_MS = process.env.PIKO_PYTHON_SANDBOX_TIMEOUT_MS
  ? parseInt(process.env.PIKO_PYTHON_SANDBOX_TIMEOUT_MS, 10)
  : 120000; // 2 minutes default for data-science workloads

const {
  includesAny,
} = require('./text');

function sandboxMode() {
  const m = String(process.env.PIKO_PYTHON_SANDBOX_MODE || 'host').trim().toLowerCase();
  return m === 'docker' ? 'docker' : 'host';
}

function resolvePythonExecutable() {
  // Prefer sandbox-specific path, then webchat .venv (pandas/numpy for Quant).
  // Do NOT prefer generic PIKO_PYTHON first — that often points at piko-os tooling
  // venvs without data-science packages and breaks nightly quant.
  const sandboxExplicit = String(process.env.PIKO_PYTHON_SANDBOX_PATH || '').trim();
  if (sandboxExplicit && fs.existsSync(sandboxExplicit)) return sandboxExplicit;
  const localVenv = path.join(__dirname, '..', '.venv', 'bin', 'python');
  if (fs.existsSync(localVenv)) return localVenv;
  const repoRoot = String(process.env.PIKO_REPO_ROOT || '').trim();
  if (repoRoot) {
    const osVenv = path.join(repoRoot, '.venv-os', 'bin', 'python');
    if (fs.existsSync(osVenv)) return osVenv;
  }
  const legacy = String(process.env.PIKO_PYTHON || '').trim();
  if (legacy && fs.existsSync(legacy)) return legacy;
  return 'python3';
}

function formatExecResult(error, stdout, stderr, timeoutMs) {
  if (error) {
    if (error.killed) return 'Error: Script timed out after ' + (timeoutMs / 1000) + ' seconds.';
    const errMsg = (stderr || error.message || '').trim();
    return errMsg ? `Execution Error:\n${errMsg}` : 'Execution failed.';
  }
  const out = (stdout || '').trim();
  return out || 'Script executed successfully with no output.';
}

function cleanupScript(filepath) {
  if (fs.existsSync(filepath)) {
    try { fs.unlinkSync(filepath); } catch (_) { /* ignore */ }
  }
}

/**
 * @param {string} filepath
 * @param {string} filename
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function runHost(filepath, filename, timeoutMs) {
  const pythonExec = resolvePythonExecutable();
  return new Promise((resolve) => {
    exec(`${pythonExec} ${filepath}`, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      cleanupScript(filepath);
      resolve(formatExecResult(error, stdout, stderr, timeoutMs));
    });
  });
}

/**
 * Docker mode — never falls back to host when mode=docker was requested.
 * @param {string} filepath
 * @param {string} filename
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function runDocker(filepath, filename, timeoutMs) {
  const dockerBin = 'docker';
  const image = String(process.env.PIKO_PYTHON_SANDBOX_IMAGE || 'python:3.12-slim').trim();
  const network = String(process.env.PIKO_PYTHON_SANDBOX_NETWORK || 'none').trim() || 'none';
  const memory = String(process.env.PIKO_PYTHON_SANDBOX_MEMORY || '512m').trim() || '512m';
  const cpus = String(process.env.PIKO_PYTHON_SANDBOX_CPUS || '1').trim() || '1';

  const args = [
    'run',
    '--rm',
    '--network', network,
    '--memory', memory,
    '--cpus', cpus,
    '-v', `${DATA_DIR}:/work:rw`,
    '-w', '/work',
    image,
    'python',
    `/work/${filename}`,
  ];

  return new Promise((resolve) => {
    execFile(dockerBin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      cleanupScript(filepath);
      if (error) {
        const msg = String(stderr || error.message || '').toLowerCase();
        // Missing docker binary / image pull failure / unknown image → explicit unavailable
        const errMsg = String(error.message || '').toLowerCase();
        if (
          error.code === 'ENOENT'
          || includesAny(msg, ['unable to find image', 'pull access denied', 'no such image', 'not found', 'cannot connect to the docker'])
          || (errMsg.includes('docker') && errMsg.includes('not found'))
          || errMsg.includes('command not found')
        ) {
          return resolve(
            `Error: docker sandbox unavailable (${(stderr || error.message || 'docker failed').toString().trim().slice(0, 200)})`,
          );
        }
      }
      resolve(formatExecResult(error, stdout, stderr, timeoutMs));
    });
  });
}

/**
 * @param {string} code
 * @param {{ timeoutMs?: number }} [opts]
 */
async function executePythonCode(code, opts = {}) {
  if (!code || typeof code !== 'string') {
    return 'Error: No code provided.';
  }
  if (code.length > 50000) {
    return 'Error: Code exceeds 50KB limit.';
  }
  const mode = sandboxMode();
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filename = `temp_script_${crypto.randomBytes(4).toString('hex')}.py`;
  const filepath = path.join(DATA_DIR, filename);

  try {
    fs.writeFileSync(filepath, code, 'utf8');
    console.log('[pythonSandbox]', mode, filename, 'bytes=' + code.length);

    if (mode === 'docker') {
      return await runDocker(filepath, filename, timeoutMs);
    }
    return await runHost(filepath, filename, timeoutMs);
  } catch (e) {
    cleanupScript(filepath);
    return `Error: ${e.message || 'Unknown error'}`;
  }
}

module.exports = { executePythonCode, resolvePythonExecutable, sandboxMode };
