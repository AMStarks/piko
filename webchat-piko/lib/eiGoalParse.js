/**
 * Parse operator goals for literature seek/mission-fit.
 * Singular named-title asks must seek one work and keep at most one deliverable.
 * Author+topic plural (and near-plural) asks carry an author contract.
 */

const STOP = new Set([
  'a', 'an', 'the', 'of', 'and', 'in', 'on', 'to', 'for', 'by', 'with', 'from',
  'please', 'find', 'add', 'get', 'download', 'seek', 'locate', 'search',
  'corpus', 'into', 'this', 'that', 'book', 'pdf', 'volume', 'file',
  'all', 'every', 'any', 'about', 'regarding', 'dealing', 'written', 'ancient',
]);

// Particles that appear inside person names ("Pliny the Elder", "W. M. Flinders
// Petrie", "van Kerkwyk") without breaking the capitalised-name matcher.
const NAME_PARTICLE = '(?:the|of|de|del|della|van|von|da|di|le|la|du)';
const NAME_TOKEN = `(?:[A-Z][\\w.'’-]*|${NAME_PARTICLE})`;
const NAME_RE = `[A-Z][\\w.'’-]*(?:\\s+${NAME_TOKEN}){0,5}`;
const MULTI_NAME_RE = `[A-Z][\\w.'’-]*(?:\\s+${NAME_TOKEN}){1,5}`;

const WORK_NOUNS = '(?:articles?|books?|works?|papers?|pdfs?|volumes?|writings?|'
  + 'essays?|reports?|publications?|lectures?|monographs?|accounts?|surveys?|'
  + 'material|materials|sources?|texts?|descriptions?|records?|notes?)';

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    // Unicode-aware: keep letters like ö/é so Göbekli ≠ "bekli"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(s) {
  return normalizeTitle(s)
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Fraction of expected title tokens present in candidate (0–1).
 * Penalizes alternate main titles (e.g. Giza Power Plant vs Lost Technologies).
 */
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

  // Exact / edition: expected title phrase appears in candidate.
  if (eNorm.length >= 10 && (cNorm.includes(eNorm) || eNorm.includes(cNorm))) {
    return Math.max(forward, 0.95);
  }

  // Different head title → strongly demote partial keyword overlap.
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
  const eParts = e.split(/\s+/).filter((p) => p.length > 2 && !STOP.has(p));
  const cParts = new Set(c.split(/\s+/));
  if (!eParts.length) return c.includes(e) || e.includes(c);
  const hits = eParts.filter((p) => cParts.has(p) || c.includes(p)).length;
  return hits >= Math.min(2, eParts.length) || (eParts.length === 1 && hits === 1);
}

function stripInstructionPreamble(goal) {
  let q = String(goal || '').trim();
  q = q.replace(
    /^(please\s+)?(can\s+you\s+|could\s+you\s+)?(find|add|get|download|seek|locate|search\s+for)\s+(and\s+)?(add\s+)?(to\s+(the\s+)?corpus\s+)?/i,
    '',
  );
  q = q.replace(/\s+(and\s+)?add\s+(it\s+|them\s+)?to\s+(the\s+)?corpus\.?$/i, '');
  q = q.replace(/\s+to\s+(the\s+)?corpus\.?$/i, '');
  return q.replace(/\s+/g, ' ').trim();
}

/**
 * Detect plural / corpus-wide asks vs one named work.
 */
function isPluralCorpusAsk(goal) {
  const g = String(goal || '').toLowerCase();
  if (/\b(all|every|works by|books by|pdfs|articles|volumes by|complete works|corpus of)\b/.test(g)) {
    return true;
  }
  if (/\b(books|pdfs|articles|volumes|accounts|surveys|material|materials|sources|texts|writings|reports)\b/.test(g)
    && !/\b(this|that|one|specific|titled|called|named)\b/.test(g)) {
    return true;
  }
  return false;
}

/**
 * Generic descriptive phrases that are NEVER a book title — they signal an
 * author+topic ask ("ancient written accounts of X by Herodotus").
 */
function isGenericDescription(title) {
  return /^(ancient\s+)?(written\s+)?(accounts?|material|materials|sources?|texts?|writings?|reports?|surveys?|descriptions?|records?)\b/i
    .test(String(title || '').trim());
}

