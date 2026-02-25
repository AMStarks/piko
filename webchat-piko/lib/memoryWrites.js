/**
 * Memory write permission system — audit log and explicit levels.
 * See docs/MEMORY_ONTOLOGY_REVIEW_AND_RECOMMENDATION.md.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
const WRITE_DECISIONS_FILE = path.join(MEMORY_DIR, 'write_decisions.json');
const MAX_DECISIONS = 500;

const WRITE_LEVELS = {
  0: 'interaction',
  1: 'episodic',
  2: 'belief',
  3: 'self_model',
};

/**
 * Append a write decision for audit. Call after any memory write (or before, with decision set after check).
 * @param {Object} decision - { write_target, proposed_change, justification[], risk_flags[], decision, review_required?, timestamp? }
 */
function logWriteDecision(decision) {
  const entry = {
    write_target: decision.write_target,
    proposed_change: decision.proposed_change,
    justification: Array.isArray(decision.justification) ? decision.justification : [].concat(decision.justification || []),
    risk_flags: Array.isArray(decision.risk_flags) ? decision.risk_flags : [],
    decision: decision.decision || 'approved',
    review_required: Boolean(decision.review_required),
    timestamp: decision.timestamp || new Date().toISOString(),
  };
  if (decision.id) entry.id = decision.id;
  let list = [];
  try {
    const raw = fs.readFileSync(WRITE_DECISIONS_FILE, 'utf8');
    list = JSON.parse(raw);
  } catch (_) {}
  list.push(entry);
  if (list.length > MAX_DECISIONS) list = list.slice(-MAX_DECISIONS);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(WRITE_DECISIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/**
 * Return a decision object for a write attempt. Caller performs the write if decision.decision === 'approved'.
 * Level 0–1: auto-approve. Level 2: approve if justification has >= 2 items (or force). Level 3: review_required, not auto-approved.
 */
function attemptWrite(writeTarget, proposedChange, justification, options = {}) {
  const justificationArr = Array.isArray(justification) ? justification : (justification ? [justification] : []);
  const riskFlags = options.risk_flags || [];
  const level = options.level ?? (writeTarget === 'interaction' ? 0 : writeTarget === 'episodic' ? 1 : writeTarget === 'belief' ? 2 : 3);
  const decision = {
    write_target: writeTarget,
    proposed_change: proposedChange,
    justification: justificationArr,
    risk_flags: riskFlags,
    decision: 'pending',
    review_required: level === 3,
    timestamp: new Date().toISOString(),
  };
  if (level <= 1) {
    decision.decision = 'approved';
  } else if (level === 2 && justificationArr.length >= 2) {
    decision.decision = 'approved';
  } else if (level === 2 && options.force) {
    decision.decision = 'approved';
  } else if (level === 3) {
    decision.decision = options.force ? 'approved' : 'pending_review';
  } else {
    decision.decision = 'rejected';
  }
  logWriteDecision(decision);
  return decision;
}

/**
 * Get recent write decisions (e.g. for /control or audit view).
 */
function getRecentWriteDecisions(limit = 50) {
  try {
    const raw = fs.readFileSync(WRITE_DECISIONS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return list.slice(-limit).reverse();
  } catch (_) {
    return [];
  }
}

module.exports = {
  WRITE_LEVELS,
  logWriteDecision,
  attemptWrite,
  getRecentWriteDecisions,
  WRITE_DECISIONS_FILE,
};
