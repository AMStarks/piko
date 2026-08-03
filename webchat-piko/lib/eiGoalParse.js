/**
 * Parse operator goals for literature seek/mission-fit.
 * Singular named-title asks must seek one work and keep at most one deliverable.
 * Author+topic plural (and near-plural) asks carry an author contract.
 * WP8: no regex.
 */

const {
  collapseWhitespace,
  toLowerAsciiish,
  includesAny,
  startsWithIgnoreCase,
  startsWithAny,
  stripTrailingPunct,
  keepLettersDigitsSpaces,
  isAsciiLetter,
  isAsciiDigit,
  isLetterOrNumber,
  replaceAllLiteral,
  normalizeApostrophes,
} = require('./text');

const STOP = new Set([
  'a', 'an', 'the', 'of', 'and', 'in', 'on', 'to', 'for', 'by', 'with', 'from',
  'please', 'find', 'add', 'get', 'download', 'seek', 'locate', 'search',
  'corpus', 'into', 'this', 'that', 'book', 'pdf', 'volume', 'file',
  'all', 'every', 'any', 'about', 'regarding', 'dealing', 'written', 'ancient',
]);

const NAME_PARTICLES = new Set([
  'the', 'of', 'de', 'del', 'della', 'van', 'von', 'da', 'di', 'le', 'la', 'du',
]);

const WORK_NOUN_STEMS = [
  'article', 'articles', 'book', 'books', 'work', 'works', 'paper', 'papers',
  'pdf', 'pdfs', 'volume', 'volumes', 'writing', 'writings', 'essay', 'essays',
  'report', 'reports', 'publication', 'publications', 'lecture', 'lectures',
  'monograph', 'monographs', 'account', 'accounts', 'survey', 'surveys',
  'material', 'materials', 'source', 'sources', 'text', 'texts',
  'description', 'descriptions', 'record', 'records', 'note', 'notes',
];

const GENERIC_DESC_STEMS = [
  'account', 'accounts', 'material', 'materials', 'source', 'sources',
  'text', 'texts', 'writing', 'writings', 'report', 'reports',
  'survey', 'surveys', 'description', 'descriptions', 'record', 'records',
];

function isNameTokenChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '.' || ch === "'" || ch === '-'
    || ch === '\u2019' || ch === '\u2018';
}

function normalizeTitle(s) {
  let t = toLowerAsciiish(s);
  t = normalizeApostrophes(t);
  t = replaceAllLiteral(t, "'", '');
  // Keep letters/numbers/spaces (unicode-aware via keepLettersDigitsSpaces)
  t = keepLettersDigitsSpaces(t);
  return collapseWhitespace(t);
}

