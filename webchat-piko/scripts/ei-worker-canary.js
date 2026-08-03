#!/usr/bin/env node
/**
 * EI worker canary — plan-level + optional live Optimus runs.
 * With planner LLM off, fallback is always a single seek_files step (no keyword routing).
 * Usage:
 *   node scripts/ei-worker-canary.js              # plan assertions only
 *   node scripts/ei-worker-canary.js --live       # also queue ei-worker jobs on BASE_URL
 *   BASE_URL=http://127.0.0.1:3021 node scripts/ei-worker-canary.js --live
 */
process.env.PIKO_EI_WORK_PLANNER_LLM = process.env.PIKO_EI_WORK_PLANNER_LLM || '0';

const { planWorkRules } = require('../lib/eiWorkPlanner');
const { buildHarvestInput } = require('../lib/eiAgentTools');
const { extractFocus } = require('../lib/eiResearchGoal');
const { assessGoalFit } = require('../lib/eiWorkerRuntime');
const { stripTrailingSlash } = require('../lib/text');

const BASE = stripTrailingSlash(process.env.BASE_URL || process.env.PIKO_EI_BASE || 'http://127.0.0.1:3021');
const LIVE = process.argv.includes('--live');

const SCENARIOS = [
  {
    id: 'petrie_texts',
    goal: 'Find all Flinders Petrie texts.',
    clarification: 'Literature only.',
  },
  {
    id: 'petrie_pdf',
    goal: 'Can you please find all Flinders Petrie works as .pdf',
    clarification: '',
  },
  {
    id: 'dunn_named_book',
    goal: 'Please look for and add Christopher Dunn Lost Technologies of Ancient Egypt',
    clarification: '',
  },
  {
    id: 'open_web_petrie_pdf',
    goal: 'Find Flinders Petrie works as PDF across the web',
    clarification: '',
  },
];

function checkPlan(scenario) {
  const fails = [];
  const plan = planWorkRules(scenario.goal, scenario.clarification || '');
  const tools = (plan.steps || []).map((s) => s.tool);
  const combined = [scenario.goal, scenario.clarification].filter(Boolean).join('\n');
  const seek = (plan.steps || []).find((s) => s.tool === 'seek_files');

  if (plan.mode !== 'fallback') fails.push(`expected fallback mode, got ${plan.mode}`);
  if (tools.length !== 1 || tools[0] !== 'seek_files') {
    fails.push(`expected single seek_files, got ${tools.join(',')}`);
  }
  if (extractFocus(combined)) fails.push(`extractFocus sniffed ${extractFocus(combined)}`);

  const seekIn = buildHarvestInput(combined, {
    seek_files: true,
    require_document: true,
    require_image: false,
    sources: ['web_pdf', 'archive_org'],
  });
  if (!(seekIn.sources || []).includes('web_pdf') || !(seekIn.sources || []).includes('archive_org')) {
    fails.push(`seek sources should be web_pdf+archive_org, got ${seekIn.sources}`);
  }

  if (scenario.id === 'petrie_pdf') {
    const bad = assessGoalFit(scenario.goal, [{
      tool: 'seek_files',
      ok: true,
      results: {
        live_count: 1,
        quality: { with_document: 0 },
        items: [{ title: 'THE GRAND BIBLE - An Encyclopaedic Compilation' }],
      },
      result: {
        live_count: 1,
        quality: { with_document: 0 },
        items: [{ title: 'THE GRAND BIBLE - An Encyclopaedic Compilation' }],
      },
      artifact: 'Samples: THE GRAND BIBLE',
    }]);
    if (bad.pass) fails.push('goal-fit incorrectly accepts Grand Bible');
  }

  return {
    id: scenario.id,
    ok: fails.length === 0,
    fails,
    plan,
    query: seek && seek.args && seek.args.query,
  };
}

async function pollJob(jobId, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/agents/jobs/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    const job = data.job || data;
    if (job.status === 'done' || job.status === 'error' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`timeout waiting for ${jobId}`);
}

async function runLive(scenario) {
  const brief = [scenario.goal, scenario.clarification ? `Success / constraints: ${scenario.clarification}` : '']
    .filter(Boolean)
    .join('\n');
  const res = await fetch(`${BASE}/api/agents/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'agent_run', agent_id: 'ei-worker', brief }),
  });
  const queued = await res.json();
  if (!queued.ok || !queued.job || !queued.job.id) {
    return { id: scenario.id, ok: false, fails: [`queue failed: ${JSON.stringify(queued).slice(0, 200)}`] };
  }
  const job = await pollJob(queued.job.id);
  const report = (job.result && job.result.report) || {};
  const fit = report.goal_fit || {};
  const fails = [];
  if (job.error) fails.push(`job error: ${job.error}`);
  if (report.pass === false || fit.pass === false) fails.push(`goal_fit fail: ${fit.summary || report.pass}`);
  return {
    id: scenario.id,
    ok: fails.length === 0,
    fails,
    jobId: queued.job.id,
    fit,
    seek_coverage: report.seek_coverage || null,
  };
}

async function main() {
  console.log('EI worker canary — plan checks (no keyword routing)');
  const planResults = SCENARIOS.map(checkPlan);
  for (const r of planResults) {
    console.log(r.ok ? 'PASS' : 'FAIL', r.id, r.fails.length ? r.fails.join('; ') : r.query || '');
  }
  let liveResults = [];
  if (LIVE) {
    console.log('\nLive runs against', BASE);
    for (const s of SCENARIOS.filter((x) => ['petrie_pdf', 'dunn_named_book'].includes(x.id))) {
      process.stdout.write(`  running ${s.id}… `);
      try {
        const r = await runLive(s);
        liveResults.push(r);
        console.log(r.ok ? 'PASS' : 'FAIL', r.fails.join('; ') || r.jobId || '');
      } catch (e) {
        liveResults.push({ id: s.id, ok: false, fails: [String(e.message || e)] });
        console.log('FAIL', e.message || e);
      }
    }
  }
  const all = [...planResults, ...liveResults];
  const failed = all.filter((r) => !r.ok);
  console.log(`\n${all.length - failed.length}/${all.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
