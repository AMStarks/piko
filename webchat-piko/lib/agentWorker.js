/**
 * Agent worker — Phase E: process queued jobs independently of the HTTP request.
 * In-process loop when PIKO_AGENT_ORCH=1 (default); optional standalone: node scripts/agent-worker.js
 */
const path = require('path');
const fs = require('fs');
const { isAgentOrchEnabled } = require('./agentOrchestrator');
const {
  claimNextPending,
  completeJob,
  readJob,
  cancelJob,
  enqueueJob,
  reapOrphanedRunning,
  reapStaleRunning,
  claimOwnerId,
  JOB_TIMEOUT_MS,
} = require('./agentJobs');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
const { runWithContext } = require('./requestContext');

let timer = null;
let reaperTimer = null;
let busy = false;
let drainRequested = false;

function drainPath(rootDir) {
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  return path.join(dataDir, 'agent-jobs', '.drain');
}

function isDrainActive(rootDir) {
  if (drainRequested) return true;
  try {
    return fs.existsSync(drainPath(rootDir));
  } catch (_) {
    return false;
  }
}

function requestDrain(rootDir) {
  drainRequested = true;
  const p = drainPath(rootDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${new Date().toISOString()}\n`, 'utf8');
  } catch (e) {
    console.warn('[agent-worker] drain file write failed:', e.message);
  }
  return p;
}

function clearDrain(rootDir) {
  drainRequested = false;
  try {
    const p = drainPath(rootDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) { /* ok */ }
}

function countRunningJobs() {
  try {
    const { listJobs } = require('./agentJobs');
    return listJobs(200).filter((j) => j && j.status === 'running').length;
  } catch (_) {
    return 0;
  }
}

function isStandaloneWorkerMode() {
  const v = String(process.env.PIKO_WORKER_STANDALONE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function isCancelRequested(job) {
  if (!job) return false;
  if (job.cancel_requested || job.cancelled) return true;
  const fresh = readJob(job.id);
  if (!fresh) return false;
  if (fresh.cancel_requested || fresh.cancelled) return true;
  // WP7.5: done with timeout/cancelled means orphaned work must stop.
  if (fresh.status === 'done'
    && (fresh.error === 'timeout' || fresh.error === 'cancelled')) {
    return true;
  }
  return false;
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

/**
 * Log + optional dashboard feed for failed agent jobs (not campaign_cycle skips).
 */
function alertAgentJobFailure(job, errorMsg, result) {
  if (!envFlagOn('PIKO_AGENT_FAILURE_ALERTS', true)) return;
  if (!job) return;
  // Soft skips are not failures
  if ((job.type === 'campaign_cycle' || job.type === 'research_pm_tick') && result && result.skipped) return;
  const err = String(errorMsg || (result && result.error) || '').slice(0, 200);
  const softFail = result && result.ok === false && !errorMsg;
  if (!errorMsg && !softFail) return;
  // campaign_cycle returning ok:false without skipped was already filtered; allow true errors
  console.log(
    `[alert] agent job failed type=${job.type} id=${job.id} error=${err || 'result.ok=false'}`,
  );
  try {
    const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
      || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFile(
      path.join(dataDir, 'agent-failures.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        type: job.type,
        id: job.id,
        error: err || 'result.ok=false',
      }) + '\n',
      () => {},
    );
  } catch (_) { /* ignore */ }
  try {
    const { recordNotification } = require('./notificationFeed');
    recordNotification({
      category: 'system',
      severity: 'warn',
      title: `Agent job failed: ${job.type}`,
      text: err || `Job ${job.id} finished with ok=false`,
      source: 'agentWorker',
    });
  } catch (_) { /* ignore */ }
}

/**
 * When a chat work order is an unambiguous single-URL ingest (not a site crawl),
 * pre-seed a rules_seed plan. Site-index / "each page" asks return null so the
 * LLM planner (or full planWork) owns the strategy.
 * @returns {object|null} plan suitable for runEiWorker, or null to fall through.
 */
function maybeSeedDirectToolPlan(goal) {
  let planner;
  try {
    planner = require('./eiWorkPlanner');
  } catch (_) {
    return null;
  }
  if (typeof planner.isSimpleDirectIngestGoal !== 'function'
    || !planner.isSimpleDirectIngestGoal(goal)) {
    return null;
  }
  let plan;
  try {
    plan = planner.planWorkRules(goal);
  } catch (_) {
    return null;
  }
  const step = plan && plan.ok && plan.steps && plan.steps[0];
  if (!step || step.tool !== 'ingest_url') return null;
  const goalLow = String(goal || '').toLowerCase();
  if (!goalLow.includes('http://') && !goalLow.includes('https://')) return null;
  plan.mode = 'rules_seed';
  let summary = String(plan.summary || '');
  // Honest label: intentional rules shortcut, not "planner LLM unavailable".
  const replacements = [
    '(deterministic rules)',
    '(planner llm unavailable)',
  ];
  for (const phrase of replacements) {
    const idx = summary.toLowerCase().indexOf(phrase);
    if (idx >= 0) {
      summary = `${summary.slice(0, idx)}(rules shortcut)${summary.slice(idx + phrase.length)}`;
    }
  }
  if (!summary.toLowerCase().includes('(rules shortcut)')) {
    summary = `${summary || 'Ingest URL'} (rules shortcut)`;
  }
  plan.summary = summary;
  return plan;
}

/**
 * @deprecated Prefer maybeSeedDirectToolPlan + runAgent. Kept as a thin wrapper
 * for tests that still call the old name; executes via ei-worker tool belt.
 */
async function maybeRunDirectToolPlan(goal, { root, onProgress, runToolFn } = {}) {
  const plan = maybeSeedDirectToolPlan(goal);
  if (!plan) return null;
  const step = plan.steps[0];
  if (typeof onProgress === 'function') {
    onProgress({ stage: 'planned', message: `Pre-seeded ${step.tool} plan for operator URL/seed.` });
  }
  const { runEiWorker } = require('./eiWorkerRuntime');
  const exec = await runEiWorker({
    brief: goal,
    goal,
    plan,
    rootDir: root,
    onProgress,
    runToolFn,
    source: 'agent_worker_direct',
    pikoUserId: 'agent:legate-direct',
  });
  const artifact = String(exec.artifact_text || '').slice(0, 4000);
  return {
    ok: exec.status !== 'failed' && exec.pass !== false,
    run: {
      id: `toolplan_${Date.now().toString(36)}`,
      agent_id: 'ei-worker',
      runtime: 'eval',
      status: exec.status === 'failed' ? 'failed' : 'done',
      artifact_text: artifact,
      result: { ...(exec.result || {}), plan },
      review: null,
      pipeline: {
        decide: 'rules',
        plan: 'rules',
        mission_fit: (exec.result && exec.result.mission_fit) ? 'tool' : 'n/a',
        review: 'n/a',
      },
    },
    report: exec.result || null,
    reply_snip: artifact.slice(0, 800),
  };
}

async function processOneJob(job, rootDir) {
  const { runAgent, createMission, executeMission } = require('./agentOrchestrator');
  const payload = job.payload || {};
  const root = rootDir || path.join(__dirname, '..');

  const onProgress = (event) => {
    if (!(payload.chat_origin && payload.session_id)) return;
    // WP7.5: skip progress after the job already timed out / finished.
    try {
      const fresh = readJob(job.id);
      if (fresh && fresh.status === 'done') return;
      if (fresh && (fresh.error === 'timeout' || fresh.cancel_requested)) return;
    } catch (_) { /* continue */ }
    try {
      const { deliverLegateProgressToChat } = require('./legateChat');
      const p = deliverLegateProgressToChat(job, event || {});
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-worker] progress', e.message);
    }
  };

  if (job.type === 'agent_run') {
    onProgress({ stage: 'started', message: 'Worker claimed the job — starting.' });
    // Prefer the operator's exact ask — never an LLM-widened rewrite.
    const goal = String(payload.operator_message || payload.brief || '').trim();
    let plan = payload.plan || null;
    let agentId = payload.agent_id;
    // URL/seed work orders: pre-seed plan and force planner-backed ei-worker so
    // reviewAgentOutput + run records stay on the normal path.
    if (payload.chat_origin && !plan) {
      const seeded = maybeSeedDirectToolPlan(goal);
      if (seeded) {
        plan = seeded;
        agentId = 'ei-worker';
        onProgress({
          stage: 'planned',
          message: `Rules shortcut (simple URL) — ${(seeded.steps[0] && seeded.steps[0].tool) || 'tool'} via ei-worker.`,
        });
      }
    }
    const out = await runAgent(agentId, goal, {
      rootDir: root,
      plan,
      onProgress,
      operatorMessage: payload.operator_message || null,
      understood: payload.understood || null,
      decide: payload.chat_origin ? 'llm' : 'api',
      chatOrigin: !!payload.chat_origin,
      shouldAbort: () => isCancelRequested(job),
      job,
    });
    const report = (out.run && (out.run.result || out.run.report))
      || (out.result && out.result.report)
      || null;
    return {
      ok: !!out.ok,
      cancelled: !!out.cancelled,
      run: out.run,
      report,
      reply_snip: String(out.reply || (out.run && out.run.artifact_text) || '').slice(0, 800),
    };
  }
  if (job.type === 'mission_plan') {
    const out = await createMission(payload.goal, { rootDir: root, execute: false });
    return { ok: !!out.ok, mission: out.mission, error: out.error };
  }
  if (job.type === 'mission_execute') {
    const out = await executeMission(payload.mission_id, {
      rootDir: root,
      shouldAbort: () => isCancelRequested(job),
    });
    return { ok: !!out.ok, mission: out.mission, error: out.error, cancelled: !!out.cancelled };
  }
  if (job.type === 'mission') {
    const out = await createMission(payload.goal, {
      rootDir: root,
      execute: true,
      shouldAbort: () => isCancelRequested(job),
    });
    return { ok: !!out.ok, mission: out.mission, error: out.error, cancelled: !!out.cancelled };
  }
  if (job.type === 'campaign_cycle') {
    const { runCampaignCycle, formatCampaignStatus, pmOwnsDaemon } = require('./eiResearchCampaign');
    if (pmOwnsDaemon()) {
      return { ok: true, skipped: 'research_pm_managing', reply_snip: 'Campaign cycle skipped: research_pm_managing' };
    }
    const out = await runCampaignCycle({ rootDir: root });
    return {
      ok: !!out.ok || !!out.skipped,
      skipped: out.skipped || null,
      report: out.report || null,
      reply_snip: out.skipped ? `Campaign cycle skipped: ${out.skipped}` : formatCampaignStatus(out.state),
    };
  }
  if (job.type === 'research_pm_tick') {
    const { tickPm, formatPmStatus, summarize } = require('./eiResearchPm');
    const out = await tickPm({ rootDir: root });
    return {
      ok: true,
      skipped: out.skipped || null,
      packet: out.packet || null,
      confirm: out.confirm || null,
      reply_snip: out.skipped
        ? `Research PM tick skipped: ${out.skipped}`
        : formatPmStatus(summarize()),
    };
  }
  if (job.type === 'article_write') {
    const { writeArticle } = require('./eiArticleWriter');
    const out = await writeArticle(payload.topic || payload.thread || 'research topic', {
      thread: payload.thread,
      rootDir: root,
    });
    return {
      ok: !!out.ok,
      error: out.error || null,
      slug: out.slug || null,
      status: out.status || null,
      meta: out.meta || null,
      reply_snip: out.ok
        ? `Article draft ${out.slug} (${out.status})`
        : `Article failed: ${out.error || 'unknown'}`,
    };
  }
  if (job.type === 'ei_platform_eval') {
    const { runPlatformEval } = require('./eiPlatformEval');
    const { tickEngineeringQueue } = require('./eiEngineeringQueue');
    const out = await runPlatformEval({
      rootDir: root,
      brief: payload.brief || '',
      source: payload.source || 'async_job',
      smoke: payload.smoke,
      harvest: payload.harvest,
      notify: payload.notify !== false,
      notifyTelegram: payload.notify_telegram === true,
    });
    tickEngineeringQueue(root);
    return {
      ok: !!out.pass,
      report: out.report,
      reply_snip: String(out.artifact_text || '').slice(0, 800),
    };
  }
  // P3.2c: heavy consolidation work runs in the worker, not the chat process.
  if (job.type === 'belief_consolidation') {
    const beliefLoop = require('./beliefLoop');
    const memory = require('./memory');
    await beliefLoop.runBeliefConsolidation();
    await memory.pruneEpisodicOlderThanDays();
    await beliefLoop.resolveBeliefConflicts();
    return { ok: true, kind: 'belief_consolidation' };
  }
  if (job.type === 'memory_consolidation') {
    await require('../scripts/memoryConsolidation').consolidateSoul();
    return { ok: true, kind: 'memory_consolidation' };
  }
  if (job.type === 'weekly_retro') {
    const { weeklyRetro } = require('./metrics');
    const report = weeklyRetro();
    const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
      || path.join(root, 'data');
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const https = require('https');
      const body = JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: report });
      const u = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`);
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, () => resolve());
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    } else {
      const retroPath = path.join(dataDir, 'learning', 'weekly-retro.md');
      fs.mkdirSync(path.dirname(retroPath), { recursive: true });
      fs.appendFileSync(retroPath, `\n\n---\n${new Date().toISOString()}\n\n${report}`, 'utf8');
    }
    return { ok: true, kind: 'weekly_retro', chars: String(report || '').length };
  }
  throw new Error(`unknown job type: ${job.type}`);
}

