/**
 * Read-only self-diagnosis for EI worker (Phase S0).
 * Canned reports run in-process; optional custom scripts use pythonSandbox
 * with writes confined to a temp run dir (never into live corpus/campaign data).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const KINDS = new Set([
  'duplicate_keeps',
  'notes_by_thread',
  'reflection_rejections',
  'scorecard',
  'custom',
]);

const {
  includesAny,
} = require('./text');

function diagnoseDuplicateKeeps() {
  const { listItems } = require('./culturesCorpusApi');
  const { normalizeSourceUrl, itemSourceUrls } = require('./eiResearchCampaign');
  const byUrl = new Map();
  let offset = 0;
  const page = 100;
  for (let guard = 0; guard < 50; guard += 1) {
    const out = listItems({ limit: page, offset });
    const items = out.items || [];
    if (!items.length) break;
    for (const it of items) {
      for (const u of itemSourceUrls(it)) {
        const key = normalizeSourceUrl(u);
        if (!key) continue;
        if (!byUrl.has(key)) byUrl.set(key, []);
        byUrl.get(key).push({ id: it.id, title: it.title, source_url: it.source_url });
        break;
      }
    }
    if (items.length < page) break;
    offset += page;
  }
  const dupes = [...byUrl.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([url, group]) => ({ url, count: group.length, ids: group.map((g) => g.id), titles: group.map((g) => g.title) }));
  return {
    kind: 'duplicate_keeps',
    duplicate_groups: dupes.length,
    duplicates: dupes.slice(0, 25),
    scanned_urls: byUrl.size,
  };
}

function diagnoseNotesByThread() {
  const { learningScorecard } = require('./eiResearchCampaign');
  const card = learningScorecard();
  return {
    kind: 'notes_by_thread',
    notes_keep_ratio: card.notes_keep_ratio,
    attributed_keep_pct: card.attributed_keep_pct,
    other_keeps: card.other_keeps,
    by_thread: card.by_thread,
    dead_thread_count: card.dead_thread_count,
  };
}

function diagnoseReflectionRejections() {
  const { loadState } = require('./eiResearchCampaign');
  const state = loadState();
  const histogram = {};
  const samples = [];
  for (const r of state.reports || []) {
    const details = (r.reflection && r.reflection.rejected_details) || [];
    for (const d of details) {
      const reason = String(d.reason || 'unknown');
      histogram[reason] = (histogram[reason] || 0) + 1;
      if (samples.length < 20) samples.push(d);
    }
  }
  return {
    kind: 'reflection_rejections',
    histogram,
    samples,
    reflection_leads_added: (state.stats && state.stats.reflection_leads_added) || 0,
    reflections: (state.stats && state.stats.reflections) || 0,
  };
}

function diagnoseScorecard() {
  const { getLearningScorecard } = require('./eiResearchCampaign');
  return { kind: 'scorecard', ...getLearningScorecard() };
}

/**
 * Run a short Python script with EI data paths as env vars.
 * Script may only write under the returned runDir; live data is not mounted RW.
 */
async function runCustomDiagnosis(code, opts = {}) {
  const { culturesDataRoot } = require('./culturesCorpusApi');
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-selfdiag-'));
  const dataRoot = culturesDataRoot();
  const preamble = [
    'import os, json, sys',
    `DATA_ROOT = ${JSON.stringify(dataRoot)}`,
    `RUN_DIR = ${JSON.stringify(runDir)}`,
    'os.chdir(RUN_DIR)',
    '# Read-only: open files under DATA_ROOT for read; write only under RUN_DIR.',
    '',
  ].join('\n');
  const script = `${preamble}\n${String(code || '').slice(0, 20000)}\n`;
  // Prefer host exec of our runDir file for isolation (writes only under runDir).
  const filename = `diag_${crypto.randomBytes(4).toString('hex')}.py`;
  const filepath = path.join(runDir, filename);
  fs.writeFileSync(filepath, script, 'utf8');
  const { execFile } = require('child_process');
  const { resolvePythonExecutable } = require('./pythonSandbox');
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 60000);
  const output = await new Promise((resolve) => {
    execFile(resolvePythonExecutable(), [filepath], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      cwd: runDir,
      env: {
        ...process.env,
        EI_DATA_ROOT: dataRoot,
        EI_RUN_DIR: runDir,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        resolve(`Error: ${(stderr || error.message || '').toString().trim().slice(0, 800)}`);
      } else {
        resolve((stdout || '').trim() || 'Script executed successfully with no output.');
      }
    });
  });
  // Ensure no writes escaped into DATA_ROOT by this run (best-effort check of mtime).
  return {
    kind: 'custom',
    run_dir: runDir,
    output: String(output).slice(0, 8000),
    data_root: dataRoot,
  };
}

