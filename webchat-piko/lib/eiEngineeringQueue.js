/**
 * EI engineering fix queue (Tier C) — structured tasks from failed platform evals
 * and bounded self-improvement proposals (Phase S1).
 * Queues local approval tasks and optionally drops legion-queue payloads for code fixes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordNotification } = require('./notificationFeed');

/** Bounded improvement categories — anything else is rejected at enqueue. */
const IMPROVEMENT_CATEGORIES = new Set([
  'seed_pack_entry',
  'pd_author_addition',
  'reflection_prompt_line',
  'code_fix_brief',
]);
const MAX_PENDING_IMPROVEMENTS = 3;
const MAX_PENDING_EVAL_TASKS = Math.max(
  1,
  Number(process.env.PIKO_EI_ENG_EVAL_PENDING_CAP || 10) || 10,
);

const FIX_HINTS = {
  abydos: ['egyptian_insights/sources/archive_org.py', 'egyptian_insights/sources/topbib.py'],
  heliopolis: ['egyptian_insights/sources/archive_org.py', 'webchat-piko/lib/agentReview.js'],
  giza: ['egyptian_insights/sources/archive_org.py', 'egyptian_insights/sources/topbib.py', 'egyptian_insights/sources/tla.py'],
  spine_health: ['egyptian_insights/harvest.py', 'legion-adapter/app/adapters/egyptian_insights.py'],
  registry_agents: ['webchat-piko/lib/agentRegistry.js'],
  irrelevant_hit: ['egyptian_insights/sources/archive_org.py', 'webchat-piko/lib/eiPlatformEval.js'],
  review_revise: ['webchat-piko/lib/agentReview.js', 'webchat-piko/lib/eiResearchGoal.js'],
};

function queueRoot(rootDir) {
  const base = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  const d = path.join(base, 'ei-engineering');
  fs.mkdirSync(path.join(d, 'pending'), { recursive: true });
  fs.mkdirSync(path.join(d, 'approved'), { recursive: true });
  fs.mkdirSync(path.join(d, 'done'), { recursive: true });
  fs.mkdirSync(path.join(d, 'rejected'), { recursive: true });
  return d;
}

function newTaskId() {
  if (typeof crypto.randomUUID === 'function') return `eifix_${crypto.randomUUID()}`;
  return `eifix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildFixBrief(report, failure) {
  const site = failure.site_id || failure.check_id || 'platform';
  const reasons = (failure.reasons || []).join(', ') || failure.detail || 'quality gate failed';
  return [
    'EI PLATFORM FIX (human-approved deploy required)',
    `Report: ${report.id}`,
    `Target: ${site}`,
    `Reasons: ${reasons}`,
    '',
    'Improve literature harvest quality for the research goal (Abydos, Heliopolis, Giza).',
    '- Prefer TopBib and TLA; Archive.org only when OCR/PDF clearly matches the site.',
    '- Add or tighten site relevance scoring; reject CIA/modern irrelevant hits.',
    '- Ensure harvest quality metrics pass the golden rubric in webchat-piko/lib/eiPlatformEval.js',
    '',
    `Suggested files: ${(failure.files_hint || []).join(', ')}`,
  ].join('\n');
}

function enqueueFixTask(task, rootDir) {
  const root = queueRoot(rootDir);
  const id = task.id || newTaskId();
  const row = {
    id,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...task,
  };
  fs.writeFileSync(path.join(root, 'pending', `${id}.json`), `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row;
}

function evalTaskKey(kind, checkOrSite) {
  return `${String(kind || '')}::${String(checkOrSite || '')}`;
}

function findOpenEvalTask(rootDir, kind, checkOrSite) {
  const key = evalTaskKey(kind, checkOrSite);
  for (const status of ['pending', 'approved']) {
    for (const t of listEngineeringTasks(rootDir, { status, limit: 100 })) {
      if (t.kind !== kind) continue;
      const k = evalTaskKey(t.kind, t.check_id || t.site_id);
      if (k === key) return t;
    }
  }
  return null;
}

function countPendingEvalTasks(rootDir) {
  return listEngineeringTasks(rootDir, { status: 'pending', limit: 100 })
    .filter((t) => t.kind === 'smoke' || t.kind === 'harvest').length;
}

