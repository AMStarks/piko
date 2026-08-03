/**
 * Tenant site context — branding + dashboard profile from site.yaml + knowledge manifest.
 */
const { loadSiteManifest } = require('./siteManifest');
const { loadManifest } = require('./knowledgeManifest');

const PROFILES = {
  ausmaker: {
    id: 'ausmaker',
    tagline: 'Business assistant',
    spineThird: {
      label: 'Inventory & orders',
      subtitle: 'AusMaker data',
      healthSource: 'ausmaker',
    },
    features: {
      inventory: true,
      cin7: true,
      nightlyForecast: true,
      culture: false,
      ausmakerIntegrations: true,
      agents: false,
    },
    quickActions: [
      { page: 'chat', title: 'Ask Piko', detail: 'Stock levels, reorders, purchase orders, summaries, and follow-ups.' },
      { page: 'tasks', title: 'View activity', detail: 'Notifications, scheduled checks, daily summaries, and ongoing work.' },
      { page: 'approvals', title: 'Review approvals', detail: 'Actions waiting for your sign-off before Piko proceeds.' },
      { page: 'business', title: 'Business tools', detail: 'Inventory systems, email, integrations, and quick capture.' },
      { id: 'reminder', title: 'Add a reminder', detail: 'Ask Piko to follow up on something later.' },
      { id: 'health', title: 'Refresh status', detail: 'Re-check service health and latest activity.' },
    ],
    chatPlaceholder: 'Ask Piko anything about your business…',
    chatIntro: 'Ask about stock, reorders, purchase orders, daily summaries, or anything else Piko can help with.',
    chatExamples: ['What needs reordering?', 'Download a CSV of potential purchase orders.'],
    defaultBusinessUnit: 'AusMaker Supplies',
    overviewCards: {
      thirdMetric: { title: 'Inventory system', caption: 'Shopify and Cin7 connection', feature: 'inventory' },
    },
  },
  culture: {
    id: 'culture',
    tagline: 'Culture research',
    spineThird: {
      label: 'Culture pipeline',
      subtitle: 'Harvest & scribe',
      healthSource: 'adapter_detail',
    },
    features: {
      inventory: false,
      cin7: false,
      nightlyForecast: false,
      culture: true,
      ausmakerIntegrations: false,
      agents: true,
    },
    quickActions: [
      { page: 'chat', title: 'Ask Piko', detail: 'Hieroglyphs, Gardiner signs, papyrus sources, and ancient Egypt research.' },
      { page: 'agents', title: 'Agents', detail: 'Start a specialist on a task, see who is working, cancel a job.' },
      { href: '/corpus', title: 'Browse corpus', detail: 'Inspect harvested images and catalogue text by site.' },
      { page: 'tasks', title: 'View activity', detail: 'Scheduled harvests, transcriptions, critiques, and tracked work.' },
      { page: 'approvals', title: 'Review approvals', detail: 'Actions waiting for your sign-off before Piko proceeds.' },
      { page: 'business', title: 'Research tools', detail: 'Culture corpus, research topics, and quick capture.' },
      { id: 'reminder', title: 'Add a reminder', detail: 'Ask Piko to follow up on a research thread later.' },
      { id: 'health', title: 'Refresh status', detail: 'Re-check culture spine health and latest activity.' },
    ],
    chatPlaceholder: 'Ask about hieroglyphs, early Egypt, or your culture corpus…',
    chatIntro: 'Research assistant for ancient cultures — focused on earliest writing at Abydos/Oserion, Heliopolis, and Giza.',
    chatExamples: [
      'Start the early-period research goal for Abydos, Heliopolis, and Giza',
      'What is in the culture corpus?',
      '/mission collate earliest hieroglyph sources for Abydos, Heliopolis, and Giza',
    ],
    defaultBusinessUnit: 'Egyptian Insights',
    overviewCards: {
      thirdMetric: { title: 'Culture corpus', caption: 'Harvest items, transcriptions, critiques', feature: 'culture' },
    },
  },
  generic: {
    id: 'generic',
    tagline: 'Assistant',
    spineThird: {
      label: 'Domain adapter',
      subtitle: 'Business tools',
      healthSource: 'adapter',
    },
    features: {
      inventory: false,
      cin7: false,
      nightlyForecast: false,
      culture: false,
      ausmakerIntegrations: false,
      agents: false,
    },
    quickActions: [
      { page: 'chat', title: 'Ask Piko', detail: 'Chat with your tenant assistant.' },
      { page: 'tasks', title: 'View activity', detail: 'Notifications, schedules, and tracked work.' },
      { page: 'approvals', title: 'Review approvals', detail: 'Actions waiting for approval.' },
      { page: 'business', title: 'Tools', detail: 'Integrations and quick capture.' },
      { id: 'reminder', title: 'Add a reminder', detail: 'Schedule a follow-up.' },
      { id: 'health', title: 'Refresh status', detail: 'Re-check service health.' },
    ],
    chatPlaceholder: 'Ask Piko…',
    chatIntro: 'Chat with your assistant for this site.',
    chatExamples: [],
    defaultBusinessUnit: 'General',
    overviewCards: {
      thirdMetric: { title: 'Domain adapter', caption: 'Legion adapter health', feature: 'culture' },
    },
  },
};

