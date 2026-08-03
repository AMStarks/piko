/**
 * Phase 4 — scheduled Legion capability execution (adapter dispatch, no chat replay).
 */
const path = require('path');

const DEFAULT_ADAPTER = String(process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || 'ausmakersupplies').trim();

const {
  stripTrailingSlash,
  collapseWhitespace,
  hasWord,
} = require('./text');

function getDataDir() {
  return String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
}

function getObjectiveFromIntent(intent) {
  return String(
    intent?.objective
    || intent?.briefFields?.objective
    || intent?.title
    || intent?.description
    || '',
  ).trim();
}

/**
 * Infer capability + input from schedule objective text.
 * @returns {{ capability: string, adapterId: string, runbook_id?: string, input: object } | null}
 */
function inferScheduleCapability(objective, dataDir) {
  const text = String(objective || '').trim();
  if (!text) return null;

  const low = collapseWhitespace(text.toLowerCase());
  if (low.includes('ei platform eval') || low.includes('platform qa') || hasWord(low, 'ei-qa')) {
    return {
      capability: 'ei.platform.eval',
      adapterId: String(process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || 'egyptian-insights').trim(),
      input: {},
    };
  }

  const { parseRunbookFromMessage, buildCapabilityInput } = require('./ausmakerRunbook');
  const rb = parseRunbookFromMessage(text);
  if (rb) {
    return {
      capability: 'ausmaker.runbook.execute',
      adapterId: DEFAULT_ADAPTER,
      runbook_id: rb.runbook_id,
      input: buildCapabilityInput({
        capability: 'ausmaker.runbook.execute',
        opts: { runbook_id: rb.runbook_id, sku: rb.sku },
      }),
    };
  }

  const { inferCapabilityFromObjective } = require('./legionCapabilities');
  const capability = inferCapabilityFromObjective({ objective: text }, dataDir);
  if (!capability) return null;

  const route = { capability, opts: {} };
  if (capability === 'inventory.report.export') route.opts = { include_all: true };
  const input = buildCapabilityInput(route);
  if (capability === 'inventory.low_stock.scan' && !input.include_raw) {
    input.include_raw = true;
  }
  return { capability, adapterId: DEFAULT_ADAPTER, input };
}

/**
 * Resolve execution plan from stored intent fields or objective inference.
 */
function resolveScheduleExecution(intent, dataDir) {
  const dir = dataDir || getDataDir();
  const storedCap = String(intent?.capability || '').trim();
  if (storedCap) {
    const { buildCapabilityInput } = require('./ausmakerRunbook');
    const route = {
      capability: storedCap,
      opts: {
        runbook_id: intent.runbook_id,
        sku: intent.sku,
        include_all: storedCap === 'inventory.report.export',
      },
    };
    const input = intent.input && typeof intent.input === 'object'
      ? { ...intent.input }
      : buildCapabilityInput(route);
    if (storedCap === 'inventory.low_stock.scan' && input.include_raw == null) {
      input.include_raw = true;
    }
    return {
      capability: storedCap,
      adapterId: String(intent.adapterId || intent.adapter_id || DEFAULT_ADAPTER).trim(),
      runbook_id: intent.runbook_id || undefined,
      input,
    };
  }
  return inferScheduleCapability(getObjectiveFromIntent(intent), dir);
}

/** Fields to persist on legion_scheduled intent at creation time. */
function buildScheduleCapabilityFields(objective, dataDir) {
  const resolved = inferScheduleCapability(objective, dataDir);
  if (!resolved) return {};
  return {
    capability: resolved.capability,
    adapterId: resolved.adapterId,
    ...(resolved.runbook_id ? { runbook_id: resolved.runbook_id } : {}),
  };
}

function formatScheduledSummary(result, capability, runbookId) {
  const { buildSummaryFromResult, formatInventoryReply } = require('./legionRunPoller');
  const { formatRunbookReply } = require('./ausmakerRunbook');
  if (capability === 'ausmaker.runbook.execute') {
    return formatRunbookReply(result, { runbook_id: runbookId });
  }
  if (capability === 'inventory.low_stock.scan' || capability === 'inventory.report.export') {
    return formatInventoryReply(result, capability, getDataDir(), '', {});
  }
  return buildSummaryFromResult(result, capability, getDataDir()) || 'Legion run completed.';
}

function sendTelegramMessage(message) {
  if (process.env.PIKO_SCHEDULED_SKIP_TELEGRAM === '1' || process.env.PIKO_SCHEDULED_SKIP_TELEGRAM === 'true') {
    return Promise.resolve('skipped');
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
 * Dispatch adapter capability for a scheduled intent, poll, save context, optional Telegram.
 */
async function executeScheduledCapability(intent, opts = {}) {
  const dataDir = opts.dataDir || getDataDir();
  const legionBase = stripTrailingSlash((opts.legionAdapterApiBase
    || process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000'));

  const plan = resolveScheduleExecution(intent, dataDir);
  if (!plan || !plan.capability) {
    return { ok: false, error: 'NO_CAPABILITY', message: 'Could not resolve capability for scheduled intent' };
  }

  const { dispatchLegionCapabilityRun } = require('./legionDispatch');
  const { pollLegionRun } = require('./legionRunPoller');
  const { saveLegionResult, isSilentCapability } = require('./sharedContext');

  const dispatch = await dispatchLegionCapabilityRun({
    adapterId: plan.adapterId,
    capability: plan.capability,
    input: plan.input || {},
    baseUrl: legionBase,
    piko_user_id: `scheduled:${intent.id || 'unknown'}`,
    execution_mode: 'auto',
    risk_level: 'low',
  });

  if (!dispatch.ok || !dispatch.runId) {
    return {
      ok: false,
      capability: plan.capability,
      error: dispatch.code || 'DISPATCH_FAILED',
      message: dispatch.message || 'Legion dispatch failed',
      lastRunStatus: 'failed',
    };
  }

  const polled = await pollLegionRun(dispatch.runId, legionBase);
  if (!polled.ok || !polled.result) {
    return {
      ok: false,
      capability: plan.capability,
      runId: dispatch.runId,
      error: polled.error || polled.status || 'POLL_FAILED',
      lastRunStatus: polled.status === 'timeout' ? 'timeout' : 'failed',
    };
  }

  saveLegionResult(dataDir, plan.capability, polled.result, { source: opts.source || 'scheduled' });

  const objective = getObjectiveFromIntent(intent);
  const summary = formatScheduledSummary(polled.result, plan.capability, plan.runbook_id);
  const notify = opts.notifyTelegram !== false && !isSilentCapability(plan.capability, dataDir);
  if (notify) {
    const title = String(intent.title || objective || plan.capability).slice(0, 80);
    const msg = `⏰ Scheduled: ${title}\n\n${summary}`;
    try {
      await sendTelegramMessage(msg);
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') {
        console.warn('[legionScheduleExecution] telegram notify failed:', e.message);
      }
    }
  }

  return {
    ok: true,
    capability: plan.capability,
    adapterId: plan.adapterId,
    runbook_id: plan.runbook_id,
    runId: dispatch.runId,
    summary,
    lastRunStatus: 'completed',
    lastRunOutcome: summary.slice(0, 500),
  };
}

module.exports = {
  inferScheduleCapability,
  resolveScheduleExecution,
  buildScheduleCapabilityFields,
  executeScheduledCapability,
  getObjectiveFromIntent,
};
