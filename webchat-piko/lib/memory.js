/**
 * Memory ontology — layered, durable. See docs/MEMORY_ONTOLOGY_AND_BELIEF_LOOP.md.
 * Layer 1: interaction (narrative trace), 2: episodic, 3B: user_beliefs, 4: self_beliefs, 5: reflective, + pending_beliefs.
 * IDs: int_*, epi_*, usr_*, ref_*, pend_* (date + seq). Write decisions logged via memoryWrites.
 */
const path = require('path');
const fs = require('fs');
const { logWriteDecision } = require('./memoryWrites');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');

const INTERACTIONS_FILE = path.join(MEMORY_DIR, 'interactions.json');
const EPISODIC_FILE = path.join(MEMORY_DIR, 'episodic.json');
const USER_BELIEFS_FILE = path.join(MEMORY_DIR, 'user_beliefs.json');
const SELF_BELIEFS_FILE = path.join(MEMORY_DIR, 'self_beliefs.json');
const REFLECTIVE_FILE = path.join(MEMORY_DIR, 'reflective.json');
const PENDING_BELIEFS_FILE = path.join(MEMORY_DIR, 'pending_beliefs.json');

const MAX_INTERACTIONS = 200;
const MAX_EPISODIC = 100;
const EPISODIC_PRUNE_DAYS = parseInt(process.env.PIKO_EPISODIC_PRUNE_DAYS, 10) || 30;
const MAX_REFLECTIVE = 50;
const MAX_PENDING = 30;
const CONFIDENCE_CAP = 0.95;
const REFLECTIVE_EXPIRY_DAYS = 7;

