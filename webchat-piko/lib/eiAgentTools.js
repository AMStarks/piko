/**
 * Shared EI tool belt — every culture worker uses these tools.
 * Intent-aware harvest defaults (literature vs images) live here.
 */
const { executeLegionAgent, buildAdapterInput } = require('./agentAdapterRuntime');
const {
  parseHarvestConstraints,
  LITERATURE_SOURCES,
  DEFAULT_SOURCES,
  extractFocus,
  loadResearchGoal,
  harvestAdapterPayload,
} = require('./eiResearchGoal');

const LIT_SOURCES = LITERATURE_SOURCES || [
  'archive_org', 'topbib', 'tla', 'oraec', 'papyri', 'trismegistos', 'open_context',
];
const IMAGE_SOURCES = [
  'met', 'commons', 'artic', 'digital_giza', 'archive_org', 'topbib', 'tla',
  'oraec', 'papyri', 'open_context',
];
/** Open-web seek engines: SearXNG/Serper finds PDFs anywhere; Archive.org is a preferred library among hosts, not an exclusive silo. */
const SEEK_FILE_SOURCES = ['web_pdf', 'archive_org'];
const { parseNamedWork, focusedSeekQuery } = require('./eiGoalParse');
const { buildSeekQueryPack, encodeHarvestQuery } = require('./eiSeekQueryPack');
const { ensureSkeletonFiles, assessCoverage, formatKnownWorksReport } = require('./eiKnownWorks');
const {
  toLowerAsciiish,
  includesAny,
  startsWithIgnoreCase,
  extractDigitRuns,
  endsWithAny,
} = require('./text');

function parsePrefixedInt(line, prefix) {
  if (!startsWithIgnoreCase(line, prefix)) return null;
  const rest = line.slice(prefix.length);
  const runs = extractDigitRuns(rest);
  if (!runs.length || runs[0].index !== 0) return null;
  return runs[0].value;
}

function parsePrefixedTail(line, prefix) {
  if (!startsWithIgnoreCase(line, prefix)) return null;
  return line.slice(prefix.length);
}

function stripGapPrefix(title) {
  let s = String(title || '');
  if (startsWithIgnoreCase(s, '[gap]')) {
    s = s.slice(5);
    while (s.startsWith(' ')) s = s.slice(1);
  }
  return s;
}

function isArchiveHost(h) {
  const low = toLowerAsciiish(h);
  return low === 'archive.org' || endsWithAny(low, ['.archive.org']);
}

function schemaIsNumber(spec) {
  const s = toLowerAsciiish(spec);
  return s.includes('number') && !s.includes('|');
}

function schemaIsBoolean(spec) {
  const s = toLowerAsciiish(spec);
  return s.includes('boolean') && !s.includes('|');
}

function seekFilesLimit(overridesLimit) {
  const envLim = Number(process.env.PIKO_EI_SEEK_FILES_LIMIT || 50);
  const lim = overridesLimit != null ? Number(overridesLimit) : envLim;
  return Math.max(1, Math.min(100, Number.isFinite(lim) ? lim : 50));
}

/**
 * Parse open-web seek coverage from harvest errors / connector_stats / items.
 */
function extractSeekCoverage(harvestResult) {
  const r = harvestResult || {};
  const errors = Array.isArray(r.errors) ? r.errors.map(String) : [];
  const items = Array.isArray(r.items) ? r.items : [];
  const stats = r.connector_stats || {};

  let searchHits = 0;
  let pdfsFound = 0;
  let gaps = 0;
  const hosts = new Set();
  for (const e of errors) {
    const hits = parsePrefixedInt(e, 'web_pdf_search_hits:');
    if (hits != null) searchHits = Math.max(searchHits, hits);
    const pdfs = parsePrefixedInt(e, 'web_pdf_pdfs:');
    if (pdfs != null) pdfsFound = Math.max(pdfsFound, pdfs);
    const gapN = parsePrefixedInt(e, 'web_pdf_gaps:');
    if (gapN != null) gaps = Math.max(gaps, gapN);
    const hostTail = parsePrefixedTail(e, 'web_pdf_hosts:');
    if (hostTail != null) {
      for (const h of String(hostTail).split(',')) {
        if (h.trim()) hosts.add(h.trim());
      }
    }
    const okHost = parsePrefixedTail(e, 'web_pdf_ok:');
    if (okHost) hosts.add(okHost);
    if (startsWithIgnoreCase(e, 'web_pdf_gap:')) {
      const rest = e.slice('web_pdf_gap:'.length);
      const colon = rest.indexOf(':');
      const host = colon >= 0 ? rest.slice(0, colon) : rest;
      if (host) hosts.add(host);
    }
  }

  let ingestedDocs = 0;
  const gapTitles = [];
  for (const it of items) {
    const meta = it.meta || it.meta_extra || {};
    const url = String(it.source_url || it.document_url || meta.source_url || '');
    try {
      if (url) hosts.add(new URL(url).hostname);
    } catch (_) { /* ignore */ }
    if (it.local_document_path || it.document_url || (r.quality && Number(r.quality.with_document) > 0)) {
      /* count via quality below */
    }
    if (
      meta.literature_role === 'web_pdf_gap'
      || meta.kind === 'source_candidate'
      || startsWithIgnoreCase(String(it.title || ''), '[gap]')
    ) {
      gapTitles.push(String(it.title || url).slice(0, 80));
    }
  }
  ingestedDocs = Number((r.quality && r.quality.with_document) || 0);
  if (!ingestedDocs && items.length) {
    ingestedDocs = items.filter((it) => it.local_document_path || (it.document_url && !(it.meta_extra || it.meta || {}).gap_reason)).length;
  }

  const hostList = [...hosts].filter(Boolean).slice(0, 20);
  const nonIa = hostList.filter((h) => !isArchiveHost(h));
  return {
    search_hits: searchHits,
    pdfs_probed_ok: pdfsFound,
    gaps,
    ingested_documents: ingestedDocs,
    connector_stats: stats,
    hostnames: hostList,
    left_archive_silo: nonIa.length > 0 || Number(stats.web_pdf || 0) > 0,
    gap_samples: gapTitles.slice(0, 6),
  };
}

function formatSeekCoverage(cov) {
  if (!cov) return '';
  const lines = [
    'Open-web seek coverage:',
    `  search_hits=${cov.search_hits} · pdfs_confirmed=${cov.pdfs_probed_ok} · ingested_docs=${cov.ingested_documents} · gaps=${cov.gaps}`,
    cov.hostnames && cov.hostnames.length
      ? `  hosts: ${cov.hostnames.join(', ')}${cov.left_archive_silo ? ' (left Archive.org silo)' : ''}`
      : '  hosts: (none reported)',
  ];
  if (cov.connector_stats && Object.keys(cov.connector_stats).length) {
    lines.push(`  connector_stats: ${JSON.stringify(cov.connector_stats)}`);
  }
  if (cov.gap_samples && cov.gap_samples.length) {
    lines.push(`  gap samples: ${cov.gap_samples.join(' · ')}`);
  }
  const emptyShelf = Number(cov.search_hits) === 0 && Number(cov.pdfs_probed_ok) === 0 && Number(cov.ingested_documents) === 0;
  const foundButRejected = Number(cov.ingested_documents) > 0 || Number(cov.pdfs_probed_ok) > 0;
  if (emptyShelf) {
    lines.push('  Shelf status: EMPTY — no open copy found. Paste a direct URL and ask me to ingest it.');
  } else if (foundButRejected) {
    lines.push('  Shelf status: FOUND candidates (see mission-fit for keeps vs rejects).');
  }
  return lines.join('\n');
}

function coverageVoiceSummary(coverage, missionFit) {
  const cov = coverage || {};
  const counts = (missionFit && missionFit.counts) || {};
  const keep = Number(counts.keep || 0);
  const drop = Number(counts.drop || 0);
  const unsure = Number(counts.unsure || 0);
  const hits = Number(cov.search_hits || 0);
  const pdfs = Number(cov.pdfs_probed_ok || 0);
  const ingested = Number(cov.ingested_documents || 0);
  if (keep > 0) {
    return `Found open candidates and kept ${keep}`
      + (unsure ? ` (${unsure} unsure for your review)` : '')
      + '.';
  }
  if (ingested > 0 || pdfs > 0 || drop > 0) {
    return `Found ${Math.max(ingested, pdfs, drop)} candidate file(s) but none met the keep bar`
      + (unsure ? `; ${unsure} flagged unsure` : '')
      + '.';
  }
  if (hits === 0 && pdfs === 0) {
    return 'Shelf empty — no open copy turned up. Paste a URL (Archive.org / PDF link) and ask me to ingest it.';
  }
  return 'Search ran but nothing usable was ingested.';
}

