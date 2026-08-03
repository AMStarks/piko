/**
 * EI Text Scout — find primary / early literature and assess fit to the research goal.
 * Operable via ei-text-scout agent, /api/ei/text-scout/run, or scripts/operate-ei-text-scout.js
 */
const fs = require('fs');
const path = require('path');
const { loadResearchGoal, harvestAdapterPayload } = require('./eiResearchGoal');
const { listItems, getItem } = require('./culturesCorpusApi');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');

const LITERATURE_SOURCES = new Set(['archive_org', 'topbib', 'tla']);

const BLOCKED = [
  'chariots of the gods',
  'von daniken',
  'von däniken',
  'ancient aliens',
  'cia reading room',
  'central intelligence agency',
  'nibiru',
  'tripadvisor',
  'tourism brochure',
];

const PRIMARY_SIGNALS = [
  'petrie',
  'excavation',
  'excavations',
  'mastaba',
  'hieroglyph',
  'hieroglyphic',
  'ivory label',
  'stela',
  'stele',
  'obelisk',
  'temple',
  'pyramid',
  'tomb',
  'dynastic',
  'old kingdom',
  'early dynastic',
  'predynastic',
  'catalogue',
  'facsimile',
  'inscription',
  'porter',
  'topbib',
  'thesaurus linguae',
  'museum',
  'british museum',
  'cairo',
  'metropolit',
  'gizeh',
  'giza',
  'abydos',
  'heliopolis',
  'umm el',
  'osireion',
  'vyse',
  'perring',
  'digital giza',
];

const PERIOD_SIGNALS = [
  'predynastic',
  'early dynastic',
  'old kingdom',
  '1st dynasty',
  'first dynasty',
  '2nd dynasty',
  '3rd dynasty',
  '4th dynasty',
  'dynasty i',
  'dynasty ii',
  'dynasty iii',
  'dynasty iv',
  'narmer',
  'khufu',
  'khafre',
  'menkaure',
  'djoser',
];

function assessDir(rootDir) {
  const base = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  const d = path.join(base, 'ei-text-scout');
  fs.mkdirSync(path.join(d, 'reports'), { recursive: true });
  return d;
}

