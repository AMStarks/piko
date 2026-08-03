/**
 * Seeded source snowball:
 * operator list → ingest → extract bibliographies → seek → iterate (capped).
 * WP8: no regex.
 */
const { parseNamedWork } = require('./eiGoalParse');
const {
  collapseWhitespace,
  toLowerAsciiish,
  includesAny,
  startsWithIgnoreCase,
  startsWithAny,
  stripTrailingPunct,
  splitLines,
  isAsciiDigit,
  isAsciiLetter,
  replaceAllLiteral,
} = require('./text');

function extractHttpUrls(s) {
  const str = String(s || '');
  const lower = toLowerAsciiish(str);
  const urls = [];
  let from = 0;
  while (from < str.length) {
    let idx = lower.indexOf('https://', from);
    let schemeLen = 8;
    if (idx < 0) {
      idx = lower.indexOf('http://', from);
      schemeLen = 7;
    }
    if (idx < 0) break;
    let end = idx + schemeLen;
    while (end < str.length) {
      const ch = str[end];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
        || ch === '<' || ch === '>' || ch === '"' || ch === "'"
        || ch === ')' || ch === ']') break;
      end += 1;
    }
    urls.push(stripTrailingPunct(str.slice(idx, end)));
    from = idx + schemeLen;
  }
  return urls;
}

/**
 * Search query for one work: quoted title + primary author surname.
 */
function buildSeedQuery(title, author) {
  let t = String(title || '');
  for (const q of ['"', '\u201c', '\u201d']) t = replaceAllLiteral(t, q, '');
  t = t.trim();
  const authorStr = String(author || '');
  let firstAuthor = authorStr;
  const andIdx = toLowerAsciiish(authorStr).indexOf(' and ');
  if (andIdx >= 0) firstAuthor = authorStr.slice(0, andIdx);
  else {
    const comma = authorStr.indexOf(',');
    if (comma >= 0) firstAuthor = authorStr.slice(0, comma);
  }
  firstAuthor = firstAuthor.trim();
  const parts = collapseWhitespace(firstAuthor).split(' ').filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : '';
  const quoted = t.includes(' ') ? `"${t}"` : t;
  return [quoted, surname, 'PDF'].filter(Boolean).join(' ').slice(0, 200);
}

function stripListPrefix(line) {
  let s = String(line || '').trim();
  if (startsWithIgnoreCase(s, 'SEED_URL:')) {
    s = s.slice('SEED_URL:'.length).trim();
  }
  // bullets
  if (s.startsWith('-') || s.startsWith('*') || s.startsWith('•')) {
    s = s.slice(1).trim();
  }
  // numbered "1. " / "12) "
  let i = 0;
  while (i < s.length && isAsciiDigit(s[i])) i += 1;
  if (i > 0 && i < s.length && (s[i] === '.' || s[i] === ')') && s[i + 1] === ' ') {
    s = s.slice(i + 2).trim();
  }
  return s;
}

function splitSemicolons(line) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ';') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      // skip following spaces
      while (i + 1 < line.length && line[i + 1] === ' ') i += 1;
      continue;
    }
    cur += line[i];
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function hasQuotedTitle(s) {
  const str = String(s || '');
  let open = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      if (open < 0) open = i;
      else if (i - open >= 7) return true;
      else open = -1;
    }
  }
  return false;
}

function hasPossessive(s) {
  return String(s || '').includes("'s ") || String(s || '').includes('\u2019s ');
}

function splitAuthorTitleDash(cleaned) {
  for (const dash of ['—', '–']) {
    const idx = cleaned.indexOf(dash);
    if (idx >= 3 && idx <= 80) {
      const author = collapseWhitespace(cleaned.slice(0, idx));
      const titlePart = collapseWhitespace(cleaned.slice(idx + dash.length));
      if (author.length >= 3 && titlePart.length >= 3) return { author, titlePart };
    }
  }
  // " - " or " -- "
  for (const sep of [' -- ', ' - ']) {
    const idx = cleaned.indexOf(sep);
    if (idx >= 3 && idx <= 80) {
      const author = collapseWhitespace(cleaned.slice(0, idx));
      const titlePart = collapseWhitespace(cleaned.slice(idx + sep.length));
      if (author.length >= 3 && titlePart.length >= 3) return { author, titlePart };
    }
  }
  return null;
}

