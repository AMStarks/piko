/**
 * Belief update loop: experience ingestion, salience, pending queue, consolidation, identity gate.
 * See docs/MEMORY_ONTOLOGY_AND_BELIEF_LOOP.md (at repo root).
 */
const path = require('path');
const fs = require('fs');
const { ai } = require('./llm');
const sessionStore = require('./sessionStore');
const { loadMind } = require('./mind');
const memory = require('./memory');
const { logWriteDecision } = require('./memoryWrites');

const CORRECTION_PHRASES = ['no', 'actually', "that's wrong", 'i meant', 'correction', 'not quite', 'nope', "don't think so", 'incorrect'];
const SHORTER_PHRASES = ['shorter', 'brief', 'tl;dr', 'summarize', 'less', 'concise', 'quick', 'in short'];
const LONGER_PHRASES = ['longer', 'more', 'expand', 'detail', 'elaborate', 'fuller', 'in depth'];
const AFFIRM_PHRASES = ['yes', 'exactly', "that's right", 'good', 'correct', 'right', 'yep', 'spot on'];
const DEPTH_KEYWORDS = ['depth', 'structure', 'structured', 'detail', 'in-depth', 'thorough', 'verbose'];
const BREVITY_KEYWORDS = ['brevity', 'brief', 'concise', 'short', 'quick'];

const PROMPTS_DIR = process.env.PIKO_PROMPTS_DIR || path.join(__dirname, '..', 'prompts');
const INGEST_EXCHANGES = 10;
const PROMOTE_THRESHOLD = 0.7;
const REJECT_THRESHOLD = 0.15;
const CONFIDENCE_UP = 0.05;
const CONFIDENCE_DOWN = 0.1;
const SALIENCE_THRESHOLD = 0.6;
const CONSOLIDATION_COUNTER_EVIDENCE_INTERACTIONS = 5;
const CONSOLIDATION_RETRIES = 2;

async function withRetry(fn, retries = CONSOLIDATION_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] retry', i + 1, e.message);
    }
  }
}

function parseJsonFromReply(reply) {
  if (!reply || typeof reply !== 'string') return null;
  let raw = reply.trim();
  const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) raw = codeMatch[1].trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** Normalize proposition for dedup: lower case, trim, slice. */
function normalizeProposition(prop) {
  return String(prop || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200);
}

/** True if a is duplicate or near-duplicate of b (one contains the other or equal). */
function isDuplicateProposition(a, b) {
  const na = normalizeProposition(a);
  const nb = normalizeProposition(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Step 1–3: Ingest recent conversation, summarize, detect salience, propose candidate beliefs.
 */
async function ingestRecentExperience(sessionId) {
  try {
    const history = sessionStore.getHistory(sessionId) || [];
    if (history.length < 2) return;

    const slice = history.slice(-Math.min(INGEST_EXCHANGES * 2, history.length));
    const transcript = slice.map((m) => `${m.role}: ${(m.content || '').slice(0, 600)}`).join('\n');

    const prompt = `You are summarizing a recent conversation for a companion AI's memory (factual, no fluff).

Conversation (last ${slice.length} messages):
---
${transcript}
---

Respond with a single JSON object (no markdown unless inside a code block) with exactly these keys:
- content_summary: string (2-4 sentences: what was discussed, outcome)
- topics: array of strings (e.g. ["memory design", "identity"])
- tone: string (e.g. "analytical", "reflective", "casual")
- salient: boolean (true only if something violated expectation: user corrected the AI, strong reaction, pattern break, or repeated theme)
- salience_score: number 0.0 to 1.0 (how much this interaction matters for long-term memory; 0.6+ = likely episodic)
- why_salient: string (brief reason if salient, else "")
- candidate_beliefs: array of 0-2 objects { "proposition": "one clear belief about the user", "evidence": "one sentence from the conversation" }. Only include if salient. Propositions should be about the user's values, preferences, or relationship—not facts about the world.`;

  let out;
  try {
    const reply = await ai(prompt, { temperature: 0.3, max_tokens: 600 });
    out = parseJsonFromReply(reply);
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] ingest ai', e.message);
    return;
  }

  if (!out || typeof out !== 'object') return;

  const salienceScore = typeof out.salience_score === 'number' ? Math.min(1, Math.max(0, out.salience_score)) : (out.salient ? 0.7 : 0.3);
  const isSalient = out.salient || salienceScore >= SALIENCE_THRESHOLD;

  memory.appendInteraction({
    timestamp: new Date().toISOString(),
    channel: 'main',
    participants: ['user', 'piko'],
    content_summary: out.content_summary || '',
    topics: Array.isArray(out.topics) ? out.topics : [],
    tone: out.tone || null,
    salience_score: salienceScore,
  });

  if (isSalient && Array.isArray(out.candidate_beliefs) && out.candidate_beliefs.length) {
    const pending = memory.getPendingBeliefs();
    for (const c of out.candidate_beliefs.slice(0, 2)) {
      const prop = c.proposition && String(c.proposition).trim();
      const ev = c.evidence && String(c.evidence).trim();
      if (!prop) continue;
      const isDup = pending.some((p) => isDuplicateProposition(p.proposition, prop));
      if (!isDup) memory.addPendingBelief(prop, ev, 0.3);
    }
    if (out.why_salient || salienceScore >= SALIENCE_THRESHOLD) {
      memory.appendEpisodic({
        event: (out.content_summary || '').slice(0, 300) + (out.why_salient ? ' [' + out.why_salient.slice(0, 100) + ']' : ''),
        perceived_significance: salienceScore,
        emotional_weight: 0.3,
        linked_beliefs: [],
        reinforcement_count: 0,
      });
    }
  }
  } catch (e) {
    const { log } = require('./logger');
    if (typeof log === 'function') log('error', 'belief_ingest', { message: e.message }, null);
    if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] ingest error', e.message);
  }
}