function newReportId() {
  const iso = new Date().toISOString();
  let ts = '';
  for (const ch of iso) {
    if (ch === '.' ) break;
    if (ch !== '-' && ch !== ':') ts += ch;
  }
  ts = ts.slice(0, 15);
  return `scout_${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseBrief(brief) {
  const raw = String(brief || '').trim();
  const out = {
    find: true,
    assess: true,
    sites: null,
    limit: 8,
    harvest_limit: 5,
    kind: 'literature',
  };
  if (!raw) return out;
  if (raw.startsWith('{')) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (p.find != null) out.find = !!p.find;
        if (p.assess != null) out.assess = !!p.assess;
        if (Array.isArray(p.sites)) out.sites = p.sites.map((s) => String(s).toLowerCase());
        if (p.site) out.sites = [String(p.site).toLowerCase()];
        if (p.focus) out.sites = [String(p.focus).toLowerCase()];
        if (p.limit != null) out.limit = Math.max(1, Math.min(40, Number(p.limit) || 8));
        if (p.harvest_limit != null) {
          out.harvest_limit = Math.max(1, Math.min(12, Number(p.harvest_limit) || 5));
        }
        if (p.kind) out.kind = String(p.kind);
      }
    } catch (_) { /* ignore */ }
    return out;
  }
  // No keyword tripwires — sites/find/assess come from JSON brief or defaults.
  return out;
}

function blobForItem(item) {
  const meta = item.meta || {};
  return [
    item.title,
    item.source,
    item.source_id,
    item.site,
    item.period,
    item.kind,
    item.official_text,
    meta.creator,
    meta.kind,
    JSON.stringify(meta),
  ].filter(Boolean).join(' ').toLowerCase();
}

function siteAliases(site) {
  if (!site) return [];
  return [site.id, site.label, ...(site.aliases || [])]
    .map((a) => String(a || '').toLowerCase())
    .filter((a) => a && a !== 'on' && a.length > 2);
}

/**
 * Score one corpus item against the EI research goal + operator Flag rules.
 * @returns {{ verdict: 'accept'|'reject'|'review', score: number, reasons: string[], signals: object }}
 */
function assessPrimaryText(item, siteDef, opts = {}) {
  const blob = blobForItem(item);
  const reasons = [];
  const {
    loadRules,
  } = require('./corpusReviewRules');
  const rules = opts.rules || loadRules();
  const primarySignals = [...PRIMARY_SIGNALS, ...(rules.primary_signals_extra || [])];
  const periodSignals = [...PERIOD_SIGNALS, ...(rules.period_signals_extra || [])];
  const acceptMin = rules.accept_min_score != null ? rules.accept_min_score : 70;
  const rejectMax = rules.reject_max_score != null ? rules.reject_max_score : 40;
  const requireSite = rules.require_site_hit_for_accept !== false;

  const signals = {
    blocked: false,
    site_hit: false,
    primary_hits: 0,
    period_hits: 0,
    substance_chars: Number((item.official_text || '').length) || 0,
    has_document: !!item.has_document,
    literature_source: LITERATURE_SOURCES.has(String(item.source || '').toLowerCase())
      || item.kind === 'literature',
    is_stub: !!item.is_stub,
    operator_force: null,
  };

  const hasLocalAsset = !!(item.has_document || item.has_local_document || item.has_image);
  signals.has_local_asset = hasLocalAsset;
  // Link-only / catalogue stubs: not a real reading of the source.
  const thinLinkOnly = !hasLocalAsset && signals.substance_chars < 500;

  // Prefer-local / any thin link-only row: never keep an Archive.org details page with no file/text.
  if (thinLinkOnly) {
    return {
      verdict: 'reject',
      score: 0,
      reasons: ['thin_link_only_stub'],
      signals,
    };
  }

  if (signals.is_stub) {
    return {
      verdict: 'reject',
      score: 0,
      reasons: ['stub_item'],
      signals,
    };
  }

  const aliases = siteAliases(siteDef);
  signals.site_hit = aliases.some((a) => blob.includes(a));
  if (!signals.site_hit && item.site && siteDef && String(item.site).toLowerCase() === siteDef.id) {
    signals.site_hit = true;
  }

  signals.primary_hits = primarySignals.filter((s) => blob.includes(s)).length;
  signals.period_hits = periodSignals.filter((s) => blob.includes(s)).length;

  let score = 0;
  if (signals.site_hit) {
    score += 35;
    reasons.push('site_match');
  } else {
    reasons.push('weak_site_match');
  }

  if (signals.literature_source || item.kind === 'literature') {
    score += 15;
    reasons.push('literature_source');
  }

  if (signals.primary_hits >= 2) {
    score += 25;
    reasons.push(`primary_signals_${signals.primary_hits}`);
  } else if (signals.primary_hits === 1) {
    score += 12;
    reasons.push('primary_signal_weak');
  } else {
    reasons.push('few_primary_signals');
  }

  if (signals.period_hits >= 1) {
    score += 15;
    reasons.push(`period_signals_${signals.period_hits}`);
  }

  if (signals.substance_chars >= 3000 || signals.has_document) {
    score += 20;
    reasons.push('substantive_digitized');
  } else if (signals.substance_chars >= 500) {
    score += 8;
    reasons.push('moderate_text');
  } else if (signals.substance_chars < 200 && !item.has_image) {
    score -= 20;
    reasons.push('thin_text');
  }

  // Museum objects with images still count as primary material for the goal
  if (item.has_image && (signals.site_hit || signals.primary_hits >= 1)) {
    score += 10;
    reasons.push('primary_object_image');
  }

  if (rules.prefer_local_assets) {
    if (hasLocalAsset) {
      score += 15;
      reasons.push('local_document_or_image');
    } else if (signals.substance_chars < 800) {
      return {
        verdict: 'reject',
        score: Math.max(0, Math.min(100, score - 30)),
        reasons: [...reasons, 'no_local_document_or_image'],
        signals,
      };
    } else {
      score -= 15;
      reasons.push('online_text_without_local_asset');
    }
  }

  let verdict = 'review';
  const acceptOk = score >= acceptMin && (!requireSite || signals.site_hit);
  if (acceptOk) verdict = 'accept';
  else if (score < rejectMax || (!signals.site_hit && signals.primary_hits < 2)) verdict = 'reject';

  return {
    verdict,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    signals,
  };
}

function loadLiteratureForSite(siteId, limit) {
  const listed = listItems({ site: siteId, limit: Math.min(100, Math.max(limit * 4, 30)) });
  const items = [];
  const ranked = [...(listed.items || [])].sort((a, b) => {
    const score = (x) => (
      (x.kind === 'literature' ? 4 : 0)
      + (LITERATURE_SOURCES.has(String(x.source || '').toLowerCase()) ? 3 : 0)
      + (x.has_document ? 2 : 0)
      + (x.has_image ? 1 : 0)
    );
    return score(b) - score(a);
  });
  for (const summary of ranked) {
    if (summary.kind === 'source_candidate') continue;
    const lit = summary.kind === 'literature'
      || LITERATURE_SOURCES.has(String(summary.source || '').toLowerCase())
      || summary.has_document;
    if (!lit && !summary.has_image) continue;
    const full = getItem(summary.id);
    if (!full.ok || !full.item) continue;
    items.push(full.item);
    if (items.length >= limit) break;
  }
  return items;
}

async function findLiteratureForSite(site, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const payload = harvestAdapterPayload(site, {
    literature_only: true,
    sources: ['archive_org', 'topbib', 'tla'],
    limit: opts.harvest_limit != null ? opts.harvest_limit : 5,
    require_image: false,
  });
  payload.skip_thin = true;
  payload.note = `ei-text-scout find primary literature for ${site.id}`;

  const { runAgent } = require('./agentOrchestrator');
  const out = await runAgent('ei-harvester', JSON.stringify(payload), { rootDir });
  return {
    site_id: site.id,
    harvest_ok: !!out.ok,
    run_id: out.run?.id || null,
    status: out.run?.status || null,
    review: out.run?.review || null,
    artifact_snip: String(out.reply || '').slice(0, 600),
  };
}

function writeReport(report, rootDir) {
  const dir = path.join(assessDir(rootDir), 'reports');
  const id = report.id || newReportId();
  const row = { ...report, id, updated_at: new Date().toISOString() };
  if (!row.created_at) row.created_at = row.updated_at;
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row;
}

function readLatestReport(rootDir) {
  const p = path.join(assessDir(rootDir), 'reports', 'latest.json');
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listReports(rootDir, limit = 20) {
  const dir = path.join(assessDir(rootDir), 'reports');
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'latest.json')
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));
  } catch (_) {
    return [];
  }
  return files.map(({ f }) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Main entry — find (optional harvest) + assess primary texts for goal sites.
 */
async function runTextScout(opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const profile = getTenantBackgroundProfile(rootDir);
  const cfg = { ...parseBrief(opts.brief), ...opts };
  if (opts.sites) cfg.sites = opts.sites;
  if (opts.find != null) cfg.find = !!opts.find;
  if (opts.assess != null) cfg.assess = !!opts.assess;

  const goal = loadResearchGoal();
  let sites = goal.sites || [];
  if (cfg.sites && cfg.sites.length) {
    sites = sites.filter((s) => cfg.sites.includes(s.id));
  }

  const started = Date.now();
  const report = {
    id: newReportId(),
    tenant_id: profile.tenant_id,
    profile: profile.profileId,
    source: opts.source || 'manual',
    goal_id: goal.id,
    config: {
      find: cfg.find,
      assess: cfg.assess,
      sites: sites.map((s) => s.id),
      limit: cfg.limit,
      harvest_limit: cfg.harvest_limit,
    },
    finds: [],
    assessments: [],
    created_at: new Date().toISOString(),
  };

  if (cfg.find) {
    for (const site of sites) {
      // eslint-disable-next-line no-await-in-loop
      const found = await findLiteratureForSite(site, {
        rootDir,
        harvest_limit: cfg.harvest_limit,
      });
      report.finds.push(found);
    }
  }

  if (cfg.assess !== false) {
    for (const site of sites) {
      const items = loadLiteratureForSite(site.id, cfg.limit || 8);
      const assessed = items.map((item) => {
        const a = assessPrimaryText(item, site);
        return {
          harvest_id: item.id,
          site_id: site.id,
          title: item.title,
          source: item.source,
          source_url: item.source_url,
          kind: item.kind,
          text_chars: (item.official_text || '').length,
          has_document: !!item.has_document,
          has_image: !!item.has_image,
          ...a,
        };
      });
      report.assessments.push({
        site_id: site.id,
        site_label: site.label,
        counted: assessed.length,
        accepted: assessed.filter((x) => x.verdict === 'accept').length,
        rejected: assessed.filter((x) => x.verdict === 'reject').length,
        review: assessed.filter((x) => x.verdict === 'review').length,
        items: assessed,
      });
    }
  }

  const accepted = report.assessments.reduce((n, s) => n + (s.accepted || 0), 0);
  const rejected = report.assessments.reduce((n, s) => n + (s.rejected || 0), 0);
  const review = report.assessments.reduce((n, s) => n + (s.review || 0), 0);
  const findFails = report.finds.filter((f) => f.harvest_ok === false).length;

  report.pass = findFails === 0 && accepted > 0 && (accepted >= rejected || accepted >= 2);
  report.summary = [
    `Text scout: accept=${accepted} review=${review} reject=${rejected}`,
    report.finds.length ? `finds=${report.finds.length} (fail=${findFails})` : 'assess-only',
    report.pass ? 'USEFUL_PRIMARY_SET' : 'NEEDS_BETTER_PRIMARY_TEXTS',
  ].join(' · ');
  report.duration_ms = Date.now() - started;

  const saved = writeReport(report, rootDir);

  const lines = [
    '[ei-text-scout / find+assess]',
    saved.summary,
    `Report: ${saved.id}`,
    `Duration: ${saved.duration_ms}ms`,
    '',
  ];
  for (const f of saved.finds || []) {
    lines.push(`Find ${f.site_id}: ${f.harvest_ok ? 'ok' : 'FAIL'} ${f.artifact_snip || ''}`);
  }
  lines.push('');
  for (const block of saved.assessments || []) {
    lines.push(
      `Assess ${block.site_id}: accept=${block.accepted} review=${block.review} reject=${block.rejected}`,
    );
    for (const it of (block.items || []).slice(0, 8)) {
      lines.push(
        `  [${it.verdict}/${it.score}] #${it.harvest_id} ${(it.title || '').slice(0, 70)} — ${it.reasons.slice(0, 4).join(', ')}`,
      );
    }
  }

  return {
    status: saved.pass ? 'ok' : 'needs_revision',
    artifact_text: lines.join('\n'),
    result: saved,
    pass: saved.pass,
    report: saved,
  };
}

module.exports = {
  assessPrimaryText,
  blobForItem,
  parseBrief,
  runTextScout,
  writeReport,
  readLatestReport,
  listReports,
  loadLiteratureForSite,
  BLOCKED,
  PRIMARY_SIGNALS,
};
