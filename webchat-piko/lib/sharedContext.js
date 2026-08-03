/**
 * Shared context — all Legion run results keyed by capability.
 * Phase 1: Intercept all Legion runs; single source for proactive analyst.
 * Platform-agnostic: context path and silent capabilities from knowledge manifest (fallback: AusMaker defaults).
 */
const path = require('path');
const fs = require('fs');
const { loadManifest } = require('./knowledgeManifest');

const LEGACY_CONTEXT_FILE = 'ausmaker-context.json';
const DEFAULT_CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getManifest(dataDir) {
  const dataDirResolved = dataDir || path.join(__dirname, '..', 'data');
  const rootDir = path.dirname(dataDirResolved);
  return loadManifest(rootDir);
}

function getContextPath(dataDir) {
  const dataDirResolved = dataDir || path.join(__dirname, '..', 'data');
  const manifest = getManifest(dataDir);
  const contextFile = manifest.contextFile || LEGACY_CONTEXT_FILE;
  return path.join(dataDirResolved, contextFile);
}

function getSilentCapabilities(dataDir) {
  const manifest = getManifest(dataDir);
  return manifest.silentCapabilities || [process.env.PIKO_AUSMAKER_SILENT_CAPABILITIES || 'sales.analysis.run']
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function migrateLegacyContextIfNeeded(dataDir) {
  const dataDirResolved = dataDir || path.join(__dirname, '..', 'data');
  const p = getContextPath(dataDir);
  const legacy = path.join(dataDirResolved, LEGACY_CONTEXT_FILE);
  if (p === legacy || fs.existsSync(p)) return;
  if (!fs.existsSync(legacy)) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.copyFileSync(legacy, p);
}

function loadContext(dataDir) {
  migrateLegacyContextIfNeeded(dataDir);
  const p = getContextPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveContext(dataDir, ctx) {
  const p = getContextPath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ctx, null, 2), 'utf8');
}

const GUILLOTINE_MAX_ITEMS = 5;

/**
 * Truncate large arrays in Legion result before saving. Prevents VRAM overspill when context is loaded into LLM prompts.
 */
function truncateForContext(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  const recs = out.forecast_raw?.purchase_recommendations || out.purchase_recommendations || out.data?.purchase_recommendations;
  if (Array.isArray(recs) && recs.length > GUILLOTINE_MAX_ITEMS) {
    const truncated = recs.slice(0, GUILLOTINE_MAX_ITEMS);
    if (out.forecast_raw) out.forecast_raw = { ...out.forecast_raw, purchase_recommendations: truncated };
    else if (out.data) out.data = { ...out.data, purchase_recommendations: truncated };
    else out.purchase_recommendations = truncated;
  }
  return out;
}

/**
 * Save a Legion run result to shared context. Upserts by capability.
 * @param {string} dataDir - Data directory
 * @param {string} capability - e.g. inventory.low_stock.scan, sales.analysis.run
 * @param {object} result - Legion run result
 */
function saveLegionResult(dataDir, capability, result, meta = {}) {
  if (!capability || !result) return;
  const safeResult = truncateForContext(result);
  const ctx = loadContext(dataDir) || {
    updatedAt: null,
    lastAnalyzedAt: null,
    capabilities: {},
  };
  ctx.capabilities = ctx.capabilities || {};
  ctx.capabilities[capability] = {
    result: safeResult,
    updatedAt: new Date().toISOString(),
    ...(meta && typeof meta === 'object' ? meta : {}),
  };
  ctx.updatedAt = new Date().toISOString();
  saveContext(dataDir, ctx);
}

function parseIsoMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Freshness summary for shared context (top-level updatedAt + per-capability).
 */
function getContextFreshness(dataDir, maxAgeMs = DEFAULT_CONTEXT_MAX_AGE_MS) {
  const ctx = loadContext(dataDir);
  const now = Date.now();
  const updatedAtMs = parseIsoMs(ctx && ctx.updatedAt);
  const ageMs = updatedAtMs > 0 ? Math.max(0, now - updatedAtMs) : null;
  const capabilities = {};
  const caps = ctx && ctx.capabilities && typeof ctx.capabilities === 'object' ? ctx.capabilities : {};
  for (const [cap, entry] of Object.entries(caps)) {
    const capUpdatedMs = parseIsoMs(entry && entry.updatedAt);
    const capAgeMs = capUpdatedMs > 0 ? Math.max(0, now - capUpdatedMs) : null;
    capabilities[cap] = {
      updatedAt: entry && entry.updatedAt ? String(entry.updatedAt) : null,
      source: entry && entry.source ? String(entry.source) : null,
      ageMs: capAgeMs,
      fresh: capAgeMs != null && capAgeMs <= maxAgeMs,
    };
  }
  return {
    hasData: !!(ctx && (Object.keys(caps).length > 0 || ctx.result)),
    updatedAt: ctx && ctx.updatedAt ? String(ctx.updatedAt) : null,
    lastAnalyzedAt: ctx && ctx.lastAnalyzedAt ? String(ctx.lastAnalyzedAt) : null,
    ageMs,
    ageHours: ageMs != null ? Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10 : null,
    fresh: ageMs != null && ageMs <= maxAgeMs,
    maxAgeMs,
    capabilities,
  };
}

function isContextFresh(dataDir, maxAgeMs = DEFAULT_CONTEXT_MAX_AGE_MS) {
  const f = getContextFreshness(dataDir, maxAgeMs);
  return !!(f.hasData && f.fresh);
}

function getCapabilityFreshness(dataDir, capability, maxAgeMs = DEFAULT_CONTEXT_MAX_AGE_MS) {
  const cap = String(capability || '').trim();
  const f = getContextFreshness(dataDir, maxAgeMs);
  const entry = f.capabilities[cap];
  if (!entry) {
    return { capability: cap, hasData: false, fresh: false, ageMs: null, updatedAt: null, source: null, maxAgeMs };
  }
  return { capability: cap, hasData: true, ...entry, maxAgeMs };
}

/**
 * True if this capability should skip Telegram when from intent-poller.
 */
function isSilentCapability(capability, dataDir) {
  const silent = getSilentCapabilities(dataDir);
  return silent.includes(String(capability || '').trim());
}

module.exports = {
  loadContext,
  saveContext,
  saveLegionResult,
  isSilentCapability,
  getSilentCapabilities,
  getContextFreshness,
  isContextFresh,
  getCapabilityFreshness,
  DEFAULT_CONTEXT_MAX_AGE_MS,
  AUSMAKER_CONTEXT_FILE: LEGACY_CONTEXT_FILE,
  getContextPath,
};
