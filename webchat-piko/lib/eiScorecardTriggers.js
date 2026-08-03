/**
 * S1 auto-triggers: after a weekly scorecard snapshot, file improvement proposals
 * when learning metrics regress. Human approval remains mandatory.
 */
const TRIGGER_COOLDOWN_MS = 7 * 24 * 3600 * 1000;
const REFLECTION_SURVIVAL_TARGET = 5;
const NOTES_KEEP_RATIO_TARGET = 0.9;
const REFLECTION_CYCLE_GROWTH = 100;

const RULE_IDS = [
  'reflection_survival_low',
  'notes_keep_ratio_drop',
  'dead_thread_increase',
];

function ensureTriggerState(state) {
  if (!state.scorecard_trigger_last_fired || typeof state.scorecard_trigger_last_fired !== 'object') {
    state.scorecard_trigger_last_fired = {};
  }
  if (!state.scorecard_trigger_meta || typeof state.scorecard_trigger_meta !== 'object') {
    state.scorecard_trigger_meta = {};
  }
  return state;
}

function withinCooldown(state, ruleId, nowMs) {
  const last = state.scorecard_trigger_last_fired && state.scorecard_trigger_last_fired[ruleId];
  if (!last) return false;
  const t = new Date(last).getTime();
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) < TRIGGER_COOLDOWN_MS;
}

function markFired(state, ruleId, atIso, extra = {}) {
  ensureTriggerState(state);
  state.scorecard_trigger_last_fired[ruleId] = atIso;
  state.scorecard_trigger_meta[ruleId] = {
    ...(state.scorecard_trigger_meta[ruleId] || {}),
    ...extra,
    last_fired_at: atIso,
  };
}

/**
 * Evaluate v1 rules against current scorecard + previous snapshot.
 * Pure: returns list of { ruleId, category, subject, evidence, fix_brief, files_hint, proposal }.
 *
 * @param {object} card — current learningScorecard
 * @param {object|null} previous — previous snapshot (from JSONL or prior card)
 * @param {object} state — campaign state (for cooldown + cycle baseline)
 * @param {object} [opts]
 */
function evaluateScorecardTriggers(card, previous, state, opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const s = ensureTriggerState(state || {});
  const fired = [];
  if (!card || typeof card !== 'object') return fired;

  const at = String(card.at || new Date(nowMs).toISOString());
  const cycles = Number(card.cycle_count || 0);
  const survival = Number(card.reflection_survival_per_100_cycles);
  const notesRatio = card.notes_keep_ratio;
  const dead = Number(card.dead_thread_count);
  const prev = previous && typeof previous === 'object' ? previous : null;

  // (a) reflection survival below target AND cycle_count grew by >= 100 since last fire
  if (Number.isFinite(survival) && survival < REFLECTION_SURVIVAL_TARGET) {
    if (!withinCooldown(s, 'reflection_survival_low', nowMs)) {
      const meta = s.scorecard_trigger_meta.reflection_survival_low || {};
      const lastCycles = meta.last_cycle_count != null ? Number(meta.last_cycle_count) : null;
      const growthOk = lastCycles == null || (cycles - lastCycles) >= REFLECTION_CYCLE_GROWTH;
      // First fire requires meaningful history: cycles >= 100, or a previous snapshot
      // that itself had >= 100 cycles (never the always-true `>= 0` check).
      const historyOk = lastCycles != null
        || cycles >= REFLECTION_CYCLE_GROWTH
        || (prev && Number(prev.cycle_count || 0) >= REFLECTION_CYCLE_GROWTH);
      if (growthOk && historyOk) {
        fired.push({
          ruleId: 'reflection_survival_low',
          category: 'code_fix_brief',
          subject: 'reflection_survival_below_target',
          evidence: {
            metric: 'reflection_survival_per_100_cycles',
            value: survival,
            detail: JSON.stringify({
              current: survival,
              previous: prev ? prev.reflection_survival_per_100_cycles : null,
              target: REFLECTION_SURVIVAL_TARGET,
              cycle_count: cycles,
              previous_cycle_count: prev ? prev.cycle_count : null,
              snapshot_at: at,
              previous_snapshot_at: prev ? prev.at : null,
            }).slice(0, 500),
          },
          files_hint: [
            'webchat-piko/lib/eiResearchCampaign.js',
            'webchat-piko/lib/eiCorpusNotes.js',
          ],
          fix_brief: [
            'EI IMPROVEMENT PROPOSAL (code_fix_brief)',
            'Subject: reflection_survival_below_target',
            `Evidence: reflection_survival_per_100_cycles=${survival} (target ${REFLECTION_SURVIVAL_TARGET})`,
            `Cycles: ${cycles}; snapshot: ${at}`,
            '',
            'Reflection leads are barely surviving. Investigate reflection prompt quality,',
            'sanitize/cooldown rejection rates, and speculative_cap — improve lead acceptance',
            'without weakening the mission-fit keep gate.',
          ].join('\n'),
          proposal: {
            rule: 'reflection_survival_low',
            target: REFLECTION_SURVIVAL_TARGET,
          },
          _meta: { last_cycle_count: cycles },
        });
      }
    }
  }

  // (b) notes_keep_ratio dropped below 0.9 after previously being at/above it
  if (
    prev
    && notesRatio != null
    && Number.isFinite(Number(notesRatio))
    && Number(notesRatio) < NOTES_KEEP_RATIO_TARGET
    && prev.notes_keep_ratio != null
    && Number(prev.notes_keep_ratio) >= NOTES_KEEP_RATIO_TARGET
  ) {
    if (!withinCooldown(s, 'notes_keep_ratio_drop', nowMs)) {
      fired.push({
        ruleId: 'notes_keep_ratio_drop',
        category: 'code_fix_brief',
        subject: 'notes_keep_ratio_regression',
        evidence: {
          metric: 'notes_keep_ratio',
          value: notesRatio,
          detail: JSON.stringify({
            current: notesRatio,
            previous: prev.notes_keep_ratio,
            target: NOTES_KEEP_RATIO_TARGET,
            snapshot_at: at,
            previous_snapshot_at: prev.at || null,
          }).slice(0, 500),
        },
        files_hint: [
          'webchat-piko/lib/eiCorpusNotes.js',
          'webchat-piko/lib/eiResearchCampaign.js',
        ],
        fix_brief: [
          'EI IMPROVEMENT PROPOSAL (code_fix_brief)',
          'Subject: notes_keep_ratio_regression',
          `Evidence: notes_keep_ratio dropped ${prev.notes_keep_ratio} → ${notesRatio} (target ${NOTES_KEEP_RATIO_TARGET})`,
          '',
          'Digestion regressed. Check note backfill coverage and keep→note pipeline;',
          'do not weaken mission-fit keep gate.',
        ].join('\n'),
        proposal: {
          rule: 'notes_keep_ratio_drop',
          target: NOTES_KEEP_RATIO_TARGET,
        },
      });
    }
  }

  // (c) dead_thread_count increased vs previous snapshot
  if (
    prev
    && Number.isFinite(dead)
    && prev.dead_thread_count != null
    && dead > Number(prev.dead_thread_count)
  ) {
    if (!withinCooldown(s, 'dead_thread_increase', nowMs)) {
      // code_fix_brief (not seed_pack_entry): we lack a concrete URL at fire time;
      // bridge/human can add a seed_pack_entry proposal once a source is chosen.
      fired.push({
        ruleId: 'dead_thread_increase',
        category: 'code_fix_brief',
        subject: 'dead_thread_count_increase',
        evidence: {
          metric: 'dead_thread_count',
          value: dead,
          detail: JSON.stringify({
            current: dead,
            previous: prev.dead_thread_count,
            target: 0,
            snapshot_at: at,
            previous_snapshot_at: prev.at || null,
          }).slice(0, 500),
        },
        files_hint: [
          'webchat-piko/lib/eiSeedPack.js',
          'webchat-piko/lib/eiResearchCampaign.js',
        ],
        fix_brief: [
          'EI IMPROVEMENT PROPOSAL (code_fix_brief)',
          'Subject: dead_thread_count_increase',
          `Evidence: dead_thread_count ${prev.dead_thread_count} → ${dead}`,
          '',
          'A thread fell below the keep threshold. Identify the lagging thread(s) from',
          'scorecard by_thread, then either improve dead-thread seeding logic or file a',
          'follow-up seed_pack_entry with a concrete open-access URL for human approval.',
        ].join('\n'),
        proposal: {
          rule: 'dead_thread_increase',
        },
      });
    }
  }

  return fired;
}

