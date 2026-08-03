/**
 * Egyptian Insights platform evaluation harness (Tiers A–B).
 * Smoke + golden literature harvest rubric per site; writes structured reports.
 */
const fs = require('fs');
const path = require('path');
const { loadResearchGoal, harvestAdapterPayload } = require('./eiResearchGoal');
const { extractQuality } = require('./agentReview');
const { listAgents } = require('./agentRegistry');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
const { recordNotification } = require('./notificationFeed');
const { enqueueFixTasksFromEval } = require('./eiEngineeringQueue');
const {
  toLowerAsciiish,
  includesAny,
  extractDigitRuns,
  isAsciiLetter,
  isAsciiDigit,
} = require('./text');

const REQUIRED_AGENTS = [
  'ei-qa',
  'ei-text-scout',
  'ei-health',
  'ei-corpus',
  'ei-harvester',
  'ei-scribe',
  'ei-scholar',
  'ei-pipeline',
  'culture-researcher',
];

const IRRELEVANT_TERMS = [
  'cia reading room',
  'central intelligence',
  'cold war',
  'modern egypt tourism',
];

/** Literature-only golden rubric — bounded eval harvest (limit 5). */
const SITE_LITERATURE_RUBRIC = {
  abydos: { minSubstantive: 2, minDocs: 1, minMaxChars: 8000 },
  heliopolis: { minSubstantive: 2, minDocs: 1, minMaxChars: 3000 },
  giza: { minSubstantive: 2, minDocs: 1, minMaxChars: 3000 },
};

function evalDataDir(rootDir) {
  const base = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  return path.join(base, 'ei-eval');
}