function enqueueFixTasksFromEval(report, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const tasks = [];
  const skipped = [];
  const cap = opts.maxPending != null ? Number(opts.maxPending) : MAX_PENDING_EVAL_TASKS;

  const tryEnqueue = (row) => {
    const keyPart = row.check_id || row.site_id;
    const open = findOpenEvalTask(rootDir, row.kind, keyPart);
    if (open) {
      skipped.push({ reason: 'duplicate_open', kind: row.kind, key: keyPart, existing: open.id });
      return null;
    }
    if (countPendingEvalTasks(rootDir) >= cap) {
      skipped.push({ reason: 'pending_cap', kind: row.kind, key: keyPart });
      return null;
    }
    const task = enqueueFixTask(row, rootDir);
    tasks.push(task);
    return task;
  };

  for (const check of report.smoke || []) {
    if (check.pass) continue;
    const files = FIX_HINTS[check.id] || FIX_HINTS.spine_health;
    tryEnqueue({
      eval_report_id: report.id,
      kind: 'smoke',
      check_id: check.id,
      detail: check.detail,
      files_hint: files,
      fix_brief: buildFixBrief(report, { check_id: check.id, detail: check.detail, files_hint: files }),
    });
  }

  for (const h of report.harvests || []) {
    if (h.score?.pass) continue;
    const files = FIX_HINTS[h.site_id] || FIX_HINTS.giza;
    const reasons = h.score?.reasons || ['harvest_quality'];
    const hint = [...new Set([
      ...files,
      ...reasons.flatMap((r) => FIX_HINTS[r] || []),
    ])];
    tryEnqueue({
      eval_report_id: report.id,
      kind: 'harvest',
      site_id: h.site_id,
      reasons,
      quality: h.score?.quality || null,
      files_hint: hint,
      fix_brief: buildFixBrief(report, {
        site_id: h.site_id,
        reasons,
        files_hint: hint,
      }),
    });
  }

  if (tasks.length) {
    recordNotification({
      text: `${tasks.length} engineering fix task(s) queued from eval ${report.id}. Approve at /ei-eval or POST /api/ei/engineering/tasks/:id/approve`,
      category: 'legion',
      title: 'EI engineering fixes pending',
      severity: 'warn',
      source: 'ei_engineering_queue',
      meta: {
        report_id: report.id,
        task_ids: tasks.map((t) => t.id),
        subject: `eval:${report.id}`,
      },
    });
  }

  if (tasks.length && envAutoProcess()) {
    for (const t of tasks) {
      if (t.kind === 'improvement') continue;
      processEngineeringTask(t.id, { rootDir, auto: true }).catch(() => {});
    }
  }

  return Object.assign(tasks, { skipped });
}

