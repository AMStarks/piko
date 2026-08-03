/**
 * Phase 9 — deterministic multi-step AusMaker workflows (adapter-only spine).
 */
const { extractSkuFromMessage } = require('./ausmakerRunbook');
const { executeLegionCapabilityStep } = require('./legionCapabilityStep');
const { ollamaNativeChat } = require('./llm');
const { toLowerAsciiish, includesAny, hasAnyWord, collapseWhitespace } = require('./text');

const PLANNER_MODEL = process.env.PIKO_HEAVY_MODEL || process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';

function normalizeForMatch(text) {
  // Treat commas/periods as spaces so "stock," still matches stock phrases.
  let s = toLowerAsciiish(text);
  let out = '';
  for (const ch of s) {
    if (ch === ',' || ch === '.' || ch === ';' || ch === ':' || ch === '!' || ch === '?') out += ' ';
    else out += ch;
  }
  return collapseWhitespace(out);
}

function hasSyncSales(t) {
  if (includesAny(t, ['sync sales', 'load sales', 'sync data', 'load data'])) return true;
  return (hasAnyWord(t, ['sync', 'load']) && hasAnyWord(t, ['sales', 'data']));
}

function hasStock(t) {
  return hasAnyWord(t, ['stock', 'inventory']) || includesAny(t, ['low stock']);
}

function hasOrder(t) {
  return hasAnyWord(t, ['order', 'reorder', 'ordering'])
    || includesAny(t, ['needs ordering', 'need ordering', 'what needs']);
}

const WORKFLOWS = [
  {
    id: 'sync_stock_order',
    label: 'Sync sales, check stock, ordering summary',
    match: (text) => {
      const t = normalizeForMatch(text);
      return hasSyncSales(t) && hasStock(t) && hasOrder(t);
    },
    steps: [
      { capability: 'ausmaker.runbook.execute', runbook_id: 'load_recent_data', label: 'Load recent sales data' },
      { capability: 'inventory.low_stock.scan' },
    ],
  },
  {
    id: 'morning_ops',
    label: 'Morning ops',
    match: (text) => includesAny(toLowerAsciiish(text), [
      'morning ops',
      'daily ops routine',
      'run morning ops',
    ]),
    steps: [
      { capability: 'ausmaker.runbook.execute', runbook_id: 'load_recent_data', label: 'Load recent sales data' },
      { capability: 'ausmaker.runbook.execute', runbook_id: 'refresh_forecast', label: 'Refresh forecast' },
      { capability: 'inventory.low_stock.scan' },
    ],
  },
  {
    id: 'weekly_review',
    label: 'Weekly business review',
    match: (text) => includesAny(toLowerAsciiish(text), [
      'weekly business review',
      'weekly review',
      'week in review',
      'review the business this week',
    ]),
    steps: [
      { capability: 'sales.analysis.run' },
      { type: 'business_health' },
    ],
    optionalSteps: [
      {
        capability: 'purchase_order.draft.create',
        when: (results) => results.some((r) => {
          const s = toLowerAsciiish(r.summary || '');
          return includesAny(s, ['reorder', 'flagged', 'draft']);
        }),
      },
    ],
  },
  {
    id: 'sku_deep_dive',
    label: 'SKU forecast deep dive',
    match: (text) => {
      const sku = extractSkuFromMessage(text);
      if (!sku) return false;
      const t = toLowerAsciiish(text);
      return includesAny(t, ['deep dive']) || hasAnyWord(t, ['forecast', 'reforecast', 'review']);
    },
    steps: (text) => {
      const sku = extractSkuFromMessage(text);
      const steps = [{ type: 'forecast_review', sku }];
      const t = toLowerAsciiish(text);
      if (hasAnyWord(t, ['reforecast', 'recompute', 'refresh'])) {
        steps.push({ type: 'forecast_recompute', sku });
      }
      return steps;
    },
  },
];

function matchCompoundWorkflow(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  for (const wf of WORKFLOWS) {
    if (wf.match(text)) return wf;
  }
  return null;
}

function synthesizeWorkflowReply(workflowId, userPrompt, stepResults) {
  const okSteps = stepResults.filter((s) => s.ok !== false);
  const body = okSteps.map((s) => s.summary).filter(Boolean).join('\n\n');
  if (!body) return 'I ran the workflow but did not get usable results from each step.';

  if (workflowId === 'sync_stock_order') {
    return `Here's your ordering picture after syncing and scanning stock:\n\n${body}`;
  }
  if (workflowId === 'morning_ops') {
    return `Morning ops complete:\n\n${body}`;
  }
  if (workflowId === 'weekly_review') {
    return `Weekly business review:\n\n${body}`;
  }
  if (workflowId === 'sku_deep_dive') {
    return `SKU deep dive:\n\n${body}`;
  }
  return body;
}

async function maybePolishReply(workflowId, userPrompt, draftReply, opts = {}) {
  if (process.env.PIKO_COMPOUND_SKIP_LLM_SYNTH === '1') return draftReply;
  try {
    const polished = await ollamaNativeChat(
      opts.sessionModel || PLANNER_MODEL,
      [{
        role: 'user',
        content: `User asked: "${userPrompt}"\n\nWorkflow (${workflowId}) step outputs:\n${draftReply}\n\nRewrite as one concise conversational reply. No step numbers or meta-commentary.`,
      }],
      { max_tokens: 600, temperature: 0.35 },
    );
    return (polished || '').trim() || draftReply;
  } catch (_) {
    return draftReply;
  }
}

/**
 * Run a matched deterministic workflow. Returns null if no match.
 */
async function executeDeterministicWorkflow(userPrompt, opts = {}) {
  const wf = matchCompoundWorkflow(userPrompt);
  if (!wf) return null;

  const { fireProgressAck } = require('./frontDesk');
  await fireProgressAck({ actionType: 'compound_task' }, userPrompt, {
    sessionId: opts.sessionId,
    reqSource: opts.reqSource,
  });

  const rawSteps = typeof wf.steps === 'function' ? wf.steps(userPrompt) : wf.steps;
  const stepResults = [];

  for (const step of rawSteps) {
    const result = await executeLegionCapabilityStep(step, {
      ...opts,
      workflowId: wf.id,
      message: userPrompt,
      pikoUserId: opts.pikoUserId || `${opts.reqSource || 'chat'}:${opts.sessionId || 'compound'}`,
    });
    stepResults.push(result);
    if (!result.ok) break;
  }

  if (wf.optionalSteps && stepResults.every((r) => r.ok !== false)) {
    for (const opt of wf.optionalSteps) {
      if (typeof opt.when === 'function' && !opt.when(stepResults)) continue;
      const result = await executeLegionCapabilityStep(opt, {
        ...opts,
        workflowId: wf.id,
        message: userPrompt,
      });
      stepResults.push(result);
    }
  }

  const draft = synthesizeWorkflowReply(wf.id, userPrompt, stepResults);
  const reply = await maybePolishReply(wf.id, userPrompt, draft, opts);

  try {
    const { logActivity } = require('./activityLog');
    logActivity('compound_workflow', {
      workflowId: wf.id,
      steps: stepResults.length,
      runIds: stepResults.map((r) => r.runId).filter(Boolean),
      outcome: stepResults.every((r) => r.ok !== false) ? 'success' : 'partial',
    });
  } catch (_) {}

  return reply;
}

module.exports = {
  WORKFLOWS,
  matchCompoundWorkflow,
  executeDeterministicWorkflow,
  synthesizeWorkflowReply,
};