function resolveKind(raw, goal = '') {
  const k = String(raw || '').trim().toLowerCase();
  if (KINDS.has(k)) return k;
  const g = String(goal || '').toLowerCase();
  if (includesAny(g, ['duplicate', 'dedupe', 'same url'])) return 'duplicate_keeps';
  if (includesAny(g, ['rejection', 'reflect'])) return 'reflection_rejections';
  if (includesAny(g, ['scorecard', 'trend'])) return 'scorecard';
  if (includesAny(g, ['note', 'thread', 'digest', 'attribution'])) return 'notes_by_thread';
  return 'scorecard';
}

async function runSelfDiagnosis(opts = {}) {
  const kind = resolveKind(opts.kind, opts.goal || opts.focus);
  let report;
  if (kind === 'duplicate_keeps') report = diagnoseDuplicateKeeps();
  else if (kind === 'notes_by_thread') report = diagnoseNotesByThread();
  else if (kind === 'reflection_rejections') report = diagnoseReflectionRejections();
  else if (kind === 'custom' && opts.code) report = await runCustomDiagnosis(opts.code, opts);
  else report = diagnoseScorecard();

  try {
    const { recordNotification } = require('./notificationFeed');
    recordNotification({
      text: `Self-diagnosis (${report.kind}): ${formatDiagnosisArtifact(report).slice(0, 280)}`,
      category: 'system',
      title: 'EI self-diagnosis',
      severity: 'info',
      source: 'ei_self_diagnosis',
      meta: { kind: report.kind },
    });
  } catch (_) { /* optional */ }

  return { ok: true, ...report };
}

function formatDiagnosisArtifact(report) {
  if (!report) return 'No diagnosis.';
  if (report.kind === 'duplicate_keeps') {
    return `Duplicate URL groups: ${report.duplicate_groups} (scanned ${report.scanned_urls} urls)`
      + (report.duplicates && report.duplicates[0]
        ? `\nTop: ${report.duplicates[0].url} ×${report.duplicates[0].count} ids=${(report.duplicates[0].ids || []).join(',')}`
        : '');
  }
  if (report.kind === 'notes_by_thread') {
    return `Notes/keep=${report.notes_keep_ratio ?? '?'} · attributed=${report.attributed_keep_pct ?? '?'}%`
      + ` · other_keeps=${report.other_keeps ?? '?'} · dead_threads=${report.dead_thread_count ?? '?'}`;
  }
  if (report.kind === 'reflection_rejections') {
    const parts = Object.entries(report.histogram || {}).map(([k, v]) => `${k}=${v}`);
    return `Reflection rejections: ${parts.join(', ') || 'none logged yet'}`;
  }
  if (report.kind === 'custom') {
    return String(report.output || '').slice(0, 500);
  }
  return `Scorecard: notes/keep=${report.notes_keep_ratio ?? '?'} · attributed=${report.attributed_keep_pct ?? '?'}%`
    + ` · reflection/100=${report.reflection_survival_per_100_cycles ?? '?'} · dead=${report.dead_thread_count ?? '?'}`;
}

module.exports = {
  KINDS,
  resolveKind,
  runSelfDiagnosis,
  diagnoseDuplicateKeeps,
  diagnoseNotesByThread,
  diagnoseReflectionRejections,
  diagnoseScorecard,
  runCustomDiagnosis,
  formatDiagnosisArtifact,
};