function splitTitlesOnAndThe(titlePart) {
  const parts = [];
  const low = toLowerAsciiish(titlePart);
  let from = 0;
  let searchFrom = 0;
  while (searchFrom < low.length) {
    const idx = low.indexOf(' and ', searchFrom);
    if (idx < 0) break;
    const after = titlePart.slice(idx + 5);
    const afterTrim = after.trimStart();
    if (
      startsWithAny(afterTrim, ['The ', 'A ', 'An '])
      && afterTrim[0] >= 'A' && afterTrim[0] <= 'Z'
    ) {
      const left = titlePart.slice(from, idx).trim();
      if (left) parts.push(left);
      from = idx + 5;
      searchFrom = from;
      continue;
    }
    searchFrom = idx + 5;
  }
  const rest = titlePart.slice(from).trim();
  if (rest) parts.push(rest);
  return parts.length ? parts : [titlePart];
}

function firstAuthorOnly(author) {
  const authorStr = String(author || '');
  const andIdx = toLowerAsciiish(authorStr).indexOf(' and ');
  if (andIdx >= 0) return authorStr.slice(0, andIdx).trim();
  const comma = authorStr.indexOf(',');
  if (comma >= 0) return authorStr.slice(0, comma).trim();
  return authorStr.trim();
}

/**
 * Parse an operator message into seed entries.
 */
function parseSeedList(message) {
  const raw = String(message || '').trim();
  const seeds = [];
  const seen = new Set();

  const push = (seed) => {
    if (!seed) return;
    const key = seed.url
      ? `url:${seed.url.toLowerCase()}`
      : `work:${String(seed.author || '').toLowerCase()}|${String(seed.title || seed.query || '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push(seed);
  };

  for (const url of extractHttpUrls(raw)) {
    push({ kind: 'url', url, note: '' });
  }

  const lines = [];
  for (const line of splitLines(raw)) {
    for (const part of splitSemicolons(line)) {
      if (part.trim()) lines.push(part.trim());
    }
  }

  const instructionStarts = [
    'please', 'ingest', 'expand', 'then', 'iterate', 'snowball', 'these',
    'source', 'sources', 'list', 'find', 'add',
  ];

  for (const line of lines) {
    if (startsWithIgnoreCase(line, 'http://') || startsWithIgnoreCase(line, 'https://')) continue;
    const cleaned = stripListPrefix(line);
    if (!cleaned || cleaned.length < 8) continue;

    const cleanedLow = toLowerAsciiish(cleaned);
    const looksNamed = hasPossessive(cleaned) || cleanedLow.includes(' by ')
      || includesAny(cleaned, ['—', '–', '-']) || hasQuotedTitle(cleaned);

    const firstWord = cleanedLow.split(' ')[0] || '';
    if (
      instructionStarts.includes(firstWord)
      && !looksNamed
    ) {
      continue;
    }
    if (
      includesAny(cleanedLow, ['iterate', 'snowball', 'bibliography', 'expand from', 'after ingest'])
      && !looksNamed
      && !cleanedLow.includes('pdf')
    ) {
      continue;
    }
    if (startsWithIgnoreCase(cleaned, 'http://') || startsWithIgnoreCase(cleaned, 'https://')) continue;

    const em = splitAuthorTitleDash(cleaned);
    if (em && !startsWithIgnoreCase(em.author, 'http://') && !startsWithIgnoreCase(em.author, 'https://')) {
      const author = em.author;
      const titlePart = em.titlePart;
      if (
        author.length <= 70
        && !includesAny(toLowerAsciiish(author), ['and the', 'texts', 'text', 'traditions', 'tradition', 'researchers', 'researcher'])
      ) {
        const titles = splitTitlesOnAndThe(titlePart);
        for (const title of titles) {
          push({
            kind: 'work',
            author,
            title,
            query: buildSeedQuery(title, author),
            note: cleaned.slice(0, 200),
          });
        }
        continue;
      }
    }

    const startsWithVerb = startsWithAny(cleanedLow, ['find ', 'add ', 'get ', 'ingest ', 'please ']);
    const named = parseNamedWork(
      startsWithVerb ? cleaned : `Please find and add to Corpus ${cleaned}`,
    );
    if (named.isSingularTitle && named.title) {
      push({
        kind: 'work',
        author: named.author,
        title: named.title,
        query: named.seekQuery,
        note: cleaned.slice(0, 200),
      });
      continue;
    }
    const capitalStart = cleaned[0] >= 'A' && cleaned[0] <= 'Z'
      && (isAsciiLetter(cleaned[0]));
    if (
      hasQuotedTitle(cleaned)
      || hasPossessive(cleaned)
      || cleanedLow.includes(' by ')
      || includesAny(cleaned, ['—', '–'])
      || capitalStart
    ) {
      push({
        kind: 'work',
        author: named.author,
        title: named.title,
        query: named.seekQuery || cleaned.slice(0, 180),
        note: cleaned.slice(0, 200),
      });
    }
  }

  const rawLow = toLowerAsciiish(raw);
  return {
    raw: raw.slice(0, 2000),
    seeds,
    wantsIterate: includesAny(rawLow, [
      'iterate', 'snowball', 'then expand', 'bibliograph', 'from those', 'other sources',
    ]),
  };
}

function looksLikeSeedSnowball(message) {
  const t = String(message || '');
  const parsed = parseSeedList(t);
  const seedCount = parsed.seeds.length;
  if (seedCount >= 2) return true;
  if (seedCount >= 1 && parsed.wantsIterate) return true;
  const low = toLowerAsciiish(t);
  if ((includesAny(low, ['seed list', 'starter list'])) && seedCount) return true;
  if (seedCount >= 1 && includesAny(low, ['snowball', 'iterate', 'then expand', 'expand bibliograph'])) {
    return true;
  }
  return false;
}

function formatSnowballReport(report) {
  if (!report) return 'Seed snowball: no report.';
  const lines = [
    `Seed snowball: rounds=${report.rounds || 0} · seeds=${(report.seed_results || []).length}`
      + ` · kept=${report.kept_ids?.length || 0} · unsure=${report.unsure_ids?.length || 0}`
      + ` · sought_citations=${report.citations_sought || 0}`,
  ];
  for (const s of report.seed_results || []) {
    if (s.kind === 'url') {
      lines.push(`  seed URL ${(s.url || '').slice(0, 70)} → kept=${s.kept || 0}${s.error ? ` (${s.error})` : ''}`);
    } else {
      lines.push(`  seed work ${(s.title || s.query || '').slice(0, 50)} → kept=${s.kept || 0}${s.error ? ` (${s.error})` : ''}`);
    }
  }
  for (const r of report.round_summaries || []) {
    lines.push(`  round ${r.round}: expanded_from=${r.from_ids?.length || 0} · new_keeps=${r.new_keeps || 0} · new_unsure=${r.new_unsure || 0}`);
  }
  if (report.unsure_ids?.length) {
    lines.push(`  Unsure for your review: #${report.unsure_ids.slice(0, 12).join(', #')}`);
  }
  if (report.stopped_reason) lines.push(`  Stopped: ${report.stopped_reason}`);
  return lines.join('\n');
}

