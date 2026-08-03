/**
 * Agent orchestrator — Phase A+B+C for EI trial.
 * When disabled, callers use legionSwarm.deploySubAgent unchanged.
 */
const path = require('path');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
const { getAgent, listAgents } = require('./agentRegistry');
const { writeRun, listRuns, readRun, newRunId } = require('./agentRuns');
const { reviewAgentOutput } = require('./agentReview');
const { planMission } = require('./agentMissionPlanner');
const { writeMission, readMission, listMissions, newMissionId } = require('./agentMissions');

function rootDir() {
  return path.join(__dirname, '..');
}

function envFlag(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * EI trial gate: explicit flag, or culture profile when PIKO_AGENT_ORCH_AUTO=1.
 * Default: only when PIKO_AGENT_ORCH=1 (set on customer-03).
 */
function isAgentOrchEnabled(root) {
  if (envFlag('PIKO_AGENT_ORCH')) return true;
  if (envFlag('PIKO_AGENT_ORCH_AUTO')) {
    const p = getTenantBackgroundProfile(root || rootDir());
    return p.isCulture === true;
  }
  return false;
}

function isReviewEnabled() {
  if (String(process.env.PIKO_AGENT_REVIEW || '1').trim() === '0') return false;
  const mode = String(process.env.PIKO_AGENT_REVIEW_MODE || 'rules').trim().toLowerCase();
  return mode !== 'off';
}

async function executeSwarm(agent, brief) {
  const { deploySubAgentRaw } = require('./legionSwarm');
  const role = agent.swarm_role || agent.id;
  const fullBrief = agent.brief_prefix
    ? `${agent.brief_prefix}\n\nTask: ${brief}`
    : brief;
  const raw = await deploySubAgentRaw(role, fullBrief);
  const text = String(raw || '');
  const low = text.toLowerCase();
  const failed = low.startsWith('error:')
    || (low.includes('failed after ') && low.includes(' attempts'))
    || low.includes('unknown agent role');
  return {
    status: failed ? 'failed' : 'ok',
    artifact_text: text,
  };
}

/**
 * Run a registered agent, record the run, optionally Piko-review.
 * @returns {Promise<object>} run record + reply string for legacy callers
 */
async function runAgent(agentId, brief, opts = {}) {
  const root = opts.rootDir || rootDir();
  const profile = getTenantBackgroundProfile(root);
  const agent = getAgent(agentId, root);
  if (!agent) {
    const err = `Error: Agent '${agentId}' not available for tenant ${profile.tenant_id} (${profile.profileId}).`;
    return {
      ok: false,
      reply: err,
      run: writeRun({
        id: newRunId(),
        agent_id: agentId,
        tenant_id: profile.tenant_id,
        profile: profile.profileId,
        brief: String(brief || '').slice(0, 4000),
        status: 'failed',
        artifact_text: err,
        review: null,
        orch: true,
        mission_id: opts.missionId || null,
        child_id: opts.childId || null,
      }),
    };
  }

  if (agent.runtime === 'swarm') {
    // handled below
  } else if (agent.runtime === 'legion') {
    // handled below
  } else if (agent.runtime === 'eval') {
    // handled below
  } else {
    const err = `Error: Unsupported runtime '${agent.runtime}' for agent '${agent.id}'.`;
    return { ok: false, reply: err, run: null };
  }

  const started = Date.now();
  const reportProgress = (event) => {
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(event); } catch (_) {}
    }
  };
  let exec;
  try {
    if (agent.runtime === 'legion') {
      reportProgress({ stage: 'running', message: `Calling Legion capability ${agent.legion_capability || agent.id}.` });
      const { executeLegionAgent } = require('./agentAdapterRuntime');
      exec = await executeLegionAgent(agent, String(brief || ''), {
        pikoUserId: opts.pikoUserId || `mission:${opts.missionId || 'adhoc'}`,
        source: 'agent_orchestrator',
        adapterInput: opts.adapterInput || {},
        shouldAbort: opts.shouldAbort,
      });
    } else if (agent.runtime === 'eval') {
      // Domain-pack seam: implementations come from the eval-runtime
      // registry, so the orchestrator stays tenant/domain-agnostic.
      const { resolveEvalImpl } = require('./evalRuntimes');
      const impl = resolveEvalImpl(agent);
      exec = await impl(agent, String(brief || ''), {
        rootDir: root,
        missionId: opts.missionId || null,
        pikoUserId: opts.pikoUserId || null,
        plan: opts.plan || null,
        onProgress: reportProgress,
        shouldAbort: opts.shouldAbort,
      });
    } else {
      reportProgress({ stage: 'running', message: 'Swarm agent running…' });
      exec = await executeSwarm(agent, String(brief || ''));
    }
  } catch (e) {
    exec = { status: 'failed', artifact_text: `Error: ${e.message || e}` };
  }

  if (exec && exec.cancelled) {
    return {
      ok: false,
      cancelled: true,
      reply: String(exec.artifact_text || 'Cancelled.'),
      run: writeRun({
        id: newRunId(),
        agent_id: agent.id,
        tenant_id: profile.tenant_id,
        profile: profile.profileId,
        brief: String(brief || '').slice(0, 4000),
        status: 'failed',
        artifact_text: String(exec.artifact_text || 'Cancelled.'),
        result: exec.result || { cancelled: true },
        review: null,
        orch: true,
        mission_id: opts.missionId || null,
      }),
    };
  }

  let review = null;
  if (isReviewEnabled()) {
    reportProgress({ stage: 'review', message: 'Legate reviewing the artifact…' });
    review = await reviewAgentOutput({
      brief,
      artifactText: exec.artifact_text,
      status: exec.status,
      agentId: agent.id,
      result: exec.result || null,
      operatorMessage: opts.operatorMessage || brief,
      understood: opts.understood || null,
      missionFit: (exec.result && exec.result.mission_fit) || null,
    });
  }

  // WP5.7: one auto-retry for chat ei-worker when revise is quality/goal-fit.
  if (
    review
    && review.verdict === 'revise'
    && opts.chatOrigin
    && agent.id === 'ei-worker'
    && !opts._reviseRetry
    && Array.isArray(review.reasons)
    && review.reasons.some((r) => /goal_fit|brief_artifact|quality|harvest_no_live/i.test(String(r)))
  ) {
    reportProgress({ stage: 'revise_retry', message: 'Legate asked for a better cut — retrying once…' });
    return runAgent(agentId, brief, { ...opts, _reviseRetry: true });
  }

  const finalStatus = exec.status === 'failed'
    ? 'failed'
    : (review && review.verdict === 'escalate' ? 'failed'
      : (review && review.verdict === 'revise' ? 'needs_revision' : 'ok'));

  // Per-stage LLM-vs-rules audit trail: which brain drove each phase of this run.
  const execPlan = exec.result && exec.result.plan;
  const pipeline = {
    decide: opts.decide || null,
    plan: execPlan ? (execPlan.mode || null) : null,
    planner_error: (execPlan && execPlan.llm_error) ? String(execPlan.llm_error).slice(0, 200) : null,
    mission_fit: (exec.result && exec.result.mission_fit) ? 'llm+contract' : null,
    review: review ? review.mode : 'off',
  };

  const run = writeRun({
    id: newRunId(),
    agent_id: agent.id,
    swarm_role: agent.swarm_role || null,
    runtime: agent.runtime,
    legion_capability: agent.legion_capability || null,
    legion_run_id: exec.legion_run_id || null,
    tenant_id: profile.tenant_id,
    profile: profile.profileId,
    brief: String(brief || '').slice(0, 4000),
    status: finalStatus,
    artifact_text: String(exec.artifact_text || '').slice(0, 20000),
    result: exec.result || null,
    review,
    pipeline,
    duration_ms: Date.now() - started,
    orch: true,
    mission_id: opts.missionId || null,
    child_id: opts.childId || null,
  });

  const reviewLine = review
    ? `\n\n[Piko review: ${review.verdict}] ${review.summary}`
    : '';

  return {
    ok: finalStatus === 'ok',
    reply: `${exec.artifact_text}${reviewLine}`,
    run,
  };
}