/**
 * Read the previous (second-to-last) scorecard line from JSONL, if present.
 * When only one line exists (the one just appended), returns null — caller may
 * pass an explicit previous instead.
 */
function readPreviousScorecardSnapshot(scorecardFilePath, fsMod = require('fs')) {
  try {
    if (!fsMod.existsSync(scorecardFilePath)) return null;
    const text = fsMod.readFileSync(scorecardFilePath, 'utf8');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    // Last line is the just-appended current; previous is second-to-last.
    return JSON.parse(lines[lines.length - 2]);
  } catch (_) {
    return null;
  }
}

/**
 * After a snapshot append: evaluate rules and call proposeImprovement for each fire.
 * Mutates state.scorecard_trigger_* via migrate-friendly fields.
 *
 * @returns {{ ok: boolean, fired: array, results: array, skipped?: string }}
 */
function maybeFileScorecardProposals(state, card, opts = {}) {
  const propose = opts.proposeImprovement
    || (() => {
      try {
        return require('./eiEngineeringQueue').proposeImprovement;
      } catch (_) {
        return null;
      }
    })();
  if (typeof propose !== 'function') {
    return { ok: false, error: 'proposeImprovement_unavailable', fired: [], results: [] };
  }

  const previous = opts.previous !== undefined
    ? opts.previous
    : readPreviousScorecardSnapshot(opts.scorecardPath || '');

  const candidates = evaluateScorecardTriggers(card, previous, state, {
    nowMs: opts.nowMs,
  });
  if (!candidates.length) {
    return { ok: true, fired: [], results: [], skipped: 'no_triggers' };
  }

  const results = [];
  const fired = [];
  const at = String((card && card.at) || new Date().toISOString());

  for (const c of candidates) {
    const out = propose({
      category: c.category,
      subject: c.subject,
      evidence: c.evidence,
      proposal: c.proposal || {},
      files_hint: c.files_hint || [],
      fix_brief: c.fix_brief,
    }, opts.rootDir);

    results.push({ ruleId: c.ruleId, ...out });

    // Only burn cooldown when the proposal actually enqueued (WP4.5 / L6).
    if (out && out.ok) {
      markFired(state, c.ruleId, at, c._meta || {});
      fired.push(c.ruleId);
    }
  }

  return { ok: true, fired, results };
}

module.exports = {
  RULE_IDS,
  TRIGGER_COOLDOWN_MS,
  REFLECTION_SURVIVAL_TARGET,
  NOTES_KEEP_RATIO_TARGET,
  REFLECTION_CYCLE_GROWTH,
  ensureTriggerState,
  withinCooldown,
  evaluateScorecardTriggers,
  readPreviousScorecardSnapshot,
  maybeFileScorecardProposals,
  markFired,
};