function notifyChatTimeout(job) {
  const p = (job && job.payload) || {};
  if (!(p.chat_origin && p.session_id)) return;
  const text = `That task ("${String(p.operator_message || p.brief || 'work').slice(0, 120)}") hit a time limit and stopped so other work can proceed. Ask me again if you still want it.`;
  const write = () => {
    require('./sessionStore').append(p.session_id, 'assistant', text);
  };
  try {
    const { acquireSessionLock } = require('./sessionLock');
    // Fire-and-forget under the session lock (same as Legate deliveries).
    Promise.resolve(acquireSessionLock(p.session_id, write)).catch(() => {
      try { write(); } catch (_) { /* optional */ }
    });
  } catch (_) {
    try { write(); } catch (__) { /* optional */ }
  }
}

/**
 * WP5.6 — escalations / orphaned retryable jobs go somewhere durable.
 */
function handleJobEscalation(job, result, rootDir) {
  const review = result && result.run && result.run.review;
  const verdict = review && review.verdict;
  const orphaned = result && (result.orphaned || (job && job.error === 'orphaned_by_restart'));
  const isEscalate = verdict === 'escalate' || orphaned;
  if (!isEscalate) return { handled: false };

  const payload = (job && job.payload) || {};
  const retryable = orphaned
    || (review && Array.isArray(review.reasons)
      && review.reasons.some((r) => /empty_or_error|timeout|transient/i.test(String(r))));

  if (retryable && !payload._escalation_retried && job.type === 'agent_run') {
    const queued = enqueueJob({
      type: 'agent_run',
      payload: { ...payload, _escalation_retried: true, _escalation_of: job.id },
    });
    if (queued.ok) {
      try {
        require('./notificationFeed').recordNotification({
          category: 'legion',
          severity: 'info',
          title: 'Agent job re-queued after escalate',
          text: `Re-queued ${job.id} → ${queued.job.id}`,
          source: 'agentWorker',
          meta: { task_id: job.id, subject: `escalate:${job.id}` },
        });
      } catch (_) { /* optional */ }
      return { handled: true, requeued: queued.job.id };
    }
  }

  try {
    require('./notificationFeed').recordNotification({
      category: 'legion',
      severity: 'warn',
      title: orphaned ? 'Agent job orphaned' : 'Agent job escalated',
      text: `Job ${job.id} needs attention: ${(review && review.summary) || job.error || 'escalate'}`,
      source: 'agentWorker',
      meta: { task_id: job.id, subject: `escalate:${job.id}` },
    });
  } catch (_) { /* optional */ }

  if (payload.chat_origin) {
    try {
      const { enqueueFixTask } = require('./eiEngineeringQueue');
      enqueueFixTask({
        kind: 'escalation',
        subject: String(payload.operator_message || payload.brief || job.id).slice(0, 200),
        fix_brief: [
          'EI AGENT ESCALATION (human review)',
          `Job: ${job.id}`,
          `Agent: ${payload.agent_id || 'unknown'}`,
          `Ask: ${String(payload.operator_message || payload.brief || '').slice(0, 500)}`,
          `Review: ${(review && review.summary) || job.error || 'escalate'}`,
        ].join('\n'),
        files_hint: [],
        evidence: {
          metric: 'agent_escalate',
          value: verdict || job.error || 'escalate',
        },
        source_job_id: job.id,
      }, rootDir);
    } catch (_) { /* optional */ }
  }
  return { handled: true, requeued: null };
}

