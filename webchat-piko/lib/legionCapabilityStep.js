/**
 * Phase 9 — single adapter capability execution (dispatch → poll → context → summary).
 */
const path = require('path');

const {
  stripTrailingSlash,
} = require('./text');

function getDataDir(opts) {
  return opts.dataDir || process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function getLegionBase(opts) {
  return stripTrailingSlash((opts.legionAdapterApiBase
    || process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000'));
}

/**
 * @param {object} step - { capability, runbook_id?, label?, input? } or { type, sku? }
 * @param {object} opts
 * @returns {Promise<{ ok: boolean, capability?: string, type?: string, summary: string, runId?: string, error?: string }>}
 */
async function executeLegionCapabilityStep(step, opts = {}) {
  const dataDir = getDataDir(opts);
  const legionBase = getLegionBase(opts);
  const message = String(opts.message || '');

  if (step.type === 'business_health') {
    const { runBusinessHealthReview, formatBusinessHealthReply } = require('./proactive/analyst');
    const review = await runBusinessHealthReview(dataDir, { forceAnalyze: true });
    return {
      type: 'business_health',
      ok: review.action !== 'stale' || !!review.freshness,
      summary: formatBusinessHealthReply(review),
    };
  }

  if (step.type === 'forecast_review' && step.sku) {
    const { buildForecastReviewReply } = require('./ausmakerForecast');
    const baseUrl = stripTrailingSlash((opts.ausmakerBaseUrl || process.env.AUSMAKER_BASE_URL || 'http://127.0.0.1:5001'));
    const summary = await buildForecastReviewReply(message, String(step.sku).trim(), opts.sessionModel, baseUrl);
    return { type: 'forecast_review', ok: true, summary: String(summary || '') };
  }

  if (step.type === 'forecast_recompute' && step.sku) {
    const { buildForecastRecomputeReply } = require('./ausmakerForecast');
    const baseUrl = stripTrailingSlash((opts.ausmakerBaseUrl || process.env.AUSMAKER_BASE_URL || 'http://127.0.0.1:5001'));
    const summary = await buildForecastRecomputeReply(String(step.sku).trim(), baseUrl);
    return { type: 'forecast_recompute', ok: true, summary: String(summary || '') };
  }

  const capability = String(step.capability || '').trim();
  if (!capability) {
    return { ok: false, summary: 'No capability for step.', error: 'NO_CAPABILITY' };
  }

  const { buildCapabilityInput, formatRunbookReply } = require('./ausmakerRunbook');
  const route = {
    capability,
    opts: {
      runbook_id: step.runbook_id,
      sku: step.sku,
      label: step.label,
      ...(step.input && typeof step.input === 'object' ? step.input : {}),
    },
  };
  const input = step.input && typeof step.input === 'object' && !step.runbook_id
    ? { ...buildCapabilityInput({ capability, opts: route.opts }), ...step.input }
    : buildCapabilityInput({ capability, opts: route.opts });

  const { dispatchLegionCapabilityRun } = require('./legionDispatch');
  const dispatch = await dispatchLegionCapabilityRun({
    capability,
    input,
    baseUrl: legionBase,
    piko_user_id: opts.pikoUserId || `compound:${opts.sessionId || 'workflow'}`,
    source: opts.source || 'compound_workflow',
    execution_mode: 'auto',
    risk_level: 'low',
  });

  if (!dispatch.ok || !dispatch.runId) {
    return {
      ok: false,
      capability,
      summary: dispatch.message || 'Legion dispatch failed.',
      error: dispatch.code || 'DISPATCH_FAILED',
    };
  }

  const { pollLegionRun, buildSummaryFromResult, formatInventoryReply } = require('./legionRunPoller');
  const polled = await pollLegionRun(dispatch.runId, legionBase);
  if (!polled.ok || !polled.result) {
    return {
      ok: false,
      capability,
      runId: dispatch.runId,
      summary: polled.error || 'Legion run did not complete.',
      error: polled.error || polled.status,
    };
  }

  const { saveLegionResult } = require('./sharedContext');
  saveLegionResult(dataDir, capability, polled.result, { source: opts.contextSource || 'compound' });

  let summary;
  if (capability === 'ausmaker.runbook.execute') {
    summary = formatRunbookReply(polled.result, {
      runbook_id: step.runbook_id || input.runbook_id,
      label: step.label,
    });
  } else if (capability === 'inventory.low_stock.scan' || capability === 'inventory.report.export') {
    summary = formatInventoryReply(polled.result, capability, dataDir, message, route.opts || {});
  } else {
    summary = buildSummaryFromResult(polled.result, capability, dataDir) || `${capability} completed.`;
  }

  try {
    const { logActivity } = require('./activityLog');
    logActivity('compound_workflow_step', {
      capability,
      runId: dispatch.runId,
      workflowId: opts.workflowId,
      outcome: 'success',
    });
  } catch (_) {}

  return { ok: true, capability, runId: dispatch.runId, summary: String(summary || '') };
}

module.exports = {
  executeLegionCapabilityStep,
};
