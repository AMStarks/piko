/**
 * Proactive analyst — evaluates business data for anomalies.
 * Unified handler for chat (on-demand) and proactive engine.
 * Supports shared context format (capabilities keyed by capability) and legacy single-result format.
 * Platform-agnostic: prompt loaded from knowledge/prompts/analyst.md when present (fallback: built-in).
 */
const path = require('path');
const fs = require('fs');
const { ollamaNativeChat } = require('../llm');
const {
  loadContext,
  saveContext,
  getContextFreshness,
  DEFAULT_CONTEXT_MAX_AGE_MS,
  AUSMAKER_CONTEXT_FILE,
} = require('../sharedContext');
const { loadManifest, getKnowledgePath } = require('../knowledgeManifest');

const MAX_CONTEXT_AGE_MS = DEFAULT_CONTEXT_MAX_AGE_MS;
const MAX_DATA_CHARS = Math.min(12000, parseInt(process.env.PIKO_ANALYST_MAX_DATA_CHARS || '8000', 10));
const ANALYST_MODEL = process.env.PIKO_ANALYST_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:latest';

const BUSINESS_BELIEF_KEYWORDS = ['sales','forecast','reorder','inventory','stock','po','purchase','supplier','widget','wholesale','ausmaker','sku','revenue'];

const BUILTIN_ANALYST_PROMPT = `You are Piko's internal business logic engine.
Review the following data (sales, inventory, forecasts, purchase orders).
Look for:
1. Significant drops in forecasted revenue.
2. Sudden spikes in product demand that outpace current inventory.
3. Stagnant SKUs costing us money.
4. Purchase orders ready but not submitted.
5. Inventory reorder spikes or urgent items.

If everything looks normal, output EXACTLY: NO_ACTION
If there is an anomaly or a strategic insight, output a brief JSON object with:
- type: string (e.g. "revenue_drop", "demand_spike", "stagnant_sku", "reorder_spike", "po_pending")
- summary: string (one sentence)
- severity: "low" | "normal" | "high"
- detail: string (optional extra context)

{BELIEFS_BLOCK}
Data:
{DATA}
`;

const {
  stripCodeFences,
  extractBalancedJsonObject,
  hasAnyWord,
} = require('../text');

function loadAnalystPrompt(dataDir) {
  const rootDir = dataDir ? path.dirname(dataDir) : path.join(__dirname, '..', '..');
  const manifest = loadManifest(rootDir);
  const knowledgePath = manifest.knowledgePath || getKnowledgePath(rootDir);
  const promptPath = path.join(knowledgePath, 'prompts', 'analyst.md');
  if (fs.existsSync(promptPath)) {
    try {
      const raw = fs.readFileSync(promptPath, 'utf8');
      const trimmed = String(raw || '').trim();
      if (trimmed.length > 0) return trimmed;
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[proactive-analyst] prompt load:', e.message);
    }
  }
  return BUILTIN_ANALYST_PROMPT;
}

function loadAusmakerContext(dataDir) {
  return loadContext(dataDir);
}

/** Load business-relevant user beliefs for analyst prompt injection. */
function loadBusinessBeliefs(dataDir) {
  let getUserBeliefs;
  try {
    const memory = require('../memory');
    getUserBeliefs = memory.getUserBeliefs || (() => []);
  } catch (_) {
    return [];
  }
  const all = getUserBeliefs();
  const business = all
    .filter((b) => b.proposition && hasAnyWord(String(b.proposition).toLowerCase(), BUSINESS_BELIEF_KEYWORDS))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 10);
  return business.map((b) => String(b.proposition || '').slice(0, 150));
}

function saveAnalyzedAt(dataDir) {
  const ctx = loadContext(dataDir);
  if (!ctx) return;
  ctx.lastAnalyzedAt = new Date().toISOString();
  saveContext(dataDir, ctx);
}

/** Build analyst input from context. Supports capabilities format and legacy single result. */
function buildAnalystData(ctx) {
  const caps = ctx.capabilities && typeof ctx.capabilities === 'object' ? ctx.capabilities : {};
  if (Object.keys(caps).length > 0) {
    const parts = [];
    for (const [cap, entry] of Object.entries(caps)) {
      if (!entry || !entry.result) continue;
      const r = entry.result;
      let str = r.summary || r.forecast_summary;
      if (str && typeof str === 'object') str = JSON.stringify(str);
      if (!str || typeof str !== 'string') str = JSON.stringify(r, null, 2);
      parts.push(`[${cap}]\n${String(str).slice(0, 4000)}`);
    }
    return parts.join('\n\n');
  }
  const result = ctx.result;
  if (!result) return '';
  let dataStr = result.summary || result.forecast_summary;
  if (dataStr && typeof dataStr === 'object') dataStr = JSON.stringify(dataStr);
  if (!dataStr || typeof dataStr !== 'string') dataStr = JSON.stringify(result, null, 2);
  return String(dataStr);
}