async function tick(rootDir, opts = {}) {
  if (busy) return;
  if (!isAgentOrchEnabled(rootDir)) return;
  if (isDrainActive(rootDir)) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log('[agent-worker] drain active — not claiming');
    }
    return;
  }
  const owner = opts.owner || claimOwnerId();
  const job = claimNextPending({ owner });
  if (!job) return;
  busy = true;
  const processFn = typeof opts.processOne === 'function' ? opts.processOne : processOneJob;
  const timeoutMs = opts.timeoutMs != null
    ? Math.max(50, Number(opts.timeoutMs) || 50)
    : JOB_TIMEOUT_MS;
  let timeoutHandle = null;
  try {
    if (isCancelRequested(job)) {
      completeJob({ ...job, cancelled: true }, { ok: false, cancelled: true }, 'cancelled');
      return;
    }
    const work = runWithContext({ priority: 'background' }, () => processFn(job, rootDir));
    const raced = await Promise.race([
      work.then((r) => ({ kind: 'done', r })).catch((e) => ({ kind: 'error', e })),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      }),
    ]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (raced.kind === 'timeout') {
      try { cancelJob(job.id); } catch (_) { /* ok */ }
      // WP7.5: carry cancel_requested so zombie shouldAbort keeps returning true.
      completeJob(
        {
          ...job,
          cancel_requested: true,
          cancel_requested_at: new Date().toISOString(),
        },
        { ok: false, timeout: true },
        'timeout',
      );
      notifyChatTimeout(job);
      console.log(`[agent-worker] job ${job.id} timed out after ${timeoutMs}ms`);
      // Let the underlying promise settle without blocking the queue.
      work.then(() => {}).catch(() => {});
      return;
    }
    if (raced.kind === 'error') {
      completeJob(job, null, raced.e.message || String(raced.e));
      alertAgentJobFailure(job, raced.e.message || String(raced.e), null);
      return;
    }

    const result = raced.r;
    // Cooperative cancel: if the run itself aborted, mark cancelled.
    if (result && result.cancelled) {
      completeJob({ ...job, cancelled: true }, { ...result, ok: false, cancelled: true }, 'cancelled');
      return;
    }
    // WP5.1: work finished before cancel was honored → done, not cancelled.
    if (isCancelRequested(job)) {
      completeJob(
        { ...job, cancel_after_complete: true },
        { ...(result || {}), cancel_after_complete: true },
        null,
      );
    } else {
      completeJob(job, result, null);
    }

    // WP7.8: one failure → one feed entry (skip generic alert when escalate notifies).
    const esc = handleJobEscalation(job, result, rootDir || path.join(__dirname, '..'));
    if (result && result.ok === false && !result.skipped && !result.cancelled && !(esc && esc.handled)) {
      alertAgentJobFailure(job, null, result);
    }

    if (job.type === 'agent_run' && job.payload && job.payload.chat_origin) {
      try {
        const { deliverLegateReviewToChat } = require('./legateChat');
        const p = deliverLegateReviewToChat(job, result);
        if (p && typeof p.then === 'function') await p;
      } catch (e) {
        if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-worker] legate review deliver', e.message);
      }
    }
  } catch (e) {
    completeJob(job, null, e.message || String(e));
    alertAgentJobFailure(job, e.message || String(e), null);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    busy = false;
  }
}