function looksLikeLiteratureIntent() {
  return false;
}

function looksLikeImageIntent() {
  return false;
}

function wantsPdf() {
  return false;
}

function wantsPetrie() {
  return false;
}

function looksLikeVolumeJob() {
  return false;
}

/**
 * Build search query from the operator goal (no keyword special-cases).
 */
function normalizeHarvestQuery(goalText, opts = {}) {
  if (opts.query) return String(opts.query).slice(0, 300);
  return String(goalText || '').trim().slice(0, 300);
}

/**
 * Build harvest adapter input. Intent comes from tool overrides / LLM plan args — not keyword sniffing.
 */
function buildHarvestInput(goalText, overrides = {}) {
  const raw = String(goalText || '').trim();
  const constraints = parseHarvestConstraints(raw);

  let sources = overrides.sources
    || constraints.sources
    || [...IMAGE_SOURCES];
  if (overrides.bibliography_only === true) {
    sources = ['topbib', 'tla', 'oraec', 'papyri', 'trismegistos'];
  }
  if (overrides.seek_files === true || overrides.volume_job === true || overrides.require_document === true) {
    if (!overrides.sources) sources = [...SEEK_FILE_SOURCES];
  }
  if (constraints.literature_only || overrides.literature_only) {
    sources = sources.filter((s) => LIT_SOURCES.includes(s) || s === 'source_scout' || s === 'web_pdf' || s === 'web_text' || s === 'web_document');
    if (!sources.length) sources = [...LIT_SOURCES];
  }
  if (constraints.discover_sources && !sources.includes('source_scout')) {
    sources = [...sources, 'source_scout'];
  }

  let requireImage = overrides.require_image;
  if (requireImage == null) requireImage = constraints.require_image;
  if (requireImage == null) {
    requireImage = !(overrides.literature_only || overrides.seek_files || overrides.volume_job || overrides.require_document === true || constraints.literature_only);
  }

  const focus = overrides.focus
    || overrides.site
    || extractFocus(raw)
    || null;

  const goal = loadResearchGoal();
  const site = focus ? (goal.sites || []).find((s) => s.id === focus) : null;
  const query = overrides.query
    || normalizeHarvestQuery(raw, overrides)
    || (site && site.query)
    || raw.slice(0, 240)
    || 'Egyptian primary source';

  const limit = overrides.limit != null
    ? overrides.limit
    : (constraints.limit != null ? constraints.limit : (goal.default_harvest_limit || 15));

  const requireDocument = overrides.require_document != null
    ? !!overrides.require_document
    : !!(overrides.seek_files === true || overrides.volume_job === true);

  const maxLim = overrides.seek_files === true ? 100 : 40;
  return {
    query,
    focus: focus || undefined,
    limit: Math.max(1, Math.min(maxLim, Number(limit) || 15)),
    allow_stubs: overrides.allow_stubs === true,
    require_image: !!requireImage,
    require_document: requireDocument,
    sources,
    note: overrides.note || raw.slice(0, 1000),
    literature_only: !!(overrides.literature_only || constraints.literature_only),
    skip_thin: overrides.skip_thin != null ? !!overrides.skip_thin : !!(requireDocument || overrides.literature_only),
    min_text_chars: overrides.min_text_chars != null ? overrides.min_text_chars : (requireDocument ? 400 : undefined),
    seek_files: overrides.seek_files === true,
    volume_job: overrides.volume_job === true || requireDocument,
    auto_route: overrides.auto_route != null ? !!overrides.auto_route : undefined,
  };
}

async function runLegionCap(capability, input, opts = {}) {
  const agent = {
    id: opts.agentId || 'ei-worker',
    adapter_id: 'egyptian-insights',
    legion_capability: capability,
    default_input: {},
  };
  // Pass JSON brief so buildAdapterInput merges fields; also pass adapterInput overrides
  const brief = JSON.stringify(input || {});
  return executeLegionAgent(agent, brief, {
    pikoUserId: opts.pikoUserId || 'agent:ei-worker',
    source: opts.source || 'ei_tool_belt',
    adapterInput: input || {},
    baseUrl: opts.baseUrl,
    timeoutMs: opts.timeoutMs,
    pollTimeoutMs: opts.pollTimeoutMs,
    shouldAbort: opts.shouldAbort,
  });
}

async function runNamedSourceSeek(sourceName, toolName, args = {}, opts = {}) {
  const mission = String(opts.goal || args.query || args.note || '').trim();
  const q = args.query || mission;
  const lim = Math.max(3, Math.min(20, Number(args.limit || 8)));
  const input = buildHarvestInput(q, {
    literature_only: true,
    require_image: false,
    require_document: false,
    sources: [sourceName],
    limit: lim,
    note: mission.slice(0, 800),
  });
  const out = await runLegionCap('research.scrape.run', input, opts);
  const items = (out.result && out.result.items) || [];
  const kept = Number((out.result && out.result.kept) || items.length || 0);
  return {
    ok: out.status === 'ok' || items.length > 0,
    tool: toolName,
    artifact: [
      out.artifact_text || `${toolName}: ${items.length} hit(s)`,
      ...items.slice(0, 8).map((it) => `  · ${stripGapPrefix(it.title || it.source_id || '').slice(0, 80)}`),
    ].join('\n'),
    result: { source: sourceName, kept, items: items.slice(0, lim), raw: out.result || null },
  };
}

async function runPointerChase(sourceName, toolName, args = {}, opts = {}) {
  const mission = String(opts.goal || args.query || args.note || '').trim();
  const named = parseNamedWork(mission);
  const q = args.query || named.seekQuery || mission;
  const lim = Math.max(3, Math.min(20, Number(args.limit || 8)));
  const chaseLim = Math.max(1, Math.min(5, Number(args.chase_limit || 3)));
  const input = buildHarvestInput(q, {
    literature_only: true,
    require_image: false,
    require_document: false,
    sources: [sourceName],
    limit: lim,
    note: mission.slice(0, 800),
  });
  const out = await runLegionCap('research.scrape.run', input, opts);
  const items = (out.result && out.result.items) || [];
  const pointers = items
    .map((it) => ({
      title: stripGapPrefix(it.title).slice(0, 160),
      id: it.harvest_id || it.id,
    }))
    .filter((p) => p.title && p.title.length > 6)
    .slice(0, chaseLim);

  const chased = [];
  for (const p of pointers) {
    const seekQ = named.author
      ? `"${p.title}" ${named.author} PDF`
      : `"${p.title}" PDF Egypt`;
    try {
      const seekOut = await runTool('seek_files', {
        query: seekQ,
        limit: 8,
        max_keeps: 1,
      }, {
        ...opts,
        goal: named.author
          ? `Please find and add to Corpus ${named.author}'s ${p.title}`
          : `Please find and add to Corpus ${p.title}`,
      });
      const mf = seekOut.mission_fit
        || (seekOut.result && seekOut.result.mission_fit)
        || null;
      const keptFromMf = ((mf && mf.judgments) || [])
        .filter((j) => j && j.verdict === 'keep' && !j.purged).length;
      chased.push({
        pointer: p.title,
        ok: !!seekOut.ok,
        kept: keptFromMf || (seekOut.result && seekOut.result.kept) || 0,
        mission_fit: mf,
      });
    } catch (e) {
      chased.push({ pointer: p.title, ok: false, error: String(e.message || e).slice(0, 120) });
    }
  }
  const art = [
    out.artifact_text,
    `${sourceName} pointers chased: ${chased.length}`,
    ...chased.map((c) => `  · ${c.pointer.slice(0, 50)} → kept=${c.kept || 0}${c.error ? ` err=${c.error}` : ''}`),
  ].join('\n');
  return {
    ok: chased.some((c) => c.kept > 0) || out.status === 'ok',
    tool: toolName,
    artifact: art,
    result: { pointers, chased, [sourceName]: out.result || null },
  };
}