function envAutoProcess() {
  const v = String(process.env.PIKO_EI_ENG_AUTO || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function improvementSubjectKey(category, subject) {
  return `${String(category || '').trim()}::${String(subject || '').trim().toLowerCase().slice(0, 160)}`;
}

/**
 * File a bounded improvement proposal (config or code brief). Requires evidence.
 * Human approval is mandatory — never auto-processed even if PIKO_EI_ENG_AUTO=1.
 *
 * @param {{
 *   category: string,
 *   subject: string,
 *   proposal: object,
 *   evidence: { metric: string, value: any, detail?: string },
 *   files_hint?: string[],
 *   fix_brief?: string,
 * }} input
 */
function proposeImprovement(input, rootDir) {
  const category = String((input && input.category) || '').trim();
  if (!IMPROVEMENT_CATEGORIES.has(category)) {
    return { ok: false, error: `invalid_category:${category}` };
  }
  const evidence = input && input.evidence;
  if (!evidence || typeof evidence !== 'object' || !evidence.metric
    || evidence.value === undefined || evidence.value === null) {
    return { ok: false, error: 'evidence_required' };
  }
  const subject = String((input && input.subject) || '').trim().slice(0, 200);
  if (!subject) return { ok: false, error: 'subject_required' };

  const pending = listEngineeringTasks(rootDir, { status: 'pending', limit: 100 })
    .filter((t) => t.kind === 'improvement');
  if (pending.length >= MAX_PENDING_IMPROVEMENTS) {
    return { ok: false, error: 'pending_cap', pending: pending.length };
  }
  const key = improvementSubjectKey(category, subject);
  if (pending.some((t) => improvementSubjectKey(t.category, t.subject) === key)) {
    return { ok: false, error: 'duplicate_pending', subject };
  }

  let outcomeCtx = '';
  try {
    outcomeCtx = require('./eiOutcomeLedger').formatOutcomesForProposer(5, rootDir);
  } catch (_) { /* optional */ }

  const fixBrief = String((input && input.fix_brief) || [
    `EI IMPROVEMENT PROPOSAL (${category})`,
    `Subject: ${subject}`,
    `Evidence: ${evidence.metric}=${JSON.stringify(evidence.value)}`,
    evidence.detail ? `Detail: ${evidence.detail}` : '',
    outcomeCtx,
    '',
    JSON.stringify((input && input.proposal) || {}, null, 2).slice(0, 2000),
  ].filter(Boolean).join('\n'));

  const task = enqueueFixTask({
    kind: 'improvement',
    category,
    subject,
    proposal: (input && input.proposal) || {},
    evidence: {
      metric: String(evidence.metric).slice(0, 80),
      value: evidence.value,
      detail: evidence.detail != null ? String(evidence.detail).slice(0, 500) : undefined,
    },
    files_hint: Array.isArray(input.files_hint) ? input.files_hint.slice(0, 12) : [],
    fix_brief: fixBrief.slice(0, 4000),
    outcomes_context: outcomeCtx || null,
    auto_forbidden: true,
  }, rootDir);

  recordNotification({
    text: `Improvement proposal pending (${category}: ${subject}). Approve via POST /api/ei/engineering/tasks/${task.id}/approve`,
    category: 'legion',
    title: 'EI improvement proposal',
    severity: 'info',
    source: 'ei_engineering_queue',
    meta: { task_id: task.id, category, subject },
  });

  return { ok: true, task };
}

function applyImprovementProposal(task, rootDir) {
  const category = String(task.category || '');
  const proposal = task.proposal || {};
  if (category === 'seed_pack_entry') {
    const { appendOverlaySeed } = require('./eiSeedPack');
    const seed = proposal.seed || proposal;
    return appendOverlaySeed(seed);
  }
  if (category === 'pd_author_addition') {
    const { appendPdAuthorOverlay } = require('./eiSeedPack');
    const author = String(proposal.author || proposal.name || task.subject || '').trim();
    return appendPdAuthorOverlay(author);
  }
  if (category === 'reflection_prompt_line') {
    const campaign = require('./eiResearchCampaign');
    const state = campaign.loadState();
    if (!Array.isArray(state.reflection_prompt_extras)) state.reflection_prompt_extras = [];
    const line = String(proposal.line || proposal.text || '').trim().slice(0, 400);
    if (!line) return { ok: false, error: 'empty_line' };
    if (!state.reflection_prompt_extras.includes(line)) {
      state.reflection_prompt_extras.push(line);
      state.reflection_prompt_extras = state.reflection_prompt_extras.slice(-20);
    }
    campaign.saveState(state);
    return { ok: true, applied: 'reflection_prompt_line', line };
  }
  if (category === 'code_fix_brief') {
    // Bridge (S2) picks up from approved/; do not mark done here.
    return { ok: true, applied: 'code_fix_brief', defer_to_bridge: true };
  }
  return { ok: false, error: `unhandled_category:${category}` };
}

function readTask(id, rootDir) {
  const root = queueRoot(rootDir);
  for (const sub of ['pending', 'approved', 'done', 'rejected']) {
    const p = path.join(root, sub, `${id}.json`);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  return null;
}

/**
 * Atomic move: exclusive-create destination, then unlink source.
 * Refuses if destination already exists (no silent overwrite).
 */
function moveTask(id, from, to, rootDir, patch = {}) {
  const root = queueRoot(rootDir);
  const src = path.join(root, from, `${id}.json`);
  const dst = path.join(root, to, `${id}.json`);
  if (!fs.existsSync(src)) return null;
  if (fs.existsSync(dst)) {
    return { ok: false, error: 'dest_exists', path: dst };
  }
  const row = { ...JSON.parse(fs.readFileSync(src, 'utf8')), ...patch, updated_at: new Date().toISOString() };
  const body = `${JSON.stringify(row, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(dst, 'wx');
    fs.writeFileSync(fd, body);
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd); } catch (_) { /* ok */ }
    if (e && e.code === 'EEXIST') return { ok: false, error: 'dest_exists', path: dst };
    throw e;
  }
  try { fs.closeSync(fd); } catch (_) { /* ok */ }
  fs.unlinkSync(src);
  return row;
}

function recordTaskOutcome(task, outcome, rootDir, detail = null) {
  try {
    require('./eiOutcomeLedger').appendOutcome({
      id: task && task.id,
      category: task && task.category,
      kind: task && task.kind,
      subject: task && task.subject,
      outcome,
      detail,
      release_id: process.env.PIKO_RELEASE_ID || null,
    }, rootDir);
  } catch (_) { /* optional */ }
}

function listEngineeringTasks(rootDir, opts = {}) {
  const root = queueRoot(rootDir);
  const status = opts.status || 'pending';
  const dir = path.join(root, status);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
  const rows = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return rows.slice(0, Math.max(1, Math.min(100, Number(opts.limit) || 50)));
}

function dropLegionQueuePayload(task, rootDir) {
  const queueDir = String(process.env.PIKO_EI_ENG_QUEUE_DIR || process.env.LEGION_QUEUE_DIR || '').trim();
  if (!queueDir) {
    console.warn(
      '[ei-engineering] legion queue drop skipped: LEGION_QUEUE_DIR / PIKO_EI_ENG_QUEUE_DIR unset (local only)',
    );
    return { ok: false, skipped: true, reason: 'no_queue_dir', queue_drop: 'skipped_no_dir' };
  }

  const payload = {
    id: task.id,
    type: 'ei_platform_fix',
    instruction: task.fix_brief,
    eval_report_id: task.eval_report_id,
    site_id: task.site_id || null,
    files_hint: task.files_hint || [],
    created_at: new Date().toISOString(),
  };
  const dest = path.join(queueDir, `${task.id}.json`);
  fs.mkdirSync(queueDir, { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, path: dest };
}

/**
 * Approve a fix task — optionally drops to legion-queue for scaffolder (Tier C).
 * Improvement tasks: never auto-approve; config categories apply on approve;
 * code_fix_brief stays in approved/ for the self-code bridge.
 */
async function processEngineeringTask(taskId, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const id = String(taskId || '').trim();
  let task = readTask(id, rootDir);
  if (!task) return { ok: false, error: 'task not found', statusCode: 404 };

  const isImprovement = task.kind === 'improvement' || task.auto_forbidden;
  if (isImprovement && opts.auto) {
    return { ok: false, error: 'improvement_requires_human_approval', task_id: id, statusCode: 400 };
  }

  // Idempotent: only pending → approved. Re-approve of done/approved is a no-op 409.
  if (task.status !== 'pending') {
    return {
      ok: false,
      error: 'not_pending',
      statusCode: 409,
      current_status: task.status,
      task_id: id,
    };
  }

  const moved = moveTask(id, 'pending', 'approved', rootDir, {
    status: 'approved',
    approved_at: new Date().toISOString(),
    ...(opts.auto ? { auto: true } : {}),
  });
  if (!moved || moved.error) {
    return { ok: false, error: (moved && moved.error) || 'move_failed', statusCode: 409, task_id: id };
  }
  task = moved;

  if (isImprovement) {
    let applied;
    try {
      applied = applyImprovementProposal(task, rootDir);
    } catch (e) {
      applied = { ok: false, error: String(e.message || e).slice(0, 300) };
    }
    if (!applied || applied.ok === false) {
      const root = queueRoot(rootDir);
      const p = path.join(root, 'approved', `${id}.json`);
      const row = {
        ...task,
        apply_error: (applied && applied.error) || 'apply_failed',
        apply_result: applied || { ok: false },
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(p, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
      recordNotification({
        text: `EI improvement ${id} approve failed to apply (${task.category}: ${task.subject}) — ${(row.apply_error || '').slice(0, 120)}`,
        category: 'legion',
        title: 'EI improvement apply failed',
        severity: 'warn',
        source: 'ei_engineering_queue',
        meta: { task_id: id, subject: task.subject, apply_error: row.apply_error },
      });
      return { ok: false, error: 'apply_failed', statusCode: 400, task: row, apply_result: applied };
    }
    if (task.category === 'code_fix_brief' || applied.defer_to_bridge) {
      const root = queueRoot(rootDir);
      const p = path.join(root, 'approved', `${id}.json`);
      const row = { ...task, apply_result: applied, updated_at: new Date().toISOString() };
      fs.writeFileSync(p, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
      recordNotification({
        text: `EI improvement ${id} approved → awaiting self-code bridge (${task.category})`,
        category: 'legion',
        title: 'EI improvement approved',
        severity: 'info',
        source: 'ei_engineering_queue',
        meta: { task_id: id, category: task.category, subject: task.subject },
      });
      return { ok: true, task: row, apply_result: applied, awaiting_bridge: true };
    }
    const done = moveTask(id, 'approved', 'done', rootDir, {
      status: 'done',
      apply_result: applied,
      processed_at: new Date().toISOString(),
    });
    if (done && !done.error) {
      recordTaskOutcome(done, 'applied', rootDir, task.category);
      recordNotification({
        text: `EI improvement ${id} applied (${task.category}: ${task.subject})`,
        category: 'legion',
        title: 'EI improvement applied',
        severity: 'info',
        source: 'ei_engineering_queue',
        meta: { task_id: id, subject: task.subject, apply_result: applied },
      });
      return { ok: true, task: done, apply_result: applied };
    }
    return { ok: false, error: (done && done.error) || 'move_to_done_failed', statusCode: 409, task };
  }

  const dropped = dropLegionQueuePayload(task, rootDir);
  const done = moveTask(id, 'approved', 'done', rootDir, {
    status: 'done',
    legion_queue: dropped,
    queue_drop: dropped.skipped ? (dropped.queue_drop || 'skipped_no_dir') : null,
    processed_at: new Date().toISOString(),
  });
  if (done && !done.error) {
    recordTaskOutcome(done, 'done', rootDir, task.kind);
    const skipNote = dropped.skipped
      ? ' (local only — queue_drop=skipped_no_dir)'
      : '';
    recordNotification({
      text: `EI fix task ${id} approved${dropped.ok ? ` → legion-queue ${dropped.path}` : skipNote}`,
      category: 'legion',
      title: 'EI engineering task processed',
      severity: dropped.skipped ? 'warn' : 'info',
      source: 'ei_engineering_queue',
      meta: {
        task_id: id,
        subject: task.check_id || task.site_id || id,
        legion_queue: dropped,
        queue_drop: done.queue_drop || null,
      },
    });
    return { ok: true, task: done, legion_queue: dropped };
  }
  return { ok: false, error: (done && done.error) || 'move_to_done_failed', statusCode: 409, task };
}

function rejectEngineeringTask(taskId, rootDir, reason = '') {
  const id = String(taskId || '').trim();
  const task = readTask(id, rootDir);
  if (!task || task.status !== 'pending') return { ok: false, error: 'task not pending' };
  const row = moveTask(id, 'pending', 'rejected', rootDir, {
    status: 'rejected',
    rejected_at: new Date().toISOString(),
    reject_reason: String(reason || '').slice(0, 500),
  });
  if (row && !row.error) recordTaskOutcome(row, 'rejected', rootDir, reason);
  return { ok: true, task: row };
}

function tickEngineeringQueue(rootDir) {
  if (!envAutoProcess()) return { processed: 0 };
  const pending = listEngineeringTasks(rootDir, { status: 'pending', limit: 5 });
  let processed = 0;
  for (const t of pending) {
    if (t.kind === 'improvement' || t.auto_forbidden) continue;
    processEngineeringTask(t.id, { rootDir, auto: true });
    processed += 1;
  }
  return { processed };
}

module.exports = {
  queueRoot,
  enqueueFixTask,
  enqueueFixTasksFromEval,
  proposeImprovement,
  applyImprovementProposal,
  IMPROVEMENT_CATEGORIES,
  MAX_PENDING_IMPROVEMENTS,
  MAX_PENDING_EVAL_TASKS,
  listEngineeringTasks,
  readTask,
  moveTask,
  findOpenEvalTask,
  processEngineeringTask,
  rejectEngineeringTask,
  tickEngineeringQueue,
  dropLegionQueuePayload,
  buildFixBrief,
};
