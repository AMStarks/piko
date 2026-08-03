/**
 * EI generalist worker — interprets goal (or uses provided plan) and runs shared tools.
 * Phase 3: one bounded re-plan pass after step failure when nothing was kept.
 */
const { planWork, formatPlanSummary } = require('./eiWorkPlanner');
const { runTool, extractSeekCoverage, formatSeekCoverage } = require('./eiAgentTools');
const { parseNamedWork, titleMatchScore } = require('./eiGoalParse');

const {
  collapseWhitespace,
} = require('./text');

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

function extractSampleTitles(stepResult) {
  const r = stepResult && stepResult.result;
  if (!r) return [];
  const items = r.items || (r.report && r.report.items) || [];
  if (Array.isArray(items)) {
    return items.slice(0, 8).map((it) => String(it.title || it.source_name || it.harvest_id || '').slice(0, 80)).filter(Boolean);
  }
  return [];
}

function coverageFromSteps(stepResults) {
  for (const sr of stepResults || []) {
    if (!sr) continue;
    if (sr.seek_coverage) return sr.seek_coverage;
    if (sr.result && sr.result.seek_coverage) return sr.result.seek_coverage;
    if (sr.tool === 'seek_files' || sr.tool === 'harvest') {
      const cov = extractSeekCoverage(sr.result || {});
      if (cov.search_hits || cov.ingested_documents || (cov.hostnames && cov.hostnames.length)) {
        return cov;
      }
    }
  }
  return null;
}

function countKeeps(stepResults) {
  let n = 0;
  for (const sr of stepResults || []) {
    const mf = sr && (sr.mission_fit || (sr.result && sr.result.mission_fit));
    if (!mf || !Array.isArray(mf.judgments)) continue;
    for (const j of mf.judgments) {
      if (j && j.verdict === 'keep' && !j.purged) n += 1;
    }
  }
  return n;
}

function shouldReplan(stepResults) {
  if (!envFlagOn('PIKO_EI_REPLAN', true)) return false;
  const steps = stepResults || [];
  if (!steps.length) return false;
  const anyFail = steps.some((s) => s && s.ok === false);
  if (!anyFail) return false;
  return countKeeps(steps) === 0;
}

function buildReplanClarification(stepResults) {
  const lines = ['PREVIOUS ATTEMPT (do not repeat completed steps):'];
  (stepResults || []).forEach((s, i) => {
    const art = collapseWhitespace(s.artifact || s.error || '').slice(0, 200);
    const args = JSON.stringify(s.input || {}).slice(0, 120);
    if (s.ok) {
      lines.push(`- step ${i + 1} ${s.tool} args=${args} → ok, kept 0, artifact: ${art}`);
    } else {
      lines.push(`- step ${i + 1} ${s.tool} args=${args} → FAILED: ${art}`);
    }
  });
  lines.push(
    'Re-plan the remaining work. Use different queries/tools where the previous step failed.',
    'Return {"steps":[]} if there is no viable alternative.',
  );
  return lines.join('\n');
}

/**
 * Goal-fit from mission-fit / step outcomes — no keyword title scoring.
 */