function workerEnabled() {
  const v = String(process.env.PIKO_AGENT_WORKER || '1').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

function bootReapOrphans(root) {
  try {
    for (const job of reapOrphanedRunning()) {
      console.log(`[agent-worker] reaped orphaned job ${job.id} (${job.error})`);
      handleJobEscalation(job, job.result || { orphaned: true }, root);
      const p = job.payload || {};
      if (p.chat_origin && p.session_id && job.error === 'orphaned_by_restart') {
        try {
          require('./sessionStore').append(
            p.session_id,
            'assistant',
            `Heads up — a task I was running ("${String(p.operator_message || p.brief || 'previous task').slice(0, 120)}") was interrupted by a restart and didn't finish. Ask me again if you still want it.`,
          );
        } catch (_) { /* optional */ }
      }
    }
  } catch (_) { /* ok */ }
  const profile = getTenantBackgroundProfile(root);
  if (profile.isCulture) {
    try {
      const { clearRunningLockAtBoot } = require('./eiResearchCampaign');
      if (clearRunningLockAtBoot().cleared) {
        console.log('[agent-worker] cleared stale campaign running lock (restart mid-cycle)');
      }
      const { clearSeekerLockAtBoot } = require('./eiResearchPm');
      if (clearSeekerLockAtBoot().cleared) {
        console.log('[agent-worker] cleared stale research-pm seeker lock (restart mid-seek)');
      }
    } catch (_) { /* ok */ }
  }
}

function startStaleReaper(root) {
  if (reaperTimer) return;
  const reaperMs = Math.max(5_000, Number(process.env.PIKO_AGENT_STALE_REAPER_MS || 30_000) || 30_000);
  reaperTimer = setInterval(() => {
    try {
      // P2.5d: reaper handles foreign/unowned jobs; own jobs get cancel_requested only.
      for (const job of reapStaleRunning({ timeoutMs: JOB_TIMEOUT_MS, owner: claimOwnerId() })) {
        console.log(`[agent-worker] reaped stale job ${job.id} (${job.error})`);
        notifyChatTimeout(job);
        handleJobEscalation(job, { orphaned: true, timeout: true }, root);
      }
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-worker] reaper', e.message);
    }
  }, reaperMs);
  if (typeof reaperTimer.unref === 'function') reaperTimer.unref();
}