function readJson(file, defaultValue) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(list, prefix) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '_');
  const pattern = new RegExp('^' + prefix + '_' + dateStr + '_(\\d+)$');
  const nums = list
    .map((x) => (x.id && pattern.test(x.id) ? parseInt(x.id.match(pattern)[1], 10) : 0))
    .filter((n) => !Number.isNaN(n));
  const seq = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}_${dateStr}_${String(seq).padStart(3, '0')}`;
}

function slugForProposition(proposition) {
  return String(proposition)
    .slice(0, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'pref';
}

// —— Layer 1: Interaction memory ——
function getInteractions() {
  return readJson(INTERACTIONS_FILE, []);
}

function appendInteraction(entry) {
  const list = getInteractions();
  const id = nextId(list, 'int');
  const timestamp = entry.timestamp || new Date().toISOString();
  const item = {
    id,
    timestamp,
    channel: entry.channel || 'main',
    participants: entry.participants != null ? entry.participants : ['user', 'piko'],
    content_summary: String(entry.content_summary || entry.summary || '').slice(0, 2000),
    topics: Array.isArray(entry.topics) ? entry.topics.slice(0, 20) : [],
    tone: entry.tone || null,
    salience_score: entry.salience_score != null ? Math.min(1, Math.max(0, Number(entry.salience_score))) : null,
  };
  list.push(item);
  if (list.length > MAX_INTERACTIONS) list.splice(0, list.length - MAX_INTERACTIONS);
  writeJson(INTERACTIONS_FILE, list);
  logWriteDecision({ write_target: 'interaction', proposed_change: 'append', justification: [item.content_summary.slice(0, 100)], decision: 'approved', id });
}

// —— Layer 2: Episodic memory ——
function getEpisodic() {
  return readJson(EPISODIC_FILE, []);
}

function appendEpisodic(entry) {
  const list = getEpisodic();
  const id = nextId(list, 'epi');
  const created_at = new Date().toISOString();
  const item = {
    id,
    event: String(entry.event || '').slice(0, 1000),
    timestamp: entry.timestamp || created_at,
    perceived_significance: entry.perceived_significance != null ? entry.perceived_significance : 0.5,
    emotional_weight: entry.emotional_weight != null ? entry.emotional_weight : 0,
    linked_beliefs: Array.isArray(entry.linked_beliefs) ? entry.linked_beliefs : [],
    reinforcement_count: entry.reinforcement_count != null ? entry.reinforcement_count : 0,
    created_at,
  };
  list.push(item);
  if (list.length > MAX_EPISODIC) list.splice(0, list.length - MAX_EPISODIC);
  writeJson(EPISODIC_FILE, list);
  logWriteDecision({ write_target: 'episodic', proposed_change: 'append', justification: [item.event.slice(0, 100)], decision: 'approved', id });
}

function reinforceEpisodic(indexOrId) {
  const list = getEpisodic();
  const i = typeof indexOrId === 'number' ? indexOrId : list.findIndex((e) => e.id === indexOrId);
  if (i >= 0 && list[i]) {
    list[i].reinforcement_count = (list[i].reinforcement_count || 0) + 1;
    writeJson(EPISODIC_FILE, list);
  }
}

/** Phase 3.1: Prune episodic entries older than N days. Call from nightly cron. */
function pruneEpisodicOlderThanDays(days) {
  const d = typeof days === 'number' ? days : EPISODIC_PRUNE_DAYS;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - d);
  const cutoffIso = cutoff.toISOString();
  const list = getEpisodic();
  const before = list.length;
  const kept = list.filter((e) => {
    const ts = e.timestamp || e.created_at || '';
    return ts && ts >= cutoffIso;
  });
  if (kept.length < list.length) {
    writeJson(EPISODIC_FILE, kept);
    logWriteDecision({ write_target: 'episodic', proposed_change: 'prune', justification: [`older than ${d} days`, `removed ${list.length - kept.length}`], decision: 'approved' });
    return { removed: list.length - kept.length, kept: kept.length };
  }
  return { removed: 0, kept: list.length };
}

// —— Layer 3B: User beliefs ——
function getUserBeliefs() {
  return readJson(USER_BELIEFS_FILE, []);
}

function addUserBelief(proposition, confidence, evidence, options = {}) {
  const list = getUserBeliefs();
  const now = new Date().toISOString();
  const prop = String(proposition).slice(0, 500);
  const existing = list.find((b) => b.proposition && b.proposition.toLowerCase() === prop.toLowerCase().slice(0, 300));
  const counterEvidence = Array.isArray(options.counter_evidence) ? options.counter_evidence.slice(0, 10) : [];
  if (existing) {
    existing.confidence = Math.min(CONFIDENCE_CAP, (existing.confidence || 0) + 0.05);
    existing.evidence = existing.evidence || [];
    if (evidence) existing.evidence.push(String(evidence).slice(0, 200));
    if (counterEvidence.length) {
      existing.counter_evidence = (existing.counter_evidence || []).concat(counterEvidence.map((e) => String(e).slice(0, 200)));
    }
    existing.last_updated = now;
  } else {
    const id = options.id || `usr_${slugForProposition(prop)}_${Date.now().toString(36)}`;
    list.push({
      id,
      proposition: prop,
      confidence: Math.min(CONFIDENCE_CAP, Math.max(0.1, confidence || 0.5)),
      evidence: evidence ? [String(evidence).slice(0, 200)] : [],
      counter_evidence: counterEvidence.map((e) => String(e).slice(0, 200)),
      created_at: existing ? undefined : now,
      last_updated: now,
    });
  }
  if (!existing) {
    const b = list[list.length - 1];
    if (b && !b.created_at) b.created_at = now;
  }
  writeJson(USER_BELIEFS_FILE, list);
  logWriteDecision({ write_target: 'belief', proposed_change: existing ? 'update' : 'add', justification: [prop.slice(0, 80)], decision: 'approved' });
}

function addCounterEvidenceToBelief(propositionOrId, evidence) {
  const list = getUserBeliefs();
  const b = list.find(
    (x) =>
      x.id === propositionOrId ||
      (x.proposition && x.proposition.toLowerCase() === String(propositionOrId).toLowerCase().slice(0, 300))
  );
  if (!b) return;
  b.counter_evidence = b.counter_evidence || [];
  b.counter_evidence.push(String(evidence).slice(0, 200));
  b.confidence = Math.max(0.1, (b.confidence || 0.5) - 0.1);
  b.last_updated = new Date().toISOString();
  writeJson(USER_BELIEFS_FILE, list);
}

/** Adjust confidence of a user belief by delta (e.g. +0.05 for affirm). Clamps to [0.1, CONFIDENCE_CAP]. */
function adjustUserBeliefConfidence(propositionOrId, delta) {
  const list = getUserBeliefs();
  const b = list.find(
    (x) =>
      x.id === propositionOrId ||
      (x.proposition && x.proposition.toLowerCase() === String(propositionOrId).toLowerCase().slice(0, 300))
  );
  if (!b) return;
  const c = (b.confidence || 0.5) + Number(delta);
  b.confidence = Math.min(CONFIDENCE_CAP, Math.max(0.1, c));
  b.last_updated = new Date().toISOString();
  writeJson(USER_BELIEFS_FILE, list);
}

// —— Layer 4: Self-model (read; writes are constrained) ——
function getSelfBeliefs() {
  return readJson(SELF_BELIEFS_FILE, []);
}

// —— Layer 5: Reflective (private scratchpad) ——
function getReflective() {
  return readJson(REFLECTIVE_FILE, []);
}

function appendReflective(text, options = {}) {
  const list = getReflective();
  const now = new Date();
  const at = now.toISOString();
  let expiry = options.expiry;
  if (!expiry && REFLECTIVE_EXPIRY_DAYS) {
    const e = new Date(now);
    e.setDate(e.getDate() + REFLECTIVE_EXPIRY_DAYS);
    expiry = e.toISOString().slice(0, 10);
  }
  const id = nextId(list, 'ref');
  list.push({
    id,
    text: String(text).slice(0, 500),
    at,
    expiry: expiry || null,
    related_beliefs: Array.isArray(options.related_beliefs) ? options.related_beliefs.slice(0, 5) : [],
  });
  const stillValid = list.filter((e) => !e.expiry || e.expiry >= now.toISOString().slice(0, 10));
  const pruned = stillValid.length < list.length ? stillValid : list;
  const trimmed = pruned.length > MAX_REFLECTIVE ? pruned.slice(-MAX_REFLECTIVE) : pruned;
  writeJson(REFLECTIVE_FILE, trimmed);
  logWriteDecision({ write_target: 'reflective', proposed_change: 'append', justification: [String(text).slice(0, 80)], decision: 'approved', id });
}

// —— Pending beliefs queue ——
function getPendingBeliefs() {
  return readJson(PENDING_BELIEFS_FILE, []);
}

function addPendingBelief(proposition, evidence, initialConfidence) {
  const list = getPendingBeliefs();
  if (list.some((b) => b.proposition && b.proposition.toLowerCase() === String(proposition).toLowerCase().slice(0, 300))) return;
  const id = nextId(list, 'pend');
  const item = {
    id,
    proposition: String(proposition).slice(0, 500),
    confidence: Math.min(0.4, Math.max(0.2, initialConfidence || 0.3)),
    evidence: evidence ? String(evidence).slice(0, 300) : '',
    created_at: new Date().toISOString(),
  };
  list.push(item);
  if (list.length > MAX_PENDING) list.splice(0, list.length - MAX_PENDING);
  writeJson(PENDING_BELIEFS_FILE, list);
  logWriteDecision({ write_target: 'pending_belief', proposed_change: 'add', justification: [item.proposition.slice(0, 80)], decision: 'approved', id });
}

function setPendingBeliefs(list) {
  writeJson(PENDING_BELIEFS_FILE, list);
}

// —— Block for prompt: user beliefs + top episodic (for context) ——
function getMemoryBlockForPrompt(maxBeliefs = 8, maxEpisodic = 3) {
  const beliefs = getUserBeliefs();
  const episodic = getEpisodic();
  const byConfidence = [...beliefs].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, maxBeliefs);
  const byReinforcement = [...episodic].sort((a, b) => (b.reinforcement_count || 0) - (a.reinforcement_count || 0)).slice(0, maxEpisodic);
  const parts = [];
  if (byConfidence.length) {
    const lines = byConfidence.map((b) => {
      const nuance = (b.counter_evidence && b.counter_evidence.length) ? ` (counter-evidence: ${b.counter_evidence.length}; use with nuance)` : '';
      return `- ${b.proposition} (confidence ${(b.confidence || 0).toFixed(2)}${nuance})`;
    });
    parts.push('**Stable beliefs about the user (use with care):**\n' + lines.join('\n'));
  }
  if (byReinforcement.length) {
    parts.push('**Salient past experiences:**\n' + byReinforcement.map((e) => `- ${(e.event || '').slice(0, 120)}`).join('\n'));
  }
  if (parts.length === 0) return '';
  return '\n\n' + parts.join('\n\n') + '\n\n';
}

module.exports = {
  getInteractions,
  appendInteraction,
  getEpisodic,
  appendEpisodic,
  reinforceEpisodic,
  pruneEpisodicOlderThanDays,
  getUserBeliefs,
  addUserBelief,
  addCounterEvidenceToBelief,
  adjustUserBeliefConfidence,
  getSelfBeliefs,
  getReflective,
  appendReflective,
  getPendingBeliefs,
  addPendingBelief,
  setPendingBeliefs,
  getMemoryBlockForPrompt,
  MEMORY_DIR,
  INTERACTIONS_FILE,
  USER_BELIEFS_FILE,
  PENDING_BELIEFS_FILE,
  CONFIDENCE_CAP,
};
