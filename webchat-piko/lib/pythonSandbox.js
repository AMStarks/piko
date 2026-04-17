/**
 * Python sandbox — executes raw Python code for complex math, data analysis, or chart generation.
 * Runs in isolated temp file. Default 2min timeout for heavy statsmodels workloads (17k+ rows).
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TIMEOUT_MS = process.env.PIKO_PYTHON_SANDBOX_TIMEOUT_MS
  ? parseInt(process.env.PIKO_PYTHON_SANDBOX_TIMEOUT_MS, 10)
  : 120000; // 2 minutes default for data-science workloads

const PYTHON_EXEC = (() => {
  const venvPython = path.join(__dirname, '..', '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return process.env.PIKO_PYTHON_SANDBOX_PATH || 'python3';
})();

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
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filename = `temp_script_${crypto.randomBytes(4).toString('hex')}.py`;
  const filepath = path.join(DATA_DIR, filename);

  try {
    fs.writeFileSync(filepath, code, 'utf8');
    if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SANDBOX] Executing Python script:', filename);

    return await new Promise((resolve) => {
      exec(`${PYTHON_EXEC} ${filepath}`, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (fs.existsSync(filepath)) {
          try {
            fs.unlinkSync(filepath);
          } catch (_) {}
        }
        if (error) {
          if (error.killed) return resolve('Error: Script timed out after ' + (timeoutMs / 1000) + ' seconds.');
          const errMsg = (stderr || error.message || '').trim();
          return resolve(errMsg ? `Execution Error:\n${errMsg}` : 'Execution failed.');
        }
        const out = (stdout || '').trim();
        resolve(out || 'Script executed successfully with no output.');
      });
    });
  } catch (e) {
    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
      } catch (_) {}
    }
    return `Error: ${e.message || 'Unknown error'}`;
  }
}

module.exports = { executePythonCode };