function assessGoalFit(goal, stepResults) {
  const samples = [];
  let harvestOk = false;
  let litOk = false;
  let seekOk = false;
  let docs = 0;
  let missionFitReport = null;

  for (const sr of stepResults || []) {
    if (!sr) continue;
    if ((sr.tool === 'harvest' || sr.tool === 'seek_files') && sr.ok) harvestOk = true;
    if (sr.tool === 'seek_files' && sr.ok) seekOk = true;
    if (sr.tool === 'find_literature' && sr.ok) litOk = true;
    const q = (sr.result && sr.result.quality) || {};
    if (q.with_document != null) docs += Number(q.with_document) || 0;
    const cov = sr.seek_coverage || (sr.result && sr.result.seek_coverage);
    if (cov && cov.ingested_documents != null) {
      docs = Math.max(docs, Number(cov.ingested_documents) || 0);
    }

    const mf = sr.mission_fit || (sr.result && sr.result.mission_fit);
    if (mf && !mf.skipped && Array.isArray(mf.judgments) && mf.judgments.length) {
      missionFitReport = mf;
      for (const j of mf.judgments) {
        if (j.verdict === 'keep') {
          samples.push(j.work_title || j.title || `#${j.harvest_id}`);
        }
      }
    } else {
      for (const title of extractSampleTitles(sr)) samples.push(title);
    }
  }

  if (missionFitReport) {
    const c = missionFitReport.counts || {};
    const kept = Number(c.keep) || 0;
    const dropped = Number(c.drop) || 0;
    const purged = Number(c.purged) || 0;
    const named = parseNamedWork(goal);
    if (kept === 0 && (dropped > 0 || purged > 0)) {
      return {
        fit: 'poor',
        pass: false,
        summary: `Mission-fit kept 0 deliverables`
          + (purged ? ` (purged ${purged} off-mission)` : ` (drop=${dropped})`)
          + '.',
        samples: samples.slice(0, 6),
        mission_fit: missionFitReport,
      };
    }
    if (named.isSingularTitle && kept > 1) {
      return {
        fit: 'poor',
        pass: false,
        summary: `Singular title ask expected 1 keep; mission-fit kept ${kept}.`,
        samples: samples.slice(0, 6),
        mission_fit: missionFitReport,
      };
    }
    if (named.isSingularTitle && kept === 1 && named.title) {
      const keepJ = (missionFitReport.judgments || []).find((j) => j && j.verdict === 'keep' && !j.purged);
      const cand = keepJ ? `${keepJ.work_title || ''} ${keepJ.title || ''}` : samples[0] || '';
      const score = titleMatchScore(named.title, cand);
      if (score < 0.72) {
        return {
          fit: 'poor',
          pass: false,
          summary: `Kept item does not match named title «${named.title}» (score=${score.toFixed(2)}).`,
          samples: samples.slice(0, 6),
          mission_fit: missionFitReport,
        };
      }
    }
    if (kept > 0) {
      return {
        fit: 'good',
        pass: true,
        summary: `Mission-fit kept ${kept} on-mission item(s)`
          + (purged ? ` · purged ${purged} rejects` : (dropped ? ` · dropped ${dropped}` : ''))
          + (docs > 0 ? ` · ${docs} document(s) ingested` : '')
          + (seekOk ? ' via open-web seek' : '')
          + '.',
        samples: samples.slice(0, 6),
        mission_fit: missionFitReport,
      };
    }
  }

  if (litOk && !harvestOk) {
    return {
      fit: 'partial',
      pass: true,
      summary: 'Literature scout completed; no harvest keep set yet.',
      samples: samples.slice(0, 6),
    };
  }

  // Seek/harvest that saved zero local documents is not a successful deliverable.
  if ((seekOk || harvestOk) && docs === 0 && !missionFitReport) {
    return {
      fit: 'poor',
      pass: false,
      summary: 'Seek/harvest completed but no local documents were ingested.',
      samples: samples.slice(0, 6),
    };
  }

  // WP5.4: health/status steps don't count; all substantive steps must ok.
  const substantive = (stepResults || []).filter(isSubstantiveStep);
  if (!substantive.length) {
    return {
      fit: 'failed',
      pass: false,
      summary: 'No substantive worker steps completed.',
      samples: samples.slice(0, 6),
    };
  }
  const allOk = substantive.every((s) => s && s.ok);
  return {
    fit: allOk ? 'ok' : 'failed',
    pass: allOk,
    summary: allOk
      ? `All ${substantive.length} substantive step(s) completed.`
      : `Substantive steps failed (${substantive.filter((s) => s && s.ok).length}/${substantive.length} ok).`,
    samples: samples.slice(0, 6),
  };
}

function isSubstantiveStep(s) {
  if (!s || !s.tool) return false;
  if (s.tool === 'health') return false;
  if (s.cancelled) return false;
  if (s.tool === 'research_campaign') {
    const action = String(
      (s.input && s.input.action)
      || (s.result && s.result.action)
      || '',
    ).toLowerCase();
    if (action === 'status' || action === 'scorecard') return false;
  }
  return true;
}

/**
 * Execute plan steps. Injectable runToolFn for tests.
 * @returns {Promise<object[]>}
 */
