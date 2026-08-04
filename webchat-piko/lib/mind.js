/**
 * Piko mind: single pipeline for learning. All observations flow through update_mind().
 * Loyalty and worldview are applied here; self_model is the source of invariants.
 */
const path = require('path');
const fs = require('fs');
const { ai } = require('./llm');

const MIND_DIR = process.env.PIKO_MIND_DIR || path.join(__dirname, '..', 'data', 'mind');
const PRIMARY_HUMAN = process.env.PIKO_PRIMARY_HUMAN || process.env.PIKO_PRIMARY_USER || '';

const {
  stripCodeFences,
  extractBalancedJsonObject,
} = require('./text');

function mindPath(file) {
  return path.join(MIND_DIR, file);
}

function readJson(file, defaultValue) {
  try {
    const raw = fs.readFileSync(mindPath(file), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  const { atomicWriteJson } = require('./atomicJson');
  atomicWriteJson(mindPath(file), data);
}

/**
 * Load full mind. Fills primary_human from env if empty in self_model.
 */
function loadMind() {
  const self_model = readJson('self_model.json', {
    identity: { name: 'Piko', primary_human: '', relationship_status: 'companion', loyalty_invariants: [] },
    capabilities: { channels: [], tools: [] },
    values: [],
    constraints: [],
    version: 1,
    last_modified_at: null,
    last_modified_by: null,
  });
  if (!self_model.identity.primary_human && PRIMARY_HUMAN) {
    self_model.identity.primary_human = PRIMARY_HUMAN;
  }
  return {
    self_model,
    beliefs: readJson('beliefs.json', []),
    goals: readJson('goals.json', []),
    tensions: readJson('tensions.json', []),
    relationship: readJson('relationship.json', { milestones: [], quality_metrics: {}, companion_since: null }),
  };
}

function nextId(items, prefix) {
  const nums = items
    .map((x) => (x.id && x.id.startsWith(prefix) ? parseInt(x.id.slice(prefix.length), 10) : 0))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Extract JSON from LLM reply (handles optional markdown code block). */
function parseUpdateReply(reply) {
  if (!reply || typeof reply !== 'string') return null;
  const raw = stripCodeFences(reply);
  const obj = extractBalancedJsonObject(raw);
  try {
    return JSON.parse(obj || raw);
  } catch (_) {
    return null;
  }
}

/**
 * Ask LLM to classify observation and propose mind updates. Returns structured update or null.
 */
async function classifyAndProposeUpdates(mind, observation) {
  const vows = (mind.self_model.identity.loyalty_invariants || []).join('. ');
  const values = (mind.self_model.values || []).join('; ');
  const beliefsSummary = (mind.beliefs || []).slice(-15).map((b) => `${b.id}: ${(b.text || '').slice(0, 80)}`).join('\n');
  const goalsSummary = (mind.goals || []).slice(-10).map((g) => `${g.id}: ${(g.text || '').slice(0, 80)} [${g.status}]`).join('\n');
  const tensionsSummary = (mind.tensions || []).slice(-10).map((t) => `${t.id}: ${(t.a || t.polarity_a)} vs ${t.b || t.polarity_b}`).join('\n');

  const prompt = `You are Piko. Your loyalty invariants: ${vows}. Your values: ${values}.

Current mind (recent only):
Beliefs:
${beliefsSummary || '(none)'}
Goals:
${goalsSummary || '(none)'}
Tensions:
${tensionsSummary || '(none)'}

New observation (from conversation, reflection, or external input):
---
${typeof observation === 'string' ? observation : JSON.stringify(observation)}
---

Decide if this observation warrants updating the mind. Output ONLY a single JSON object with any of these keys (omit keys if no update):
- new_beliefs: array of { "text": "one short sentence", "confidence": 0.0-1.0 }
- update_beliefs: array of { "id": "b001", "text": "optional new text", "confidence": optional number }
- new_goals: array of { "text": "short description", "status": "active" }
- new_tensions: array of { "a": "one pole", "b": "other pole" }
- relationship_milestone: single object { "type": "string", "note": "string" }

Rules: Prefer updating existing belief/goal if it fits. Do not invent IDs for update_beliefs (use existing ids from the list). If nothing meaningful to store, output {}.
Output only valid JSON, no other text.`;

  const reply = await ai(prompt, { max_tokens: 800, temperature: 0.3 });
  return parseUpdateReply(reply);
}

/**
 * Apply proposed updates to in-memory mind and persist. Returns summary of what was applied.
 */
function applyUpdates(mind, plan) {
  if (!plan || typeof plan !== 'object') return { applied: [] };
  const applied = [];

  const now = new Date().toISOString().slice(0, 10);

  if (Array.isArray(plan.new_beliefs) && plan.new_beliefs.length) {
    for (const b of plan.new_beliefs) {
      const text = (b.text || '').trim().slice(0, 500);
      if (!text) continue;
      const id = nextId(mind.beliefs, 'b');
      mind.beliefs.push({
        id,
        text,
        evidence: [],
        confidence: typeof b.confidence === 'number' ? b.confidence : 0.8,
        source: 'observation',
        last_touched: now,
      });
      applied.push({ type: 'new_belief', id, text: text.slice(0, 60) });
    }
    writeJson('beliefs.json', mind.beliefs);
  }

  if (Array.isArray(plan.update_beliefs) && plan.update_beliefs.length) {
    for (const u of plan.update_beliefs) {
      const existing = mind.beliefs.find((b) => b.id === u.id);
      if (!existing) continue;
      if (u.text && typeof u.text === 'string') existing.text = u.text.trim().slice(0, 500);
      if (typeof u.confidence === 'number') existing.confidence = u.confidence;
      existing.last_touched = now;
      applied.push({ type: 'update_belief', id: u.id });
    }
    writeJson('beliefs.json', mind.beliefs);
  }

  if (Array.isArray(plan.new_goals) && plan.new_goals.length) {
    for (const g of plan.new_goals) {
      const text = (g.text || '').trim().slice(0, 300);
      if (!text) continue;
      const id = nextId(mind.goals, 'g');
      mind.goals.push({
        id,
        text,
        status: g.status || 'active',
        subgoals: [],
        last_touched: now,
      });
      applied.push({ type: 'new_goal', id, text: text.slice(0, 60) });
    }
    writeJson('goals.json', mind.goals);
  }

  if (Array.isArray(plan.new_tensions) && plan.new_tensions.length) {
    for (const t of plan.new_tensions) {
      const a = (t.a || t.polarity_a || '').trim().slice(0, 200);
      const b = (t.b || t.polarity_b || '').trim().slice(0, 200);
      if (!a || !b) continue;
      const id = nextId(mind.tensions, 't');
      mind.tensions.push({
        id,
        a,
        b,
        examples: [],
        last_touched: now,
      });
      applied.push({ type: 'new_tension', id, a, b });
    }
    writeJson('tensions.json', mind.tensions);
  }

  if (plan.relationship_milestone && typeof plan.relationship_milestone === 'object') {
    const m = plan.relationship_milestone;
    const type = (m.type || 'note').toString().slice(0, 50);
    const note = (m.note || '').toString().slice(0, 500);
    mind.relationship.milestones = mind.relationship.milestones || [];
    mind.relationship.milestones.push({
      date: now,
      type,
      note,
    });
    writeJson('relationship.json', mind.relationship);
    applied.push({ type: 'relationship_milestone', note: note.slice(0, 60) });
  }

  return { applied };
}

/**
 * Update and persist self_model. Merges partial updates. Use for primary_human, values, constraints.
 */
function saveSelfModel(updates) {
  const mind = loadMind();
  const sm = mind.self_model;
  if (updates.primary_human !== undefined) {
    sm.identity = sm.identity || {};
    sm.identity.primary_human = String(updates.primary_human).trim().slice(0, 200);
  }
  if (updates.values !== undefined) {
    sm.values = Array.isArray(updates.values) ? updates.values.map((s) => String(s).trim()).filter(Boolean) : sm.values;
  }
  if (updates.constraints !== undefined) {
    sm.constraints = Array.isArray(updates.constraints)
      ? updates.constraints.map((s) => String(s).trim()).filter(Boolean)
      : sm.constraints;
  }
  sm.last_modified_at = new Date().toISOString();
  writeJson('self_model.json', sm);
}

/**
 * Replace and persist beliefs (e.g. from control UI).
 */
function saveBeliefs(beliefs) {
  const list = Array.isArray(beliefs) ? beliefs : [];
  writeJson('beliefs.json', list);
}

/**
 * Single entry point: observe something, classify, apply updates. All learning flows through here.
 * Call from conversation end, daily-briefing, Moltbook feedback, etc.
 * Returns { applied: [...] } or { error: string }. Does not throw.
 */
async function updateMind(observation) {
  if (process.env.PIKO_MIND_DISABLED === '1' || process.env.PIKO_MIND_DISABLED === 'true') {
    return { applied: [], skipped: 'mind disabled' };
  }
  const obs =
    typeof observation === 'string'
      ? observation
      : Array.isArray(observation)
        ? observation.map((m) => (m.role ? `${m.role}: ${(m.content || '').slice(0, 500)}` : String(m))).join('\n')
        : JSON.stringify(observation);
  if (!obs || obs.length < 10) return { applied: [] };

  try {
    const mind = loadMind();
    const plan = await classifyAndProposeUpdates(mind, obs);
    const result = applyUpdates(mind, plan);
    return result;
  } catch (e) {
    if (process.env.LITELLM_LOG) console.error('[mind] update_mind error:', e.message);
    return { applied: [], error: e.message };
  }
}

/**
 * Bootstrap: load existing learning markdown and push as one observation so the mind can absorb it.
 * Call once or periodically to sync legacy markdown into the mind.
 */
function bootstrapFromMarkdown(learningDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = learningDir || path.join(__dirname, '..', 'data', 'learning');
  const parts = [];
  try {
    const tensionsPath = path.join(dir, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      parts.push('Tensions (current):\n' + fs.readFileSync(tensionsPath, 'utf8').trim().slice(0, 2000));
    }
    const stickyPath = path.join(dir, 'sticky-ideas.md');
    if (fs.existsSync(stickyPath)) {
      parts.push('Sticky ideas (current):\n' + fs.readFileSync(stickyPath, 'utf8').trim().slice(0, 2000));
    }
    const rabbitPath = path.join(dir, 'rabbit-hole-notes.md');
    if (fs.existsSync(rabbitPath)) {
      parts.push('Rabbit-hole notes (recent):\n' + fs.readFileSync(rabbitPath, 'utf8').trim().slice(-3000));
    }
  } catch (_) {}
  return parts.length ? parts.join('\n\n---\n\n') : '';
}

module.exports = {
  loadMind,
  updateMind,
  saveSelfModel,
  saveBeliefs,
  bootstrapFromMarkdown,
  MIND_DIR,
  nextId,
  readJson,
  writeJson,
};