function significantTokens(s) {
  return normalizeTitle(s)
    .split(' ')
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function titleMatchScore(expected, candidate) {
  const eToks = significantTokens(expected);
  if (!eToks.length) return 0;
  const cToks = significantTokens(candidate);
  const cSet = new Set(cToks);
  const eNorm = normalizeTitle(expected);
  const cNorm = normalizeTitle(candidate);
  let hit = 0;
  for (const t of eToks) {
    if (cSet.has(t) || cNorm.includes(t)) hit += 1;
  }
  let forward = hit / eToks.length;

  if (eNorm.length >= 10 && (cNorm.includes(eNorm) || eNorm.includes(cNorm))) {
    return Math.max(forward, 0.95);
  }

  if (eToks.length >= 2 && cToks.length >= 2) {
    const eHead = `${eToks[0]} ${eToks[1]}`;
    const cHead = `${cToks[0]} ${cToks[1]}`;
    if (eHead !== cHead && forward < 0.92) {
      forward *= 0.65;
    }
  }
  return Math.max(0, Math.min(1, forward));
}

function authorMatch(expected, candidate) {
  const e = normalizeTitle(expected);
  const c = normalizeTitle(candidate);
  if (!e || !c || c === 'unknown') return false;
  const eParts = e.split(' ').filter((p) => p.length > 2 && !STOP.has(p));
  const cParts = new Set(c.split(' '));
  if (!eParts.length) return c.includes(e) || e.includes(c);
  const hits = eParts.filter((p) => cParts.has(p) || c.includes(p)).length;
  return hits >= Math.min(2, eParts.length) || (eParts.length === 1 && hits === 1);
}

function stripInstructionPreamble(goal) {
  let q = String(goal || '').trim();
  const low = toLowerAsciiish(q);
  // Strip leading please/can you/find/add…to corpus
  const verbs = ['find ', 'add ', 'get ', 'download ', 'seek ', 'locate ', 'search for '];
  let start = 0;
  if (low.startsWith('please ')) start = 7;
  const afterPlease = low.slice(start);
  if (afterPlease.startsWith('can you ')) start += 8;
  else if (afterPlease.startsWith('could you ')) start += 10;
  const restLow = low.slice(start);
  for (const v of verbs) {
    if (restLow.startsWith(v)) {
      start += v.length;
      break;
    }
  }
  let midLow = low.slice(start);
  if (midLow.startsWith('and ')) {
    start += 4;
    midLow = low.slice(start);
  }
  if (midLow.startsWith('add ')) {
    start += 4;
    midLow = low.slice(start);
  }
  for (const phrase of ['to the corpus ', 'to corpus ']) {
    if (midLow.startsWith(phrase)) {
      start += phrase.length;
      break;
    }
  }
  q = q.slice(start).trim();

  // Strip trailing "and add … to corpus"
  const qLow = toLowerAsciiish(q);
  for (const tail of [
    ' and add it to the corpus',
    ' and add them to the corpus',
    ' and add to the corpus',
    ' and add it to corpus',
    ' and add them to corpus',
    ' and add to corpus',
    ' to the corpus',
    ' to corpus',
  ]) {
    if (qLow.endsWith(tail) || qLow.endsWith(`${tail}.`)) {
      const cut = qLow.endsWith('.') ? tail.length + 1 : tail.length;
      q = q.slice(0, q.length - cut).trim();
      break;
    }
  }
  return collapseWhitespace(q);
}

function isPluralCorpusAsk(goal) {
  const g = toLowerAsciiish(goal);
  if (includesAny(g, [
    'all ', 'every ', 'works by', 'books by', 'pdfs', 'articles', 'volumes by',
    'complete works', 'corpus of',
  ])) {
    // "all"/"every" alone as substrings — check carefully via padded words
    if (includesAny(` ${g} `, [' all ', ' every '])
      || includesAny(g, ['works by', 'books by', 'pdfs', 'articles', 'volumes by', 'complete works', 'corpus of'])) {
      return true;
    }
  }
  const pluralNouns = [
    'books', 'pdfs', 'articles', 'volumes', 'accounts', 'surveys',
    'material', 'materials', 'sources', 'texts', 'writings', 'reports',
  ];
  if (includesAny(g, pluralNouns)
    && !includesAny(g, ['this ', 'that ', 'one ', 'specific', 'titled', 'called', 'named'])) {
    return true;
  }
  return false;
}

function isGenericDescription(title) {
  let t = String(title || '').trim();
  const low = toLowerAsciiish(t);
  let rest = low;
  if (rest.startsWith('ancient ')) rest = rest.slice(8);
  if (rest.startsWith('written ')) rest = rest.slice(8);
  for (const stem of GENERIC_DESC_STEMS) {
    if (rest === stem || rest.startsWith(`${stem} `) || rest.startsWith(`${stem}.`)) return true;
  }
  return false;
}

function cleanAuthor(name) {
  if (!name) return null;
  let a = String(name).trim();
  if (endsWithIgnoreCase(a, "'s")) a = a.slice(0, -2);
  else if (endsWithIgnoreCase(a, '\u2019s')) a = a.slice(0, -2);
  a = stripTrailingPunct(a);
  a = collapseWhitespace(a);
  const aLow = toLowerAsciiish(a);
  for (const filler of ['all ', 'every ', 'of ']) {
    if (aLow.startsWith(filler)) {
      a = a.slice(filler.length).trim();
      break;
    }
  }
  if (!a || significantTokens(a).length === 0) return null;
  return a;
}

function endsWithIgnoreCase(s, suffix) {
  return toLowerAsciiish(s).endsWith(toLowerAsciiish(suffix));
}

function extractTopic(goal) {
  const g = String(goal || '');
  const low = toLowerAsciiish(g);
  const cues = ['dealing with ', 'about ', 'regarding ', 'on ', 'concerning '];
  let best = null;
  for (const cue of cues) {
    let from = 0;
    while (from < low.length) {
      const idx = low.indexOf(cue, from);
      if (idx < 0) break;
      if (idx === 0 || !isAsciiLetter(low[idx - 1])) {
        let end = g.length;
        for (let i = idx + cue.length; i < g.length; i++) {
          if (g[i] === '.' || g[i] === '!' || g[i] === '?') {
            end = i;
            break;
          }
        }
        const slice = g.slice(idx + cue.length, end);
        const toks = significantTokens(slice).filter((t) => t.length > 3);
        if (toks.length) {
          best = toks.slice(0, 8);
        }
      }
      from = idx + cue.length;
    }
  }
  return best;
}

/**
 * Scan a capitalized person name starting at index.
 * Allows particles (the/of/van…) between capital tokens.
 * Returns { name, end } or null.
 */
function scanPersonName(text, start, opts = {}) {
  const s = String(text || '');
  const minTokens = opts.minTokens != null ? opts.minTokens : 1;
  const maxTokens = opts.maxTokens != null ? opts.maxTokens : 6;
  let i = start;
  while (i < s.length && s[i] === ' ') i += 1;
  if (i >= s.length) return null;
  // First token must be capital letter (not particle-only)
  if (s[i] < 'A' || s[i] > 'Z') return null;

  const tokens = [];
  while (i < s.length && tokens.length < maxTokens) {
    if (tokens.length) {
      if (s[i] !== ' ') break;
      while (i < s.length && s[i] === ' ') i += 1;
      if (i >= s.length) break;
    }
    // Particle?
    let wordEnd = i;
    while (wordEnd < s.length && isNameTokenChar(s[wordEnd])) wordEnd += 1;
    if (wordEnd === i) break;
    const tok = s.slice(i, wordEnd);
    const tokLow = toLowerAsciiish(tok);
    if (tokens.length && NAME_PARTICLES.has(tokLow)) {
      tokens.push(tok);
      i = wordEnd;
      continue;
    }
    if (tok[0] < 'A' || tok[0] > 'Z') break;
    tokens.push(tok);
    i = wordEnd;
  }
  if (tokens.length < minTokens) return null;
  // Drop trailing particle
  while (tokens.length && NAME_PARTICLES.has(toLowerAsciiish(tokens[tokens.length - 1]))) {
    tokens.pop();
  }
  if (tokens.length < minTokens) return null;
  return { name: tokens.join(' '), end: i };
}

function startsWithWorkNoun(s) {
  const low = toLowerAsciiish(String(s || '').trim());
  for (const n of WORK_NOUN_STEMS) {
    if (low === n || low.startsWith(`${n} `)) return true;
  }
  return false;
}

function findTrailingByAuthor(cleaned) {
  const low = toLowerAsciiish(cleaned);
  for (const cue of ['authored by ', 'written by ', 'by ']) {
    const idx = low.lastIndexOf(cue);
    if (idx < 0) continue;
    if (idx > 0 && isAsciiLetter(low[idx - 1])) continue;
    const scanned = scanPersonName(cleaned, idx + cue.length, { minTokens: 1, maxTokens: 6 });
    if (!scanned) continue;
    // Prefer end-anchored for bare "by"
    const after = cleaned.slice(scanned.end).trim();
    if (cue === 'by ' && after && after !== '.' && after !== '') {
      // allow if only trailing punct
      if (stripTrailingPunct(after) !== '') continue;
    }
    return scanned.name;
  }
  // Non-end authored/written by
  for (const cue of ['authored by ', 'written by ']) {
    const idx = low.indexOf(cue);
    if (idx < 0) continue;
    const scanned = scanPersonName(cleaned, idx + cue.length, { minTokens: 1, maxTokens: 6 });
    if (scanned) return scanned.name;
  }
  return null;
}

function findAllNameWorks(cleaned) {
  const low = toLowerAsciiish(cleaned);
  for (const quant of ['all ', 'every ']) {
    let from = 0;
    while (from < low.length) {
      const idx = low.indexOf(quant, from);
      if (idx < 0) break;
      if (idx > 0 && isAsciiLetter(low[idx - 1])) {
        from = idx + quant.length;
        continue;
      }
      let pos = idx + quant.length;
      // optional "of "
      if (low.slice(pos, pos + 3) === 'of ') pos += 3;

      // Pattern A: all <Name> works
      const nameA = scanPersonName(cleaned, pos, { minTokens: 2, maxTokens: 6 });
      if (nameA) {
        let after = cleaned.slice(nameA.end).trim();
        if (startsWithIgnoreCase(after, "'s")) after = after.slice(2).trim();
        else if (after.startsWith('\u2019s')) after = after.slice(2).trim();
        // optional adjective before work noun
        const afterLow = toLowerAsciiish(after);
        let check = after;
        if (!startsWithWorkNoun(check)) {
          // skip one word
          const sp = after.indexOf(' ');
          if (sp > 0) check = after.slice(sp + 1);
        }
        if (startsWithWorkNoun(check)) return nameA.name;
      }

      // Pattern B: all works by <Name>
      for (const noun of WORK_NOUN_STEMS) {
        if (low.slice(pos, pos + noun.length) === noun) {
          let p2 = pos + noun.length;
          while (p2 < cleaned.length && cleaned[p2] === ' ') p2 += 1;
          if (toLowerAsciiish(cleaned.slice(p2, p2 + 3)) === 'by ') {
            const nameB = scanPersonName(cleaned, p2 + 3, { minTokens: 1, maxTokens: 6 });
            if (nameB) return nameB.name;
          }
        }
      }
      from = idx + quant.length;
    }
  }

  // "<Name>'s articles"
  for (let i = 0; i < cleaned.length - 2; i++) {
    if (cleaned[i] === "'" || cleaned[i] === '\u2019') {
      if (toLowerAsciiish(cleaned[i + 1]) !== 's') continue;
      if (i + 2 < cleaned.length && cleaned[i + 2] !== ' ') continue;
      // walk back to find name start
      let start = i - 1;
      while (start > 0 && cleaned[start - 1] !== '.' && !(cleaned[start - 1] === ' ' && start > 1 && !isNameTokenChar(cleaned[start - 2]) && cleaned[start - 2] !== ' ')) {
        // simpler: find whitespace-run before capitalized sequence
        start -= 1;
        if (start < 0) break;
      }
      // Find beginning of name: last stretch of name tokens before 's
      let nameStart = i;
      while (nameStart > 0) {
        const ch = cleaned[nameStart - 1];
        if (isNameTokenChar(ch) || ch === ' ') nameStart -= 1;
        else break;
      }
      while (nameStart < i && cleaned[nameStart] === ' ') nameStart += 1;
      const namePart = cleaned.slice(nameStart, i).trim();
      const scanned = scanPersonName(namePart, 0, { minTokens: 1, maxTokens: 6 });
      if (!scanned || scanned.name !== namePart) continue;
      let after = cleaned.slice(i + 2).trim();
      if (after.startsWith(' ')) after = after.trim();
      // optional word then work noun
      if (!startsWithWorkNoun(after)) {
        const sp = after.indexOf(' ');
        if (sp > 0) after = after.slice(sp + 1);
      }
      if (startsWithWorkNoun(after)) return scanned.name;
    }
  }
  return null;
}

function parsePossessiveTitle(cleaned) {
  // Author's Title
  for (let i = 0; i < cleaned.length - 2; i++) {
    if ((cleaned[i] === "'" || cleaned[i] === '\u2019') && toLowerAsciiish(cleaned[i + 1]) === 's') {
      if (i + 2 < cleaned.length && cleaned[i + 2] !== ' ') continue;
      let nameStart = i;
      while (nameStart > 0) {
        const ch = cleaned[nameStart - 1];
        if (isNameTokenChar(ch) || ch === ' ') nameStart -= 1;
        else break;
      }
      while (nameStart < i && cleaned[nameStart] === ' ') nameStart += 1;
      if (nameStart !== 0) continue; // must be at start for this pattern
      const namePart = cleaned.slice(0, i).trim();
      const scanned = scanPersonName(namePart, 0, { minTokens: 1, maxTokens: 6 });
      if (!scanned || collapseWhitespace(scanned.name) !== collapseWhitespace(namePart)) continue;
      let title = cleaned.slice(i + 2).trim();
      title = stripTrailingPunct(title);
      for (const q of ['"', "'"]) {
        while (title.endsWith(q)) title = title.slice(0, -1).trim();
      }
      if (!title || isGenericDescription(title) || startsWithWorkNoun(title)) continue;
      return { author: cleanAuthor(scanned.name), title };
    }
  }
  return null;
}

function parseTitleByAuthor(cleaned) {
  const low = toLowerAsciiish(cleaned);
  // Find " by " near the end with a name after
  let from = 0;
  let best = null;
  while (from < low.length) {
    const idx = low.indexOf(' by ', from);
    if (idx < 0) break;
    const left = cleaned.slice(0, idx).trim();
    const scanned = scanPersonName(cleaned, idx + 4, { minTokens: 1, maxTokens: 6 });
    if (scanned) {
      const after = stripTrailingPunct(cleaned.slice(scanned.end).trim());
      if (!after && left && !isGenericDescription(left)) {
        let title = left;
        if (startsWithIgnoreCase(title, 'the book ')) title = title.slice(9).trim();
        best = { author: cleanAuthor(scanned.name), title };
      }
    }
    from = idx + 4;
  }
  return best;
}

/**
 * @returns {{
 *   raw: string,
 *   isSingularTitle: boolean,
 *   isAuthorWorks: boolean,
 *   author: string|null,
 *   title: string|null,
 *   topic: string[]|null,
 *   seekQuery: string,
 *   maxKeeps: number|null,
 *   seekLimit: number|null,
 * }}
 */
function parseNamedWork(goal) {
  const raw = String(goal || '').trim();
  const cleaned = stripInstructionPreamble(raw);
  const plural = isPluralCorpusAsk(raw);
  let author = null;
  let title = null;

  const poss = parsePossessiveTitle(cleaned);
  if (poss) {
    author = poss.author;
    title = poss.title;
  }

  if (!title) {
    const by = parseTitleByAuthor(cleaned);
    if (by) {
      title = by.title;
      author = by.author;
    }
  }

  if (!title || isGenericDescription(title)) {
    if (isGenericDescription(title)) title = null;

    const byAuth = findTrailingByAuthor(cleaned);
    if (byAuth) author = cleanAuthor(byAuth);

    if (!author) {
      const fromAll = findAllNameWorks(cleaned);
      if (fromAll) author = cleanAuthor(fromAll);
    }
  }

  if (!title && !author && cleaned && cleaned.length >= 8 && !plural) {
    title = stripTrailingPunct(cleaned);
    if (isGenericDescription(title)) {
      title = null;
    } else {
      const poss2 = parsePossessiveTitle(title);
      if (poss2 && !isGenericDescription(poss2.title)) {
        author = poss2.author;
        title = poss2.title;
      }
    }
  }

  const titleLow = toLowerAsciiish(title || '');
  const isSingularTitle = !plural && !!title && title.length >= 8
    && !includesAny(` ${titleLow} `, [' all ', ' every '])
    && !isGenericDescription(title);
  const isAuthorWorks = !isSingularTitle && !!author;
  const topic = extractTopic(raw);

  let seekQuery = cleaned || raw;
  if (isSingularTitle) {
    let bare = title;
    for (const q of ['"', '\u201c', '\u201d']) bare = replaceAllLiteral(bare, q, '');
    if (endsWithIgnoreCase(bare, ' PDF')) bare = bare.slice(0, -4).trim();
    const quoted = bare.includes(' ') ? `"${bare}"` : bare;
    seekQuery = [quoted, author, 'PDF'].filter(Boolean).join(' ').trim();
  } else if (isAuthorWorks) {
    const topicBit = topic && topic.length ? topic.slice(0, 4).join(' ') : '';
    seekQuery = [author, topicBit, 'PDF'].filter(Boolean).join(' ').trim();
  } else if (
    seekQuery
    && !includesAny(` ${toLowerAsciiish(seekQuery)} `, [' pdf '])
    && !toLowerAsciiish(seekQuery).endsWith(' pdf')
    && includesAny(toLowerAsciiish(raw), ['book', 'volume', 'literature', 'text'])
  ) {
    seekQuery = `${seekQuery} PDF`;
  }

  return {
    raw,
    isSingularTitle,
    isAuthorWorks,
    author,
    title: title || null,
    topic,
    seekQuery: String(seekQuery).slice(0, 220),
    maxKeeps: isSingularTitle ? 1 : null,
    seekLimit: isSingularTitle ? 12 : null,
  };
}

function focusedSeekQuery(goal) {
  return parseNamedWork(goal).seekQuery;
}

// WP8.2: chat veto floors moved to phrase/understand helpers (no regex).
const {
  isCampaignStatusQuestion,
  isOpinionQuestion,
  isSoftMusing,
  looksLikeWorkOrder,
  parseCampaignControlAction,
} = require('./eiFloors');

module.exports = {
  parseNamedWork,
  focusedSeekQuery,
  titleMatchScore,
  authorMatch,
  normalizeTitle,
  significantTokens,
  stripInstructionPreamble,
  isPluralCorpusAsk,
  extractTopic,
  looksLikeWorkOrder,
  isOpinionQuestion,
  isCampaignStatusQuestion,
  isSoftMusing,
  parseCampaignControlAction,
  isGenericDescription,
};
