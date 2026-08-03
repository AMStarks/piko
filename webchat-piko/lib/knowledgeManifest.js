/**
 * Knowledge manifest loader — platform-agnostic config.
 * Falls back to AusMaker defaults when manifest is missing (backward compatible).
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_CONTEXT_FILE = 'context/aggregate.json';
const LEGACY_CONTEXT_FILE = 'ausmaker-context.json';
const DEFAULT_SILENT_CAPABILITIES = ['sales.analysis.run'];
const DEFAULT_NATIVE_CAPABILITIES = [
  {
    id: 'ausmaker.business.health.review',
    patterns: [
      'run business review',
      'have a look at the business',
      'check ausmaker',
      'anything wrong with the business',
      'review the business',
      'business health',
      'ausmaker review',
    ],
  },
];
const DEFAULT_ADAPTER = 'ausmakersupplies';
const DEFAULT_ADAPTER_ALIASES = [
  {
    phrases: ['aus maker', 'ausmaker', 'cin7', 'shopify'],
    adapterId: 'ausmakersupplies',
  },
];

let cached = null;

const {
  includesAny,
  hasAnyWord,
} = require('./text');

function getDefaultAdapter(rootDir) {
  return loadManifest(rootDir).defaultAdapter || DEFAULT_ADAPTER;
}

/**
 * Infer Legion adapter id from brief objective/scope text (manifest adapterAliases).
 */
function inferAdapterFromBrief(fields, rootDir) {
  const objective = String(fields && fields.objective || '').toLowerCase();
  const scope = String(fields && fields.scope || '').toLowerCase();
  const merged = `${objective} ${scope}`.trim();
  const manifest = loadManifest(rootDir);
  const aliases = manifest.adapterAliases || DEFAULT_ADAPTER_ALIASES;
  for (const entry of aliases) {
    const adapterId = String(entry.adapterId || '').trim();
    if (!adapterId) continue;
    let phrases = Array.isArray(entry.phrases) ? entry.phrases.map(String) : [];
    if (!phrases.length && entry.pattern) {
      // Legacy: pipe-separated tokens with optional \\b / \\s* noise
      const raw = String(entry.pattern);
      let buf = '';
      const push = () => { const t = buf.trim(); if (t) phrases.push(t); buf = ''; };
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '\\' && raw[i + 1] === 'b') { i++; continue; }
        if (raw[i] === '\\' && raw[i + 1] === 's' && raw[i + 2] === '*') { buf += ' '; i += 2; continue; }
        if (raw[i] === '|') { push(); continue; }
        if (raw[i] === '(' || raw[i] === ')') continue;
        buf += raw[i];
      }
      push();
    }
    const lows = phrases.map((p) => p.toLowerCase()).filter(Boolean);
    if (!lows.length) continue;
    if (includesAny(merged, lows) || hasAnyWord(merged, lows)) return adapterId;
  }
  return manifest.defaultAdapter || process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || DEFAULT_ADAPTER;
}

function getDetectorConfig(rootDir, detectorId) {
  const manifest = loadManifest(rootDir);
  const detectors = manifest.detectors || [];
  const hit = detectors.find((d) => String(d.id) === String(detectorId));
  return hit && typeof hit === 'object' ? hit : null;
}

function getKnowledgePath(rootDir) {
  const base = process.env.PIKO_KNOWLEDGE_PATH || path.join(rootDir || path.join(__dirname, '..'), 'knowledge');
  return path.isAbsolute(base) ? base : path.join(rootDir || path.join(__dirname, '..'), base);
}

/**
 * Load manifest. Returns defaults when missing — backward compatible.
 * @param {string} [rootDir] - Project root (default: webchat-piko dir)
 * @returns {object} Manifest with contextFile, silentCapabilities, nativeCapabilities, defaultAdapter
 */
function loadManifest(rootDir) {
  if (cached) return cached;
  const knowledgePath = getKnowledgePath(rootDir);
  const manifestPath = path.join(knowledgePath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    cached = {
      contextFile: process.env.PIKO_CONTEXT_FILE || DEFAULT_CONTEXT_FILE,
      silentCapabilities: (process.env.PIKO_AUSMAKER_SILENT_CAPABILITIES || 'sales.analysis.run')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      nativeCapabilities: DEFAULT_NATIVE_CAPABILITIES,
      defaultAdapter: process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || DEFAULT_ADAPTER,
      adapterAliases: DEFAULT_ADAPTER_ALIASES,
      detectors: [{ id: 'businessHealth', enabled: true, synthesis: true, envelopeLabel: 'Business Health Alert', pendingAction: true }],
      knowledgePath,
      fromFile: false,
    };
    return cached;
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const m = parsed && typeof parsed === 'object' ? parsed : {};
    cached = {
      contextFile: m.contextFile || process.env.PIKO_CONTEXT_FILE || DEFAULT_CONTEXT_FILE,
      silentCapabilities: Array.isArray(m.silentCapabilities)
        ? m.silentCapabilities
        : (process.env.PIKO_AUSMAKER_SILENT_CAPABILITIES || 'sales.analysis.run').split(',').map((s) => s.trim()).filter(Boolean),
      nativeCapabilities: Array.isArray(m.nativeCapabilities) ? m.nativeCapabilities : DEFAULT_NATIVE_CAPABILITIES,
      defaultAdapter: m.defaultAdapter || process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER || DEFAULT_ADAPTER,
      adapterAliases: Array.isArray(m.adapterAliases) ? m.adapterAliases : DEFAULT_ADAPTER_ALIASES,
      detectors: Array.isArray(m.detectors) ? m.detectors : [],
      contextRefresh: m.contextRefresh && typeof m.contextRefresh === 'object' ? m.contextRefresh : null,
      knowledgePath,
      fromFile: true,
    };
    return cached;
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[knowledgeManifest] load error:', e.message);
    cached = {
      contextFile: DEFAULT_CONTEXT_FILE,
      silentCapabilities: DEFAULT_SILENT_CAPABILITIES,
      nativeCapabilities: DEFAULT_NATIVE_CAPABILITIES,
      defaultAdapter: DEFAULT_ADAPTER,
      adapterAliases: DEFAULT_ADAPTER_ALIASES,
      detectors: [],
      knowledgePath,
      fromFile: false,
    };
    return cached;
  }
}

/** Clear cache (for tests). */
function clearCache() {
  cached = null;
}

module.exports = {
  loadManifest,
  getKnowledgePath,
  getDefaultAdapter,
  inferAdapterFromBrief,
  getDetectorConfig,
  clearCache,
  DEFAULT_CONTEXT_FILE,
  LEGACY_CONTEXT_FILE,
  DEFAULT_SILENT_CAPABILITIES,
  DEFAULT_NATIVE_CAPABILITIES,
  DEFAULT_ADAPTER,
  DEFAULT_ADAPTER_ALIASES,
};
