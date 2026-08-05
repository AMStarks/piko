/**
 * Egyptian Insights research goal — early-period Abydos / Heliopolis / Giza.
 * Keep in sync with egyptian_insights/research_goal.json
 */
const fs = require('fs');
const path = require('path');

const FALLBACK = {
  id: 'early-period-three-sites',
  title: 'Earliest Egyptian writing — Abydos, Heliopolis, Giza',
  summary:
    'Collate digital primary material on the earliest periods (Predynastic → Early Dynastic → Old Kingdom) for Oserion/Abydos (esp. Umm el-Qa\'ab), Heliopolis (Iunu), and the Giza complex.',
  agent_mandate:
    'Work toward this collation goal. Harvest into cultures_cache first (images + official text + open literature). Structure meta by site id (abydos|heliopolis|giza). Prefer Archive.org, TopBib, and TLA alongside museum images. Discover additional digital archives when asked.',
  sites: [
    {
      id: 'abydos',
      label: 'Abydos / Oserion / Umm el-Qa\'ab',
      aliases: ['abydos', 'oserion', 'osireion', 'umm el-qa\'ab', 'umm el-qaab'],
      query: "Abydos Umm el-Qa'ab Early Dynastic ivory label hieroglyph",
      query_pack: ['Abydos', "Umm el-Qa'ab", 'Umm el-Qaab', 'Osireion', 'Early Dynastic ivory label'],
      priorities: ['Umm el-Qa\'ab tomb labels', 'Oserion inscriptions'],
    },
    {
      id: 'heliopolis',
      label: 'Heliopolis (Iunu / Innu)',
      aliases: ['heliopolis', 'iunu', 'innu'],
      query: 'Heliopolis Iunu Old Kingdom hieroglyph obelisk',
      query_pack: ['Heliopolis', 'Iunu', 'On Egypt', 'obelisk Heliopolis'],
    },
    {
      id: 'giza',
      label: 'Giza complex',
      aliases: ['giza', 'gizeh', 'khufu', 'khafre', 'menkaure'],
      query: 'Giza Pyramid Old Kingdom hieroglyph inscription Giza Project',
      query_pack: ['Giza', 'Gizeh', 'Khufu mastaba', 'Digital Giza'],
    },
  ],
  default_harvest_limit: 15,
  phase1_connectors: [
    'met', 'commons', 'artic', 'digital_giza', 'archive_org', 'web_pdf', 'topbib', 'tla',
    'oraec', 'papyri', 'open_context', 'trismegistos',
  ],
};

const CONNECTOR_ALIASES = {
  met: ['met', 'metmuseum', 'metropolitan'],
  commons: ['commons', 'wikimedia', 'wiki commons'],
  artic: ['artic', 'art institute', 'chicago art'],
  digital_giza: ['digital_giza', 'digital giza', 'giza project'],
  archive_org: ['archive_org', 'archive.org', 'internet archive', 'ia'],
  web_pdf: ['web_pdf', 'web pdf', 'open web', 'open-web', 'searxng', 'serper'],
  topbib: ['topbib', 'top bib', 'porter & moss', 'porter and moss', 'griffith topbib'],
  tla: ['tla', 'thesaurus linguae', 'thesaurus-linguae'],
  oraec: ['oraec', 'open ras egyptian', 'oraec corpus'],
  papyri: ['papyri', 'papyri.info', 'idp.data', 'ddbdp', 'duke databank'],
  open_context: ['open_context', 'open context', 'opencontext'],
  trismegistos: ['trismegistos', 'tm texts', 'demotic tm'],
  source_scout: [
    'source_scout',
    'source scout',
    'discover sources',
    'find archives',
    'find more sites',
  ],
};

const LITERATURE_SOURCES = [
  'archive_org', 'topbib', 'tla', 'oraec', 'papyri', 'trismegistos', 'open_context',
];
const OBJECT_SOURCES = ['met', 'commons', 'artic', 'digital_giza'];
const DEFAULT_SOURCES = [...OBJECT_SOURCES, ...LITERATURE_SOURCES];

const {
  aliasMatch,
} = require('./text');

function goalJsonPaths() {
  const roots = [
    path.join(__dirname, '..', '..', 'egyptian_insights', 'research_goal.json'),
    path.join(__dirname, '..', 'egyptian_insights', 'research_goal.json'),
    path.join(process.env.EGYPTIAN_INSIGHTS_ROOT || '', 'egyptian_insights', 'research_goal.json'),
    path.join('/home/chief/projects/Piko', 'egyptian_insights', 'research_goal.json'),
  ];
  return roots.filter(Boolean);
}

function loadResearchGoal() {
  for (const p of goalJsonPaths()) {
    try {
      if (p && fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw && raw.id) return raw;
      }
    } catch (_) { /* continue */ }
  }
  return { ...FALLBACK };
}

function mandateBlock() {
  const g = loadResearchGoal();
  return [
    `RESEARCH GOAL (${g.id}): ${g.title}`,
    g.summary,
    g.agent_mandate,
  ].filter(Boolean).join('\n');
}

/** @deprecated No keyword tripwire — collation detection is LLM/planner-owned. */
function isCollationGoal() {
  return false;
}

/** Free-text site sniffing removed; pass focus via tool args. */
function sitesMentioned() {
  return [];
}

/**
 * Match a site alias in free text.
 * Short single-token aliases (e.g. Egyptian "On" for Heliopolis) use word boundaries
 * so "Literature only" does not falsely match "on".
 */
function aliasMatchesText(text, alias) {
  return aliasMatch(text, alias);
}