function cleanAuthor(name) {
  if (!name) return null;
  let a = String(name).trim()
    .replace(/'s$/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop leading filler ("all", "every") if a capture over-reached.
  a = a.replace(/^(all|every|of)\s+/i, '').trim();
  if (!a || significantTokens(a).length === 0) return null;
  return a;
}

/**
 * Topic keywords after "dealing with / about / regarding / on …".
 * Used by the topic-relevance contract for author+topic asks.
 */
function extractTopic(goal) {
  const g = String(goal || '');
  const m = g.match(/\b(?:dealing with|about|regarding|on|concerning)\s+(.+?)(?:[.!?]|$)/i);
  if (!m) return null;
  const toks = significantTokens(m[1]).filter((t) => t.length > 3);
  return toks.length ? toks.slice(0, 8) : null;
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

  // Author's Title…
  let m = cleaned.match(
    new RegExp(`^(${NAME_RE})'s\\s+(.+)$`),
  );
  if (m && !isGenericDescription(m[2]) && !new RegExp(`^${WORK_NOUNS}\\b`, 'i').test(m[2].trim())) {
    author = cleanAuthor(m[1]);
    title = m[2].replace(/[.!?"']+$/, '').trim();
  }

  // Title by Author (only when the left side looks like a real title, not a
  // generic "accounts of X by Author" description).
  if (!title) {
    m = cleaned.match(new RegExp(`^(.+?)\\s+by\\s+(${NAME_RE})\\.?$`));
    if (m && !isGenericDescription(m[1])) {
      title = m[1].replace(/^(the\s+book\s+)/i, '').trim();
      author = cleanAuthor(m[2]);
    }
  }

  // Author+topic / authored-works asks — no single title, but the author is a
  // hard contract. Fire for plurals AND for non-plural "accounts by X" shapes.
  if (!title || isGenericDescription(title)) {
    if (isGenericDescription(title)) title = null;

    // "… (authored|written) by <Name>" / trailing "by <Name>"
    let am = cleaned.match(new RegExp(`\\b(?:authored\\s+by|written\\s+by|by)\\s+(${NAME_RE})\\.?$`, 'i'));
    if (!am) {
      am = cleaned.match(new RegExp(`\\b(?:authored\\s+by|written\\s+by)\\s+(${NAME_RE})`, 'i'));
    }
    if (am) author = cleanAuthor(am[1]);

    // "all <Name> articles…" / "every <Name> paper…"
    if (!author) {
      am = cleaned.match(new RegExp(
        `\\b(?:[Aa]ll|[Ee]very)\\s+(?:of\\s+)?(${MULTI_NAME_RE})(?:'s)?\\s+${WORK_NOUNS}\\b`,
      ));
      if (am) author = cleanAuthor(am[1]);
    }

    // "<Name>'s articles/reports…"
    if (!author) {
      am = cleaned.match(new RegExp(`\\b(${NAME_RE})'s\\s+(?:\\w+\\s+)?${WORK_NOUNS}\\b`));
      if (am) author = cleanAuthor(am[1]);
    }

    // "all material by <Name>" / "all <Name> material"
    if (!author) {
      am = cleaned.match(new RegExp(`\\b(?:[Aa]ll|[Ee]very)\\s+${WORK_NOUNS}\\s+by\\s+(${NAME_RE})`, 'i'));
      if (am) author = cleanAuthor(am[1]);
    }
    if (!author) {
      am = cleaned.match(new RegExp(
        `\\b(?:[Aa]ll|[Ee]very)\\s+(${MULTI_NAME_RE})\\s+${WORK_NOUNS}\\b`,
      ));
      if (am) author = cleanAuthor(am[1]);
    }
  }

  // Fallback: remaining text after strip is the work name — ONLY when it does
  // not look like a generic description and is not a plural ask.
  if (!title && !author && cleaned && cleaned.length >= 8 && !plural) {
    title = cleaned.replace(/[.!?]+$/, '').trim();
    if (isGenericDescription(title)) {
      title = null;
    } else {
      m = title.match(new RegExp(`^(${NAME_RE})'s\\s+(.+)$`));
      if (m && !isGenericDescription(m[2])) {
        author = cleanAuthor(m[1]);
        title = m[2].trim();
      }
    }
  }

  const isSingularTitle = !plural && !!title && title.length >= 8
    && !/\b(all|every)\b/i.test(title)
    && !isGenericDescription(title);
  const isAuthorWorks = !isSingularTitle && !!author;
  const topic = extractTopic(raw);

  let seekQuery = cleaned || raw;
  if (isSingularTitle) {
    // Dequote first — titles carrying quotes would otherwise double-wrap
    // into unusable search phrases like ""The Giza Power Plant" Dunn PDF".
    const bare = title.replace(/["“”]/g, '').replace(/\s+PDF$/i, '').trim();
    const quoted = bare.includes(' ') ? `"${bare}"` : bare;
    seekQuery = [quoted, author, 'PDF'].filter(Boolean).join(' ').trim();
  } else if (isAuthorWorks) {
    const topicBit = topic && topic.length ? topic.slice(0, 4).join(' ') : '';
    seekQuery = [author, topicBit, 'PDF'].filter(Boolean).join(' ').trim();
  } else if (seekQuery && !/\bpdf\b/i.test(seekQuery) && /book|volume|literature|text/i.test(raw)) {
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
