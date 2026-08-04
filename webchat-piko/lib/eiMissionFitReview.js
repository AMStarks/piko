/**
 * Mission-fit literature judgment — Piko reads each piece and decides keep/drop/unsure
 * against the operator brief (authored_by vs about vs off-mission).
 *
 * For volume/PDF jobs: keep requires a local document; drops (and demoted keeps) are
 * quarantined (soft-delete) so the corpus is the accepted deliverable only — reversible.
 */
const { resolveReadableContent } = require('./eiCorpusContentReview');
const { getItem, quarantineHarvestItem } = require('./culturesCorpusApi');
const { setFlag, clearFlag } = require('./eiCorpusFlags');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const {
  parseNamedWork,
  titleMatchScore,
  authorMatch,
} = require('./eiGoalParse');
const { isSummaryMillUrl } = require('./eiSeekQueryPack');
const {
  includesAny,
  hasWord,
  startsWithIgnoreCase,
  keepLettersDigitsSpaces,
  toLowerAsciiish,
} = require('./text');

function getModel() {
  return (
    process.env.PIKO_EI_MISSION_FIT_MODEL
    || process.env.PIKO_EI_CONTENT_REVIEW_MODEL
    || process.env.EGYPTIAN_SCHOLAR_MODEL
    || process.env.PIKO_HEAVY_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

function missionFitEnabled() {
  const v = String(process.env.PIKO_EI_MISSION_FIT || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function purgeDropsEnabled(opts = {}) {
  if (opts.purgeDrops === false) return false;
  if (opts.purgeDrops === true) return true;
  const v = String(process.env.PIKO_EI_MISSION_FIT_PURGE || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/** P1.5: mission-fit "purge" now quarantines (reversible soft-delete). */
function purgeOrQuarantine(harvestId, judgment) {
  return quarantineHarvestItem(harvestId, {
    reason: String((judgment && judgment.why) || 'mission_fit_drop').slice(0, 280),
    sourceUrl: (judgment && (judgment.source_url || judgment.url)) || '',
  });
}

function requireLocalDocument(opts = {}) {
  if (opts.requireLocalDocument === false) return false;
  if (opts.requireLocalDocument === true) return true;
  const v = String(process.env.PIKO_EI_MISSION_FIT_REQUIRE_DOC || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function buildMissionPrompt(mission) {
  return `You are Piko judging one literature/document item against an operator mission.

OPERATOR MISSION:
${String(mission || '').trim().slice(0, 1200)}

Read the SOURCE MATERIAL carefully (title page, preface, first pages — not metadata alone).

Decide whether this item fulfills the mission:
- If the operator named a specific title/author/work, keep ONLY when this is that exact work (or a clear edition/reprint of the same title). Drop other books by the same author. Drop near-miss titles that share a theme or subtitle words. Drop summary pages, biographies ABOUT the author, and conference abstracts.
- If the operator asked for an author's works in general, keep items authored by them; drop secondary writing merely ABOUT them.
- Drop unrelated junk even if a keyword overlaps.

Verdict:
- keep: fits the mission
- drop: wrong work / about-not-by / unrelated / junk / unreadable
- unsure: cannot tell from available text

Return JSON only:
{"verdict":"keep"|"drop"|"unsure","relation":"authored_by"|"about"|"unrelated"|"unknown"|"title_match","author":"best guess or unknown","work_title":"short","confidence":0.0-1.0,"why":"one short sentence"}`;
}

function parseMissionJudgment(raw) {
  const parsed = extractJsonObject(raw) || {};
  let verdict = String(parsed.verdict || '').toLowerCase().trim();
  if (!['keep', 'drop', 'unsure'].includes(verdict)) {
    verdict = verdict === 'review' ? 'unsure' : 'unsure';
  }
  let relation = String(parsed.relation || 'unknown').toLowerCase().trim();
  if (!['authored_by', 'about', 'unrelated', 'unknown', 'title_match'].includes(relation)) relation = 'unknown';
  return {
    ok: true,
    verdict,
    relation,
    author: String(parsed.author || 'unknown').trim().slice(0, 120),
    work_title: String(parsed.work_title || '').trim().slice(0, 200),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    why: String(parsed.why || '').trim().slice(0, 280),
  };
}

/**
 * Judge one harvest item against the operator mission.
 */
async function judgeItemAgainstMission(item, mission, opts = {}) {
  if (!item || !item.id) {
    return { ok: false, verdict: 'unsure', why: 'missing item', relation: 'unknown' };
  }
  const content = await resolveReadableContent(item);
  if (content.kind === 'none') {
    return {
      ok: true,
      harvest_id: item.id,
      title: item.title || item.source_name || '',
      verdict: 'drop',
      relation: 'unknown',
      author: 'unknown',
      confidence: 0.9,
      why: 'No readable text/PDF to judge authorship',
      content_source: 'none',
    };
  }
  const material = content.kind === 'text'
    ? content.text
    : `Title: ${item.title || ''}\n(Image-only source; limited text available.)`;

  const charLimit = Number(opts.contentChars || process.env.PIKO_EI_MISSION_FIT_CHARS || 9000);
  const userLines = [
    `ITEM id=#${item.id}`,
    `Catalogue title: ${item.title || item.source_name || ''}`,
    `Connector: ${item.source || ''}`,
    `URL: ${item.source_url || ''}`,
    '',
    `SOURCE MATERIAL (${content.source || content.kind}):`,
    String(material).slice(0, charLimit),
  ];
  if (opts.secondLook) {
    userLines.push(
      '',
      'SECOND LOOK: this item was previously judged "unsure". Scan the text above for a byline, title page, copyright page, or repeated first-person authorship. Commit to keep or drop if the evidence supports it; only stay unsure if genuinely undecidable.',
    );
  }

  const model = opts.model || getModel();
  const raw = await ollamaNativeChat(model, [
    { role: 'system', content: buildMissionPrompt(mission) },
    { role: 'user', content: userLines.join('\n') },
  ], {
    format: 'json',
    temperature: 0,
    max_tokens: 220,
    num_ctx: Number(process.env.PIKO_EI_MISSION_FIT_NUM_CTX || 8192),
    timeoutMs: Math.max(8000, Number(process.env.PIKO_EI_MISSION_FIT_TIMEOUT_MS || 90000)),
    priority: 'background',
    lane: 'worker',
    tag: 'eiMissionFitReview',
  });

  const judged = parseMissionJudgment(raw);
  return {
    ...judged,
    harvest_id: item.id,
    title: item.title || item.source_name || '',
    content_source: content.source || content.kind,
    content_chars: content.chars || null,
  };
}

/**
 * Enforce job contract: keep without local document → drop.
 */
function enforceDeliverableContract(judgment, item, opts = {}) {
  const j = { ...(judgment || {}) };
  if (!requireLocalDocument(opts)) return j;
  if (j.verdict !== 'keep') return j;
  const hasLocal = !!(item && (item.has_local_document || item.local_document_path));
  if (hasLocal) return j;
  return {
    ...j,
    verdict: 'drop',
    relation: j.relation || 'unknown',
    demoted_from_keep: true,
    why: `Kept on content but no local document — ${j.why || 'rejected by deliverable contract'}`.slice(0, 280),
  };
}

/**
 * Provenance contract: PDFs from book-summary services are never the actual
 * work. Exempt only missions that explicitly ask for a summary.
 */
function enforceProvenanceContract(judgment, item, mission) {
  const j = { ...(judgment || {}) };
  if (j.verdict !== 'keep') return j;
  const missionLow = toLowerAsciiish(mission);
  if (hasWord(missionLow, 'summary') || hasWord(missionLow, 'summaries')) return j;
  const blob = [
    item && item.source_url,
    item && item.title,
    j.work_title,
    j.title,
  ].filter(Boolean).join(' ');
  if (!isSummaryMillUrl(blob)) return j;
  return {
    ...j,
    verdict: 'drop',
    demoted_from_keep: true,
    why: `Summary-service PDF (summary mill), not the actual work — ${j.why || 'rejected by provenance contract'}`.slice(0, 280),
  };
}

/**
 * Consistency contract: keep + relation "about" is self-contradictory for
 * find/add-works missions (the judge's own rubric says drop secondary writing).
 * Exempt missions that explicitly ask for secondary / biographical material.
 */
function missionWantsSecondary(mission) {
  const m = toLowerAsciiish(mission);
  if (m.includes('biograph') || m.includes('reception') || m.includes('historiograph')) return true;
  if (includesAny(m, [
    'secondary literature', 'secondary sources', 'secondary writing',
    'about him', 'about her', 'about the author', "about petrie's life", 'about petries life',
  ])) return true;
  return false;
}

function enforceRelationConsistency(judgment, mission) {
  const j = { ...(judgment || {}) };
  if (j.verdict !== 'keep' || j.relation !== 'about') return j;
  if (missionWantsSecondary(mission)) return j;
  return {
    ...j,
    verdict: 'drop',
    demoted_from_keep: true,
    why: `Keep contradicted its own relation=about (secondary writing, not the work) — ${j.why || 'demoted by consistency contract'}`.slice(0, 280),
  };
}

/**
 * Author contract: when the mission names an author (singular OR "works by X"),
 * a keep whose judged author is a DIFFERENT named person is demoted to drop.
 * On author-works asks, unknown/missing authors are demoted to unsure (not
 * keep) — we will not treat anonymous hits as deliverables for a named author.
 */
function enforceAuthorConsistency(judgment, named, mission) {
  const j = { ...(judgment || {}) };
  if (j.verdict !== 'keep') return j;
  const expected = named && named.author;
  if (!expected) return j;
  if (missionWantsSecondary(mission)) return j;
  const judgedAuthor = String(j.author || '').trim();
  const titleBlob = `${j.work_title || ''} ${j.title || ''}`;
  if (authorMatch(expected, judgedAuthor) || authorMatch(expected, titleBlob)) {
    return j;
  }
  // Singular named-author asks: unknown authorship cannot be a keep (Churchward→wrong book risk).
  if (!judgedAuthor || toLowerAsciiish(judgedAuthor) === 'unknown') {
    return {
      ...j,
      verdict: 'unsure',
      demoted_from_keep: true,
      why: `Author contract: mission names ${expected}, but authorship is unknown — ${j.why || 'needs byline'}`.slice(0, 280),
    };
  }
  return {
    ...j,
    verdict: 'drop',
    demoted_from_keep: true,
    why: `Author contract: judged author "${judgedAuthor}" is not ${expected} — ${j.why || 'demoted'}`.slice(0, 280),
  };
}

/**
 * Topic contract for author+topic asks ("Schoch articles dealing with Sphinx
 * erosion"): a keep whose title/why mentions none of the topic tokens is
 * demoted to unsure. Soft floor — OCR/metadata-poor real hits survive as
 * unsure for operator review rather than silent purge.
 */
function enforceTopicRelevance(judgment, named) {
  const j = { ...(judgment || {}) };
  if (j.verdict !== 'keep') return j;
  if (!named || !named.isAuthorWorks) return j;
  const topic = named.topic || [];
  if (!topic.length) return j;
  const blob = normalizeLoose(`${j.work_title || ''} ${j.title || ''} ${j.why || ''}`);
  const hits = topic.filter((t) => blob.includes(normalizeLoose(t)));
  if (hits.length > 0) return j;
  return {
    ...j,
    verdict: 'unsure',
    demoted_from_keep: true,
    why: `Topic contract: no mention of ${topic.slice(0, 3).join('/')} in title or rationale — ${j.why || 'off-topic?'}`.slice(0, 280),
  };
}

function normalizeLoose(s) {
  return keepLettersDigitsSpaces(toLowerAsciiish(s));
}

/**
 * Thin-content floor (plural / author-works asks only): a keep whose readable
 * text is a few hundred characters is a stub or preview, not a deliverable.
 * Demoted to unsure (not drop) so scanned/OCR-poor real documents are flagged
 * for review rather than silently purged.
 */
function enforceThinContentFloor(judgment, named) {
  const j = { ...(judgment || {}) };
  if (j.verdict !== 'keep') return j;
  if (named && named.isSingularTitle) return j; // strong title matches may be scans
  const floor = Number(process.env.PIKO_EI_MISSION_FIT_MIN_KEEP_CHARS || 1500);
  const chars = Number(j.content_chars);
  if (!Number.isFinite(chars) || chars <= 0 || chars >= floor) return j;
  return {
    ...j,
    verdict: 'unsure',
    demoted_from_keep: true,
    why: `Only ${chars} chars of readable text (< ${floor}) — likely a stub/preview, needs a real copy — ${j.why || ''}`.slice(0, 280),
  };
}

/**
 * Singular named-title: promote strong title matches the LLM dropped; annotate score.
 */
function applySingularTitleOverride(judgment, item, named, opts = {}) {
  if (!named || !named.isSingularTitle || !named.title) return judgment;
  const j = { ...(judgment || {}) };
  // Deterministic contract demotions (no doc / summary mill / relation) are a
  // floor; the promoter only overrules LLM misjudgments, never contracts.
  if (j.demoted_from_keep) return j;
  const candidate = [
    j.work_title,
    j.title,
    item && item.title,
    item && item.source_name,
  ].filter(Boolean).join(' ');
  if (j.verdict !== 'keep'
    && isSummaryMillUrl([item && item.source_url, candidate].filter(Boolean).join(' '))) {
    j.title_score = titleMatchScore(named.title, candidate);
    return j;
  }
  const score = titleMatchScore(named.title, candidate);
  j.title_score = score;
  const authOk = !named.author
    || authorMatch(named.author, j.author || '')
    || authorMatch(named.author, candidate);
  const hasLocal = !!(item && (item.has_local_document || item.local_document_path));
  const minPromote = Number(opts.minPromoteScore != null ? opts.minPromoteScore : 0.9);

  // WP2.6: never promote an LLM `drop` without an author match.
  if (j.verdict === 'drop' && !authOk) return j;

  // Strong edition match → keep even if the LLM called it unsure/about.
  if (j.verdict !== 'keep' && score >= minPromote && hasLocal && authOk) {
    return {
      ...j,
      verdict: 'keep',
      relation: 'title_match',
      author: (j.author && j.author !== 'unknown') ? j.author : (named.author || j.author),
      work_title: j.work_title || named.title,
      promoted_from_drop: j.verdict === 'drop' || !!j.promoted_from_drop,
      confidence: Math.max(Number(j.confidence) || 0, score),
      why: `Title match for «${named.title}» (score=${score.toFixed(2)}) — ${j.why || 'promoted'}`.slice(0, 280),
    };
  }
  return j;
}

/**
 * For singular named-title missions: drop title mismatches, keep at most maxKeeps (default 1).
 * Optionally purge demoted rows from the corpus.
 */
async function enforceNamedWorkKeeps(judgments, mission, opts = {}) {
  const named = opts.namedWork || parseNamedWork(mission);
  const maxKeeps = opts.maxKeeps != null
    ? Number(opts.maxKeeps)
    : (named.isSingularTitle ? 1 : null);
  if (!named.isSingularTitle && maxKeeps == null) {
    return { judgments, demoted: [], named };
  }

  const expectedTitle = named.title || '';
  const expectedAuthor = named.author || '';
  const minScore = Number(opts.minTitleScore != null ? opts.minTitleScore : 0.72);
  const out = [];
  const demoted = [];

  for (const j of judgments || []) {
    if (!j || j.verdict !== 'keep' || j.purged) {
      out.push(j);
      continue;
    }
    const candidate = `${j.work_title || ''} ${j.title || ''}`.trim();
    const score = expectedTitle ? titleMatchScore(expectedTitle, candidate) : 1;
    const authOk = !expectedAuthor || authorMatch(expectedAuthor, j.author || '');
    // Strong title match can pass without author; weak title needs author agreement.
    const passTitle = score >= minScore && (score >= 0.9 || authOk || !expectedAuthor);
    if (!passTitle) {
      const nj = {
        ...j,
        verdict: 'drop',
        demoted_from_keep: true,
        title_score: score,
        why: (
          `Named-work mismatch «${expectedTitle}»`
          + (expectedAuthor ? ` / ${expectedAuthor}` : '')
          + ` (score=${score.toFixed(2)}) — ${j.why || 'rejected'}`
        ).slice(0, 280),
      };
      demoted.push(nj);
      out.push(nj);
    } else {
      out.push({ ...j, title_score: score });
    }
  }

  const keepCap = Number.isFinite(maxKeeps) && maxKeeps > 0 ? maxKeeps : null;
  if (keepCap != null) {
    const keeps = out
      .filter((j) => j && j.verdict === 'keep' && !j.purged)
      .sort((a, b) => {
        const rank = (j) => {
          const blob = `${j.work_title || ''} ${j.title || ''}`.toLowerCase();
          const thin = includesAny(blob, ['bookey', 'summary of', 'cliffnotes', 'sparknotes']) ? -0.15 : 0;
          return (Number(j.title_score) || 0) + thin + (Number(j.confidence) || 0) * 0.01;
        };
        return rank(b) - rank(a);
      });
    const winners = new Set(keeps.slice(0, keepCap).map((j) => j.harvest_id));
    for (let i = 0; i < out.length; i += 1) {
      const j = out[i];
      if (!j || j.verdict !== 'keep' || j.purged) continue;
      if (winners.has(j.harvest_id)) continue;
      const nj = {
        ...j,
        verdict: 'drop',
        demoted_from_keep: true,
        why: (
          `Singular title ask — kept best match only (max=${keepCap}); `
          + `${j.why || 'extra edition dropped'}`
        ).slice(0, 280),
      };
      demoted.push(nj);
      out[i] = nj;
    }
  }

  const doPurge = purgeDropsEnabled(opts);
  if (doPurge || opts.applyFlags !== false) {
    for (const j of demoted) {
      if (!j || !j.harvest_id) continue;
      if (doPurge) {
        const del = purgeOrQuarantine(j.harvest_id, j);
        if (del.ok) {
          try { clearFlag(j.harvest_id); } catch (_) { /* ok */ }
          j.purged = true;
          j.quarantined = true;
        } else if (opts.applyFlags !== false) {
          await applyMissionFitFlag(j);
        }
      } else if (opts.applyFlags !== false) {
        await applyMissionFitFlag(j);
      }
    }
  }

  return { judgments: out, demoted, named };
}

/**
 * Same work fetched from two hosts → one keep. Compare titles with publisher
 * suffixes stripped ("Medum - The University of Chicago" vs "Medum"); volume
 * numbering survives normalization, so multi-part works are not collapsed.
 */
function dedupeTitleKey(judgment) {
  let t = String(judgment.work_title || judgment.title || '').trim();
  if (startsWithIgnoreCase(t, 'pdf ')) t = t.slice(4).trim();
  for (const sep of [' - ', ' – ', ' — ']) {
    const idx = t.indexOf(sep);
    if (idx >= 0) { t = t.slice(0, idx); break; }
  }
  const { normalizeTitle } = require('./eiGoalParse');
  return normalizeTitle(t);
}

async function dedupeKeepJudgments(judgments, opts = {}) {
  const byKey = new Map();
  const demoted = [];
  const out = [...(judgments || [])];

  for (let i = 0; i < out.length; i += 1) {
    const j = out[i];
    if (!j || j.verdict !== 'keep' || j.purged) continue;
    const key = dedupeTitleKey(j);
    if (!key || key.length < 4) continue;
    const prevIdx = byKey.get(key);
    if (prevIdx == null) {
      byKey.set(key, i);
      continue;
    }
    const rank = (x) => (Number(x.title_score) || 0) + (Number(x.confidence) || 0) * 0.01;
    const keepIdx = rank(out[prevIdx]) >= rank(j) ? prevIdx : i;
    const dropIdx = keepIdx === prevIdx ? i : prevIdx;
    const winner = out[keepIdx];
    const loser = {
      ...out[dropIdx],
      verdict: 'drop',
      demoted_from_keep: true,
      why: `Duplicate of kept #${winner.harvest_id} (${dedupeTitleKey(winner) || 'same work'})`.slice(0, 280),
    };
    out[dropIdx] = loser;
    demoted.push(loser);
    byKey.set(key, keepIdx);
  }

  const doPurge = purgeDropsEnabled(opts);
  for (const j of demoted) {
    if (!j || !j.harvest_id) continue;
    if (doPurge) {
      const del = purgeOrQuarantine(j.harvest_id, j);
      if (del.ok) {
        try { clearFlag(j.harvest_id); } catch (_) { /* ok */ }
        j.purged = true;
        j.quarantined = true;
      } else if (opts.applyFlags !== false) {
        await applyMissionFitFlag(j);
      }
    } else if (opts.applyFlags !== false) {
      await applyMissionFitFlag(j);
    }
  }

  return { judgments: out, demoted };
}

/**
 * Second look at unsure items when the mission names an author: re-judge with
 * a much larger text window and a byline-focused instruction. Genuine works
 * often land "unsure" only because the first sample missed the title page.
 */
async function secondLookUnsures(judgments, mission, opts = {}) {
  const named = opts.namedWork || parseNamedWork(mission);
  if (!named.author) return { judgments, changed: 0, examined: 0 };
  const max = Math.max(1, Number(process.env.PIKO_EI_MISSION_FIT_SECOND_LOOK_LIMIT || 6));
  const out = [...(judgments || [])];
  let changed = 0;
  let examined = 0;

  for (let i = 0; i < out.length && examined < max; i += 1) {
    const j = out[i];
    if (!j || j.verdict !== 'unsure' || j.purged || j.ok === false || !j.harvest_id) continue;
    const got = getItem(j.harvest_id);
    if (!got.ok || !got.item) continue;
    examined += 1;
    try {
      let nj = await judgeItemAgainstMission(got.item, mission, {
        ...opts,
        secondLook: true,
        contentChars: Number(process.env.PIKO_EI_MISSION_FIT_SECOND_LOOK_CHARS || 24000),
      });
      nj = enforceDeliverableContract(nj, got.item, opts);
      nj = enforceProvenanceContract(nj, got.item, mission);
      nj = enforceRelationConsistency(nj, mission);
      nj = enforceAuthorConsistency(nj, named, mission);
      nj = enforceTopicRelevance(nj, named);
      nj = enforceThinContentFloor(nj, named);
      nj = { ...nj, harvest_id: j.harvest_id, second_look: true };
      if (nj.verdict !== 'unsure') changed += 1;
      out[i] = nj;
    } catch (_) { /* keep original unsure on failure */ }
  }
  return { judgments: out, changed, examined };
}

function recountJudgments(judgments) {
  const counts = {
    keep: 0, drop: 0, unsure: 0, error: 0, purged: 0, demoted: 0,
  };
  for (const j of judgments || []) {
    if (!j) continue;
    if (j.ok === false && j.verdict === 'unsure') counts.error += 1;
    if (j.purged) counts.purged += 1;
    if (j.demoted_from_keep) counts.demoted += 1;
    if (j.verdict === 'keep') counts.keep += 1;
    else if (j.verdict === 'drop') counts.drop += 1;
    else counts.unsure += 1;
  }
  return counts;
}

/**
 * Apply mission-fit verdict as a corpus flag (keep/drop/review).
 */
async function applyMissionFitFlag(judgment) {
  if (!judgment || !judgment.harvest_id) return null;
  const flag = judgment.verdict === 'keep'
    ? 'keep'
    : judgment.verdict === 'drop'
      ? 'drop'
      : 'review';

  // Persist mission-fit author onto harvest meta for corpus lookups.
  if (judgment.verdict === 'keep' && judgment.author && toLowerAsciiish(judgment.author) !== 'unknown') {
    try {
      const { patchItemMeta, getItem } = require('./culturesCorpusApi');
      const { enrichMeta } = require('./corpusAuthorMeta');
      const got = getItem(judgment.harvest_id);
      const existing = (got && got.item && got.item.meta) || {};
      const enriched = enrichMeta(existing, judgment.work_title || judgment.title || (got && got.item && got.item.title) || '', {
        hint: judgment.author,
        force: false,
        from: 'mission_fit',
      });
      patchItemMeta(judgment.harvest_id, {
        ...enriched.meta,
        author: enriched.meta.author || judgment.author,
        work_author: judgment.author,
        mission_fit_relation: judgment.relation || null,
      });
    } catch (_) { /* non-fatal */ }
  }

  return setFlag(judgment.harvest_id, {
    flag,
    reason: `mission_fit:${judgment.relation || 'unknown'} — ${judgment.why || judgment.verdict}`,
    score: Math.round((judgment.confidence || 0) * 100),
    reasons: [
      `mission_fit:${judgment.verdict}`,
      `relation:${judgment.relation || 'unknown'}`,
      judgment.author ? `author:${judgment.author}` : null,
      judgment.content_source || null,
      judgment.demoted_from_keep ? 'demoted:no_local_document' : null,
    ].filter(Boolean),
    reviewer: 'ei-mission-fit',
  });
}

/**
 * Review a list of harvest ids against the mission.
 * opts.requireLocalDocument — keep must have local PDF/file (default on)
 * opts.purgeDrops — delete drop/unsure-without-doc from corpus (default on)
 */
async function reviewHarvestsForMission(harvestIds, mission, opts = {}) {
  if (!missionFitEnabled() && opts.force !== true) {
    return { ok: true, skipped: true, counts: {}, judgments: [], purged: [] };
  }
  const ids = [...new Set((harvestIds || [])
    .map((x) => (typeof x === 'object' ? Number(x.harvest_id || x.id) : Number(x)))
    .filter((n) => Number.isFinite(n) && n > 0))];

  const maxItems = Math.max(1, Math.min(
    ids.length,
    Number(opts.limit != null ? opts.limit : process.env.PIKO_EI_MISSION_FIT_LIMIT || 40),
  ));
  const slice = ids.slice(0, maxItems);
  let judgments = [];
  const purged = [];
  const counts = { keep: 0, drop: 0, unsure: 0, error: 0, purged: 0, demoted: 0 };

  const doPurge = purgeDropsEnabled(opts);
  const namedEarly = parseNamedWork(mission);

  for (const hid of slice) {
    try {
      const got = getItem(hid);
      if (!got.ok || !got.item) {
        judgments.push({
          harvest_id: hid,
          verdict: 'unsure',
          relation: 'unknown',
          why: 'item not found',
          ok: false,
        });
        counts.unsure += 1;
        continue;
      }
      let j = await judgeItemAgainstMission(got.item, mission, opts);
      j = enforceDeliverableContract(j, got.item, opts);
      j = enforceProvenanceContract(j, got.item, mission);
      j = enforceRelationConsistency(j, mission);
      j = enforceAuthorConsistency(j, namedEarly, mission);
      j = enforceTopicRelevance(j, namedEarly);
      j = enforceThinContentFloor(j, namedEarly);
      j = applySingularTitleOverride(j, got.item, namedEarly, opts);
      if (j.demoted_from_keep) counts.demoted += 1;

      // source_candidate / gap rows are never corpus deliverables
      if (got.item.kind === 'source_candidate' || String(got.item.title || '').startsWith('[gap]')) {
        j = {
          ...j,
          verdict: 'drop',
          why: j.why || 'Source candidate / gap — not a deliverable',
        };
      }

      const shouldPurge = doPurge && (
        j.verdict === 'drop'
        || (j.verdict === 'unsure' && requireLocalDocument(opts) && !(got.item.has_local_document || got.item.local_document_path))
      );

      if (shouldPurge) {
        const del = purgeOrQuarantine(hid, j);
        if (del.ok) {
          try { clearFlag(hid); } catch (_) { /* ok */ }
          counts.purged += 1;
          purged.push({
            harvest_id: hid,
            title: j.title || got.item.title,
            relation: j.relation,
            why: j.why,
            quarantined: true,
          });
          j = { ...j, purged: true, quarantined: true };
        } else if (opts.applyFlags !== false) {
          await applyMissionFitFlag(j);
        }
      } else if (opts.applyFlags !== false) {
        await applyMissionFitFlag(j);
      }

      judgments.push(j);
      const bucket = j.verdict === 'keep' ? 'keep' : j.verdict === 'drop' ? 'drop' : 'unsure';
      counts[bucket] = (counts[bucket] || 0) + 1;
    } catch (e) {
      counts.error += 1;
      judgments.push({
        harvest_id: hid,
        verdict: 'unsure',
        relation: 'unknown',
        why: String(e.message || e).slice(0, 160),
        ok: false,
      });
    }
  }

  const named = namedEarly;

  // Authored-works asks: unsure items get one deeper read before we settle.
  let secondLook = null;
  if (named.author && opts.secondLook !== false && counts.unsure > 0) {
    secondLook = await secondLookUnsures(judgments, mission, { ...opts, namedWork: named });
    if (secondLook.changed > 0) {
      judgments = secondLook.judgments;
      // New drops from the second look respect the purge policy.
      for (let i = 0; i < judgments.length; i += 1) {
        const j = judgments[i];
        if (!j || !j.second_look || j.purged) continue;
        if (j.verdict === 'drop' && doPurge) {
          const del = purgeOrQuarantine(j.harvest_id, j);
          if (del.ok) {
            try { clearFlag(j.harvest_id); } catch (_) { /* ok */ }
            judgments[i] = { ...j, purged: true, quarantined: true };
            purged.push({
              harvest_id: j.harvest_id,
              title: j.work_title || j.title,
              relation: j.relation,
              why: j.why,
              quarantined: true,
            });
            continue;
          }
        }
        if (opts.applyFlags !== false) await applyMissionFitFlag(j);
      }
      Object.assign(counts, recountJudgments(judgments));
    }
  }

  const maxKeeps = opts.maxKeeps != null
    ? Number(opts.maxKeeps)
    : (named.maxKeeps != null ? named.maxKeeps : null);
  if (named.isSingularTitle || maxKeeps != null) {
    const refined = await enforceNamedWorkKeeps(judgments, mission, {
      ...opts,
      namedWork: named,
      maxKeeps: maxKeeps != null ? maxKeeps : 1,
      purgeDrops: doPurge,
    });
    judgments = refined.judgments;
    for (const d of refined.demoted || []) {
      if (d && d.purged) purged.push({
        harvest_id: d.harvest_id,
        title: d.work_title || d.title,
        relation: d.relation,
        why: d.why,
      });
    }
    Object.assign(counts, recountJudgments(judgments));
  }

  const deduped = await dedupeKeepJudgments(judgments, { ...opts, purgeDrops: doPurge });
  if ((deduped.demoted || []).length) {
    judgments = deduped.judgments;
    for (const d of deduped.demoted) {
      if (d && d.purged) purged.push({
        harvest_id: d.harvest_id,
        title: d.work_title || d.title,
        relation: d.relation,
        why: d.why,
      });
    }
    Object.assign(counts, recountJudgments(judgments));
  }

  return {
    ok: true,
    mission: String(mission || '').slice(0, 500),
    named_work: named.isSingularTitle
      ? { title: named.title, author: named.author, max_keeps: maxKeeps || 1 }
      : (named.isAuthorWorks ? { author: named.author, author_works: true } : null),
    reviewed: judgments.length,
    counts,
    second_look: secondLook
      ? { examined: secondLook.examined, changed: secondLook.changed }
      : null,
    judgments,
    purged,
    pass: (counts.keep || 0) > 0,
  };
}

/**
 * Extract harvest ids from a seek/harvest tool result.
 */
function harvestIdsFromToolResult(result) {
  const r = result || {};
  const items = r.items || (r.report && r.report.items) || [];
  const ids = [];
  for (const it of items) {
    const id = Number(it.harvest_id || it.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}

function formatMissionFitReport(report) {
  if (!report || report.skipped) return 'Mission-fit review skipped.';
  const c = report.counts || {};
  const lines = [
    'Mission-fit review (read each piece; corpus = accepted deliverables only):',
    `  keep=${c.keep || 0} · drop=${c.drop || 0} · unsure=${c.unsure || 0}`
      + (c.demoted ? ` · demoted_no_doc=${c.demoted}` : '')
      + (c.purged ? ` · quarantined=${c.purged}` : '')
      + (c.error ? ` · error=${c.error}` : ''),
  ];
  if (report.second_look && report.second_look.examined) {
    lines.push(`  Second look: re-read ${report.second_look.examined} unsure item(s), resolved ${report.second_look.changed}.`);
  }
  const kept = (report.judgments || []).filter((j) => j.verdict === 'keep' && !j.purged).slice(0, 8);
  const dropped = (report.judgments || []).filter((j) => j.verdict === 'drop').slice(0, 6);
  const unsure = (report.judgments || []).filter((j) => j.verdict === 'unsure' && !j.purged).slice(0, 6);
  if (kept.length) {
    lines.push('  Kept (in corpus):');
    for (const j of kept) {
      lines.push(`    #${j.harvest_id} [${j.relation}] ${(j.work_title || j.title || '').slice(0, 70)} — ${j.author || '?'}`);
    }
  }
  if (unsure.length) {
    lines.push('  Unsure (flagged for operator review, not counted as delivered):');
    for (const j of unsure) {
      lines.push(`    #${j.harvest_id} [${j.relation}] ${(j.work_title || j.title || '').slice(0, 70)} — ${j.why || ''}`);
    }
  }
  if (dropped.length) {
    lines.push('  Rejected' + (c.purged ? ' (quarantined — restorable for 14 days)' : '') + ':');
    for (const j of dropped) {
      lines.push(`    #${j.harvest_id} [${j.relation}] ${(j.title || '').slice(0, 70)} — ${j.why || ''}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  missionFitEnabled,
  judgeItemAgainstMission,
  reviewHarvestsForMission,
  applyMissionFitFlag,
  enforceDeliverableContract,
  enforceProvenanceContract,
  applySingularTitleOverride,
  enforceNamedWorkKeeps,
  enforceRelationConsistency,
  enforceAuthorConsistency,
  enforceTopicRelevance,
  enforceThinContentFloor,
  secondLookUnsures,
  dedupeKeepJudgments,
  harvestIdsFromToolResult,
  formatMissionFitReport,
  buildMissionPrompt,
  parseMissionJudgment,
  requireLocalDocument,
  purgeDropsEnabled,
};