/**
 * Run ingest of seeds, then iterative bibliography expand.
 */
async function runSeedSnowball(messageOrSeeds, opts = {}) {
  const { runTool } = require('./eiAgentTools');
  const { expandFromItem } = require('./eiBibliography');

  const parsed = Array.isArray(messageOrSeeds)
    ? { seeds: messageOrSeeds, wantsIterate: true, raw: '' }
    : parseSeedList(messageOrSeeds);

  const seeds = (parsed.seeds || []).slice(0, Number(opts.maxSeeds || process.env.PIKO_EI_SNOWBALL_MAX_SEEDS || 12));
  if (!seeds.length) {
    return { ok: false, error: 'no_seeds_parsed', seed_results: [], kept_ids: [], unsure_ids: [] };
  }

  const maxRounds = Math.max(0, Math.min(4, Number(opts.rounds != null ? opts.rounds : (parsed.wantsIterate ? 2 : 1))));
  const expandPerItem = Math.max(1, Math.min(8, Number(opts.expandLimit || process.env.PIKO_EI_SNOWBALL_EXPAND_LIMIT || 3)));
  const maxExpandsPerRound = Math.max(1, Math.min(10, Number(opts.maxExpandItems || 4)));

  const keptIds = new Set();
  const unsureIds = new Set();
  const seedResults = [];
  let citationsSought = 0;
  const roundSummaries = [];

  // --- Phase A: ingest seeds ---
  for (const seed of seeds) {
    if (seed.kind === 'url') {
      try {
        const out = await runTool('ingest_url', {
          url: seed.url,
          note: seed.note || opts.goal || `Ingest seed ${seed.url}`,
        }, {
          goal: opts.goal || `Please ingest ${seed.url} into the corpus`,
          rootDir: opts.rootDir,
          source: 'ei_seed_snowball',
          pikoUserId: opts.pikoUserId || 'agent:ei-snowball',
        });
        const mf = out.mission_fit || (out.result && out.result.mission_fit);
        const keeps = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'keep' && !j.purged);
        const unsures = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'unsure' && !j.purged);
        keeps.forEach((j) => keptIds.add(j.harvest_id));
        unsures.forEach((j) => unsureIds.add(j.harvest_id));
        seedResults.push({
          kind: 'url',
          url: seed.url,
          ok: !!out.ok,
          kept: keeps.length,
          keep_ids: keeps.map((j) => j.harvest_id),
          unsure_ids: unsures.map((j) => j.harvest_id),
        });
      } catch (e) {
        seedResults.push({ kind: 'url', url: seed.url, ok: false, kept: 0, error: String(e.message || e).slice(0, 160) });
      }
      continue;
    }

    // Named work → seek_files (prefer primary author + clean title)
    try {
      const primaryAuthor = firstAuthorOnly(seed.author);
      let cleanTitle = String(seed.title || '');
      for (const q of ['"', '\u201c', '\u201d']) cleanTitle = replaceAllLiteral(cleanTitle, q, '');
      const cleanLow = toLowerAsciiish(cleanTitle);
      if (cleanLow.startsWith('works on ')) cleanTitle = cleanTitle.slice('works on '.length);
      else if (cleanLow.startsWith('work on ')) cleanTitle = cleanTitle.slice('work on '.length);
      cleanTitle = cleanTitle.trim();
      const mission = primaryAuthor && cleanTitle
        ? `Please find and add to Corpus the book ${cleanTitle} by ${primaryAuthor}.`
        : `Please find and add to Corpus ${seed.query || seed.note}`;
      const out = await runTool('seek_files', {
        query: seed.query || buildSeedQuery(cleanTitle || seed.query || seed.note, primaryAuthor),
        limit: 10,
        max_keeps: 1,
      }, {
        goal: mission,
        rootDir: opts.rootDir,
        source: 'ei_seed_snowball',
        pikoUserId: opts.pikoUserId || 'agent:ei-snowball',
      });
      const mf = out.mission_fit || (out.result && out.result.mission_fit);
      const keeps = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'keep' && !j.purged);
      const unsures = ((mf && mf.judgments) || []).filter((j) => j.verdict === 'unsure' && !j.purged);
      keeps.forEach((j) => keptIds.add(j.harvest_id));
      unsures.forEach((j) => unsureIds.add(j.harvest_id));
      seedResults.push({
        kind: 'work',
        title: seed.title,
        author: primaryAuthor || seed.author,
        query: seed.query,
        ok: !!out.ok,
        kept: keeps.length,
        keep_ids: keeps.map((j) => j.harvest_id),
        unsure_ids: unsures.map((j) => j.harvest_id),
      });
    } catch (e) {
      seedResults.push({
        kind: 'work',
        title: seed.title,
        author: seed.author,
        ok: false,
        kept: 0,
        error: String(e.message || e).slice(0, 160),
      });
    }
  }

  // --- Phase B: iterate bibliography expand from newly kept items ---
  let frontier = [...keptIds];
  let stoppedReason = null;
  let round = 0;
  for (; round < maxRounds; round += 1) {
    if (!frontier.length) {
      stoppedReason = 'no_kept_items_to_expand';
      break;
    }
    const batch = frontier.slice(0, maxExpandsPerRound);
    frontier = [];
    let newKeeps = 0;
    let newUnsure = 0;
    const fromIds = [];

    for (const hid of batch) {
      fromIds.push(hid);
      try {
        const exp = await expandFromItem(hid, {
          limit: expandPerItem,
          rootDir: opts.rootDir,
          pikoUserId: opts.pikoUserId || 'agent:ei-snowball',
        });
        citationsSought += Number(exp.sought || 0);
        for (const e of exp.expanded || []) {
          for (const k of e.keeps || []) {
            if (k.id && !keptIds.has(k.id)) {
              keptIds.add(k.id);
              frontier.push(k.id);
              newKeeps += 1;
            }
          }
          for (const u of e.unsures || []) {
            if (u.id) {
              unsureIds.add(u.id);
              newUnsure += 1;
            }
          }
        }
      } catch (_) { /* continue other items */ }
    }
    roundSummaries.push({
      round: round + 1,
      from_ids: fromIds,
      new_keeps: newKeeps,
      new_unsure: newUnsure,
    });
    if (!frontier.length) {
      stoppedReason = 'frontier_exhausted';
      break;
    }
  }
  if (round >= maxRounds && !stoppedReason) stoppedReason = `max_rounds_${maxRounds}`;

  // Index keeps (best-effort)
  try {
    const { indexHarvest } = require('./eiCorpusRag');
    for (const id of [...keptIds].slice(0, 12)) {
      indexHarvest(id).catch(() => {});
    }
  } catch (_) { /* optional */ }

  return {
    ok: keptIds.size > 0 || seedResults.some((s) => s.ok),
    seeds_parsed: seeds.length,
    seed_results: seedResults,
    rounds: roundSummaries.length,
    round_summaries: roundSummaries,
    kept_ids: [...keptIds],
    unsure_ids: [...unsureIds],
    citations_sought: citationsSought,
    stopped_reason: stoppedReason,
    pass: keptIds.size > 0,
  };
}

module.exports = {
  buildSeedQuery,
  parseSeedList,
  looksLikeSeedSnowball,
  formatSnowballReport,
  runSeedSnowball,
};