async function runSteps(steps, ctx = {}) {
  const stepResults = [];
  const goal = ctx.goal || '';
  const reportProgress = typeof ctx.onProgress === 'function' ? ctx.onProgress : () => {};
  const toolFn = typeof ctx.runToolFn === 'function' ? ctx.runToolFn : runTool;
  const list = steps || [];
  const offset = Number(ctx.stepOffset) || 0;
  const totalLabel = ctx.totalSteps != null ? ctx.totalSteps : list.length;

  for (let i = 0; i < list.length; i++) {
    if (typeof ctx.shouldAbort === 'function' && ctx.shouldAbort()) {
      stepResults.push({
        tool: '_cancelled',
        why: 'cancel_requested',
        ok: false,
        cancelled: true,
        artifact: 'Cancelled before step started.',
        result: null,
      });
      reportProgress({ stage: 'cancelled', message: 'Cancel requested — stopping at step boundary.' });
      return stepResults;
    }
    const step = list[i];
    const label = step.tool || `step_${i + 1}`;
    const why = String(step.why || '').trim().slice(0, 120);
    const displayN = offset + i + 1;
    reportProgress({
      stage: 'step_start',
      tool: label,
      message: why
        ? `Step ${displayN}/${totalLabel}: ${why}`
        : `Step ${displayN}/${totalLabel}: running ${label}…`,
    });
    try {
      const out = await toolFn(step.tool, step.args || {}, {
        goal,
        rootDir: ctx.rootDir,
        source: ctx.source || 'ei_worker',
        pikoUserId: ctx.pikoUserId || 'agent:ei-worker',
        shouldAbort: ctx.shouldAbort,
      });
      const row = {
        tool: step.tool,
        why: step.why || '',
        ok: !!out.ok,
        artifact: out.artifact,
        result: out.result,
        input: out.input || step.args,
        legion_run_id: out.legion_run_id || null,
        seek_coverage: out.seek_coverage || (out.result && out.result.seek_coverage) || null,
        mission_fit: out.mission_fit || (out.result && out.result.mission_fit) || null,
      };
      if (ctx.replanned) row.replanned = true;
      stepResults.push(row);
      const snip = String(out.artifact || '').split('\n').filter(Boolean)[0] || (out.ok ? 'ok' : 'failed');
      reportProgress({
        stage: 'step_done',
        tool: label,
        ok: !!out.ok,
        message: `Step ${displayN}/${totalLabel} ${out.ok ? 'done' : 'failed'}: ${snip.slice(0, 180)}`,
      });
    } catch (e) {
      stepResults.push({
        tool: step.tool,
        why: step.why || '',
        ok: false,
        artifact: `Error: ${e.message || e}`,
        result: null,
        replanned: !!ctx.replanned,
      });
      reportProgress({
        stage: 'step_done',
        tool: label,
        ok: false,
        message: `Step ${displayN}/${totalLabel} error: ${String(e.message || e).slice(0, 180)}`,
      });
    }
  }
  return stepResults;
}

/**
 * Run the EI worker against a brief / goal.
 * @returns {Promise<{ status, artifact_text, result, pass }>}
 */
