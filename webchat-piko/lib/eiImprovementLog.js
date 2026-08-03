/**
 * Daily improvement findings log (report-only).
 *
 * Once per day the campaign writes "what needs improving" — metric misses,
 * weak threads, reflection rejection patterns, idle state — to
 * <cultures-data>/improvement_findings.jsonl. Nothing is changed or filed;
 * the weekly scorecard triggers (eiScorecardTriggers) still own proposals.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot } = require('./culturesCorpusApi');

const FINDINGS_DAY_MS = 24 * 3600 * 1000;
const DIGESTION_RATIO_TARGET = 0.9;
const DEAD_THREAD_KEEPS = 3;

function findingsPath() {
  return path.join(culturesDataRoot(), 'improvement_findings.jsonl');
}

/**
 * Pure: derive findings from a learning scorecard + campaign state.
 * Each finding: { id, severity: 'warn'|'info', summary, evidence }.
 */
function buildDailyFindings(card, state) {
  const findings = [];
  const s = state || {};
  const targets = (card && card.targets) || {};

  // 1. Scorecard metric misses
  const survival = Number(card && card.reflection_survival_per_100_cycles);
  const survivalTarget = Number(targets.reflection_survival_per_100_cycles || 5);
  if (Number.isFinite(survival) && survival < survivalTarget) {
    findings.push({
      id: 'reflection_survival_low',
      severity: 'warn',
      summary: `Reflection survival ${survival}/100 cycles (target ${survivalTarget}) — reflection leads are not surviving to keeps.`,
      evidence: { metric: 'reflection_survival_per_100_cycles', value: survival, target: survivalTarget },
    });
  }

  const ratio = card && card.notes_keep_ratio;
  const ratioTarget = Number(targets.notes_keep_ratio || DIGESTION_RATIO_TARGET);
  if (ratio != null && Number(ratio) < ratioTarget) {
    findings.push({
      id: 'notes_keep_ratio_low',
      severity: 'warn',
      summary: `Overall digestion ${ratio} below target ${ratioTarget}.`,
      evidence: { metric: 'notes_keep_ratio', value: ratio, target: ratioTarget },
    });
  }

  const attributed = card && card.attributed_keep_pct;
  const attributedTarget = Number(targets.attributed_keep_pct || 70);
  if (attributed != null && Number(attributed) < attributedTarget) {
    findings.push({
      id: 'attribution_low',
      severity: 'warn',
      summary: `Attributed keeps ${attributed}% below target ${attributedTarget}%.`,
      evidence: { metric: 'attributed_keep_pct', value: attributed, target: attributedTarget },
    });
  }

  // 2. Per-thread weaknesses (dead + under-digested)
  const byThread = (card && card.by_thread) || {};
  const dead = [];
  const underDigested = [];
  for (const [id, t] of Object.entries(byThread)) {
    if (id === 'other') continue;
    const keeps = Number(t.keeps || 0);
    if (keeps < DEAD_THREAD_KEEPS) {
      dead.push({ thread: id, keeps });
    } else if (t.notes_keep_ratio != null && Number(t.notes_keep_ratio) < DIGESTION_RATIO_TARGET) {
      underDigested.push({ thread: id, keeps, notes: Number(t.notes || 0), ratio: t.notes_keep_ratio });
    }
  }
  if (dead.length) {
    findings.push({
      id: 'dead_threads',
      severity: 'warn',
      summary: `${dead.length} dead thread(s) (< ${DEAD_THREAD_KEEPS} keeps): ${dead.map((d) => `${d.thread} (${d.keeps})`).join(', ')}. Needs viable leads or seed-pack entries.`,
      evidence: { threads: dead },
    });
  }
  if (underDigested.length) {
    findings.push({
      id: 'threads_under_digested',
      severity: 'info',
      summary: `Thread(s) with keeps but weak notes coverage: ${underDigested.map((d) => `${d.thread} (${d.notes}/${d.keeps})`).join(', ')}. Backfill digestion would help.`,
      evidence: { threads: underDigested },
    });
  }

  // 3. Reflection rejection patterns from recent cycle reports
  const reasonCounts = {};
  let rejectedTotal = 0;
  let addedTotal = 0;
  for (const r of s.reports || []) {
    const refl = r.reflection || {};
    addedTotal += Number(refl.added || 0);
    for (const d of refl.rejected_details || []) {
      rejectedTotal += 1;
      const reason = String(d.reason || 'unknown');
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  if (rejectedTotal > 0 && rejectedTotal >= addedTotal * 3) {
    const top = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    findings.push({
      id: 'reflection_rejections_dominant',
      severity: 'warn',
      summary: `Recent reflection: ${addedTotal} lead(s) accepted vs ${rejectedTotal} rejected. Top reasons: ${top.map(([k, v]) => `${k} (${v})`).join(', ')}.`,
      evidence: { added: addedTotal, rejected: rejectedTotal, reasons: reasonCounts },
    });
  }

  // 4. Campaign idle / starved of leads
  const pendingLeads = (s.leads || []).filter((l) => l.status === 'pending').length;
  const idleStreak = Number(s.idle_streak || 0);
  if (pendingLeads === 0 && idleStreak >= 3) {
    findings.push({
      id: 'campaign_idle_no_leads',
      severity: 'warn',
      summary: `Campaign idling (streak ${idleStreak}) with 0 pending leads — lead generation (reflection/seeds) is not keeping up.`,
      evidence: { pending_leads: pendingLeads, idle_streak: idleStreak },
    });
  }

  // 5. Pending improvement proposals awaiting human review
  try {
    const { listEngineeringTasks } = require('./eiEngineeringQueue');
    const pendingTasks = listEngineeringTasks(undefined, { status: 'pending', limit: 50 });
    if (pendingTasks.length) {
      const improvements = pendingTasks.filter((t) => t.kind === 'improvement').length;
      findings.push({
        id: 'proposals_awaiting_review',
        severity: 'info',
        summary: `${pendingTasks.length} engineering task(s) pending human review (${improvements} improvement proposal(s)).`,
        evidence: { pending: pendingTasks.length, improvements },
      });
    }
  } catch (_) { /* queue optional */ }

  return findings;
}

/**
 * Append today's findings entry (guarded — at most once per day).
 * Mutates state.last_findings_at when written.
 */
function maybeAppendDailyFindings(state, opts = {}) {
  const s = state || {};
  const last = s.last_findings_at;
  if (last && !opts.force) {
    const age = Date.now() - new Date(last).getTime();
    if (Number.isFinite(age) && age < FINDINGS_DAY_MS) {
      return { ok: true, skipped: true, reason: 'within_day' };
    }
  }

  let card = opts.card;
  if (!card) {
    try {
      card = require('./eiResearchCampaign').learningScorecard(s);
    } catch (e) {
      return { ok: false, error: `scorecard_failed:${String(e.message || e).slice(0, 120)}` };
    }
  }

  const findings = buildDailyFindings(card, s);
  let improvement_outcomes = null;
  try {
    improvement_outcomes = require('./eiOutcomeLedger').outcomeSummaryForLookup(8);
  } catch (_) { /* optional */ }
  const entry = {
    at: new Date().toISOString(),
    cycle_count: Number((card && card.cycle_count) || s.cycle_count || 0),
    findings_count: findings.length,
    findings,
    improvement_outcomes,
    scorecard: {
      notes_keep_ratio: card.notes_keep_ratio,
      attributed_keep_pct: card.attributed_keep_pct,
      reflection_survival_per_100_cycles: card.reflection_survival_per_100_cycles,
      dead_thread_count: card.dead_thread_count,
      keeps_total: card.keeps_total,
      notes_count: card.notes_count,
    },
  };

  try {
    fs.mkdirSync(path.dirname(findingsPath()), { recursive: true });
    fs.appendFileSync(findingsPath(), `${JSON.stringify(entry)}\n`, 'utf8');
    s.last_findings_at = entry.at;
    return { ok: true, skipped: false, entry };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }
}

/**
 * Read the most recent N findings entries (newest last).
 */
function readRecentFindings(limit = 7) {
  try {
    if (!fs.existsSync(findingsPath())) return { ok: true, entries: [] };
    const lines = fs.readFileSync(findingsPath(), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const n = Math.max(1, Math.min(Number(limit) || 7, 60));
    const entries = [];
    for (const line of lines.slice(-n)) {
      try { entries.push(JSON.parse(line)); } catch (_) { /* skip bad line */ }
    }
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160), entries: [] };
  }
}

module.exports = {
  FINDINGS_DAY_MS,
  findingsPath,
  buildDailyFindings,
  maybeAppendDailyFindings,
  readRecentFindings,
};
