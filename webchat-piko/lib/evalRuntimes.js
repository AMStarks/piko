/**
 * Eval-runtime registry — the plugin seam between the tenant-generic agent
 * orchestrator and domain-specific worker implementations.
 *
 * An agent with runtime "eval" names its implementation via `eval_impl`
 * (falling back to its own id). Implementations receive a uniform context and
 * return a uniform exec record, so the orchestrator never needs to know what
 * domain it is running:
 *
 *   impl(agent, brief, ctx) → { status: 'ok'|'needs_revision'|'failed',
 *                               artifact_text, result }
 *   ctx = { rootDir, missionId, pikoUserId, plan, onProgress }
 *
 * Domain packs (EI today, business tools tomorrow) call `register()` to add
 * implementations; tenant agent sets come from the registry (built-ins +
 * data/agents/registry.json overrides) scoped by profiles/tenants.
 */

const IMPLS = new Map();

function register(name, fn) {
  if (name && typeof fn === 'function') IMPLS.set(String(name), fn);
}

function normalizeStatus(status) {
  if (status === 'ok') return 'ok';
  if (status === 'failed') return 'failed';
  return 'needs_revision';
}

// —— EI domain pack (culture profile) ————————————————————————————

register('ei-worker', async (agent, brief, ctx) => {
  ctx.onProgress({ stage: 'planning', message: 'Planning worker steps…' });
  const { runEiWorker } = require('./eiWorkerRuntime');
  const out = await runEiWorker({
    rootDir: ctx.rootDir,
    brief,
    source: ctx.missionId ? `mission:${ctx.missionId}` : 'agent_run',
    pikoUserId: ctx.pikoUserId || `agent:${agent.id}`,
    plan: ctx.plan || null,
    onProgress: ctx.onProgress,
    shouldAbort: ctx.shouldAbort,
    runToolFn: ctx.runToolFn,
    job: ctx.job || null,
  });
  return {
    status: out.cancelled ? 'failed' : normalizeStatus(out.status),
    artifact_text: out.artifact_text,
    result: out.result,
    cancelled: !!out.cancelled,
  };
});

register('ei-text-scout', async (agent, brief, ctx) => {
  ctx.onProgress({ stage: 'running', message: 'Text scout running…' });
  const { runTextScout } = require('./eiTextScout');
  const out = await runTextScout({
    rootDir: ctx.rootDir,
    brief,
    source: ctx.missionId ? `mission:${ctx.missionId}` : 'agent_run',
  });
  return { status: out.status === 'ok' ? 'ok' : 'needs_revision', artifact_text: out.artifact_text, result: out.report };
});

register('ei-corpus-reviewer', async (agent, brief, ctx) => {
  ctx.onProgress({ stage: 'running', message: 'Corpus reviewer running…' });
  const { runCorpusReview } = require('./eiCorpusFlags');
  const out = await runCorpusReview({
    include_candidates: String(brief || '').toLowerCase().includes('include candidates'),
  });
  return { status: out.status === 'ok' ? 'ok' : 'needs_revision', artifact_text: out.artifact_text, result: out.report };
});

register('platform-eval', async (agent, brief, ctx) => {
  ctx.onProgress({ stage: 'running', message: 'Platform eval running…' });
  const { runPlatformEval } = require('./eiPlatformEval');
  const out = await runPlatformEval({
    rootDir: ctx.rootDir,
    brief,
    source: ctx.missionId ? `mission:${ctx.missionId}` : 'agent_run',
    notify: false,
  });
  return { status: out.status === 'ok' ? 'ok' : 'needs_revision', artifact_text: out.artifact_text, result: out.report };
});

/**
 * Resolve the implementation for an eval agent: explicit eval_impl, then the
 * agent id, then the platform-eval default (preserves legacy ei-qa behavior).
 */
function resolveEvalImpl(agent) {
  if (!agent) return null;
  return IMPLS.get(String(agent.eval_impl || '')) || IMPLS.get(String(agent.id || '')) || IMPLS.get('platform-eval');
}

module.exports = { register, resolveEvalImpl };