const TOOLS = {
  harvest: {
    name: 'harvest',
    description:
      'Harvest primary sources into cultures_cache (museums and/or Archive.org/TopBib/TLA). Use literature-only for texts/books/Petrie reports.',
    input_schema: {
      query: 'string',
      focus: 'abydos|heliopolis|giza|null',
      sources: 'string[]',
      require_image: 'boolean',
      limit: 'number',
      literature_only: 'boolean',
    },
    async run(args = {}, opts = {}) {
      const goalHint = args.query || args.note || opts.goal || '';
      const input = buildHarvestInput(goalHint, args);
      if (args.literature_only === true) {
        input.sources = [...LIT_SOURCES];
        input.require_image = false;
        input.literature_only = true;
      }
      const out = await runLegionCap('research.scrape.run', input, opts);
      let missionFit = null;
      let missionFitText = '';
      const mission = opts.goal || goalHint;
      const litHarvest = input.literature_only || input.require_document || input.volume_job
        || (Array.isArray(input.sources) && input.sources.every((s) => ['archive_org', 'web_pdf', 'topbib', 'tla'].includes(s)));
      if (out.status === 'ok' && litHarvest && String(process.env.PIKO_EI_MISSION_FIT || '1') !== '0') {
        try {
          const {
            harvestIdsFromToolResult,
            reviewHarvestsForMission,
            formatMissionFitReport,
          } = require('./eiMissionFitReview');
          const ids = harvestIdsFromToolResult(out.result || {});
          if (ids.length) {
            missionFit = await reviewHarvestsForMission(ids, mission, {
              applyFlags: true,
              requireLocalDocument: !!(input.require_document || input.volume_job),
              purgeDrops: true,
              limit: input.limit,
            });
            missionFitText = formatMissionFitReport(missionFit);
          }
        } catch (e) {
          missionFitText = `Mission-fit review error: ${e.message || e}`;
        }
      }
      const art = [out.artifact_text, missionFitText].filter(Boolean).join('\n\n');
      return {
        ok: out.status === 'ok',
        tool: 'harvest',
        artifact: art,
        result: missionFit
          ? { ...(out.result || {}), mission_fit: missionFit }
          : (out.result || null),
        legion_run_id: out.legion_run_id || null,
        input,
        mission_fit: missionFit,
      };
    },
  },

  seek_files: {
    name: 'seek_files',
    description:
      'Find downloadable volumes/PDFs anywhere on the open web (SearXNG/Serper). Prefer Archive.org when it has the file, but do not treat Archive.org as the only library. Confirms PDFs, ingests keeps after mission-fit; rejects are purged.',
    input_schema: {
      query: 'string',
      limit: 'number',
      focus: 'abydos|heliopolis|giza|null',
    },
    async run(args = {}, opts = {}) {
      const mission = String(opts.goal || args.note || '').trim()
        || String(args.query || '').trim();
      const named = parseNamedWork(mission || args.query || '');
      const pack = buildSeekQueryPack(mission || args.query || '');
      try { ensureSkeletonFiles(); } catch (_) { /* ok */ }
      const qLow = toLowerAsciiish(args.query || '');
      const goalHint = args.query && !includesAny(qLow, ['please find', 'add to corpus'])
        ? String(args.query).trim()
        : encodeHarvestQuery(pack);
      const lim = seekFilesLimit(
        args.limit != null ? args.limit : (named.seekLimit != null ? named.seekLimit : undefined),
      );
      const maxKeeps = args.max_keeps != null
        ? Number(args.max_keeps)
        : (named.maxKeeps != null ? named.maxKeeps : null);
      const input = buildHarvestInput(goalHint, {
        seek_files: true,
        volume_job: true,
        literature_only: true,
        require_image: false,
        require_document: true,
        sources: [...SEEK_FILE_SOURCES],
        limit: lim,
        skip_thin: true,
        focus: args.focus || args.site || undefined,
        min_text_chars: args.min_text_chars != null ? args.min_text_chars : 400,
        note: args.note || mission.slice(0, 1000) || pack.primary,
        seed_urls: pack.seed_urls,
      });
      // Encode seeds into query for the Python web_pdf connector
      input.query = encodeHarvestQuery(pack);
      const out = await runLegionCap('research.scrape.run', input, {
        ...opts,
        timeoutMs: Math.max(
          180000,
          Number(opts.timeoutMs || process.env.PIKO_EI_SEEK_FILES_TIMEOUT_MS || 600000),
        ),
        pollTimeoutMs: Math.max(
          180000,
          Number(opts.pollTimeoutMs || process.env.PIKO_EI_SEEK_FILES_TIMEOUT_MS || 600000),
        ),
      });
      const coverage = extractSeekCoverage(out.result || {});
      const covText = formatSeekCoverage(coverage);

      let missionFit = null;
      let missionFitText = '';
      // WP2.6: mission-fit fails closed — never leave ungated harvests as keeps.
      if (out.status === 'ok') {
        const {
          harvestIdsFromToolResult,
          reviewHarvestsForMission,
          formatMissionFitReport,
        } = require('./eiMissionFitReview');
        const { deleteHarvestItem } = require('./culturesCorpusApi');
        const ids = harvestIdsFromToolResult(out.result || {});
        const purgeUngated = (reason) => {
          let purged = 0;
          for (const id of ids) {
            try {
              const del = deleteHarvestItem(id);
              if (del && del.ok !== false) purged += 1;
            } catch (_) { /* best-effort */ }
          }
          missionFit = {
            error: 'mission_fit_error',
            reason,
            judgments: [],
            counts: { keep: 0, drop: 0, unsure: 0, purged },
          };
          missionFitText = `Mission-fit fail-closed (${reason}): purged ${purged} ungated harvest(s).`;
        };
        if (String(process.env.PIKO_EI_MISSION_FIT || '1') === '0') {
          if (ids.length) purgeUngated('mission_fit_disabled');
        } else if (ids.length) {
          try {
            missionFit = await reviewHarvestsForMission(ids, mission || pack.primary, {
              applyFlags: true,
              requireLocalDocument: true,
              purgeDrops: true,
              limit: lim,
              maxKeeps: maxKeeps != null ? maxKeeps : undefined,
              campaignDomain: opts.campaignDomain === true || opts.source === 'ei_research_campaign',
              campaignTopic: opts.campaignTopic || null,
              thread: opts.thread || null,
            });
            missionFitText = formatMissionFitReport(missionFit);
          } catch (e) {
            purgeUngated(String(e.message || e).slice(0, 120));
          }
        }
      }

      // Index kept items into corpus RAG (best-effort)
      try {
        const { indexHarvest } = require('./eiCorpusRag');
        const keeps = ((missionFit && missionFit.judgments) || [])
          .filter((j) => j && j.verdict === 'keep' && !j.purged);
        for (const j of keeps.slice(0, 5)) {
          indexHarvest(j.harvest_id).catch(() => {});
        }
      } catch (_) { /* optional */ }

      let knownText = '';
      try {
        if (named.author) {
          const keeps = ((missionFit && missionFit.judgments) || [])
            .filter((j) => j && j.verdict === 'keep' && !j.purged);
          const report = assessCoverage(named.author, keeps, { topic: named.topic || [] });
          knownText = formatKnownWorksReport(report);
          if (missionFit) missionFit.known_works = report;
        }
      } catch (_) { /* ok */ }

      const kept = (missionFit && missionFit.counts && missionFit.counts.keep) || 0;
      const purged = (missionFit && missionFit.counts && missionFit.counts.purged) || 0;
      const voice = coverageVoiceSummary(coverage, missionFit);
      const art = [out.artifact_text, covText, missionFitText, knownText, voice].filter(Boolean).join('\n\n');
      return {
        ok: out.status === 'ok' && (kept > 0 || !missionFit || missionFit.skipped),
        tool: 'seek_files',
        artifact: art,
        result: {
          ...(out.result || {}),
          seek_coverage: coverage,
          mission_fit: missionFit,
          known_works: missionFit && missionFit.known_works,
          coverage_voice: voice,
          kept,
          purged,
          query_pack: { queries: pack.queries, seed_urls: pack.seed_urls },
        },
        legion_run_id: out.legion_run_id || null,
        input,
        seek_coverage: coverage,
        mission_fit: missionFit,
      };
    },
  },

  ingest_url: {
    name: 'ingest_url',
    description:
      'Ingest a specific operator-provided URL into the corpus, then run mission-fit. Probes the URL and routes: PDF → web_pdf, TEI/XML/TXT or HTML with a Download/full-text link → fetch_document (one file), flat HTML book index → web_text crawl. Use when the operator pastes a URL. Set force=true or recrawl=true to discard an incomplete shelf hit.',
    input_schema: {
      url: 'string',
      note: 'string',
      title: 'string',
      force: 'boolean',
      recrawl: 'boolean',
      deliver_existing: 'boolean',
      site_crawl: 'boolean',
      thread: 'string',
      focus: 'string',
    },
    async run(args = {}, opts = {}) {
      const url = String(args.url || args.query || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        return {
          ok: false,
          tool: 'ingest_url',
          artifact: 'Error: url must be an http(s) link',
          result: null,
        };
      }
      const mission = String(opts.goal || args.note || args.title || `Ingest ${url}`).trim();
      // Accept LLM aliases: force/recrawl, force_recrawl; deliver_existing:false means recrawl.
      let force = !!(
        args.force
        || args.recrawl
        || args.force_recrawl
        || args['force/recrawl'] === true
        || args['force/recrawl'] === 'true'
        || args.deliver_existing === false
      );
      if (!force) {
        try {
          const { isForceRecrawlIntent } = require('./eiWorkPlanner');
          if (isForceRecrawlIntent(mission)) force = true;
        } catch (_) { /* optional */ }
      }
      const deliverExisting = args.deliver_existing !== false && !force;
      let existing = null;
      try {
        const { findKeptItemByUrl, normalizeSourceUrl } = require('./eiResearchCampaign');
        existing = findKeptItemByUrl(url);
        if (existing && !force) {
          const { isSiteIndexIntent, isTocLikeUrl } = require('./eiWorkPlanner');
          const wantsCrawl = !!(args.site_crawl || isSiteIndexIntent(mission) || isTocLikeUrl(url));
          // P0: only short-circuit when crawl QA proves a full on-work delivery.
          const {
            evidenceFromExistingItem,
            formatDeliveryEvidenceBlock,
            presentWebTextTitle,
          } = require('./eiWebTextDelivery');
          const evidence = evidenceFromExistingItem(existing, url);
          const fullDoc = !!(existing.is_full_document || (existing.meta && existing.meta.is_full_document));
          const fullOk = !!(existing.is_full_web_text && evidence && evidence.crawl_qa && evidence.crawl_qa.ok);
          if ((fullOk || fullDoc) && (existing.is_full_web_text || fullDoc || deliverExisting)) {
            let digested = false;
            try {
              const { deepDigestItem } = require('./eiCorpusNotes');
              await deepDigestItem(existing.harvest_id);
              digested = true;
            } catch (_) { /* best-effort */ }
            const displayTitle = (evidence && evidence.display_title)
              || presentWebTextTitle(existing.title, existing.pages_scraped)
              || existing.title;
            const judgment = {
              verdict: 'keep',
              harvest_id: existing.harvest_id,
              work_title: displayTitle,
              title: displayTitle,
              relation: fullDoc ? 'web_document' : 'web_text_site_crawl',
              author: (existing.meta && (existing.meta.author || existing.meta.work_author)) || 'unknown',
              purged: false,
              existing: true,
              pages_scraped: existing.pages_scraped,
              is_full_web_text: !fullDoc,
              is_full_document: !!fullDoc,
            };
            const missionFit = {
              judgments: [judgment],
              counts: { keep: 1, drop: 0, unsure: 0 },
            };
            const chars = evidence && evidence.text_chars_total;
            return {
              ok: true,
              tool: 'ingest_url',
              artifact: [
                formatDeliveryEvidenceBlock(evidence),
                `Already in corpus as #${existing.harvest_id}`
                  + (existing.pages_scraped ? ` (${existing.pages_scraped} pages scraped)` : '')
                  + `: ${displayTitle}`,
                fullDoc
                  ? `Full document already on the shelf (#${existing.harvest_id}${chars ? `, ${chars} chars` : ''}).`
                  : (`QA-green full web_text site crawl on the shelf (${existing.pages_scraped || '?'} pages`
                    + (chars ? `, ${chars} chars` : '')
                    + ').'),
                digested ? 'Deep-digested existing keep for operator ask.' : null,
                'Delivered existing keep — no duplicate ingest.',
              ].filter(Boolean).join('\n'),
              result: {
                url,
                kept: 1,
                skipped_duplicate_url: true,
                existing_harvest_id: existing.harvest_id,
                harvest_id: existing.harvest_id,
                pages_scraped: existing.pages_scraped,
                text_chars_total: chars || null,
                has_local_document: existing.has_local_document,
                is_full_web_text: !fullDoc,
                is_full_document: !!fullDoc,
                crawl_qa: evidence && evidence.crawl_qa,
                crawl_prefix: (evidence && evidence.crawl_prefix) || url,
                work_title: displayTitle,
                delivery_evidence: evidence,
                mission_fit: missionFit,
                quality: { substantive_count: 1, with_document: existing.has_local_document ? 1 : 0 },
              },
              mission_fit: missionFit,
            };
          }
          // Incomplete / thin / crawl ask: fall through to Legion re-scrape
          // (force_recrawl set below). Do not fail closed — that blocked force-recrawl.
          const incomplete = !!(
            existing.is_partial_web_text
            || existing.is_thin_stub
            || (!existing.is_full_web_text && !existing.is_full_document)
          );
          if (wantsCrawl || incomplete) {
            // fall through
          } else {
            return {
              ok: false,
              tool: 'ingest_url',
              artifact: `Skipped duplicate URL without full delivery proof: ${url}`,
              result: {
                url,
                kept: 0,
                skipped_duplicate_url: true,
                existing_harvest_id: existing.harvest_id,
              },
            };
          }
        }
      } catch (_) { /* best-effort */ }
      const query = `SEED_URL:${url}`;
      const input = buildHarvestInput(query, {
        seek_files: true,
        volume_job: true,
        literature_only: true,
        require_image: false,
        require_document: true,
        // Probe inside harvest picks one: web_pdf | web_document | web_text.
        sources: ['web_pdf', 'web_document', 'web_text'],
        limit: 3,
        skip_thin: true,
        note: mission.slice(0, 1000),
        auto_route: true,
        focus: args.thread || args.focus || args.site || undefined,
      });
      input.query = query;
      input.auto_route = true;
      if (force || (existing && (existing.is_thin_stub || existing.is_partial_web_text || (!existing.is_full_web_text && !existing.is_full_document)))) {
        input.force_recrawl = true;
      }
      if (args.site_crawl) input.site_crawl = true;
      const out = await runLegionCap('research.scrape.run', input, {
        ...opts,
        // Large TOC crawls can take 15–20+ minutes; keep poll aligned.
        timeoutMs: Math.max(
          900000,
          Number(opts.timeoutMs || process.env.PIKO_EI_INGEST_URL_TIMEOUT_MS || 1200000),
        ),
        pollTimeoutMs: Math.max(
          900000,
          Number(opts.pollTimeoutMs || process.env.PIKO_EI_INGEST_URL_TIMEOUT_MS || 1200000),
        ),
      });
      const coverage = extractSeekCoverage(out.result || {});
      let missionFit = null;
      let missionFitText = '';
      if (out.status === 'ok') {
        const {
          harvestIdsFromToolResult,
          reviewHarvestsForMission,
          formatMissionFitReport,
        } = require('./eiMissionFitReview');
        const { deleteHarvestItem } = require('./culturesCorpusApi');
        const ids = harvestIdsFromToolResult(out.result || {});
        const purgeUngated = (reason) => {
          let purged = 0;
          for (const id of ids) {
            try {
              const del = deleteHarvestItem(id);
              if (del && del.ok !== false) purged += 1;
            } catch (_) { /* best-effort */ }
          }
          missionFit = {
            error: 'mission_fit_error',
            reason,
            judgments: [],
            counts: { keep: 0, drop: 0, unsure: 0, purged },
          };
          missionFitText = `Mission-fit fail-closed (${reason}): purged ${purged} ungated harvest(s).`;
        };
        if (String(process.env.PIKO_EI_MISSION_FIT || '1') === '0') {
          if (ids.length) purgeUngated('mission_fit_disabled');
        } else if (ids.length) {
          try {
            missionFit = await reviewHarvestsForMission(ids, mission, {
              applyFlags: true,
              requireLocalDocument: true,
              purgeDrops: true,
              limit: 5,
              maxKeeps: 1,
              campaignDomain: opts.campaignDomain === true || opts.source === 'ei_research_campaign',
              campaignTopic: opts.campaignTopic || null,
              thread: opts.thread || null,
            });
            missionFitText = formatMissionFitReport(missionFit);
            try {
              const { indexHarvest } = require('./eiCorpusRag');
              const { deepDigestItem } = require('./eiCorpusNotes');
              for (const j of (missionFit.judgments || []).filter((x) => x.verdict === 'keep' && !x.purged)) {
                indexHarvest(j.harvest_id).catch(() => {});
                deepDigestItem(j.harvest_id).catch(() => {});
              }
            } catch (_) { /* ok */ }
          } catch (e) {
            purgeUngated(String(e.message || e).slice(0, 120));
          }
        }
      }
      const kept = (missionFit && missionFit.counts && missionFit.counts.keep) || 0;
      let scrapeHid = 0;
      try {
        const { harvestIdsFromToolResult } = require('./eiMissionFitReview');
        scrapeHid = Number((harvestIdsFromToolResult(out.result || {}) || [])[0] || 0);
      } catch (_) { /* optional */ }
      if (!scrapeHid) {
        for (const it of (out.result && out.result.items) || []) {
          scrapeHid = Number(it && (it.harvest_id || it.id)) || 0;
          if (scrapeHid) break;
        }
      }
      const voice = coverageVoiceSummary(coverage, missionFit);
      const route = (out.result && out.result.ingest_route) || input.ingest_route || null;
      const routeLine = route && route.connector
        ? `Ingest route: ${route.connector} (${route.kind || 'page'}${route.hint ? `, ${route.hint}` : ''}${route.fetch_url && route.fetch_url !== url ? ` via ${route.fetch_url}` : ''}).`
        : '';
      const emptyHint = kept === 0
        ? '\nIf this URL is paywalled or not a direct PDF/TEI download, try an Archive.org details link or a direct .pdf / .xml URL.'
        : '';
      return {
        ok: out.status === 'ok' && kept > 0,
        tool: 'ingest_url',
        artifact: [out.artifact_text, routeLine, formatSeekCoverage(coverage), missionFitText, voice + emptyHint].filter(Boolean).join('\n\n'),
        result: {
          ...(out.result || {}),
          seek_coverage: coverage,
          mission_fit: missionFit,
          url,
          kept,
          harvest_id: scrapeHid || undefined,
          force_recrawl: !!input.force_recrawl,
          ingest_route: route,
        },
        seek_coverage: coverage,
        mission_fit: missionFit,
        input,
      };
    },
  },

  fetch_document: {
    name: 'fetch_document',
    description:
      'Fetch a single full document (PDF, TEI/XML, plain text, or an HTML viewer that offers Download/full text) into the corpus. Prefer this over HTML site crawl when the work is one file. For a pasted URL, ingest_url also auto-routes here after probing.',
    input_schema: {
      url: 'string',
      note: 'string',
      title: 'string',
      force: 'boolean',
      recrawl: 'boolean',
    },
    async run(args = {}, opts = {}) {
      const out = await TOOLS.ingest_url.run({
        ...args,
        site_crawl: false,
      }, {
        ...opts,
        timeoutMs: Math.max(120000, Number(opts.timeoutMs || process.env.PIKO_EI_FETCH_DOCUMENT_TIMEOUT_MS || 180000)),
        pollTimeoutMs: Math.max(120000, Number(opts.pollTimeoutMs || process.env.PIKO_EI_FETCH_DOCUMENT_TIMEOUT_MS || 180000)),
      });
      if (out && typeof out === 'object') out.tool = 'fetch_document';
      return out;
    },
  },

  chase_topbib: {
    name: 'chase_topbib',
    description:
      'Search TopBib for bibliographic pointers matching the goal, then chase the best titles with open-web seek (pointer → PDF).',
    input_schema: { query: 'string', limit: 'number', chase_limit: 'number' },
    async run(args = {}, opts = {}) {
      return runPointerChase('topbib', 'chase_topbib', args, opts);
    },
  },

  chase_tla: {
    name: 'chase_tla',
    description:
      'Search Thesaurus Linguae Aegyptiae object/text index, then chase promising titles via open-web seek.',
    input_schema: { query: 'string', limit: 'number', chase_limit: 'number' },
    async run(args = {}, opts = {}) {
      return runPointerChase('tla', 'chase_tla', args, opts);
    },
  },

  seek_oraec: {
    name: 'seek_oraec',
    description:
      'Search the ORAEC open Egyptian text corpus (inscriptions with translations / bibliography).',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      return runNamedSourceSeek('oraec', 'seek_oraec', args, opts);
    },
  },

  seek_papyri: {
    name: 'seek_papyri',
    description:
      'Search Integrating Digital Papyrology (papyri/idp.data — DDbDP/HGV/APIS/DCLP). Uses the open GitHub dump; papyri.info UI is bot-gated.',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      return runNamedSourceSeek('papyri', 'seek_papyri', args, opts);
    },
  },

  seek_digital_giza: {
    name: 'seek_digital_giza',
    description:
      'Search Digital Giza / Giza Project object and tomb records (primary excavation context).',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      return runNamedSourceSeek('digital_giza', 'seek_digital_giza', args, opts);
    },
  },

  seek_open_context: {
    name: 'seek_open_context',
    description:
      'Search Open Context for archaeological excavation/archive records (primary context, not literary PDFs).',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      return runNamedSourceSeek('open_context', 'seek_open_context', args, opts);
    },
  },

  seek_trismegistos: {
    name: 'seek_trismegistos',
    description:
      'Search Trismegistos Demotic/Egyptian text index (christiancasey open dump → TM text pages).',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      return runNamedSourceSeek('trismegistos', 'seek_trismegistos', args, opts);
    },
  },

  extract_bibliography: {
    name: 'extract_bibliography',
    description: 'Read a kept corpus item and extract cited works from its bibliography / footnotes.',
    input_schema: { harvest_id: 'number' },
    async run(args = {}) {
      const { extractBibliography } = require('./eiBibliography');
      const hid = Number(args.harvest_id);
      const report = await extractBibliography(hid);
      const lines = [
        `Bibliography extract #${hid}: ${report.count || 0} citation(s)`,
        ...((report.citations || []).slice(0, 12).map((c) => {
          const flag = c.in_corpus_id ? ` [in corpus #${c.in_corpus_id}]` : (c.already_chased ? ' [already chased]' : '');
          return `  · ${(c.title || '').slice(0, 60)} — ${c.author || '?'}${flag}`;
        })),
      ];
      return {
        ok: !!report.ok,
        tool: 'extract_bibliography',
        artifact: lines.join('\n'),
        result: report,
      };
    },
  },

  expand_from_item: {
    name: 'expand_from_item',
    description:
      'Hybrid bibliography expansion: extract citations from a kept item, auto-seek them, keep strong matches, leave unsures for the operator.',
    input_schema: { harvest_id: 'number', limit: 'number' },
    async run(args = {}, opts = {}) {
      const { expandFromItem, formatExpandReport } = require('./eiBibliography');
      const report = await expandFromItem(Number(args.harvest_id), {
        ...opts,
        limit: args.limit,
      });
      return {
        ok: !!report.ok,
        tool: 'expand_from_item',
        artifact: formatExpandReport(report),
        result: report,
        mission_fit: null,
      };
    },
  },

  seed_snowball: {
    name: 'seed_snowball',
    description:
      'Ingest an operator-provided list of source URLs and/or named works, then iteratively expand bibliographies from what was kept (hybrid keep/unsure). Use when the operator pastes a starter list and wants snowball growth.',
    input_schema: {
      list: 'string',
      rounds: 'number',
      expand_limit: 'number',
      max_seeds: 'number',
    },
    async run(args = {}, opts = {}) {
      const { runSeedSnowball, formatSnowballReport, parseSeedList } = require('./eiSeedSnowball');
      // Prefer whichever text yields more seeds — LLM often collapses newlines to "; "
      // while opts.goal still has the operator's line list.
      const candidates = [
        String(args.list || '').trim(),
        String(opts.goal || '').trim(),
        String(args.note || '').trim(),
      ].filter(Boolean);
      let listText = candidates[0] || '';
      let bestCount = -1;
      for (const c of candidates) {
        const n = parseSeedList(c).seeds.length;
        if (n > bestCount) {
          bestCount = n;
          listText = c;
        }
      }
      const parsed = parseSeedList(listText);
      const report = await runSeedSnowball(listText, {
        ...opts,
        goal: opts.goal || listText,
        rounds: args.rounds != null ? Number(args.rounds) : undefined,
        expandLimit: args.expand_limit != null ? Number(args.expand_limit) : undefined,
        maxSeeds: args.max_seeds != null ? Number(args.max_seeds) : undefined,
      });
      const art = [
        formatSnowballReport(report),
        parsed.seeds.length
          ? `Parsed ${parsed.seeds.length} seed(s): ${parsed.seeds.slice(0, 6).map((s) => (s.url || s.title || s.query || '?').slice(0, 40)).join(' · ')}`
          : 'No seeds parsed from the list.',
      ].join('\n');
      return {
        ok: !!report.ok,
        tool: 'seed_snowball',
        artifact: art,
        result: report,
        mission_fit: null,
      };
    },
  },

  research_pm: {
    name: 'research_pm',
    description:
      'Piko research PM: propose one named spine work, deploy a thinking seeker, confirm the edition/URL, then ingest. Actions: start, pause, resume, stop, status, propose, deploy, confirm, tick, scorecard. Confirm stays with Piko (27b) / operator — seeker does not ingest.',
    input_schema: {
      action: 'start|pause|resume|stop|status|propose|deploy|confirm|tick|scorecard',
      topic: 'string',
      title: 'string',
      author: 'string',
      thread: 'string',
      url: 'string',
      id: 'string',
      verdict: 'keep|recrawl|drop|retag|ask_operator',
      why: 'string',
      interval_minutes: 'number',
      auto_confirm: 'boolean',
    },
    async run(args = {}, opts = {}) {
      const pm = require('./eiResearchPm');
      const action = String(args.action || 'status').toLowerCase();
      const out = await pm.runPmTool(args, opts);
      return {
        ok: out.ok !== false,
        tool: 'research_pm',
        artifact: pm.formatPmToolArtifact(action, out),
        result: out,
        mission_fit: null,
      };
    },
  },

  research_campaign: {
    name: 'research_campaign',
    description:
      'Piko research PM mode (default): start/pause/resume/stop/status/run_now/scorecard. Start deploys thinking seekers under Piko confirm — not the old autonomous forklift. Use action start_forklift only to re-enable the legacy campaign daemon. backfill_learning still digests existing keeps.',
    input_schema: {
      action: 'start|pause|resume|stop|status|run_now|backfill_learning|scorecard|start_forklift',
      topic: 'string',
      focus_only: 'boolean',
      interval_minutes: 'number',
      limit: 'number',
      deep: 'boolean',
    },
    async run(args = {}, opts = {}) {
      const campaign = require('./eiResearchCampaign');
      const pm = require('./eiResearchPm');
      const action = String(args.action || 'status').toLowerCase();
      let out;
      if (action === 'start_forklift') {
        try { pm.stopPm(); } catch (_) { /* PM may already be off */ }
        out = campaign.startCampaign({
          topic: args.topic || opts.goal,
          focus_only: !!args.focus_only,
          interval_minutes: args.interval_minutes,
          force_forklift: true,
        });
      } else if (action === 'start') {
        const phrase = String(args.topic || opts.goal || '').trim();
        const focusOnly = !!args.focus_only || includesAny(toLowerAsciiish(phrase), ['focus only on']);
        if (pm.pmModeDefaultOn()) {
          const keepGoing = includesAny(toLowerAsciiish(phrase), [
            'keep research', 'keep ingest', 'keep seek', 'keep gather', 'keep think',
            'gather more', 'more resource', 'more source', 'keep going',
          ]);
          out = pm.startPm({
            topic: focusOnly ? phrase : (phrase || undefined),
            interval_minutes: args.interval_minutes,
          });
          out.operator_leads_added = 0;
          if (keepGoing) {
            out = await pm.tickPm({ force: true, rootDir: opts.rootDir });
          }
        } else {
          out = campaign.startCampaign({
            topic: focusOnly ? phrase : undefined,
            focus_only: focusOnly,
            interval_minutes: args.interval_minutes,
          });
          if (phrase) {
            const leads = campaign.leadsFromTopicPhrase(phrase, 3);
            if (leads.length) {
              const added = campaign.addCampaignLeads(leads);
              out.operator_leads_added = added.added || 0;
              out.status = campaign.getCampaignStatus().status;
            }
          }
        }
      } else if (action === 'pause') {
        out = pm.loadState().enabled ? pm.pausePm() : campaign.pauseCampaign();
      } else if (action === 'resume') {
        out = pm.loadState().enabled || pm.loadState().created_at ? pm.resumePm() : campaign.resumeCampaign();
      } else if (action === 'stop') {
        if (pm.loadState().enabled || pm.loadState().created_at) out = pm.stopPm();
        else out = campaign.stopCampaign();
      } else if (action === 'backfill_learning') {
        const { backfillCorpusLearning } = require('./eiCorpusNotes');
        const bf = await backfillCorpusLearning({
          limit: args.limit != null ? Number(args.limit) : 40,
          deep: !!args.deep,
        });
        out = { ok: !!bf.ok, status: campaign.getCampaignStatus().status, backfill: bf };
      } else if (action === 'scorecard') {
        out = pm.isPmManaging() || (pm.loadState().stats && pm.loadState().stats.confirmed_keep)
          ? pm.pmScorecard()
          : campaign.getLearningScorecard();
      } else if (action === 'run_now') {
        if (pm.pmModeDefaultOn()) {
          if (!pm.loadState().enabled) pm.startPm({ topic: args.topic || opts.goal });
          out = await pm.tickPm({ force: true, rootDir: opts.rootDir });
        } else {
          const { enqueueAgentJob } = require('./agentOrchestrator');
          campaign.startCampaign({});
          campaign.resetIdleStreak();
          const queued = enqueueAgentJob('campaign_cycle', { source: 'chat' }, { rootDir: opts.rootDir });
          out = { ok: !!queued.ok, status: campaign.getCampaignStatus().status };
        }
      } else if (pm.loadState().enabled) {
        out = pm.getPmStatus();
      } else {
        out = campaign.getCampaignStatus();
      }
      let artifact;
      if (action === 'backfill_learning' && out.backfill) {
        artifact = `Backfill: digested ${(out.backfill.digested || []).length}, skipped ${(out.backfill.skipped || []).length}, errors ${(out.backfill.errors || []).length}`;
      } else if (action === 'start_forklift') {
        artifact = campaign.formatCampaignStatus(out.status);
      } else if (
        out.mode === 'research_pm'
        || out.packet
        || out.work
        || out.confirmed_spine_total != null
        || out.skipped
        || (pm.loadState().enabled && action !== 'backfill_learning')
      ) {
        artifact = pm.formatPmToolArtifact(action === 'run_now' ? 'tick' : action, out);
      } else if (action === 'scorecard') {
        artifact = `Learning scorecard: notes/keep=${out.notes_keep_ratio ?? '?'} · attributed=${out.attributed_keep_pct ?? '?'}% · reflection/100=${out.reflection_survival_per_100_cycles ?? '?'} · dead_threads=${out.dead_thread_count ?? '?'}`;
      } else {
        artifact = campaign.formatCampaignStatus(out.status || out);
      }
      return {
        ok: out.ok !== false,
        tool: 'research_campaign',
        artifact,
        result: out,
        mission_fit: null,
      };
    },
  },

  digest_item: {
    name: 'digest_item',
    description: 'Write structured notes (claims, people, sites, methods) for a kept corpus item for later tasks.',
    input_schema: { harvest_id: 'number' },
    async run(args = {}) {
      const { digestItem } = require('./eiCorpusNotes');
      const report = await digestItem(Number(args.harvest_id));
      const n = report.note || {};
      const art = report.ok
        ? `Digest #${n.harvest_id}: ${(n.summary || '').slice(0, 240)}\nClaims: ${(n.claims || []).slice(0, 3).join('; ')}`
        : `Digest failed: ${report.error}`;
      return { ok: !!report.ok, tool: 'digest_item', artifact: art, result: report };
    },
  },

  deep_digest_item: {
    name: 'deep_digest_item',
    description:
      'Multi-window structured digest for long corpus works (samples start/middle/end). Short texts fall back to digest_item.',
    input_schema: { harvest_id: 'number' },
    async run(args = {}) {
      const { deepDigestItem } = require('./eiCorpusNotes');
      const report = await deepDigestItem(Number(args.harvest_id));
      const n = report.note || {};
      const art = report.ok
        ? `Deep digest #${n.harvest_id}${n.deep ? ' (deep)' : ''}: ${(n.summary || '').slice(0, 240)}\nClaims: ${(n.claims || []).slice(0, 4).join('; ')}`
        : `Deep digest failed: ${report.error}`;
      return { ok: !!report.ok, tool: 'deep_digest_item', artifact: art, result: report };
    },
  },

  thread_dossier: {
    name: 'thread_dossier',
    description:
      'Load or rebuild the expert dossier for a research thread (giza, abydos, heliopolis, self-view, premodern-reception, gobekli-tepe, cataclysm, atlantis, tiahuanaco, flood-myths). Claims cite corpus harvest ids.',
    input_schema: { thread: 'string', rebuild: 'boolean' },
    async run(args = {}) {
      const d = require('./eiThreadDossiers');
      const rawThread = String(args.thread || '').trim().toLowerCase();
      if (!rawThread) {
        return {
          ok: false,
          tool: 'thread_dossier',
          artifact: 'thread required (e.g. giza)',
          result: { error: 'thread_required' },
        };
      }
      // Exact alias resolve ("osireion" → abydos) — never fuzzy-match invented ids.
      const thread = d.resolveThreadAlias(rawThread) || rawThread;
      let dossier = d.loadDossier(thread);
      if (args.rebuild || !dossier) {
        const built = await d.buildDossier(thread);
        if (!built.ok) {
          return {
            ok: false,
            tool: 'thread_dossier',
            artifact: `Dossier failed: ${built.error}`,
            result: built,
          };
        }
        dossier = built.dossier;
      }
      const art = [
        `Dossier [${dossier.thread}] notes=${dossier.note_count}`,
        dossier.summary || '',
        `Claims: ${(dossier.key_claims || []).slice(0, 4).map((c) => c.claim).join('; ')}`,
        `Gaps: ${(dossier.evidence_gaps || []).slice(0, 3).join('; ')}`,
      ].filter(Boolean).join('\n');
      return { ok: true, tool: 'thread_dossier', artifact: art.slice(0, 2000), result: { dossier } };
    },
  },

  write_article: {
    name: 'write_article',
    description:
      'Write a verifiable research article draft on a topic (corpus citations + verification). Runs inline by default so review sees the draft; optional async child with wait.',
    input_schema: { topic: 'string', thread: 'string', async: 'boolean' },
    async run(args = {}, opts = {}) {
      const topic = String(args.topic || args.thread || '').trim();
      if (!topic) {
        return {
          ok: false,
          tool: 'write_article',
          artifact: 'topic required',
          result: { error: 'topic_required' },
        };
      }
      const wantAsync = args.async === true
        || String(process.env.PIKO_ARTICLE_INLINE || '1').trim() === '0';
      if (!wantAsync) {
        const { writeArticle } = require('./eiArticleWriter');
        const out = await writeArticle(topic, {
          thread: args.thread || null,
          rootDir: opts.rootDir,
        });
        return {
          ok: !!out.ok,
          tool: 'write_article',
          artifact: out.ok
            ? `Article draft ${out.slug || 'written'} (${out.status || 'draft'})`
            : `Article failed: ${out.error || 'unknown'}`,
          result: out,
        };
      }
      // Async child path: enqueue then wait until done (parent stays blocked / awaiting_child).
      // WP7.8: without a standalone worker, the single-threaded in-process loop
      // deadlocks (parent holds busy while child waits to be claimed). Cap wait.
      const standaloneWorker = String(process.env.PIKO_AGENT_STANDALONE_WORKER || '').trim() === '1'
        || String(process.env.PIKO_ARTICLE_ASYNC_OK || '').trim() === '1';
      if (!standaloneWorker) {
        return {
          ok: false,
          tool: 'write_article',
          artifact: 'Async article child unsupported in-process (set PIKO_ARTICLE_INLINE=1 or PIKO_ARTICLE_ASYNC_OK=1 with a standalone worker).',
          result: {
            ok: false,
            error: 'awaiting_child_unsupported_inline',
            awaiting_child: true,
          },
        };
      }
      const { enqueueAgentJob } = require('./agentOrchestrator');
      const { readJob } = require('./agentJobs');
      const queued = enqueueAgentJob('article_write', {
        topic,
        thread: args.thread || null,
        source: 'tool',
        parent_awaiting: true,
      }, { rootDir: opts.rootDir });
      if (!queued.ok || !queued.job) {
        return {
          ok: false,
          tool: 'write_article',
          artifact: `Queue failed: ${queued.error || 'unknown'}`,
          result: queued,
        };
      }
      const childId = queued.job.id;
      const deadline = Date.now() + Math.max(
        5_000,
        Math.min(
          60_000,
          Number(process.env.PIKO_ARTICLE_CHILD_WAIT_MS || 60_000) || 60_000,
        ),
      );
      while (Date.now() < deadline) {
        if (typeof opts.shouldAbort === 'function' && opts.shouldAbort()) {
          return {
            ok: false,
            tool: 'write_article',
            artifact: `Article child ${childId} cancelled while awaiting.`,
            result: { ok: false, cancelled: true, child_id: childId, awaiting_child: true },
          };
        }
        const child = readJob(childId);
        if (child && child.status === 'done') {
          const ok = !!(child.result && child.result.ok);
          return {
            ok,
            tool: 'write_article',
            artifact: ok
              ? `Article draft ${child.result.slug || 'written'} (${child.result.status || 'draft'})`
              : `Article child failed: ${(child.error || (child.result && child.result.error) || 'unknown')}`,
            result: { ...(child.result || {}), child_id: childId, awaited_child: true },
          };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return {
        ok: false,
        tool: 'write_article',
        artifact: `Timed out waiting for article child ${childId}`,
        result: { ok: false, error: 'awaiting_child_timeout', child_id: childId, awaiting_child: true },
      };
    },
  },

  index_corpus: {
    name: 'index_corpus',
    description: 'Chunk and embed kept corpus texts for semantic chat retrieval (RAG).',
    input_schema: { limit: 'number', harvest_id: 'number' },
    async run(args = {}) {
      const rag = require('./eiCorpusRag');
      if (args.harvest_id) {
        const r = await rag.indexHarvest(Number(args.harvest_id));
        return {
          ok: !!r.ok,
          tool: 'index_corpus',
          artifact: r.ok ? `Indexed #${r.harvest_id} (${r.chunks} chunks)` : `Index failed: ${r.error || r.reason}`,
          result: r,
        };
      }
      const r = await rag.indexKeptCorpus({ limit: args.limit });
      return {
        ok: !!r.ok,
        tool: 'index_corpus',
        artifact: `Indexed ${r.indexed || 0} kept items (${r.failed || 0} failed)`,
        result: r,
      };
    },
  },

  find_literature: {
    name: 'find_literature',
    description:
      'Find and assess primary/early literature (Archive.org, TopBib, TLA) against the EI research goal; may harvest useful texts.',
    input_schema: {
      brief: 'string',
      sites: 'string[]',
      limit: 'number',
      harvest_limit: 'number',
    },
    async run(args = {}, opts = {}) {
      const { runTextScout } = require('./eiTextScout');
      const mission = String(opts.goal || args.brief || '').trim();
      const brief = args.brief || opts.goal || JSON.stringify({
        find: true,
        assess: true,
        sites: args.sites || ['abydos', 'heliopolis', 'giza'],
        limit: args.limit != null ? args.limit : 8,
        harvest_limit: args.harvest_limit != null ? args.harvest_limit : 4,
      });

      // Watermark so mission-fit only judges what THIS run ingested,
      // never pre-existing corpus rows.
      let beforeMaxId = 0;
      try {
        const { listItems } = require('./culturesCorpusApi');
        const latest = listItems({ limit: 1, exclude_candidates: false });
        beforeMaxId = Number((latest.items && latest.items[0] && latest.items[0].id) || 0);
      } catch (_) { /* watermark best-effort */ }

      const scoutOut = await runTextScout({
        rootDir: opts.rootDir,
        brief: typeof brief === 'string' ? brief : JSON.stringify(brief),
        source: opts.source || 'ei_tool_belt',
      });

      let missionFit = null;
      let missionFitText = '';
      if ((scoutOut.status === 'ok' || scoutOut.pass === true)
        && mission
        && String(process.env.PIKO_EI_MISSION_FIT || '1') !== '0') {
        try {
          const { listItems } = require('./culturesCorpusApi');
          const {
            reviewHarvestsForMission,
            formatMissionFitReport,
          } = require('./eiMissionFitReview');
          const after = listItems({ limit: 100, exclude_candidates: false });
          const newIds = (after.items || [])
            .map((it) => Number(it.id))
            .filter((id) => Number.isFinite(id) && id > beforeMaxId);
          if (newIds.length) {
            missionFit = await reviewHarvestsForMission(newIds.sort((a, b) => a - b), mission, {
              applyFlags: true,
              requireLocalDocument: false,
              purgeDrops: true,
            });
            missionFitText = formatMissionFitReport(missionFit);
          }
        } catch (e) {
          missionFitText = `Mission-fit review error: ${e.message || e}`;
        }
      }

      const report = scoutOut.report || scoutOut;
      return {
        ok: scoutOut.status === 'ok' || scoutOut.pass === true,
        tool: 'find_literature',
        artifact: [scoutOut.artifact_text, missionFitText].filter(Boolean).join('\n\n'),
        result: missionFit ? { ...report, mission_fit: missionFit } : report,
        mission_fit: missionFit,
      };
    },
  },

  search_corpus: {
    name: 'search_corpus',
    description: 'Search the local Egyptian Insights cultures_cache.',
    input_schema: { query: 'string', limit: 'number' },
    async run(args = {}, opts = {}) {
      const input = {
        query: args.query || opts.goal || '',
        limit: args.limit != null ? args.limit : 20,
      };
      const out = await runLegionCap('culture.corpus.search', input, opts);
      return {
        ok: out.status === 'ok',
        tool: 'search_corpus',
        artifact: out.artifact_text,
        result: out.result || null,
        legion_run_id: out.legion_run_id || null,
        input,
      };
    },
  },

  review_corpus: {
    name: 'review_corpus',
    description: 'Content-review every corpus source and set Flag keep/drop/review.',
    input_schema: { include_candidates: 'boolean' },
    async run(args = {}, opts = {}) {
      const { runCorpusReview } = require('./eiCorpusFlags');
      const rev = await runCorpusReview({
        include_candidates: !!args.include_candidates,
      });
      return {
        ok: !!rev.pass || rev.status === 'ok',
        tool: 'review_corpus',
        artifact: rev.artifact_text,
        result: rev.report || rev,
      };
    },
  },

  transcribe: {
    name: 'transcribe',
    description: 'Vision scribe: hieroglyph/papyrus image → Gardiner tokens (needs harvest_id).',
    input_schema: { harvest_id: 'number' },
    async run(args = {}, opts = {}) {
      const hid = Number(args.harvest_id);
      if (!Number.isFinite(hid) || hid <= 0) {
        return { ok: false, tool: 'transcribe', artifact: 'Error: harvest_id required', result: null };
      }
      const out = await runLegionCap('scribe.transcribe.image', { harvest_id: hid }, opts);
      return {
        ok: out.status === 'ok',
        tool: 'transcribe',
        artifact: out.artifact_text,
        result: out.result || null,
        legion_run_id: out.legion_run_id || null,
      };
    },
  },

  critique: {
    name: 'critique',
    description: 'Scholar critique of transcription vs museum translation (needs harvest_id).',
    input_schema: { harvest_id: 'number' },
    async run(args = {}, opts = {}) {
      const hid = Number(args.harvest_id);
      if (!Number.isFinite(hid) || hid <= 0) {
        return { ok: false, tool: 'critique', artifact: 'Error: harvest_id required', result: null };
      }
      const out = await runLegionCap('translation.critique', { harvest_id: hid }, opts);
      return {
        ok: out.status === 'ok',
        tool: 'critique',
        artifact: out.artifact_text,
        result: out.result || null,
        legion_run_id: out.legion_run_id || null,
      };
    },
  },

  self_diagnosis: {
    name: 'self_diagnosis',
    description:
      'Read-only self-diagnosis over campaign/corpus data: duplicate keeps by URL, notes-per-thread, reflection rejection histogram, or learning scorecard. Does not modify live data. Use when the operator asks to diagnose learning, find duplicates, or inspect trends.',
    input_schema: {
      kind: 'duplicate_keeps|notes_by_thread|reflection_rejections|scorecard|custom',
      focus: 'string',
      code: 'string',
    },
    async run(args = {}, opts = {}) {
      const { runSelfDiagnosis, formatDiagnosisArtifact } = require('./eiSelfDiagnosis');
      const report = await runSelfDiagnosis({
        kind: args.kind,
        focus: args.focus || opts.goal,
        goal: opts.goal,
        code: args.code,
      });
      return {
        ok: !!report.ok,
        tool: 'self_diagnosis',
        artifact: formatDiagnosisArtifact(report),
        result: report,
        mission_fit: null,
      };
    },
  },

  health: {
    name: 'health',
    description: 'Check Egyptian Insights spine health (DB, assets, vision, SearXNG seek).',
    input_schema: {},
    async run(_args = {}, opts = {}) {
      const out = await runLegionCap('health.check', {}, opts);
      let seekHealth = null;
      try {
        // Probe via a tiny Python one-liner on the harvest host is heavy; report env instead.
        seekHealth = {
          searxng_url: process.env.SEARXNG_URL || 'http://127.0.0.1:8080',
          serper_configured: !!(process.env.SERPER_API_KEY || process.env.SERPER_KEY),
        };
        const http = require('http');
        let base = String(seekHealth.searxng_url);
        while (base.endsWith('/')) base = base.slice(0, -1);
        seekHealth = await new Promise((resolve) => {
          const req = http.get(`${base}/search?q=test&format=json`, { timeout: 5000 }, (res) => {
            resolve({
              ...seekHealth,
              ok: res.statusCode >= 200 && res.statusCode < 500,
              status: res.statusCode,
            });
            res.resume();
          });
          req.on('error', (e) => resolve({ ...seekHealth, ok: false, error: String(e.message || e).slice(0, 120) }));
          req.on('timeout', () => { req.destroy(); resolve({ ...seekHealth, ok: false, error: 'timeout' }); });
        });
      } catch (e) {
        seekHealth = { ok: false, error: String(e.message || e).slice(0, 120) };
      }
      const art = [
        out.artifact_text,
        `Seek engine: SearXNG ${seekHealth.ok ? 'OK' : 'DOWN'} (${seekHealth.searxng_url || '?'})`
          + (seekHealth.serper_configured ? '; Serper configured' : '; Serper not configured'),
      ].filter(Boolean).join('\n');
      return {
        ok: out.status === 'ok',
        tool: 'health',
        artifact: art,
        result: { ...(out.result || {}), seek_health: seekHealth },
        legion_run_id: out.legion_run_id || null,
      };
    },
  },
};

function listTools() {
  return Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

function getTool(name) {
  return TOOLS[String(name || '').trim()] || null;
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

/**
 * Coerce planner-LLM args against tool.input_schema (partial schemas — extras kept).
 * @returns {{ args: object, warnings: string[] }}
 */
function validateToolArgs(tool, args) {
  const warnings = [];
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { args: {}, warnings: args == null ? [] : ['args coerced from non-object to {}'] };
  }
  const schema = (tool && tool.input_schema) || {};
  const out = { ...args };
  for (const key of Object.keys(schema)) {
    if (!(key in out)) continue;
    const spec = String(schema[key] || '');
    const v = out[key];
    if (schemaIsNumber(spec)) {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        delete out[key];
        warnings.push(`${key}: NaN deleted (was ${JSON.stringify(v)})`);
      } else if (typeof v !== 'number') {
        out[key] = n;
        warnings.push(`${key}: coerced to number ${n}`);
      }
      continue;
    }
    if (schemaIsBoolean(spec)) {
      if (typeof v === 'boolean') continue;
      const s = String(v).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') {
        out[key] = true;
        warnings.push(`${key}: coerced to boolean true`);
      } else if (s === 'false' || s === '0' || s === 'no') {
        out[key] = false;
        warnings.push(`${key}: coerced to boolean false`);
      } else {
        warnings.push(`${key}: expected boolean, kept ${JSON.stringify(v)}`);
      }
      continue;
    }
    // string or enum-ish (a|b|c)
    if (typeof v !== 'string') {
      out[key] = String(v);
      warnings.push(`${key}: coerced to string`);
    }
    if (spec.includes('|')) {
      const opts = spec.split('|').map((s) => s.trim()).filter(Boolean);
      if (opts.length && !opts.includes(String(out[key]))) {
        warnings.push(`${key}: value ${JSON.stringify(out[key])} not in [${opts.join('|')}]`);
      }
    }
  }
  return { args: out, warnings };
}