/** Free-text focus sniffing removed; pass focus via tool args / plan. */
function extractFocus() {
  return null;
}

function briefForSite(site, opts = {}) {
  const pri = (site.priorities || []).slice(0, 4).join('; ');
  const lit = opts.literature_only
    ? 'Prefer open literature (Archive.org OCR/PDF, TopBib bibliography, TLA object records). '
    : 'Prefer images + official catalogue text plus open literature. ';
  const scout = opts.discover_sources
    ? 'Also scout for additional digital archives similar to TopBib/TLA/Archive.org. '
    : '';
  return (
    `Harvest open digital primary sources for ${site.label} into cultures_cache. `
    + 'Focus: earliest periods (Predynastic → Early Dynastic → Old Kingdom). '
    + `Query hint: ${site.query || site.label}. `
    + (pri ? `Priorities: ${pri}. ` : '')
    + lit
    + scout
    + `Tag meta.site=${site.id}.`
  );
}

/**
 * Harvest constraints come from LLM plan / tool args — not keyword sniffing.
 * Kept as a stable empty shape for callers.
 */
function parseHarvestConstraints() {
  return {
    literature_only: false,
    literature_first: false,
    discover_sources: false,
    sources: null,
    skip_sites: [],
    only_sites: [],
    limit: null,
    require_image: null,
    note: null,
  };
}

function harvestAdapterPayload(site, opts = {}) {
  const g = loadResearchGoal();
  const c = { ...opts };
  let sources = Array.isArray(c.sources) && c.sources.length
    ? [...c.sources]
    : (g.phase1_connectors || DEFAULT_SOURCES);
  if (c.literature_only) {
    sources = sources.filter((s) => LITERATURE_SOURCES.includes(s) || s === 'source_scout');
    if (!sources.length) sources = [...LITERATURE_SOURCES];
  }
  if (c.discover_sources && !sources.includes('source_scout')) {
    sources = [...sources, 'source_scout'];
  }
  if (c.literature_first && !c.literature_only) {
    const lit = sources.filter((s) => LITERATURE_SOURCES.includes(s) || s === 'source_scout');
    const rest = sources.filter((s) => !lit.includes(s));
    sources = [...lit, ...rest];
  }
  const requireImage = c.require_image != null
    ? !!c.require_image
    : !(c.literature_only || (sources.length && sources.every((s) => LITERATURE_SOURCES.includes(s) || s === 'source_scout')));
  return {
    focus: site.id,
    query: site.query || site.label,
    limit: c.limit != null ? c.limit : (g.default_harvest_limit || 15),
    allow_stubs: false,
    require_image: requireImage,
    sources,
    note: briefForSite(site, c),
  };
}

function planSiteHarvestChildren(opts = {}) {
  const g = loadResearchGoal();
  let list = g.sites || [];
  if (opts.only_sites && opts.only_sites.length) {
    list = list.filter((s) => opts.only_sites.includes(s.id));
  }
  if (opts.skip_sites && opts.skip_sites.length) {
    list = list.filter((s) => !opts.skip_sites.includes(s.id));
  }
  const children = list.slice(0, 3).map((site, i) => ({
    id: `c${i + 1}`,
    title: `Harvest ${site.label}`.slice(0, 80),
    brief: JSON.stringify(harvestAdapterPayload(site, opts)),
    agent_id: 'ei-harvester',
    status: 'planned',
    run_id: null,
    review: null,
    focus: site.id,
  }));
  if (opts.discover_sources) {
    const scoutPayload = {
      focus: (list[0] && list[0].id) || 'abydos',
      query: 'Egyptian egyptology digital archive bibliography corpus TopBib TLA Archive.org',
      limit: opts.limit != null ? opts.limit : 12,
      allow_stubs: false,
      require_image: false,
      sources: ['source_scout'],
      note: 'Scout for digital archives / bibliographies similar to TopBib, TLA, and Archive.org; store as source_candidate.',
    };
    children.unshift({
      id: 'c0',
      title: 'Scout digital archives (TopBib/TLA-like)',
      brief: JSON.stringify(scoutPayload),
      agent_id: 'ei-harvester',
      status: 'planned',
      run_id: null,
      review: null,
      focus: scoutPayload.focus,
    });
    children.forEach((c, i) => { c.id = `c${i + 1}`; });
  }
  return children;
}

function formatConstraintsSummary(c) {
  if (!c || (!c.note && !c.sources && !c.discover_sources && !c.literature_only)) {
    return null;
  }
  const bits = [];
  if (c.literature_only) bits.push('literature-only');
  if (c.literature_first && !c.literature_only) bits.push('literature-first');
  if (c.discover_sources) bits.push('source scout on');
  if (c.sources && c.sources.length) bits.push(`sources: ${c.sources.join(', ')}`);
  if (c.skip_sites && c.skip_sites.length) bits.push(`skip: ${c.skip_sites.join(', ')}`);
  if (c.only_sites && c.only_sites.length) bits.push(`only: ${c.only_sites.join(', ')}`);
  if (c.limit != null) bits.push(`limit ${c.limit}`);
  return bits.join(' · ');
}

module.exports = {
  loadResearchGoal,
  mandateBlock,
  isCollationGoal,
  sitesMentioned,
  aliasMatchesText,
  extractFocus,
  briefForSite,
  harvestAdapterPayload,
  planSiteHarvestChildren,
  parseHarvestConstraints,
  formatConstraintsSummary,
  DEFAULT_SOURCES,
  LITERATURE_SOURCES,
  OBJECT_SOURCES,
  CONNECTOR_ALIASES,
};