function reportsDir(rootDir) {
  const d = path.join(evalDataDir(rootDir), 'reports');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function newReportId() {
  // ISO → YYYYMMDDTHHMMSS without regex (strip - : and fractional seconds)
  const iso = new Date().toISOString();
  let ts = '';
  for (let i = 0; i < iso.length && ts.length < 15; i++) {
    const ch = iso[i];
    if (ch === '.' || ch === 'Z') break;
    if (ch === '-' || ch === ':') continue;
    ts += ch;
  }
  return `eval_${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseEvalBrief(brief) {
  const raw = String(brief || '').trim();
  const out = {
    smoke: true,
    harvest: true,
    sites: null,
    limit: 5,
    enqueue_fixes: true,
    notify: false,
  };
  if (!raw) return out;
  if (raw.startsWith('{')) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (p.smoke != null) out.smoke = !!p.smoke;
        if (p.harvest != null) out.harvest = !!p.harvest;
        if (Array.isArray(p.sites)) out.sites = p.sites.map((s) => String(s).toLowerCase());
        if (p.limit != null) out.limit = Math.max(1, Math.min(12, Number(p.limit) || 5));
        if (p.enqueue_fixes != null) out.enqueue_fixes = !!p.enqueue_fixes;
        if (p.notify != null) out.notify = !!p.notify;
      }
    } catch (_) { /* ignore */ }
    return out;
  }
  const lower = toLowerAsciiish(raw);
  if (includesAny(lower, ['smoke only'])) out.harvest = false;
  if (includesAny(lower, ['harvest only', 'no smoke'])) out.smoke = false;
  if (includesAny(lower, ['no fix', 'no fixes'])) out.enqueue_fixes = false;
  const limIdx = lower.indexOf('limit');
  if (limIdx >= 0) {
    const after = raw.slice(limIdx + 5);
    let i = 0;
    while (i < after.length && (after[i] === ' ' || after[i] === ':' || after[i] === '=')) i += 1;
    const runs = extractDigitRuns(after.slice(i, i + 4));
    if (runs.length && runs[0].index === 0 && runs[0].text.length <= 2) {
      out.limit = Math.max(1, Math.min(12, runs[0].value));
    }
  }
  return out;
}

function hasIrrelevantContent(text) {
  const t = String(text || '').toLowerCase();
  return IRRELEVANT_TERMS.some((term) => t.includes(term));
}

function scoreSiteHarvest(siteId, run) {
  const rubric = SITE_LITERATURE_RUBRIC[siteId] || SITE_LITERATURE_RUBRIC.giza;
  const artifact = String(run?.artifact_text || '');
  const quality = extractQuality(artifact, run?.result || null);
  const reasons = [];
  let pass = true;

  if (run?.status === 'failed') {
    pass = false;
    reasons.push('harvest_failed');
  }
  if (run?.review?.verdict === 'revise' || run?.review?.verdict === 'escalate') {
    pass = false;
    reasons.push(`review_${run.review.verdict}`);
  }
  if (quality.substantive != null && quality.substantive < rubric.minSubstantive) {
    pass = false;
    reasons.push(`substantive_${quality.substantive}_lt_${rubric.minSubstantive}`);
  }
  if (quality.docs != null && quality.docs < rubric.minDocs) {
    pass = false;
    reasons.push(`docs_${quality.docs}_lt_${rubric.minDocs}`);
  }
  if (quality.maxChars != null && quality.maxChars < rubric.minMaxChars) {
    pass = false;
    reasons.push(`max_chars_${quality.maxChars}_lt_${rubric.minMaxChars}`);
  }
  if (hasIrrelevantContent(artifact)) {
    pass = false;
    reasons.push('irrelevant_hit');
  }

  return {
    site_id: siteId,
    pass,
    reasons,
    rubric,
    quality,
    review_verdict: run?.review?.verdict || null,
    run_id: run?.id || null,
    status: run?.status || 'unknown',
  };
}

async function runSmokeChecks(rootDir) {
  const checks = [];
  const agents = listAgents(rootDir);
  const ids = new Set(agents.map((a) => a.id));
  const missing = REQUIRED_AGENTS.filter((id) => !ids.has(id));
  checks.push({
    id: 'registry_agents',
    pass: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(', ')}` : `agents=${agents.length}`,
    missing,
  });

  if (!ids.has('ei-health')) {
    checks.push({
      id: 'spine_health',
      pass: false,
      detail: 'ei-health agent unavailable',
    });
    return checks;
  }

  const { runAgent } = require('./agentOrchestrator');
  const health = await runAgent('ei-health', 'platform eval spine health', { rootDir });
  const ok = !!(health.ok && health.run && health.run.status === 'ok');
  checks.push({
    id: 'spine_health',
    pass: ok,
    detail: ok ? 'ei-health ok' : String(health.reply || health.run?.status || 'failed').slice(0, 200),
    run_id: health.run?.id || null,
  });

  return checks;
}

async function runSiteHarvestEval(site, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const limit = opts.limit != null ? opts.limit : 5;
  const payload = harvestAdapterPayload(site, {
    literature_only: true,
    sources: ['archive_org', 'topbib', 'tla'],
    limit,
    require_image: false,
  });
  payload.skip_thin = true;
  payload.note = `EI platform eval — literature golden harvest for ${site.id}`;

  const { runAgent } = require('./agentOrchestrator');
  const out = await runAgent('ei-harvester', JSON.stringify(payload), { rootDir });
  const scored = scoreSiteHarvest(site.id, out.run || { status: 'failed', artifact_text: out.reply });
  return {
    site_id: site.id,
    site_label: site.label,
    harvest_ok: !!out.ok,
    run: out.run || null,
    score: scored,
  };
}

function writeReport(report, rootDir) {
  const dir = reportsDir(rootDir);
  const id = report.id || newReportId();
  const row = {
    ...report,
    id,
    updated_at: new Date().toISOString(),
  };
  if (!row.created_at) row.created_at = row.updated_at;
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row;
}

