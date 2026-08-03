/**
 * Legion capability inference from brief objective.
 * Reads keyword→capability mapping from config file. Add new capabilities without code changes.
 * Phase 3: LLM-based inference when keyword matching fails (PIKO_LLM_CAPABILITY_INFERENCE=1).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { inferLegionCapabilityViaLLM } = require('./legionCapabilityInference');

const DEFAULT_CAPABILITIES = {
  'inventory.low_stock.scan': ['low stock', 'inventory', 'stock', 'scan', 'reorder check', 'stock check', 'check products'],
  'purchase_order.draft.create': ['po', 'purchase order', 'draft', 'order sheet', 'prep order', 'reorder list'],
  'ausmaker.runbook.execute': ['load recent data', 'sync data', 'recent sync', 'load recent', 'sync recent', 'incremental sync', 'full data load', 'full sync', 'full load', 'rebuild cache', 'sync status', 'sync progress', 'monitor sync', 'refresh forecast', 'list runbooks', 'integration survey', 'api attachment'],
  'sales.analysis.run': ['sales', 'analysis', 'analyse', 'sales report', 'demand forecast'],
};

let _configCache = null;
let _configMtime = 0;

const {
  hasWord,
} = require('./text');

function getConfigPath(dataDir) {
  const override = dataDir ? path.join(dataDir, 'legion-capabilities.json') : path.join(__dirname, '..', 'data', 'legion-capabilities.json');
  const shipped = path.join(__dirname, '..', 'legion-capabilities.json');
  if (override && fs.existsSync(override)) return override;
  return shipped;
}

/**
 * Load capability config. Uses data/legion-capabilities.json if present, else legion-capabilities.json in repo root.
 * Caches by file mtime; call with dataDir for server context.
 */
function loadCapabilityConfig(dataDir) {
  const configPath = getConfigPath(dataDir);
  try {
    if (!fs.existsSync(configPath)) return DEFAULT_CAPABILITIES;
    const stat = fs.statSync(configPath);
    if (_configCache && _configMtime === stat.mtimeMs) return _configCache;
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      _configCache = parsed;
      _configMtime = stat.mtimeMs;
      return _configCache;
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legionCapabilities] load failed:', e.message);
  }
  return DEFAULT_CAPABILITIES;
}

/**
 * Infer Legion capability from objective/success_criteria using config.
 * @param {object} fields - { objective, success_criteria }
 * @param {string} [dataDir] - Data dir for config override
 * @returns {string} Capability ID or ''
 */
function inferCapabilityFromObjective(fields, dataDir) {
  const objective = String(fields && fields.objective || '').toLowerCase();
  const success = String(fields && fields.success_criteria || '').toLowerCase();
  const merged = `${objective} ${success}`.trim();
  if (!merged) return '';

  const { parseRunbookFromMessage } = require('./ausmakerRunbook');
  if (parseRunbookFromMessage(fields.objective || '')) {
    return 'ausmaker.runbook.execute';
  }

  const config = loadCapabilityConfig(dataDir);
  for (const [capability, keywords] of Object.entries(config)) {
    if (!Array.isArray(keywords)) continue;
    for (const kw of keywords) {
      const k = String(kw).toLowerCase().trim();
      if (!k) continue;
      if (k.includes(' ') ? merged.includes(k) : hasWord(merged, k)) return capability;
    }
  }
  return '';
}

const _llmCache = new Map();
const LLM_CACHE_MAX = 200;

function objectiveHash(fields) {
  const objective = String(fields && fields.objective || '').trim();
  const success = String(fields && fields.success_criteria || '').trim();
  const merged = `${objective}|${success}`;
  return crypto.createHash('sha256').update(merged).digest('hex').slice(0, 32);
}

/**
 * Async capability inference: keyword match first, then LLM if PIKO_LLM_CAPABILITY_INFERENCE=1.
 * Caches LLM results by objective hash.
 * @param {object} fields - { objective, success_criteria }
 * @param {string} [dataDir] - Data dir for config override
 * @param {string} [model] - Ollama model for LLM inference (required if LLM path used)
 * @returns {Promise<string>} Capability ID or ''
 */
async function inferCapabilityFromObjectiveAsync(fields, dataDir, model) {
  const syncResult = inferCapabilityFromObjective(fields, dataDir);
  if (syncResult) return syncResult;

  if (process.env.PIKO_LLM_CAPABILITY_INFERENCE !== '1') return '';

  const hash = objectiveHash(fields);
  const cached = _llmCache.get(hash);
  if (cached !== undefined) return cached;

  const config = loadCapabilityConfig(dataDir);
  const availableCapabilities = Object.keys(config).filter((k) => Array.isArray(config[k]));
  if (availableCapabilities.length === 0) return '';

  const llmResult = await inferLegionCapabilityViaLLM(fields, availableCapabilities, model || 'llama3.1:latest');
  if (_llmCache.size >= LLM_CACHE_MAX) {
    const firstKey = _llmCache.keys().next().value;
    if (firstKey != null) _llmCache.delete(firstKey);
  }
  _llmCache.set(hash, llmResult);
  return llmResult;
}

/**
 * Clear config cache (e.g. for tests or hot-reload).
 */
function clearConfigCache() {
  _configCache = null;
  _configMtime = 0;
}

/**
 * Clear LLM inference cache (e.g. for tests).
 */
function clearLLMCache() {
  _llmCache.clear();
}

module.exports = {
  loadCapabilityConfig,
  inferCapabilityFromObjective,
  inferCapabilityFromObjectiveAsync,
  clearConfigCache,
  clearLLMCache,
  DEFAULT_CAPABILITIES,
};
