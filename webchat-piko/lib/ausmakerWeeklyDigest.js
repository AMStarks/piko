/**
 * Phase 6 — weekly AusMaker health digest: refresh sales + inventory context, run analyst, notify.
 */
const path = require('path');

const DIGEST_CAPS = ['sales.analysis.run', 'inventory.low_stock.scan'];
const DEFAULT_ADAPTER = String(process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies').trim();

const {
  stripTrailingSlash,
} = require('./text');

function getDataDir(opts) {
  return String(opts.dataDir || process.env.PIKO_DATA_DIR || '').trim()
    || path.join(__dirname, '..', 'data');
}

async function refreshCapabilityIfStale(capability, dataDir, legionBase) {
  const { getCapabilityFreshness } = require('./sharedContext');
  const fresh = getCapabilityFreshness(dataDir, capability);
  if (fresh.fresh) return { capability, skipped: true, fresh: true };

  const { buildCapabilityInput } = require('./ausmakerRunbook');
  const { dispatchLegionCapabilityRun } = require('./legionDispatch');
  const { pollLegionRun } = require('./legionRunPoller');
  const { saveLegionResult } = require('./sharedContext');

  const route = { capability, opts: {} };
  if (capability === 'inventory.report.export') route.opts = { include_all: true };
  const input = buildCapabilityInput(route);
  if (capability === 'inventory.low_stock.scan' && !input.include_raw) {
    input.include_raw = true;
  }

  const dispatch = await dispatchLegionCapabilityRun({
    adapterId: DEFAULT_ADAPTER,
    capability,
    input,
    baseUrl: legionBase,
    piko_user_id: 'scheduled:weekly-digest',
    execution_mode: 'auto',
    risk_level: 'low',
  });
  if (!dispatch.ok || !dispatch.runId) {
    return { capability, ok: false, error: dispatch.message || dispatch.code || 'dispatch_failed' };
  }

  const polled = await pollLegionRun(dispatch.runId, legionBase);
  if (!polled.ok || !polled.result) {
    return { capability, ok: false, runId: dispatch.runId, error: polled.error || polled.status || 'poll_failed' };
  }

  saveLegionResult(dataDir, capability, polled.result, { source: 'scheduled' });
  return { capability, ok: true, runId: dispatch.runId, refreshed: true };
}

function formatDigestMessage(review, refreshResults) {
  const { formatBusinessHealthReply } = require('./proactive/analyst');
  const lines = ['📊 Weekly AusMaker business digest'];
  const refreshed = (refreshResults || []).filter((r) => r.refreshed).map((r) => r.capability);
  if (refreshed.length) lines.push(`Refreshed: ${refreshed.join(', ')}`);
  lines.push(formatBusinessHealthReply(review));
  return lines.join('\n\n');
}

async function sendTelegramMessage(message) {
  if (process.env.PIKO_SCHEDULED_SKIP_TELEGRAM === '1' || process.env.PIKO_SCHEDULED_SKIP_TELEGRAM === 'true') {
    return 'skipped';
  }
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    const fs = require('fs');
    const repoRoot = process.env.PIKO_REPO_ROOT || path.join(__dirname, '..', '..');
    const venvPy = path.join(repoRoot, '.venv-os', 'bin', 'python');
    const pyBin = process.env.PIKO_PYTHON
      || (fs.existsSync(venvPy) ? venvPy : null)
      || 'python3';
    const py = [
      'import json',
      'from yolo_protocol import execute_tool_yolo',
      `print(execute_tool_yolo("send_telegram_message", json.dumps({"message": ${JSON.stringify(String(message).slice(0, 3900))}})))`,
    ].join('; ');
    execFile(pyBin, ['-c', py], { cwd: repoRoot, timeout: 45000, env: process.env }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout || '').trim());
    });
  });
}

/**
 * Run weekly compound digest for scheduled intent `ausmaker.weekly.health.digest`.
 */
async function runWeeklyHealthDigest(intent, opts = {}) {
  const dataDir = getDataDir(opts);
  const legionBase = stripTrailingSlash((opts.legionAdapterApiBase
    || process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000'));

  const refreshResults = [];
  for (const cap of DIGEST_CAPS) {
    refreshResults.push(await refreshCapabilityIfStale(cap, dataDir, legionBase));
  }

  const failed = refreshResults.find((r) => r.ok === false);
  if (failed) {
    return {
      ok: false,
      capability: 'ausmaker.weekly.health.digest',
      error: failed.error || 'refresh_failed',
      refreshResults,
      lastRunStatus: 'failed',
    };
  }

  const { runBusinessHealthReview } = require('./proactive/analyst');
  const review = await runBusinessHealthReview(dataDir, { forceAnalyze: true });
  const summary = formatDigestMessage(review, refreshResults);

  if (opts.notifyTelegram !== false) {
    try {
      await sendTelegramMessage(summary);
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') {
        console.warn('[ausmakerWeeklyDigest] telegram failed:', e.message);
      }
    }
  }

  return {
    ok: true,
    capability: 'ausmaker.weekly.health.digest',
    summary,
    review,
    refreshResults,
    lastRunStatus: 'completed',
    lastRunOutcome: summary.slice(0, 500),
  };
}

module.exports = {
  DIGEST_CAPS,
  runWeeklyHealthDigest,
  refreshCapabilityIfStale,
  formatDigestMessage,
};