/**
 * Drop-in for deploySubAgent when orch enabled.
 */
async function deploySubAgentViaOrch(role, taskContext) {
  const agents = listAgents(rootDir());
  const match = agents.find((a) => a.swarm_role === role || a.id === role)
    || agents.find((a) => a.id === role);
  const agentId = match ? match.id : role;
  const out = await runAgent(agentId, taskContext);
  return out.reply;
}

/**
 * Phase C: plan a mission (parent + assigned children). Does not execute unless opts.execute.
 */
async function createMission(goal, opts = {}) {
  const root = opts.rootDir || rootDir();
  if (!isAgentOrchEnabled(root)) {
    return { ok: false, error: 'agent orchestration not enabled on this spine' };
  }
  const profile = getTenantBackgroundProfile(root);
  const planned = await planMission(goal, root);
  if (!planned.ok) {
    return { ok: false, error: planned.error || 'plan failed', children: [] };
  }

  const mission = writeMission({
    id: newMissionId(),
    tenant_id: profile.tenant_id,
    profile: profile.profileId,
    goal: String(goal || '').trim().slice(0, 4000),
    status: 'planned',
    plan_mode: planned.mode,
    plan_note: planned.note || null,
    children: planned.children,
    summary: null,
  });

  if (opts.execute) {
    return executeMission(mission.id, { rootDir: root, shouldAbort: opts.shouldAbort });
  }
  return { ok: true, mission };
}