function readLatestReport(rootDir) {
  const p = path.join(reportsDir(rootDir), 'latest.json');
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readReport(reportId, rootDir) {
  const id = String(reportId || '').trim();
  if (!id || id.includes('..')) return null;
  const p = path.join(reportsDir(rootDir), `${id}.json`);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listReports(rootDir, limit = 20) {
  const dir = reportsDir(rootDir);
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'latest.json')
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, n);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const { f } of files) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (_) { /* skip */ }
  }
  return out;
}

function summarizeReport(report) {
  const smokePass = (report.smoke || []).every((c) => c.pass);
  const harvestPass = (report.harvests || []).every((h) => h.score && h.score.pass);
  const pass = report.pass != null ? report.pass : (smokePass && harvestPass);
  const failedSites = (report.harvests || [])
    .filter((h) => !h.score?.pass)
    .map((h) => h.site_id);
  const failedChecks = (report.smoke || [])
    .filter((c) => !c.pass)
    .map((c) => c.id);
  return {
    pass,
    smoke_pass: smokePass,
    harvest_pass: harvestPass,
    failed_sites: failedSites,
    failed_checks: failedChecks,
    summary: pass
      ? 'Platform eval PASS'
      : `Platform eval FAIL — checks: ${failedChecks.join(', ') || 'ok'}; sites: ${failedSites.join(', ') || 'ok'}`,
  };
}

const CHECK_LABELS = {
  spine_health: 'core services',
  registry_agents: 'the research agents',
};

function titleCase(id) {
  const str = String(id || '');
  let spaced = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '-' || ch === '_') {
      if (spaced.length && spaced[spaced.length - 1] !== ' ') spaced += ' ';
    } else {
      spaced += ch;
    }
  }
  let out = '';
  let capNext = true;
  for (let i = 0; i < spaced.length; i++) {
    const ch = spaced[i];
    if (ch === ' ') {
      out += ch;
      capNext = true;
    } else if (capNext && (isAsciiLetter(ch) || isAsciiDigit(ch))) {
      out += ch.toUpperCase();
      capNext = false;
    } else {
      out += ch;
      if (isAsciiLetter(ch) || isAsciiDigit(ch)) capNext = false;
    }
  }
  return out;
}

/** Turn the technical rollup into a sentence a client can act on. */
function humanEvalSummary(rollup, opts = {}) {
  if (rollup.pass) return 'Overnight health check passed — everything is running normally.';
  const parts = [];
  if (rollup.failed_checks.length) {
    const labels = rollup.failed_checks.map((id) => CHECK_LABELS[id] || titleCase(id));
    parts.push(`a problem with ${labels.join(' and ')}`);
  }
  if (rollup.failed_sites.length) {
    parts.push(`${rollup.failed_sites.length} research source${rollup.failed_sites.length === 1 ? '' : 's'} not collecting properly (${rollup.failed_sites.map(titleCase).join(', ')})`);
  }
  const tail = opts.fixesQueued
    ? 'Piko has queued the fixes — no action needed unless this repeats tomorrow.'
    : 'Piko will keep an eye on it — no action needed unless this repeats tomorrow.';
  return `Overnight health check found ${parts.join(' and ') || 'an issue'}. ${tail}`;
}

/**
 * Full platform evaluation — invoked by ei-qa agent, cron, or API.
 */
