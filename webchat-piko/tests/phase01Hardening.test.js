/**
 * Phase 0 + Phase 1 hardening tests (2026-08-04 platform review).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ——— P0.3 channel allowlist fail-closed ———
test('P0.3: missing allowlist source denies non-webchat by default', () => {
  const { isAllowedByAllowlist } = require('../lib/channelAllowlist');
  return withEnv({ PIKO_CHANNEL_ALLOWLIST_OPEN: undefined }, () => {
    assert.equal(isAllowedByAllowlist({}, 'webchat', 'any'), true);
    assert.equal(isAllowedByAllowlist({}, 'discord', '123'), false);
    assert.equal(isAllowedByAllowlist({ discord: ['123'] }, 'discord', '123'), true);
    assert.equal(isAllowedByAllowlist({ discord: ['123'] }, 'discord', '999'), false);
    assert.equal(isAllowedByAllowlist({ discord: [] }, 'discord', '123'), false);
  });
});

test('P0.3: PIKO_CHANNEL_ALLOWLIST_OPEN=1 restores open channels', () => {
  const { isAllowedByAllowlist } = require('../lib/channelAllowlist');
  return withEnv({ PIKO_CHANNEL_ALLOWLIST_OPEN: '1' }, () => {
    assert.equal(isAllowedByAllowlist({}, 'discord', 'stranger'), true);
  });
});

// ——— P0.6 boot validation ———
test('P0.6: authoritative understand requires LEGATE + UNDERSTAND models', () => {
  const { validate } = require('../lib/config');
  return withEnv({
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
    PIKO_UNDERSTAND_MODEL: undefined,
    PIKO_LEGATE_MODEL: undefined,
  }, () => {
    assert.throws(() => validate(), /PIKO_UNDERSTAND_MODEL|PIKO_LEGATE_MODEL/);
  });
});

test('P0.6: authoritative with both models set passes', () => {
  const { validate } = require('../lib/config');
  return withEnv({
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
    PIKO_UNDERSTAND_MODEL: 'qwen3.6:27b',
    PIKO_LEGATE_MODEL: 'qwen3.6:27b',
  }, () => {
    assert.equal(validate(), true);
  });
});

test('P0.6: decideLegateTurn refuses when model unset (no 8B fallback)', async () => {
  const { decideLegateTurn } = require('../lib/legateChat');
  await withEnv({
    PIKO_LEGATE_MODEL: undefined,
    PIKO_UNDERSTAND_MODEL: undefined,
    OLLAMA_MODEL: 'llama3.1:8b',
  }, async () => {
    const out = await decideLegateTurn('Pause the campaign', { model: '' });
    assert.equal(out.source, 'fail_closed');
    assert.equal(out.reason, 'legate_model_unset');
    assert.match(out.reply || '', /PIKO_LEGATE_MODEL/);
  });
});

// ——— P1.1 thread matching ———
test('P1.1: table-driven matchThreadId word-boundary cases', () => {
  const { matchThreadId } = require('../lib/eiThreadDossiers');
  const cases = [
    ['atlantis', 'atlantis'],
    ['Atlantis origins', 'atlantis'],
    ['flood insurance', null],
    ['flood myths of Mesopotamia', 'flood-myths'],
    ['the great flood', 'flood-myths'],
    ['Osireion', 'abydos'],
    ['osireion origins', 'abydos'],
    ['Plato on justice', null],
    ['anden cuisine recipes', null],
    ['Tiahuanaco stones', 'tiahuanaco'],
    ['Giza precision', 'giza'],
    ['Seti temple at Abydos', 'abydos'],
  ];
  for (const [q, expect] of cases) {
    assert.equal(matchThreadId(q), expect, `matchThreadId(${JSON.stringify(q)})`);
  }
});

// ——— P1.2 planner alias resolution ———
test('P1.2: normalizePlan resolves osireion → abydos for thread_dossier', () => {
  const { normalizePlan } = require('../lib/eiWorkPlanner');
  // normalizePlan may not be exported — use plan path via require internals
  let normalize;
  try {
    normalize = require('../lib/eiWorkPlanner').normalizePlan;
  } catch (_) {
    normalize = null;
  }
  const { resolveThreadAlias } = require('../lib/eiThreadDossiers');
  assert.equal(resolveThreadAlias('osireion'), 'abydos');
  assert.equal(resolveThreadAlias('atlantis-moonbase'), null);
  const out = normalize({
    steps: [
      { tool: 'thread_dossier', args: { thread: 'osireion' }, why: 'load' },
      { tool: 'thread_dossier', args: { thread: 'atlantis-moonbase' }, why: 'invented' },
    ],
    summary: 'test',
  }, 'research Osireion');
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].args.thread, 'abydos');
  assert.ok((out.dropped_steps || []).some((d) => String(d).includes('unknown_thread')));
});

// ——— P1.3 opinion retrieval continuity ———
test('P1.3: opinionRetrievalQuery prefers current topic over history', () => {
  const { opinionRetrievalQuery } = require('../lib/legateChat');
  const q = opinionRetrievalQuery(
    'Have you come to any conclusions on the Osireion and its possible origins?',
    {
      lastAssistant: 'The Giza plateau shows remarkable precision engineering…',
      history: [
        { role: 'user', content: 'Tell me about the Great Pyramid' },
        { role: 'assistant', content: 'Giza precision and Bauval Orion correlation…' },
      ],
    },
  );
  assert.ok(q.toLowerCase().includes('osireion'));
  assert.ok(!q.toLowerCase().includes('giza'), `history must not pollute: ${q}`);
});

// ——— P1.4 named-work parsing ———
test('P1.4: conversational research asks are never singular titles', () => {
  const {
    parseNamedWork,
    extractResearchTopicPhrase,
  } = require('../lib/eiGoalParse');
  const phrases = [
    'Keep researching the Osireion',
    'Focus research on Abydos',
    'Find me something on the Sphinx erosion debate',
    'Yes please; prioritise research of the Osireion.',
    'Continue researching Göbekli Tepe',
    'More research on Tiahuanaco',
  ];
  for (const p of phrases) {
    const n = parseNamedWork(p);
    assert.equal(n.isSingularTitle, false, p);
    assert.equal(n.title, null, p);
    assert.ok(n.seekQuery && !n.seekQuery.toLowerCase().includes('yes please'), p);
  }
  assert.equal(extractResearchTopicPhrase('Keep researching the Osireion'), 'Osireion');
  assert.equal(extractResearchTopicPhrase('Focus research on Abydos'), 'Abydos');
});

test('P1.4: quoted / possessive / by-author remain singular titles', () => {
  const { parseNamedWork } = require('../lib/eiGoalParse');
  const poss = parseNamedWork("Please find Dunn's Lost Technologies of Ancient Egypt");
  assert.equal(poss.isSingularTitle, true);
  const by = parseNamedWork('Find Lost Technologies of Ancient Egypt by Christopher Dunn');
  assert.equal(by.isSingularTitle, true);
  const quoted = parseNamedWork('Please add "Serpent in the Sky" by John Anthony West');
  assert.equal(quoted.isSingularTitle, true);
});

// ——— P1.6 listNotes ordering ———
test('P1.6: listNotes returns newest by updated_at/mtime before slice', async () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-notes-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  for (const key of Object.keys(require.cache)) {
    if (key.includes('eiCorpusNotes') || key.includes('eiBibliography') || key.includes('culturesCorpusApi')) {
      delete require.cache[key];
    }
  }
  try {
    const notesDir = path.join(dir, 'corpus_notes');
    fs.mkdirSync(notesDir, { recursive: true });
    // Create 5 notes; oldest first on disk (readdir order often lexical).
    for (let i = 1; i <= 5; i += 1) {
      const f = path.join(notesDir, `item_${i}.json`);
      fs.writeFileSync(f, JSON.stringify({
        harvest_id: i,
        title: `Note ${i}`,
        updated_at: `2026-01-0${i}T00:00:00.000Z`,
      }));
    }
    const { listNotes } = require('../lib/eiCorpusNotes');
    const notes = listNotes(2);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].harvest_id, 5);
    assert.equal(notes[1].harvest_id, 4);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const key of Object.keys(require.cache)) {
      if (key.includes('eiCorpusNotes') || key.includes('eiBibliography') || key.includes('culturesCorpusApi')) {
        delete require.cache[key];
      }
    }
  }
});

// ——— P1.7 replan dedup + outcome taxonomy ———
test('P1.7: filterDuplicateReplanSteps drops identical research_campaign start', () => {
  const {
    filterDuplicateReplanSteps,
    stepFingerprint,
  } = require('../lib/eiWorkerRuntime');
  const prior = [
    { tool: 'seek_files', ok: false, input: { query: 'Osireion PDF' } },
    { tool: 'research_campaign', ok: true, input: { action: 'start', topic: 'Osireion' } },
  ];
  const extra = [
    { tool: 'research_campaign', args: { action: 'start', topic: 'Osireion' }, why: 'resume' },
    { tool: 'seek_files', args: { query: 'Osireion temple PDF' }, why: 'retry' },
  ];
  const { steps, skipped } = filterDuplicateReplanSteps(extra, prior);
  assert.equal(skipped.length, 1);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].tool, 'seek_files');
  assert.ok(stepFingerprint(extra[0]));
});

test('P1.7: classifySeekOutcome taxonomy', () => {
  const { classifySeekOutcome, outcomeReasonLine } = require('../lib/eiWorkerRuntime');
  assert.equal(classifySeekOutcome([
    {
      tool: 'seek_files',
      ok: true,
      mission_fit: { judgments: [{ verdict: 'keep', harvest_id: 1 }], counts: { keep: 1 } },
    },
  ]), 'partial_keep');
  assert.equal(classifySeekOutcome([
    {
      tool: 'seek_files',
      ok: false,
      error: 'Step failed: [ei-worker / research.scrape.run]',
      seek_coverage: { search_hits: 0, pdfs_probed_ok: 0, ingested_documents: 0 },
    },
  ]), 'search_error');
  assert.equal(classifySeekOutcome([
    {
      tool: 'seek_files',
      ok: true,
      seek_coverage: { search_hits: 0, pdfs_probed_ok: 0, ingested_documents: 0 },
    },
  ]), 'no_candidates');
  assert.equal(classifySeekOutcome([
    {
      tool: 'seek_files',
      ok: true,
      seek_coverage: { search_hits: 3, pdfs_probed_ok: 1, ingested_documents: 1 },
      mission_fit: { judgments: [{ verdict: 'drop' }], counts: { drop: 1, keep: 0 } },
    },
  ]), 'all_rejected');
  assert.match(outcomeReasonLine('all_rejected'), /rejected|quarantined/i);
  assert.match(outcomeReasonLine('search_error'), /error/i);
});
