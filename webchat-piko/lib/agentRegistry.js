/**
 * Agent registry — named, bounded specialists.
 * Phase A: wrap swarm personas; tenant-scoped for EI trial.
 */
const fs = require('fs');
const path = require('path');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');

/** Built-in agents. AusMaker keeps using swarm directly unless orch is on. */
const BUILTIN_AGENTS = [
  {
    id: 'quant',
    label: 'Quant Agent',
    runtime: 'swarm',
    swarm_role: 'quant',
    profiles: ['ausmaker'],
    tenants: ['customer-01'],
    capabilities: ['forecast', 'sku_stats'],
    description: 'Statistical forecasts against AusMaker sales cache.',
  },
  {
    id: 'researcher',
    label: 'Research Agent',
    runtime: 'swarm',
    swarm_role: 'researcher',
    profiles: ['ausmaker', 'culture', 'generic'],
    tenants: ['*'],
    capabilities: ['research', 'summarize'],
    description: 'Deep-dive research and concise factual summaries.',
  },
  {
    id: 'culture-researcher',
    label: 'Culture Research Agent',
    runtime: 'swarm',
    swarm_role: 'researcher',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['research', 'egypt', 'ancient_cultures'],
    brief_prefix:
      'You are researching for Egyptian Insights (ancient cultures). Primary goal: collate earliest-period (Predynastic→Early Dynastic→Old Kingdom) digital primary sources for Abydos/Oserion (Umm el-Qa\'ab), Heliopolis (Iunu), and Giza — photos, facsimiles, museum entries, TLA/TopBib/reports, structured by site. Prefer primary sources and clear citation. When the local cultures_cache is empty or thin, recommend or hand off to ei-harvester before deep synthesis. Avoid modern commerce/inventory topics.',
    description: 'EI-scoped research brief wrapper around the research swarm role.',
  },
  // Phase D — egyptian-insights adapter agents (customer-03 / culture only)
  {
    id: 'ei-health',
    label: 'EI Spine Health',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'health.check',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['health', 'culture'],
    description: 'Check Egyptian Insights culture spine health (DB, assets, vision).',
  },
  {
    id: 'ei-corpus',
    label: 'EI Corpus Search',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'culture.corpus.search',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['search', 'corpus', 'egypt'],
    description: 'Search the local Egyptian Insights cultures_cache.',
  },
  {
    id: 'ei-harvester',
    label: 'EI Harvester',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'research.scrape.run',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['harvest', 'scrape', 'egypt'],
    default_input: { limit: 15, allow_stubs: false, require_image: true },
    brief_prefix:
      'Harvest toward the EI research goal: earliest-period primary material for Abydos/Oserion, Heliopolis, and Giza into cultures_cache. Prefer images + official text; also Archive.org volumes, TopBib, and TLA; tag by site.',
    description: 'Harvest museum/archive images, open literature (Archive.org/TopBib/TLA), and scout similar digital archives into the cultures cache.',
  },
  {
    id: 'ei-scribe',
    label: 'EI Scribe',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'scribe.transcribe.image',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['scribe', 'transcribe', 'gardiner'],
    description: 'Vision scribe: hieroglyph/papyrus → Gardiner tokens (pass harvest_id JSON or id).',
  },
  {
    id: 'ei-scholar',
    label: 'EI Scholar',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'translation.critique',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['scholar', 'critique', 'translation'],
    description: 'Scholar critique of transcription vs museum translation (pass harvest_id).',
  },
  {
    id: 'ei-pipeline',
    label: 'EI Culture Pipeline',
    runtime: 'legion',
    adapter_id: 'egyptian-insights',
    legion_capability: 'culture.pipeline.run',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['pipeline', 'egypt'],
    default_input: { limit: 2 },
    brief_prefix:
      'Run scrape→scribe→scholar in service of the early-period three-site collation goal (Abydos, Heliopolis, Giza).',
    description: 'Full scrape → scribe → scholar handshake for one or more items.',
  },
  {
    id: 'ei-qa',
    label: 'EI Platform QA',
    runtime: 'eval',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['qa', 'eval', 'platform', 'test'],
    description:
      'Run platform eval: registry smoke, golden literature harvest rubric per site, queue engineering fixes on failure.',
  },
  {
    id: 'ei-worker',
    label: 'EI Worker',
    runtime: 'eval',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['worker', 'harvest', 'literature', 'corpus', 'review', 'egypt', 'tools'],
    description:
      'Generalist worker: Piko interprets your goal and runs the shared EI tool belt (harvest, literature, corpus search, content review, scribe, health).',
  },
  {
    id: 'ei-text-scout',
    label: 'EI Text Scout',
    runtime: 'eval',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['literature', 'primary_texts', 'assess', 'scout'],
    description:
      'Find primary/early literature (Archive.org, TopBib, TLA) and assess whether each text fits Abydos / Heliopolis / Giza research goal.',
  },
  {
    id: 'ei-corpus-reviewer',
    label: 'EI Corpus Reviewer',
    runtime: 'eval',
    profiles: ['culture'],
    tenants: ['customer-03'],
    capabilities: ['corpus', 'review', 'flag', 'keep'],
    description:
      'Read every corpus source (text/OCR/PDF/image) and set Flag = keep / drop / review for the research goal.',
  },
];

function dataDir() {
  return String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
}

function loadOverrideAgents() {
  const p = path.join(dataDir(), 'agents', 'registry.json');
  try {
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : (parsed.agents || []);
    return rows.filter((a) => a && a.id);
  } catch (_) {
    return [];
  }
}

function mergeAgents() {
  const byId = new Map();
  for (const a of BUILTIN_AGENTS) byId.set(a.id, { ...a });
  for (const a of loadOverrideAgents()) {
    const prev = byId.get(a.id) || {};
    byId.set(a.id, { ...prev, ...a, id: a.id });
  }
  return [...byId.values()];
}

function agentAllowedForTenant(agent, profile) {
  if (!agent) return false;
  const profiles = Array.isArray(agent.profiles) ? agent.profiles : ['*'];
  if (!profiles.includes('*') && !profiles.includes(profile.profileId)) return false;
  const tenants = Array.isArray(agent.tenants) ? agent.tenants : ['*'];
  if (tenants.includes('*')) return true;
  return tenants.includes(profile.tenant_id);
}

function listAgents(rootDir) {
  const profile = getTenantBackgroundProfile(rootDir || path.join(__dirname, '..'));
  return mergeAgents()
    .filter((a) => agentAllowedForTenant(a, profile))
    .map((a) => ({
      id: a.id,
      label: a.label || a.id,
      runtime: a.runtime,
      swarm_role: a.swarm_role || null,
      adapter_id: a.adapter_id || null,
      legion_capability: a.legion_capability || null,
      capabilities: a.capabilities || [],
      description: a.description || '',
      profiles: a.profiles || [],
      tenants: a.tenants || [],
    }));
}

function getAgent(agentId, rootDir) {
  const id = String(agentId || '').trim();
  if (!id) return null;
  const profile = getTenantBackgroundProfile(rootDir || path.join(__dirname, '..'));
  const agent = mergeAgents().find((a) => a.id === id) || null;
  if (!agent || !agentAllowedForTenant(agent, profile)) return null;
  return agent;
}

module.exports = {
  BUILTIN_AGENTS,
  listAgents,
  getAgent,
  agentAllowedForTenant,
  mergeAgents,
  dataDir,
};