async function runPlatformEval(opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const profile = getTenantBackgroundProfile(rootDir);
  const briefOpts = parseEvalBrief(opts.brief);
  const config = {
    smoke: opts.smoke != null ? !!opts.smoke : briefOpts.smoke,
    harvest: opts.harvest != null ? !!opts.harvest : briefOpts.harvest,
    limit: opts.limit != null ? opts.limit : briefOpts.limit,
    enqueue_fixes: opts.enqueue_fixes != null ? !!opts.enqueue_fixes : briefOpts.enqueue_fixes,
    notify: opts.notify != null ? !!opts.notify : briefOpts.notify,
    sites: opts.sites || briefOpts.sites,
  };

  const started = Date.now();
  const report = {
    id: newReportId(),
    tenant_id: profile.tenant_id,
    profile: profile.profileId,
    source: opts.source || 'manual',
    config,
    smoke: [],
    harvests: [],
    engineering_tasks: [],
    created_at: new Date().toISOString(),
  };

  if (config.smoke) {
    report.smoke = await runSmokeChecks(rootDir);
  }

  if (config.harvest) {
    const goal = loadResearchGoal();
    let sites = goal.sites || [];
    if (config.sites && config.sites.length) {
      sites = sites.filter((s) => config.sites.includes(s.id));
    }
    for (const site of sites.slice(0, 3)) {
      // eslint-disable-next-line no-await-in-loop
      const row = await runSiteHarvestEval(site, { rootDir, limit: config.limit });
      report.harvests.push(row);
    }
  }

  const rollup = summarizeReport(report);
  report.pass = rollup.pass;
  report.summary = rollup.summary;
  report.duration_ms = Date.now() - started;

  const saved = writeReport(report, rootDir);

  if (!rollup.pass && config.enqueue_fixes) {
    const tasks = enqueueFixTasksFromEval(saved, { rootDir });
    saved.engineering_tasks = tasks;
    writeReport(saved, rootDir);
  }

  if (config.notify || opts.notifyTelegram) {
    const sev = rollup.pass ? 'info' : 'warn';
    // Client-facing wording; the technical rollup stays in meta + the report file.
    const human = humanEvalSummary(rollup, {
      fixesQueued: !!(saved.engineering_tasks && saved.engineering_tasks.length),
    });
    recordNotification({
      text: human,
      category: 'legion',
      title: rollup.pass ? 'Overnight health check' : 'Health check needs attention',
      severity: sev,
      source: 'ei_platform_eval',
      meta: {
        report_id: saved.id,
        pass: rollup.pass,
        summary: rollup.summary,
        failed_checks: rollup.failed_checks,
        failed_sites: rollup.failed_sites,
      },
    });
    if (opts.notifyTelegram !== false && process.env.PIKO_EI_EVAL_SKIP_TELEGRAM !== '1') {
      try {
        const { sendTelegramMessage } = require('./legionScheduleExecution');
        await sendTelegramMessage(`${rollup.pass ? '✅' : '⚠️'} ${human}`);
      } catch (_) { /* optional */ }
    }
  }

  const artifactLines = [
    '[ei-qa / ei.platform.eval]',
    rollup.summary,
    `Report: ${saved.id}`,
    `Duration: ${saved.duration_ms}ms`,
    '',
    'Smoke:',
    ...(saved.smoke || []).map((c) => `  ${c.pass ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`),
    '',
    'Harvest rubric:',
    ...(saved.harvests || []).map((h) => {
      const s = h.score || {};
      return `  ${s.pass ? 'PASS' : 'FAIL'} ${h.site_id} — substantive=${s.quality?.substantive ?? '?'} docs=${s.quality?.docs ?? '?'} max_chars=${s.quality?.maxChars ?? '?'}${s.reasons?.length ? ` (${s.reasons.join(', ')})` : ''}`;
    }),
  ];
  if (saved.engineering_tasks?.length) {
    artifactLines.push('', `Engineering tasks queued: ${saved.engineering_tasks.length}`);
  }

  return {
    status: rollup.pass ? 'ok' : 'needs_revision',
    artifact_text: artifactLines.join('\n'),
    result: saved,
    pass: rollup.pass,
    report: saved,
  };
}

module.exports = {
  SITE_LITERATURE_RUBRIC,
  REQUIRED_AGENTS,
  parseEvalBrief,
  scoreSiteHarvest,
  runSmokeChecks,
  runSiteHarvestEval,
  runPlatformEval,
  writeReport,
  readLatestReport,
  readReport,
  listReports,
  summarizeReport,
  evalDataDir,
};
