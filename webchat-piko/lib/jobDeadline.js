/**
 * Derive tool timeouts from remaining job budget (P2.5c).
 */
function remainingBudgetMs(job, now = Date.now()) {
  if (!job) return null;
  const deadline = Date.parse(job.deadline_at || '') || 0;
  if (deadline) return Math.max(0, deadline - now);
  const started = Date.parse(job.started_at || '') || 0;
  if (!started) return null;
  const { JOB_TIMEOUT_MS } = require('./agentJobs');
  return Math.max(0, started + JOB_TIMEOUT_MS - now);
}

/**
 * Cap a tool's timeout against remaining budget, leaving a reserve for wrap-up.
 * @returns {number} timeout ms (>= minMs)
 */
function toolTimeoutFromBudget(job, toolDefaultMs, opts = {}) {
  const reserveMs = opts.reserveMs != null ? Number(opts.reserveMs) : 60_000;
  const minMs = opts.minMs != null ? Number(opts.minMs) : 5_000;
  const def = Math.max(minMs, Number(toolDefaultMs) || minMs);
  const remaining = remainingBudgetMs(job);
  if (remaining == null) return def;
  const capped = Math.min(def, Math.max(0, remaining - reserveMs));
  return Math.max(minMs, capped);
}

/**
 * Build opts fragment to pass into runTool / seek_files.
 */
function deadlineOptsForJob(job, toolDefaultMs) {
  const timeoutMs = toolTimeoutFromBudget(job, toolDefaultMs);
  return {
    timeoutMs,
    pollTimeoutMs: timeoutMs,
    job_deadline_at: job && job.deadline_at ? job.deadline_at : null,
  };
}

module.exports = {
  remainingBudgetMs,
  toolTimeoutFromBudget,
  deadlineOptsForJob,
};