/**
 * Chat-process entry: claim loop unless PIKO_WORKER_STANDALONE=1 (then reaper only).
 */
function startAgentWorker(rootDir) {
  if (!workerEnabled()) return { started: false, reason: 'PIKO_AGENT_WORKER off' };
  if (!isAgentOrchEnabled(rootDir)) return { started: false, reason: 'orch disabled' };

  const root = rootDir || path.join(__dirname, '..');
  const profile = getTenantBackgroundProfile(root);
  bootReapOrphans(root);
  startStaleReaper(root);

  // P3.2b: standalone worker owns claiming; chat keeps reaper only.
  if (isStandaloneWorkerMode()) {
    console.log(`[agent-worker] standalone mode — claim loop off (reaper on) tenant=${profile.tenant_id}`);
    return { started: false, reaper: true, reason: 'standalone' };
  }

  if (timer) return { started: true, reason: 'already running' };

  const ms = Math.max(500, Number(process.env.PIKO_AGENT_WORKER_INTERVAL_MS || 2000));
  timer = setInterval(() => {
    tick(root).catch((e) => {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-worker]', e.message);
    });
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(`[agent-worker] started interval=${ms}ms tenant=${profile.tenant_id}`);
  tick(root).catch(() => {});
  return { started: true, interval_ms: ms };
}

/** Standalone process entry — always runs the claim loop (ignores STANDALONE flag). */
function startStandaloneWorker(rootDir) {
  if (!isAgentOrchEnabled(rootDir)) return { started: false, reason: 'orch disabled' };
  const root = rootDir || path.join(__dirname, '..');
  const profile = getTenantBackgroundProfile(root);
  bootReapOrphans(root);
  startStaleReaper(root);
  if (timer) return { started: true, reason: 'already running' };

  const ms = Math.max(500, Number(process.env.PIKO_AGENT_WORKER_INTERVAL_MS || 2000));
  timer = setInterval(() => {
    tick(root).catch((e) => {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-worker]', e.message);
    });
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(`[agent-worker] standalone process interval=${ms}ms tenant=${profile.tenant_id}`);
  tick(root).catch(() => {});
  return { started: true, interval_ms: ms, standalone: true };
}

function stopAgentWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

module.exports = {
  processOneJob,
  maybeSeedDirectToolPlan,
  maybeRunDirectToolPlan,
  tick,
  startAgentWorker,
  startStandaloneWorker,
  stopAgentWorker,
  workerEnabled,
  isStandaloneWorkerMode,
  isDrainActive,
  requestDrain,
  clearDrain,
  drainPath,
  countRunningJobs,
  alertAgentJobFailure,
  handleJobEscalation,
  isCancelRequested,
};
