/**
 * Observability subnet — read-only site summary for HQ / monitor (purpose: see site health without SSH).
 */
const fs = require('fs');
const path = require('path');
const { loadSiteManifest } = require('./siteManifest');
const { getContextFreshness } = require('./sharedContext');
const { loadManifest } = require('./knowledgeManifest');
const { readState: readContextRefreshState } = require('./contextRefresh');

const {
  stripTrailingSlash,
} = require('./text');

function readWatchState(dataDir) {
  const p = path.join(dataDir, 'watch-state.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readLastCanaryLine(dataDir) {
  const local = path.join(dataDir, 'legion-ausmaker-canary-log.jsonl');
  if (!fs.existsSync(local)) return null;
  try {
    const lines = fs.readFileSync(local, 'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch (_) {
    return null;
  }
}

async function buildObserveSummary(opts) {
  const {
    dataDir,
    rootDir,
    legionAdapterBase,
    checkAdapterHealth,
    loadIntents,
  } = opts;

  const site = loadSiteManifest(rootDir);
  const knowledge = loadManifest(rootDir);
  const ctx = getContextFreshness(dataDir);
  const watch = readWatchState(dataDir);
  const canary = readLastCanaryLine(dataDir);
  const contextRefresh = readContextRefreshState(dataDir);

  let adapter = { ok: false, error: 'not_checked' };
  try {
    adapter = await checkAdapterHealth({ baseUrl: legionAdapterBase });
  } catch (e) {
    adapter = { ok: false, error: e.message };
  }

  const health = { ok: true, model: process.env.OLLAMA_MODEL || null, llm: process.env.MODEL_PRIMARY || null };

  const intents = typeof loadIntents === 'function' ? loadIntents() : [];
  const scheduled = intents.filter((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status));

  const spineOk = !!(health.ok !== false && adapter.ok && ctx.fresh);
  const overall = spineOk && (!canary || canary.overall === 'pass');

  const summary = {
    ok: true,
    contract_version: (site.observe && site.observe.contract_version) || '2026-06-12.observe.v1',
    ts: new Date().toISOString(),
    tenant_id: site.tenant_id || 'customer-01',
    display_name: site.display_name || site.tenant_id,
    overall: overall ? 'pass' : 'check',
    spine: {
      webchat: { ok: health.ok !== false, model: health.model || null, llm: health.llm || null },
      legion_adapter: { ok: !!adapter.ok, adapters: adapter.adapters || null, error: adapter.error || null },
      context: { fresh: !!ctx.fresh, updatedAt: ctx.updatedAt, ageHours: ctx.ageHours },
    },
    watch: watch || { status: 'unknown', note: 'legion-watch not reporting' },
    canary: canary || null,
    context_refresh: contextRefresh || null,
    ops: {
      scheduled_missions: scheduled.length,
      default_adapter: knowledge.defaultAdapter || site.knowledge?.default_adapter,
    },
    urls: {
      public: site.public?.url || null,
      dashboard: site.public?.url && site.public?.dashboard_path
        ? `${stripTrailingSlash(String(site.public.url))}${site.public.dashboard_path}`
        : null,
    },
  };

  try {
    const { writeSiteHeartbeat } = require('./tenantRegistry');
    writeSiteHeartbeat(dataDir, {
      tenant_id: summary.tenant_id,
      status: summary.overall === 'pass' ? 'healthy' : 'degraded',
      overall: summary.overall,
      spine: summary.spine,
    });
  } catch (_) { /* ignore */ }

  return summary;
}

module.exports = {
  buildObserveSummary,
  readWatchState,
  readLastCanaryLine,
};
