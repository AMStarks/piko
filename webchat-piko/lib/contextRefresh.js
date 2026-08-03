/**
 * Context refresh — keep aggregate.json fresh via scheduled adapter capabilities.
 * Purpose: proactive analyst + observe spine stay green without manual SSH.
 */
const fs = require('fs');
const path = require('path');
const { loadManifest } = require('./knowledgeManifest');
const { getContextFreshness } = require('./sharedContext');
const { executeLegionCapabilityStep } = require('./legionCapabilityStep');

const DEFAULT_REFRESH_STEPS = [
  {
    capability: 'ausmaker.runbook.execute',
    runbook_id: 'monitor_sync_progress',
    label: 'Sync status check',
  },
];

function getContextRefreshConfig(rootDir) {
  const manifest = loadManifest(rootDir);
  const raw = manifest.contextRefresh || {};
  return {
    enabled: raw.enabled !== false,
    steps: Array.isArray(raw.steps) && raw.steps.length ? raw.steps : DEFAULT_REFRESH_STEPS,
    skipIfFresh: raw.skipIfFresh !== false,
    maxAgeHours: Number(raw.maxAgeHours) > 0 ? Number(raw.maxAgeHours) : 20,
  };
}

function statePath(dataDir) {
  return path.join(dataDir, 'context-refresh-state.json');
}

function readState(dataDir) {
  const p = statePath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2));
}

/**
 * Run configured refresh steps unless context is already fresh (optional).
 */
async function runContextRefresh(opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const dataDir = opts.dataDir || path.join(rootDir, 'data');
  const cfg = getContextRefreshConfig(rootDir);
  const force = opts.force === true
    || String(process.env.PIKO_CONTEXT_REFRESH_FORCE || '').trim() === '1';
  const maxAgeMs = Math.max(1, Number(cfg.maxAgeHours) || 20) * 60 * 60 * 1000;

  if (!cfg.enabled) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const freshness = getContextFreshness(dataDir, maxAgeMs);
  if (!force && cfg.skipIfFresh && freshness.fresh) {
    const out = {
      ok: true,
      skipped: true,
      reason: 'already_fresh',
      updatedAt: freshness.updatedAt,
      ageHours: freshness.ageHours,
      maxAgeHours: cfg.maxAgeHours,
      ts: new Date().toISOString(),
    };
    writeState(dataDir, out);
    return out;
  }

  const results = [];
  let anyOk = false;
  for (const step of cfg.steps) {
    const started = Date.now();
    try {
      const r = await executeLegionCapabilityStep(step, {
        dataDir,
        rootDir,
        legionAdapterApiBase: opts.legionAdapterApiBase,
        contextSource: 'context_refresh',
        source: 'context_refresh',
        pikoUserId: opts.pikoUserId || 'context-refresh',
      });
      results.push({
        capability: step.capability,
        runbook_id: step.runbook_id || null,
        ok: !!r.ok,
        summary: String(r.summary || '').slice(0, 300),
        ms: Date.now() - started,
        runId: r.runId || null,
      });
      if (r.ok) anyOk = true;
    } catch (e) {
      results.push({
        capability: step.capability,
        ok: false,
        error: e.message || String(e),
        ms: Date.now() - started,
      });
    }
  }

  const after = getContextFreshness(dataDir, maxAgeMs);
  const out = {
    ok: anyOk,
    skipped: false,
    forced: force,
    ts: new Date().toISOString(),
    before: { fresh: freshness.fresh, ageHours: freshness.ageHours, updatedAt: freshness.updatedAt },
    after: { fresh: after.fresh, ageHours: after.ageHours, updatedAt: after.updatedAt },
    results,
  };
  writeState(dataDir, out);
  return out;
}

module.exports = {
  runContextRefresh,
  getContextRefreshConfig,
  readState,
  DEFAULT_REFRESH_STEPS,
};