/**
 * Step 5: Identity impact check. Returns true if safe to add this belief (does not contradict SOUL/self-model).
 */
async function identityGate(proposition) {
  let soul = '';
  try {
    soul = fs.readFileSync(path.join(PROMPTS_DIR, 'SOUL.md'), 'utf8').trim().slice(0, 3000);
  } catch (_) {}
  const mind = loadMind();
  const identity = (mind.self_model && mind.self_model.identity) || {};
  const constraints = (mind.self_model && mind.self_model.constraints) || [];
  const invariants = (identity.loyalty_invariants || []).join('. ');
  const identityBlock = `Identity/constraints: ${invariants}. ${constraints.join('. ')}. SOUL (excerpt): ${soul.slice(0, 1500)}`;

  const prompt = `Does the following USER BELIEF (something we believe about the human user) contradict or undermine the AI's identity, values, or constraints below? Identity is about who the AI is, not about the user. A belief like "the user values depth" does NOT contradict identity.

${identityBlock}

User belief to check: "${String(proposition).slice(0, 300)}"

Answer with exactly one word: YES or NO.`;

  try {
    const reply = (await ai(prompt, { temperature: 0, max_tokens: 10 })).trim().toUpperCase();
    return reply.startsWith('NO');
  } catch (e) {
    if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] identityGate', e.message);
    return false;
  }
}

/**
 * Detect counter-evidence: which pending beliefs are contradicted by recent interactions?
 * Returns { contradictions: [ { pending_index, evidence } ] }.
 */
async function detectCounterEvidence(pending, recentInteractions) {
  if (!pending.length || !recentInteractions.length) return { contradictions: [] };
  const summaries = recentInteractions.map((i) => (i.content_summary || '').slice(0, 200)).join('\n');
  const beliefsList = pending.map((p, i) => `${i}: ${(p.proposition || '').slice(0, 150)}`).join('\n');
  const prompt = `Recent interaction summaries:
---
${summaries}
---

Candidate beliefs (index: proposition):
---
${beliefsList}
---

For each belief, does any summary contradict it (e.g. user prefers quick/short when belief says depth)? Return JSON only: { "contradictions": [ { "pending_index": 0, "evidence": "one sentence from a summary" } ] }. Use pending_index 0-based. If none, return { "contradictions": [] }.`;

  try {
    const reply = await withRetry(() => ai(prompt, { temperature: 0, max_tokens: 400 }));
    const out = parseJsonFromReply(reply);
    const contradictions = Array.isArray(out && out.contradictions) ? out.contradictions : [];
    return { contradictions };
  } catch (e) {
    const { log } = require('./logger');
    if (typeof log === 'function') log('error', 'belief_detect_counter_evidence', { message: e.message }, null);
    if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] detectCounterEvidence', e.message);
    return { contradictions: [] };
  }
}

/**
 * Step 4: Consolidate pending beliefs — adjust confidence, promote or drop. Applies counter-evidence from recent interactions.
 */
async function runBeliefConsolidation() {
  const pending = memory.getPendingBeliefs();
  if (!pending.length) return;

  const interactions = memory.getInteractions();
  const recent = interactions.slice(-CONSOLIDATION_COUNTER_EVIDENCE_INTERACTIONS);
  const { contradictions } = await detectCounterEvidence(pending, recent);
  const counterByIndex = {};
  for (const c of contradictions) {
    const i = c.pending_index;
    if (typeof i === 'number' && i >= 0 && i < pending.length && c.evidence) {
      counterByIndex[i] = (counterByIndex[i] || []).concat(String(c.evidence).slice(0, 200));
    }
  }

  const remaining = [];
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    let confidence = typeof p.confidence === 'number' ? p.confidence : 0.3;
    const counterEvidence = counterByIndex[i] || [];
    if (counterEvidence.length) confidence -= CONFIDENCE_DOWN;
    confidence += CONFIDENCE_UP;
    if (confidence >= PROMOTE_THRESHOLD) {
      let allowed = false;
      try {
        allowed = await withRetry(() => identityGate(p.proposition));
      } catch (e) {
        const { log } = require('./logger');
        if (typeof log === 'function') log('error', 'belief_identity_gate', { message: e.message }, null);
        if (process.env.PIKO_LOG_CONSOLE) console.error('[beliefLoop] identityGate', e.message);
      }
      if (allowed) {
        memory.addUserBelief(p.proposition, confidence, p.evidence, { counter_evidence: counterEvidence });
        logWriteDecision({
          write_target: 'belief',
          proposed_change: 'promoted',
          justification: [p.proposition.slice(0, 80), 'consolidation passed identity gate'],
          decision: 'approved',
          id: p.id,
        });
        if (process.env.PIKO_LOG_CONSOLE) console.log('[beliefLoop] promoted:', p.proposition.slice(0, 60));
      } else {
        logWriteDecision({
          write_target: 'belief',
          proposed_change: 'promote_rejected',
          justification: [p.proposition.slice(0, 80), 'identity gate failed'],
          risk_flags: ['identity_conflict'],
          decision: 'rejected',
          id: p.id,
        });
      }
      continue;
    }
    if (confidence <= REJECT_THRESHOLD) {
      logWriteDecision({
        write_target: 'pending_belief',
        proposed_change: 'rejected',
        justification: [p.proposition.slice(0, 80), 'confidence below threshold'],
        decision: 'rejected',
        id: p.id,
      });
      continue;
    }
    remaining.push({ ...p, confidence });
  }
  memory.setPendingBeliefs(remaining);
}