async function runTool(name, args, opts = {}) {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, tool: name, artifact: `Error: unknown tool '${name}'`, result: null };
  }
  let runArgs = args || {};
  let warnings = [];
  if (envFlagOn('PIKO_EI_TOOL_ARG_VALIDATE', true)) {
    const v = validateToolArgs(tool, args);
    runArgs = v.args;
    warnings = v.warnings;
    if (warnings.length) {
      console.log(`[eiAgentTools] arg coercion ${name}:`, warnings.join('; '));
    }
  }
  const result = await tool.run(runArgs, opts);
  if (warnings.length && result && typeof result === 'object') {
    result.arg_warnings = warnings;
  }
  return result;
}

module.exports = {
  TOOLS,
  listTools,
  getTool,
  runTool,
  validateToolArgs,
  buildHarvestInput,
  looksLikeLiteratureIntent,
  looksLikeImageIntent,
  looksLikeVolumeJob,
  wantsPdf,
  wantsPetrie,
  normalizeHarvestQuery,
  extractSeekCoverage,
  formatSeekCoverage,
  coverageVoiceSummary,
  seekFilesLimit,
  LIT_SOURCES,
  IMAGE_SOURCES,
  SEEK_FILE_SOURCES,
  // re-export helpers used by planner
  harvestAdapterPayload,
  buildAdapterInput,
};