async function runEiWorker(opts = {}) {
  const started = Date.now();
  const goal = String(opts.brief || opts.goal || '').trim();
  if (!goal) {
    return {
      status: 'failed',
      pass: false,
      artifact_text: '[ei-worker]\nError: empty goal.',
      result: { ok: false, error: 'empty_goal' },
    };
  }

  let plan = opts.plan || null;
  const reportProgress = (event) => {
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(event); } catch (_) {}
    }
  };
  const planFn = typeof opts.planWorkFn === 'function' ? opts.planWorkFn : planWork;

  if (!plan || !plan.steps || !plan.steps.length) {
    reportProgress({ stage: 'planning', message: 'Planning tools for this brief…' });
    let clarification = opts.clarification || '';
    try {
      const notes = require('./eiCorpusNotes').getNotesContextForGoal(goal);
      if (notes) clarification = [clarification, notes].filter(Boolean).join('\n\n').slice(0, 2800);
    } catch (_) { /* optional */ }
    plan = await planFn(goal, {
      clarification,
      llm: opts.llm,
      rootDir: opts.rootDir,
    });
  }

  const steps = plan.steps || [];
  const plannerLabel = plan.mode === 'fallback'
    ? `Planner: LLM failed (${plan.llm_error || 'unknown'}) — deterministic fallback`
    : `Planner: LLM plan${plan.mode === 'llm_retry' ? ' (after retry)' : ''}${plan.linted ? ', linted' : ''}`;
  reportProgress({
    stage: 'planned',
    message: steps.length
      ? `${plannerLabel} — ${steps.length} step(s): ${steps.map((s) => s.tool).filter(Boolean).join(' → ') || 'tools'}`
      : `${plannerLabel} — plan empty, nothing to run.`,
    ok: steps.length > 0,
  });

  let stepResults = await runSteps(steps, {
    goal,
    rootDir: opts.rootDir,
    source: opts.source,
    pikoUserId: opts.pikoUserId,
    onProgress: reportProgress,
    runToolFn: opts.runToolFn,
    totalSteps: steps.length,
    shouldAbort: opts.shouldAbort,
  });

  if (stepResults.some((s) => s && s.cancelled)) {
    return {
      status: 'failed',
      pass: false,
      cancelled: true,
      artifact_text: '[ei-worker]\nCancelled at step boundary.',
      result: { ok: false, cancelled: true, steps: stepResults },
    };
  }

  let replanMeta = null;
  // One bounded re-plan only (never recurse).
  if (shouldReplan(stepResults) && !opts._replanDepth) {
    const clarification = buildReplanClarification(stepResults);
    reportProgress({ stage: 'replanning', message: 'Step failed — re-planning once…' });
    let replan;
    try {
      replan = await planFn(goal, {
        clarification,
        llm: opts.llm,
        rootDir: opts.rootDir,
      });
    } catch (e) {
      replan = { steps: [], summary: `replan error: ${e.message || e}`, mode: 'error' };
    }

    const maxExtra = Math.max(1, Math.min(4, Number(process.env.PIKO_EI_REPLAN_MAX_STEPS || 2)));
    const extra = (replan.steps || []).slice(0, maxExtra);
    if (!extra.length) {
      replanMeta = { status: 'no_alternative', added: 0 };
      reportProgress({ stage: 'replan_done', message: 'Re-plan: no viable alternative.' });
    } else {
      const extraResults = await runSteps(extra, {
        goal,
        rootDir: opts.rootDir,
        source: opts.source,
        pikoUserId: opts.pikoUserId,
        onProgress: reportProgress,
        runToolFn: opts.runToolFn,
        replanned: true,
        stepOffset: stepResults.length,
        totalSteps: stepResults.length + extra.length,
        shouldAbort: opts.shouldAbort,
      });
      stepResults = stepResults.concat(extraResults);
      if (extraResults.some((s) => s && s.cancelled)) {
        return {
          status: 'failed',
          pass: false,
          cancelled: true,
          artifact_text: '[ei-worker]\nCancelled during re-plan steps.',
          result: { ok: false, cancelled: true, steps: stepResults, replan: replanMeta },
        };
      }
      replanMeta = { status: 'ran', added: extra.length, plan: replan };
      reportProgress({
        stage: 'replan_done',
        message: `Re-planned after step failure: ${extra.length} extra step(s)`,
      });
    }
  }

  const fit = assessGoalFit(goal, stepResults);
  const okSteps = stepResults.filter((s) => s.ok).length;
  const pass = fit.pass && okSteps > 0;
  const coverage = coverageFromSteps(stepResults);
  const covBlock = coverage ? formatSeekCoverage(coverage) : null;
  let missionFitBlock = null;
  try {
    const { formatMissionFitReport } = require('./eiMissionFitReview');
    const mf = fit.mission_fit || stepResults.map((s) => s.mission_fit).find(Boolean);
    if (mf) missionFitBlock = formatMissionFitReport(mf);
  } catch (_) { /* optional */ }

  const lines = [
    '[ei-worker / shared tool belt]',
    `Goal: ${goal.slice(0, 240)}`,
    '',
    formatPlanSummary(plan),
    '',
    replanMeta && replanMeta.status === 'ran'
      ? `Re-planned after step failure: ${replanMeta.added} extra step(s)`
      : (replanMeta && replanMeta.status === 'no_alternative'
        ? 'Re-plan: no viable alternative.'
        : null),
    `Goal fit: ${fit.fit} — ${fit.summary}`,
    fit.samples && fit.samples.length ? `Samples: ${fit.samples.join(' · ')}` : null,
    covBlock || null,
    missionFitBlock || null,
    '',
    'Step results:',
    ...stepResults.map((s, i) => {
      const head = `  ${i + 1}. ${s.tool}${s.replanned ? ' (replan)' : ''} → ${s.ok ? 'ok' : 'FAIL'}`;
      const snip = String(s.artifact || '').split('\n').slice(0, 3).join(' / ').slice(0, 220);
      return `${head}\n     ${snip}`;
    }),
    '',
    `Duration: ${Date.now() - started}ms · steps_ok=${okSteps}/${stepResults.length}`,
  ].filter((l) => l != null);

  return {
    status: pass ? 'ok' : (okSteps > 0 ? 'needs_revision' : 'failed'),
    pass,
    artifact_text: lines.join('\n'),
    result: {
      ok: pass,
      pass,
      goal: goal.slice(0, 500),
      plan,
      replan: replanMeta,
      goal_fit: fit,
      seek_coverage: coverage,
      mission_fit: fit.mission_fit || stepResults.map((s) => s.mission_fit).find(Boolean) || null,
      steps: stepResults.map((s) => ({
        tool: s.tool,
        ok: s.ok,
        why: s.why,
        input: s.input,
        replanned: !!s.replanned,
        legion_run_id: s.legion_run_id,
        sample_titles: extractSampleTitles(s),
        artifact_snip: String(s.artifact || '').slice(0, 400),
        seek_coverage: s.seek_coverage || null,
        mission_fit: s.mission_fit || null,
      })),
      duration_ms: Date.now() - started,
    },
  };
}

module.exports = {
  runEiWorker,
  assessGoalFit,
  coverageFromSteps,
  runSteps,
  shouldReplan,
  buildReplanClarification,
  countKeeps,
  isSubstantiveStep,
};
