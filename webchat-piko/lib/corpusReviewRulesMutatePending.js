/**
 * Pending corpus review-rules mutation confirmations per session.
 */
const fs = require('fs');
const path = require('path');
const {
  PENDING_TTL_MS,
  executeCorpusReviewRulesMutation,
  formatCorpusReviewRulesMutateSuccess,
  clearRulesDialog,
} = require('./corpusReviewRulesMutate');

const {
  stripTrailingSentencePunct,
} = require('./text');

function getPendingFile() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'pending-corpus-review-rules-mutations.json');
}

function loadPendingMapRaw() {
  const map = new Map();
  try {
    const pendingFile = getPendingFile();
    if (!fs.existsSync(pendingFile)) return map;
    const raw = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && v.intent) map.set(k, v);
    }
  } catch (_) { /* ignore */ }
  return map;
}

function loadPendingMap() {
  const map = new Map();
  const now = Date.now();
  for (const [k, v] of loadPendingMapRaw().entries()) {
    if (v.expiresAt > now) map.set(k, v);
  }
  return map;
}

function savePendingMap(map) {
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  const pendingFile = getPendingFile();
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify(obj, null, 2), 'utf8');
}

function setPending(sessionKey, intent) {
  const map = loadPendingMapRaw();
  // Drop other expired rows while writing
  const now = Date.now();
  for (const [k, v] of [...map.entries()]) {
    if (!v || v.expiresAt <= now) map.delete(k);
  }
  map.set(sessionKey, {
    intent,
    expiresAt: Date.now() + PENDING_TTL_MS,
    createdAt: new Date().toISOString(),
  });
  savePendingMap(map);
  return map.get(sessionKey);
}

function clearPending(sessionKey) {
  const map = loadPendingMapRaw();
  map.delete(sessionKey);
  const now = Date.now();
  for (const [k, v] of [...map.entries()]) {
    if (!v || v.expiresAt <= now) map.delete(k);
  }
  savePendingMap(map);
}

function getPending(sessionKey) {
  const map = loadPendingMapRaw();
  const row = map.get(sessionKey);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) return { ...row, expired: true };
  return row;
}

async function tryConfirm(sessionKey, message) {
  const trimmed = stripTrailingSentencePunct(message).toLowerCase();
  const isNo = ['no', 'n', 'cancel', 'stop', 'nevermind', 'never mind'].includes(trimmed);
  const isYes = ['yes', 'y', 'confirm', 'ok', 'sure', 'yes please', 'do it'].includes(trimmed);
  const pending = getPending(sessionKey);
  if (!pending) return null;

  if (pending.expired) {
    clearPending(sessionKey);
    if (isYes || isNo) {
      return {
        reply: 'That Flag-rules confirmation expired (they last 20 minutes). Please state the keep/drop policy again and I’ll confirm before saving.',
        route: 'corpus_rules_mutate_expired',
      };
    }
    return null;
  }

  if (isNo) {
    clearPending(sessionKey);
    clearRulesDialog(sessionKey);
    return { reply: 'Cancelled — corpus Flag rules unchanged.', route: 'corpus_rules_mutate_cancelled' };
  }

  if (!isYes) return null;

  clearPending(sessionKey);
  const result = executeCorpusReviewRulesMutation(pending.intent);
  if (!result.ok) {
    return {
      reply: `Couldn't update Flag rules: ${result.error}. Please restate the policy.`,
      route: 'corpus_rules_mutate_failed',
    };
  }
  clearRulesDialog(sessionKey);

  let reply = formatCorpusReviewRulesMutateSuccess(pending.intent, result.detail);
  reply = `${reply}\n\n${require('./corpusReviewRules').formatRulesSummary(result.rules)}`;
  if (result.rerun) {
    try {
      const { enqueueAgentJob, isAgentOrchEnabled } = require('./agentOrchestrator');
      if (isAgentOrchEnabled()) {
        const queued = enqueueAgentJob('agent_run', {
          agent_id: 'ei-corpus-reviewer',
          brief: 'flag all corpus sources keep or drop after rules update',
        });
        const jid = queued.job && queued.job.id;
        reply = `${reply}\n\nContent review queued${jid ? ` (${jid})` : ''} — Piko will read each source and update Flags.`;
      } else {
        const { runCorpusReview } = require('./eiCorpusFlags');
        const rev = await runCorpusReview({});
        const summary = (rev.report && rev.report.summary) || 'Review finished.';
        reply = `${reply}\n\n${summary}`;
      }
    } catch (e) {
      reply = `${reply}\n\nRules saved, but re-review failed: ${e.message || e}`;
    }
  }

  return {
    reply,
    route: 'corpus_rules_mutate_applied',
    result,
  };
}

module.exports = {
  setPending,
  clearPending,
  getPending,
  tryConfirm,
};