function summarizeMission(mission) {
  const children = mission.children || [];
  const accepted = children.filter((c) => c.review && c.review.verdict === 'accept').length;
  const revise = children.filter((c) => c.status === 'needs_revision' || (c.review && c.review.verdict === 'revise')).length;
  const failed = children.filter((c) => c.status === 'failed' || (c.review && c.review.verdict === 'escalate')).length;
  const done = children.filter((c) => ['ok', 'failed', 'needs_revision'].includes(c.status)).length;

  let status = 'planned';
  if (done === 0) status = 'planned';
  else if (done < children.length) status = 'running';
  else if (failed > 0) status = 'needs_attention';
  else if (revise > 0) status = 'needs_revision';
  else status = 'completed';

  return {
    status,
    summary: `${done}/${children.length} children done; accept=${accepted} revise=${revise} failed=${failed}`,
  };
}

/**
 * Execute planned children via runAgent + Piko review; update mission record.
 * On harvest revise, automatically re-briefs once with a stricter quality pass.
 */
async function executeMission(missionId, opts = {}) {
  const root = opts.rootDir || rootDir();
  if (!isAgentOrchEnabled(root)) {
    return { ok: false, error: 'agent orchestration not enabled on this spine' };
  }
  let mission = readMission(missionId);
  if (!mission) return { ok: false, error: `mission not found: ${missionId}` };

  mission.status = 'running';
  writeMission(mission);

  const { buildRevisedHarvestBrief } = require('./agentReview');
  const maxRevises = Math.max(0, Number(process.env.PIKO_AGENT_MAX_REVISES || 1));

  const children = Array.isArray(mission.children) ? mission.children : [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (typeof opts.shouldAbort === 'function' && opts.shouldAbort()) {
      for (let j = i; j < children.length; j++) {
        if (!['ok', 'failed', 'needs_revision', 'cancelled'].includes(children[j].status)) {
          children[j].status = 'cancelled';
        }
      }
      mission.children = children;
      mission.status = 'cancelled';
      mission.summary = (mission.summary ? `${mission.summary}; ` : '') + 'cancelled';
      mission = writeMission(mission);
      return { ok: false, cancelled: true, mission };
    }
    const fresh = readMission(missionId);
    if (fresh && fresh.status === 'cancelled') {
      return { ok: false, cancelled: true, mission: fresh };
    }
    if (child.status === 'ok' && child.run_id && !opts.rerun) continue;

    child.status = 'running';
    mission.children = children;
    writeMission(mission);

    let attempt = 0;
    let out = null;
    // Initial run + up to maxRevises automatic quality revises for harvesters
    while (attempt <= maxRevises) {
      const briefForRun = child.brief;
      out = await runAgent(child.agent_id, briefForRun, {
        rootDir: root,
        missionId: mission.id,
        childId: child.id,
        adapterInput: child.focus ? { focus: child.focus } : undefined,
        shouldAbort: opts.shouldAbort,
      });
      if (out && out.cancelled) {
        child.status = 'cancelled';
        child.reply_snip = String(out.reply || 'Cancelled.').slice(0, 500);
        children[i] = child;
        for (let j = i + 1; j < children.length; j++) {
          if (!['ok', 'failed', 'needs_revision', 'cancelled'].includes(children[j].status)) {
            children[j].status = 'cancelled';
          }
        }
        mission.children = children;
        mission.status = 'cancelled';
        mission.summary = (mission.summary ? `${mission.summary}; ` : '') + 'cancelled';
        mission = writeMission(mission);
        return { ok: false, cancelled: true, mission };
      }

      child.run_id = out.run ? out.run.id : null;
      child.review = out.run ? out.run.review : null;
      child.status = out.run ? out.run.status : (out.ok ? 'ok' : 'failed');
      child.reply_snip = String(out.reply || '').slice(0, 500);

      const wantsRevise = child.status === 'needs_revision'
        && child.agent_id === 'ei-harvester'
        && attempt < maxRevises;
      if (!wantsRevise) break;

      child.revise_count = (child.revise_count || 0) + 1;
      child.brief_before_revise = child.brief_before_revise || child.brief;
      child.brief = buildRevisedHarvestBrief(child.brief, child.review, mission.goal);
      child.status = 'revising';
      child.reply_snip = `${child.reply_snip || ''}\n→ auto-revise #${child.revise_count}: ${(child.review && child.review.summary) || ''}`.slice(0, 500);
      children[i] = child;
      mission.children = children;
      writeMission(mission);
      attempt += 1;
    }

    children[i] = child;
    mission.children = children;
    const rollup = summarizeMission(mission);
    mission.status = rollup.status === 'planned' ? 'running' : rollup.status;
    mission.summary = rollup.summary;
    writeMission(mission);
  }

  const rollup = summarizeMission(mission);
  mission.status = rollup.status;
  mission.summary = rollup.summary;
  mission = writeMission(mission);

  return {
    ok: mission.status === 'completed',
    mission,
  };
}

