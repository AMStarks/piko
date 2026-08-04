/**
 * Tenant-gated background jobs — AusMaker ops must not run on culture / other tenant spines.
 */
const { loadSiteManifest } = require('./siteManifest');
const { loadManifest } = require('./knowledgeManifest');
const { inferProfileId } = require('./siteContext');

/** Job ids used by server boot + crons. */
const JOB_DEFS = {
  ausmaker_watchman: { profiles: ['ausmaker'] },
  tripwire: { profiles: ['ausmaker'] },
  urgency_engine: { profiles: ['ausmaker'] },
  weekly_po: { profiles: ['ausmaker'] },
  proactive_thinker: { profiles: ['ausmaker'] },
  friday_closer: { profiles: ['ausmaker'] },
  manifest_refresh: { profiles: ['ausmaker'] },
  proactive_cycle: { profiles: ['ausmaker'] },
  nightly_quant: { profiles: ['ausmaker'] },
  nightly_wisdom: { profiles: ['ausmaker', 'culture', 'generic'] },
  ea_lookin: { profiles: ['ausmaker'] },
  rabbit_hole_daily: { profiles: ['ausmaker'] },
  meta_reflection_weekly: { profiles: ['ausmaker'] },
  daily_memory_summarize: { profiles: ['ausmaker'] },
  context_refresh: { profiles: ['ausmaker', 'culture', 'generic'] },
  legion_watch: { profiles: ['ausmaker', 'culture', 'generic'] },
  api_ping: { profiles: ['ausmaker', 'culture', 'generic'] },
  intent_poller: { profiles: ['ausmaker', 'culture', 'generic'] },
  legion_backup: { profiles: ['ausmaker', 'culture', 'generic'] },
  unified_heartbeat: { profiles: ['ausmaker', 'culture', 'generic'] },
  history_dump: { profiles: ['ausmaker', 'culture', 'generic'] },
  ei_platform_eval: { profiles: ['culture'] },
  ei_engineering_queue: { profiles: ['culture'] },
  ei_stance_synthesis: { profiles: ['culture'] },
  ei_quarantine_cleanup: { profiles: ['culture'] },
};

let cached = null;

function getTenantBackgroundProfile(rootDir) {
  if (cached) return cached;

  let site = {};
  let knowledge = {};
  try {
    site = loadSiteManifest(rootDir) || {};
  } catch (_) {
    site = {};
  }
  try {
    knowledge = loadManifest(rootDir) || {};
  } catch (_) {
    knowledge = {};
  }

  const envProfile = String(process.env.PIKO_BACKGROUND_JOBS_PROFILE || '').trim();
  const profileId = envProfile || String(inferProfileId(site, knowledge) || '').trim() || 'ausmaker';

  const tenantId = String(
    process.env.PIKO_TENANT_ID
    || site.tenant_id
    || 'customer-01',
  ).trim();

  const displayName = String(site.display_name || tenantId).trim();

  cached = {
    profileId,
    tenant_id: tenantId,
    display_name: displayName,
    isCulture: profileId === 'culture',
    isAusmaker: profileId === 'ausmaker',
  };
  return cached;
}

function resetTenantBackgroundProfileCache() {
  cached = null;
}

function isBackgroundJobEnabled(jobId, rootDir) {
  const id = String(jobId || '').trim();
  const def = JOB_DEFS[id];
  if (!def) return true;

  const envOff = String(process.env[`PIKO_DISABLE_${id.toUpperCase()}`] || '').trim();
  if (envOff === '1' || envOff.toLowerCase() === 'true') return false;

  if (id === 'ausmaker_watchman') {
    const legacy = String(process.env.PIKO_DISABLE_AUSMAKER_WATCHMAN || '').trim();
    if (legacy === '1' || legacy.toLowerCase() === 'true') return false;
  }

  const profile = getTenantBackgroundProfile(rootDir);
  return def.profiles.includes(profile.profileId);
}

function notificationMatchesTenant(entry, profile) {
  if (!entry || typeof entry !== 'object') return false;
  const tid = String(entry.tenant_id || entry.meta?.tenant_id || '').trim();
  if (tid) return tid === profile.tenant_id;

  const ep = String(entry.profile || entry.meta?.profile || '').trim();
  if (ep) return ep === profile.profileId;

  // Legacy rows without tags: only show on AusMaker spine.
  if (profile.profileId === 'ausmaker') return true;

  const text = String(entry.text || '').toLowerCase();
  const src = String(entry.source || '').toLowerCase();
  const cat = String(entry.category || '').toLowerCase();

  // Block obvious AusMaker bleed on culture tenants.
  if (profile.profileId === 'culture') {
    if (hasWord(text, 'ausmaker')) return false;
    if (src.includes('ausmaker') || src.includes('tripwire') || src.includes('nightly_quant')) return false;
    if (cat === 'nightly_quant' || cat === 'business') return false;
    return false;
  }

  return profile.profileId !== 'culture';
}

module.exports = {
  JOB_DEFS,
  getTenantBackgroundProfile,
  resetTenantBackgroundProfileCache,
  isBackgroundJobEnabled,
  notificationMatchesTenant,
};

const {
  hasWord,
} = require('./text');