/**
 * Run analyst on AusMaker context. Returns { action: 'none' } or { action: 'alert', anomaly: {...} }.
 * @param {string} [dataDir] - Data directory
 * @param {{ forceAnalyze?: boolean }} [opts] - forceAnalyze: bypass lastAnalyzedAt (for on-demand)
 * @returns {Promise<{ action: 'none' | 'alert', anomaly?: object }>}
 */
function attachFreshness(dataDir, out) {
  const freshness = getContextFreshness(dataDir, MAX_CONTEXT_AGE_MS);
  return { ...out, freshness, stale: !freshness.fresh };
}

async function runAnalyst(dataDir, opts = {}) {
  const ctx = loadContext(dataDir);
  const freshness = getContextFreshness(dataDir, MAX_CONTEXT_AGE_MS);
  const hasData = freshness.hasData;
  if (!hasData) return { action: 'none', freshness, stale: true, reason: 'no_data' };

  if (!opts.forceAnalyze && !freshness.fresh) {
    return { action: 'none', freshness, stale: true, reason: 'stale_context' };
  }

  const updatedAt = ctx.updatedAt ? new Date(ctx.updatedAt).getTime() : 0;
  const lastAnalyzed = ctx.lastAnalyzedAt ? new Date(ctx.lastAnalyzedAt).getTime() : 0;
  if (!opts.forceAnalyze && lastAnalyzed >= updatedAt) {
    return { action: 'none', freshness, stale: !freshness.fresh, reason: 'already_analyzed' };
  }

  const dataStr = String(buildAnalystData(ctx)).slice(0, MAX_DATA_CHARS);
  if (!dataStr.trim()) return { action: 'none', freshness, stale: !freshness.fresh, reason: 'empty_data' };

  const beliefs = loadBusinessBeliefs(dataDir);
  const beliefsBlock = beliefs.length > 0
    ? `User rules (do not flag anomalies that contradict these):\n${beliefs.map((b) => `- ${b}`).join('\n')}\n\n`
    : '';

  const promptTemplate = loadAnalystPrompt(dataDir);
  const prompt = promptTemplate
    .replace('{BELIEFS_BLOCK}', beliefsBlock)
    .replace('{DATA}', dataStr);

  let raw;
  try {
    raw = await ollamaNativeChat(ANALYST_MODEL, [{ role: 'user', content: prompt }], {
      temperature: 0.2,
      max_tokens: 300,
    });
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[proactive-analyst] LLM error:', e.message);
    }
    return attachFreshness(dataDir, { action: 'none', reason: 'llm_error' });
  }

  const trimmed = String(raw || '').trim().toUpperCase();
  if (trimmed === 'NO_ACTION' || trimmed.startsWith('NO_ACTION')) {
    saveAnalyzedAt(dataDir);
    return attachFreshness(dataDir, { action: 'none', reason: 'no_action' });
  }

  // Robust JSON extraction — models sometimes wrap in "Here is the anomaly: {...}"
  let anomaly = null;
  const rawStr = String(raw || '').trim();
  const jsonMatch = extractBalancedJsonObject(rawStr);
  const toParse = jsonMatch || stripCodeFences(rawStr);
  try {
    anomaly = JSON.parse(toParse);
  } catch (_) {
    // Parsing failed — treat as NO_ACTION (don't alert on hallucinated/garbage output)
    saveAnalyzedAt(dataDir);
    return attachFreshness(dataDir, { action: 'none', reason: 'parse_error' });
  }

  if (!anomaly || typeof anomaly !== 'object') {
    saveAnalyzedAt(dataDir);
    return attachFreshness(dataDir, { action: 'none', reason: 'invalid_anomaly' });
  }

  saveAnalyzedAt(dataDir);
  return attachFreshness(dataDir, { action: 'alert', anomaly });
}

/**
 * Unified business health review — used by chat (on-demand) and proactive engine.
 * Same as runAnalyst; opts.forceAnalyze bypasses idempotency for on-demand.
 */
async function runBusinessHealthReview(dataDir, opts = {}) {
  return runAnalyst(dataDir, opts);
}

function formatBusinessHealthReply(review) {
  const f = review && review.freshness;
  const ageNote = f && f.fresh && f.ageHours != null
    ? ` (metrics ~${f.ageHours}h old)`
    : f && !f.fresh
      ? ` (data is stale${f.ageHours != null ? ` — ~${f.ageHours}h old` : ''}; run low stock or sales scan for fresher context)`
      : '';
  if (review.action === 'alert' && review.anomaly) {
    const a = review.anomaly;
    const body = String(a.summary || a.detail || 'Anomaly detected.');
    const extra = a.detail && a.summary && a.detail !== a.summary ? ` ${a.detail}` : '';
    return `Business: ${body}${extra}${ageNote}`;
  }
  if (review.reason === 'no_data') {
    return `No business metrics in context yet — run a low stock scan or sales analysis first.${ageNote}`;
  }
  return `Nothing to report — business looks normal.${ageNote}`;
}

module.exports = {
  loadAusmakerContext,
  loadBusinessBeliefs,
  runAnalyst,
  runBusinessHealthReview,
  formatBusinessHealthReply,
  MAX_CONTEXT_AGE_MS,
  AUSMAKER_CONTEXT_FILE,
};