/**
 * Cancel a mission and any unfinished children. Also cancels related pending/running jobs.
 */
function cancelMission(missionId, opts = {}) {
  const root = opts.rootDir || rootDir();
  if (!isAgentOrchEnabled(root)) {
    return { ok: false, error: 'agent orchestration not enabled on this spine' };
  }
  let mission = readMission(missionId);
  if (!mission) return { ok: false, error: `mission not found: ${missionId}` };
  if (mission.status === 'cancelled') return { ok: true, mission, already: true };

  const children = Array.isArray(mission.children) ? mission.children : [];
  for (const child of children) {
    if (!['ok', 'failed', 'needs_revision', 'cancelled'].includes(child.status)) {
      child.status = 'cancelled';
    }
  }
  mission.children = children;
  mission.status = 'cancelled';
  mission.summary = (mission.summary ? `${mission.summary}; ` : '') + 'cancelled by operator';
  mission = writeMission(mission);

  const { listJobs, cancelJob } = require('./agentJobs');
  const cancelledJobs = [];
  for (const j of listJobs(100)) {
    if (!['pending', 'running'].includes(j.status)) continue;
    const p = j.payload || {};
    if (p.mission_id === missionId) {
      const c = cancelJob(j.id);
      if (c.ok) cancelledJobs.push(c.job);
    }
  }
  return { ok: true, mission, cancelled_jobs: cancelledJobs };
}

/**
 * Phase E: enqueue async work (processed by agentWorker).
 */
function enqueueAgentJob(type, payload, opts = {}) {
  const root = opts.rootDir || rootDir();
  if (!isAgentOrchEnabled(root)) {
    return { ok: false, error: 'agent orchestration not enabled on this spine' };
  }
  const profile = getTenantBackgroundProfile(root);
  const { enqueueJob } = require('./agentJobs');
  return enqueueJob({
    type,
    payload,
    tenant_id: profile.tenant_id,
    profile: profile.profileId,
  });
}

function getAgentStatus(opts = {}) {
  const root = opts.rootDir || rootDir();
  const enabled = isAgentOrchEnabled(root);
  if (!enabled) {
    return { ok: true, orch_enabled: false, counts: { pending: 0, running: 0, done: 0, working: 0 }, agents: [], jobs: [] };
  }
  const { listJobs, jobCounts } = require('./agentJobs');
  const counts = jobCounts();
  const jobs = listJobs(Math.max(1, opts.limit || 40));
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  return {
    ok: true,
    orch_enabled: true,
    counts,
    agents: listAgents(root),
    jobs: active,
    recent: jobs.filter((j) => j.status === 'done').slice(0, 10),
  };
}

module.exports = {
  isAgentOrchEnabled,
  isReviewEnabled,
  runAgent,
  deploySubAgentViaOrch,
  listAgents,
  listRuns,
  readRun,
  createMission,
  executeMission,
  cancelMission,
  readMission,
  listMissions,
  enqueueAgentJob,
  getAgentStatus,
};
