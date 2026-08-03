/**
 * Thin HTTP transport → Python `execute_tool_yolo` (single tool registry).
 * See docs/ENTERPRISE_TOOLS_CHANNELS.md — no duplicate tool logic in Node.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function getPikoRepoRoot() {
  return String(process.env.PIKO_REPO_ROOT || path.join(__dirname, '..', '..')).trim();
}

function getPythonBin() {
  const repo = getPikoRepoRoot();
  const venvPy = path.join(repo, '.venv-os', 'bin', 'python');
  if (process.env.PIKO_PYTHON) return process.env.PIKO_PYTHON;
  if (fs.existsSync(venvPy)) return venvPy;
  return 'python3';
}

function runYoloTool(toolName, argsObj, options = {}) {
  const name = String(toolName || '').trim();
  if (!name) throw new Error('tool name is required');
  const repo = getPikoRepoRoot();
  const pyBin = getPythonBin();
  const argsJson = JSON.stringify(argsObj && typeof argsObj === 'object' ? argsObj : {});
  const channel = String(options.channel || 'ios').trim() || 'ios';
  const timeoutMs = Number(options.timeoutMs) || Number(process.env.PIKO_YOLO_TOOL_TIMEOUT_MS) || 180000;
  const env = {
    ...process.env,
    PIKO_HITL_ASYNC: '1',
    PIKO_HITL_CHANNEL: channel,
    PYTHONPATH: repo,
  };
  const py = [
    'import os',
    `os.environ["PIKO_HITL_ASYNC"] = "1"`,
    `os.environ["PIKO_HITL_CHANNEL"] = ${JSON.stringify(channel)}`,
    'from yolo_protocol import execute_tool_yolo',
    `print(execute_tool_yolo(${JSON.stringify(name)}, ${JSON.stringify(argsJson)}))`,
  ].join('\n');
  const out = execFileSync(pyBin, ['-c', py], {
    cwd: repo,
    encoding: 'utf8',
    timeout: timeoutMs,
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return (out || '').trim();
}

function getYoloToolRegistry() {
  const repo = getPikoRepoRoot();
  const pyBin = getPythonBin();
  const py = 'from yolo_protocol import get_yolo_tool_registry; print(get_yolo_tool_registry())';
  const out = execFileSync(pyBin, ['-c', py], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PYTHONPATH: repo },
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse((out || '').trim());
}

module.exports = {
  getPikoRepoRoot,
  getPythonBin,
  runYoloTool,
  getYoloToolRegistry,
};