const {
  stripTrailingSlash,
} = require('./text');

function inferProfileId(site, knowledge) {
  const explicit = String(knowledge.dashboardProfile || site.dashboard_profile || '').trim();
  if (explicit && PROFILES[explicit]) return explicit;
  const adapter = String(knowledge.defaultAdapter || site.knowledge?.default_adapter || '').trim();
  const tenant = String(site.tenant_id || '').trim();
  if (adapter === 'ausmakersupplies' || tenant === 'customer-01') return 'ausmaker';
  if (adapter === 'egyptian-insights' || tenant === 'customer-03') return 'culture';
  return 'generic';
}

async function fetchAdapterDetail(baseUrl, adapterId, timeoutMs = 5000) {
  const base = StringstripTrailingSlash((baseUrl || ''));
  const id = String(adapterId || '').trim();
  if (!base || !id) return null;
  try {
    const res = await fetch(`${base}/api/adapters/${encodeURIComponent(id)}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/**
 * Build tenant context for dashboard + clients.
 * @param {{ rootDir?: string, legionAdapterBase?: string }} opts
 */
async function buildSiteContext(opts = {}) {
  const rootDir = opts.rootDir || require('path').join(__dirname, '..');
  const site = loadSiteManifest(rootDir);
  const knowledge = loadManifest(rootDir);
  const profileId = inferProfileId(site, knowledge);
  const profile = { ...PROFILES[profileId] };

  let orchEnabled = false;
  try {
    const { isAgentOrchEnabled } = require('./agentOrchestrator');
    orchEnabled = isAgentOrchEnabled(rootDir);
  } catch (_) {}

  profile.features = {
    ...profile.features,
    agents: !!(profile.features && profile.features.agents && orchEnabled),
  };
  if (!orchEnabled && Array.isArray(profile.quickActions)) {
    profile.quickActions = profile.quickActions.filter((a) => a.page !== 'agents');
  }

  const defaultAdapter = String(
    knowledge.defaultAdapter
    || site.knowledge?.default_adapter
    || process.env.PIKO_LEGION_BRIEF_DEFAULT_ADAPTER
    || 'ausmakersupplies',
  ).trim();

  const adapterDetail = profile.spineThird.healthSource === 'adapter_detail'
    ? await fetchAdapterDetail(opts.legionAdapterBase, defaultAdapter)
    : null;

  const stats = adapterDetail && adapterDetail.stats && typeof adapterDetail.stats === 'object'
    ? adapterDetail.stats
    : null;

  return {
    ok: true,
    contractVersion: '2026-07-20.site-context.v1',
    tenant_id: site.tenant_id || process.env.PIKO_TENANT_ID || 'customer-01',
    display_name: site.display_name || site.tenant_id || 'Piko',
    business_unit_default: site.business_unit_default || profile.defaultBusinessUnit,
    default_adapter: defaultAdapter,
    dashboard_profile: profileId,
    agent_orch_enabled: orchEnabled,
    public_url: process.env.PIKO_PUBLIC_BASE_URL
      || process.env.PIKO_IOS_PUBLIC_URL
      || site.public?.url
      || null,
    dashboard_path: site.public?.dashboard_path || '/ios-dashboard',
    break_glass_url: site.public?.break_glass_url || null,
    node_host: site.ai_subnet?.host || null,
    piko_port: Number(site.ai_subnet?.piko_port || process.env.PORT || 3000),
    dashboard: {
      ...profile,
      cultureStats: stats,
    },
    urls: {
      dashboard: site.public?.url && site.public?.dashboard_path
        ? `${StringstripTrailingSlash((site.public.url))}${site.public.dashboard_path}`
        : null,
      observe: site.public?.break_glass_url
        ? `${StringstripTrailingSlash((site.public.break_glass_url))}/api/observe/summary`
        : null,
    },
  };
}

module.exports = {
  buildSiteContext,
  inferProfileId,
  PROFILES,
};