/**
 * Apply behaviour signals from the last exchange: correction, shorter, longer, affirm.
 * Heuristic-only; called after ingest so beliefs can be adjusted from explicit user feedback.
 */
function applyBehaviourSignals(sessionId, userMessage, assistantReply) {
  if (!userMessage || typeof userMessage !== 'string') return;
  const msg = userMessage.toLowerCase().trim().slice(0, 500);
  const userBeliefs = memory.getUserBeliefs();
  const pending = memory.getPendingBeliefs();

  const hasCorrection = CORRECTION_PHRASES.some((p) => msg.includes(p) || msg.startsWith(p));
  const hasShorter = SHORTER_PHRASES.some((p) => msg.includes(p));
  const hasLonger = LONGER_PHRASES.some((p) => msg.includes(p));
  const hasAffirm = AFFIRM_PHRASES.some((p) => msg.includes(p) || msg === p);

  if (hasCorrection && userBeliefs.length) {
    const byUpdated = [...userBeliefs].sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
    memory.addCounterEvidenceToBelief(byUpdated[0].proposition, msg.slice(0, 200));
  }
  if (hasShorter && userBeliefs.length) {
    const depthBelief = userBeliefs.find((b) => DEPTH_KEYWORDS.some((k) => (b.proposition || '').toLowerCase().includes(k)));
    if (depthBelief) memory.addCounterEvidenceToBelief(depthBelief.proposition, msg.slice(0, 200));
  }
  if (hasLonger && userBeliefs.length) {
    const brevityBelief = userBeliefs.find((b) => BREVITY_KEYWORDS.some((k) => (b.proposition || '').toLowerCase().includes(k)));
    if (brevityBelief) memory.addCounterEvidenceToBelief(brevityBelief.proposition, msg.slice(0, 200));
    else {
      const depthBelief = userBeliefs.find((b) => DEPTH_KEYWORDS.some((k) => (b.proposition || '').toLowerCase().includes(k)));
      if (depthBelief) memory.adjustUserBeliefConfidence(depthBelief.proposition, CONFIDENCE_UP);
    }
  }
  if (hasAffirm && userBeliefs.length) {
    const byUpdated = [...userBeliefs].sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
    memory.adjustUserBeliefConfidence(byUpdated[0].proposition, CONFIDENCE_UP);
  }
}

/**
 * Phase 3.2: Resolve conflicting user beliefs (e.g. depth vs brevity). Lowers confidence of the weaker belief.
 */
function resolveBeliefConflicts() {
  const list = memory.getUserBeliefs();
  const depthBelief = list.find((b) => DEPTH_KEYWORDS.some((k) => (b.proposition || '').toLowerCase().includes(k)));
  const brevityBelief = list.find((b) => BREVITY_KEYWORDS.some((k) => (b.proposition || '').toLowerCase().includes(k)));
  if (!depthBelief || !brevityBelief) return Promise.resolve();
  const depthStrength = (depthBelief.confidence || 0) + (Array.isArray(depthBelief.evidence) ? depthBelief.evidence.length : 0) * 0.05;
  const brevityStrength = (brevityBelief.confidence || 0) + (Array.isArray(brevityBelief.evidence) ? brevityBelief.evidence.length : 0) * 0.05;
  const weaker = depthStrength <= brevityStrength ? depthBelief : brevityBelief;
  memory.adjustUserBeliefConfidence(weaker.proposition, -CONFIDENCE_DOWN);
  if (process.env.PIKO_LOG_CONSOLE) console.log('[beliefLoop] conflict resolved, lowered:', weaker.proposition.slice(0, 50));
  return Promise.resolve();
}

module.exports = {
  ingestRecentExperience,
  runBeliefConsolidation,
  identityGate,
  applyBehaviourSignals,
  resolveBeliefConflicts,
};
