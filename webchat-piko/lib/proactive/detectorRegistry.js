/**
 * Detector registry — maps manifest detector ids to detector modules.
 * Add new detectors here; manifest controls which run.
 */
const { detectBusinessHealth } = require('./events/businessHealth');

const REGISTRY = {
  businessHealth: detectBusinessHealth,
  ausmakerBusinessHealth: detectBusinessHealth, // backward compat
};

const DEFAULT_META = {
  synthesis: false,
  envelopeLabel: null,
  pendingAction: false,
};

const DETECTOR_META = {
  businessHealth: { synthesis: true, envelopeLabel: 'Business Health Alert', pendingAction: true },
  ausmakerBusinessHealth: { synthesis: true, envelopeLabel: 'Business Health Alert', pendingAction: true },
};

/**
 * Get detector function by id.
 * @param {string} id - Detector id from manifest
 * @returns {((opts: { dataDir: string, now: Date }) => Promise<object[]>) | null}
 */
function getDetector(id) {
  return REGISTRY[String(id || '')] || null;
}

/**
 * List registered detector ids.
 */
function listDetectorIds() {
  return Object.keys(REGISTRY);
}

/**
 * Detector presentation + side-effect flags (manifest overrides registry defaults).
 */
function getDetectorMeta(id, rootDir) {
  const base = { ...DEFAULT_META, ...(DETECTOR_META[String(id || '')] || {}) };
  if (!rootDir) return base;
  try {
    const { getDetectorConfig } = require('../knowledgeManifest');
    const cfg = getDetectorConfig(rootDir, id);
    if (!cfg) return base;
    return {
      synthesis: cfg.synthesis != null ? !!cfg.synthesis : base.synthesis,
      envelopeLabel: cfg.envelopeLabel != null ? String(cfg.envelopeLabel) : base.envelopeLabel,
      pendingAction: cfg.pendingAction != null ? !!cfg.pendingAction : base.pendingAction,
    };
  } catch (_) {
    return base;
  }
}

module.exports = {
  getDetector,
  getDetectorMeta,
  listDetectorIds,
  REGISTRY,
  DETECTOR_META,
};
