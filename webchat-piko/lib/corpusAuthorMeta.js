/**
 * Corpus author metadata — extract + normalize for harvest meta / lookups.
 * Sources: meta.author(s), meta.creator, title ("by X"), optional query/mission hints.
 * WP8: no regex.
 */
const {
  collapseWhitespace,
  toLowerAsciiish,
  includesAny,
  startsWithAny,
  isAsciiLetter,
  isAsciiDigit,
} = require('./text');

const INSTITUTION_WORDS = [
  'university', 'library', 'archive.org', 'internet archive', 'museum', 'press',
  'institute', 'college', 'society', 'foundation', 'publisher',
];

const TITLE_SITE_WORDS = ['pyramid', 'temple', 'tomb', 'egypt', 'giza', 'abydos'];

function isNameTokenChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '.' || ch === "'" || ch === '-'
    || ch === '\u2019' || ch === '\u2018';
}

function isInitialToken(tok) {
  if (!tok) return false;
  if (tok.length === 1 && tok[0] >= 'A' && tok[0] <= 'Z') return true;
  if (tok.length === 2 && tok[0] >= 'A' && tok[0] <= 'Z' && tok[1] === '.') return true;
  return false;
}

function splitWs(s) {
  return collapseWhitespace(s).split(' ').filter(Boolean);
}

function hasDigit(s) {
  for (let i = 0; i < s.length; i++) {
    if (isAsciiDigit(s[i])) return true;
  }
  return false;
}

function stripTrailingRole(s) {
  const low = toLowerAsciiish(s);
  for (const role of ['author', 'editor', 'translator', 'trans.']) {
    for (const sep of [' - ', ' – ', ' — ', ': ']) {
      const needle = sep + role;
      const idx = low.lastIndexOf(needle);
      if (idx >= 0 && idx + needle.length >= low.length - 1) {
        return s.slice(0, idx).trim();
      }
    }
  }
  // "trans" without lator
  for (const sep of [' - ', ' – ', ' — ', ': ']) {
    const needle = `${sep}trans`;
    const idx = low.lastIndexOf(needle);
    if (idx >= 0 && idx + needle.length >= low.length - 1) {
      return s.slice(0, idx).trim();
    }
  }
  return s;
}

function normalizeAuthor(value) {
  let s = collapseWhitespace(value);
  if (!s || s.length < 2 || s.length > 160) return null;
  if (toLowerAsciiish(s) === 'unknown') return null;
  const low = toLowerAsciiish(s);
  if (low === 'n/a' || low === 'na' || low === 'none' || low === 'null' || low === 'undefined') return null;
  if (startsWithAny(low, ['pdf', 'http', 'www.', 'archive.org'])) return null;
  s = stripTrailingRole(s);
  if (!looksLikePersonName(s)) return null;
  return s || null;
}

function looksLikePersonName(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  const low = toLowerAsciiish(s);
  if (includesAny(` ${low} `, [' on the '])) return false;
  if (includesAny(low, INSTITUTION_WORDS)) return false;
  const parts = splitWs(s);
  if (startsWithAny(low, ['the ', 'a ', 'an ']) && parts.length <= 6 && !s.includes(',')) {
    if (s === s.toUpperCase() || includesAny(low, TITLE_SITE_WORDS)) return false;
  }
  if (parts.length === 1 && !isInitialToken(parts[0]) && parts[0].length < 5) return false;
  if (parts.every((p) => isInitialToken(p))) return false;
  return true;
}

/** Strip parenthetical segments. */
function stripParens(s) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return collapseWhitespace(out);
}

/** Strip trailing ", 1853-1942" / "1853–1942" date ranges. */
function stripTrailingDates(s) {
  const str = String(s || '');
  // Find ", YYYY-…" or " YYYY-…" near the end
  for (let i = 0; i < str.length - 4; i++) {
    const ch = str[i];
    if (ch !== ',' && ch !== ' ') continue;
    let j = i + 1;
    while (j < str.length && str[j] === ' ') j += 1;
    let year = '';
    while (j < str.length && isAsciiDigit(str[j]) && year.length < 4) {
      year += str[j];
      j += 1;
    }
    if (year.length !== 4) continue;
    if (j >= str.length) return str.slice(0, i).trim();
    const dash = str[j];
    if (dash !== '-' && dash !== '–' && dash !== '—') continue;
    // Rest of string is date range / junk — drop from i
    return str.slice(0, i).trim();
  }
  return str.trim();
}

/**
 * Archive.org-style "Last, First (dates)" → "First Last"
 */
function normalizeCreator(raw) {
  let s = String(raw || '').split(';')[0].split('|')[0];
  s = stripParens(s);
  s = stripTrailingDates(s);
  s = collapseWhitespace(s);
  const comma = s.indexOf(',');
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    if (splitWs(last).length <= 4 && splitWs(first).length <= 6 && !hasDigit(last)) {
      return normalizeAuthor(`${first} ${last}`);
    }
  }
  return normalizeAuthor(s);
}

/**
 * Scan for capitalized name tokens starting at idx (after "by "/"By ").
 * Returns { name, end } or null.
 */
function scanCapitalizedName(text, start, maxExtraTokens) {
  const s = String(text || '');
  let i = start;
  while (i < s.length && s[i] === ' ') i += 1;
  if (i >= s.length || s[i] < 'A' || s[i] > 'Z') return null;
  const tokens = [];
  while (i < s.length && tokens.length <= maxExtraTokens + 1) {
    if (tokens.length && s[i] === ' ') {
      i += 1;
      while (i < s.length && s[i] === ' ') i += 1;
      if (i >= s.length) break;
      // Next token must be capital or initial
      if (s[i] < 'A' || s[i] > 'Z') break;
    } else if (tokens.length) {
      break;
    }
    let tok = '';
    while (i < s.length && isNameTokenChar(s[i])) {
      tok += s[i];
      i += 1;
    }
    if (!tok) break;
    tokens.push(tok);
    if (tokens.length > maxExtraTokens + 1) {
      tokens.pop();
      break;
    }
  }
  if (!tokens.length) return null;
  return { name: tokens.join(' '), end: i };
}

function findByName(text) {
  const s = String(text || '');
  const low = toLowerAsciiish(s);
  let from = 0;
  while (from < s.length) {
    const idx = low.indexOf('by ', from);
    if (idx < 0) break;
    // word boundary: start or non-letter before
    if (idx > 0 && isAsciiLetter(low[idx - 1])) {
      from = idx + 2;
      continue;
    }
    const scanned = scanCapitalizedName(s, idx + 3, 5);
    if (scanned) return scanned.name;
    from = idx + 2;
  }
  return null;
}

function authorsFromTitle(title) {
  const t = collapseWhitespace(title);
  if (!t) return [];
  const out = [];
  const push = (v) => {
    const a = normalizeAuthor(v);
    if (a && !out.includes(a)) out.push(a);
  };

  const by = findByName(t);
  if (by) push(by);

  // Em-dash / en-dash name before ( or end or [
  for (const dash of ['—', '–']) {
    const idx = t.indexOf(dash);
    if (idx < 0) continue;
    const scanned = scanCapitalizedName(t, idx + dash.length, 5);
    if (!scanned) continue;
    const after = t.slice(scanned.end).trimStart();
    if (!after || after.startsWith('(') || after.startsWith('[') || after === '') {
      push(scanned.name);
    }
  }

  // "Title - Author Name" at end
  const hyphenIdx = t.lastIndexOf(' - ');
  if (hyphenIdx >= 0) {
    const scanned = scanCapitalizedName(t, hyphenIdx + 3, 4);
    if (scanned && scanned.end >= t.length - 1) {
      if (splitWs(scanned.name).length >= 2) push(scanned.name);
    }
  }

  // "Title / Author" or "Title | Author"
  for (const sep of [' / ', ' | ', '/ ', '| ']) {
    const idx = t.lastIndexOf(sep);
    if (idx < 0) continue;
    const scanned = scanCapitalizedName(t, idx + sep.length, 4);
    if (scanned && scanned.end >= t.length - 1 && splitWs(scanned.name).length >= 2) {
      push(scanned.name);
    }
  }

  return out;
}

function authorsFromQuery(query) {
  const q = collapseWhitespace(query);
  if (!q) return [];
  const out = [];
  const push = (v) => {
    const a = normalizeAuthor(v);
    if (a && !out.includes(a)) out.push(a);
  };
  const by = findByName(q);
  if (by) push(by);
  return out;
}

function splitCreatorList(raw) {
  const s = String(raw || '');
  const parts = [];
  let cur = '';
  const low = toLowerAsciiish(s);
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ';') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    // " and " splitter
    if (low.slice(i, i + 5) === ' and ') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      i += 4;
      continue;
    }
    cur += s[i];
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function authorsFromMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const out = [];
  const push = (v, viaCreator) => {
    const a = viaCreator ? normalizeCreator(v) : normalizeAuthor(v);
    if (a && !out.includes(a)) out.push(a);
  };
  if (Array.isArray(m.authors)) m.authors.forEach((v) => push(v, false));
  if (m.author) push(m.author, false);
  if (m.work_author) push(m.work_author, false);
  if (m.creator) {
    splitCreatorList(m.creator).forEach((part) => push(part, true));
  }
  if (Array.isArray(m.creators)) m.creators.forEach((v) => push(v, true));
  return out;
}

/**
 * Collect authors from meta + title + optional query hint.
 */
function extractAuthors(title, meta, opts = {}) {
  const out = [];
  const seen = new Set();
  const add = (list) => {
    for (const a of list || []) {
      const key = a.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  };
  add(authorsFromMeta(meta));
  add(authorsFromTitle(title));
  if (opts.query) add(authorsFromQuery(opts.query));
  if (opts.hint) {
    const h = normalizeAuthor(opts.hint) || normalizeCreator(opts.hint);
    if (h) add([h]);
  }
  return out;
}

/**
 * Ensure meta has author / authors when we can infer them.
 * Does not overwrite an existing non-empty author unless opts.force.
 */
function enrichMeta(meta, title, opts = {}) {
  const base = meta && typeof meta === 'object' ? { ...meta } : {};
  const existing = extractAuthors(title, base, opts);
  if (!existing.length) return { meta: base, authors: [], changed: false };

  const hadAuthor = !!(base.author || (Array.isArray(base.authors) && base.authors.length) || base.work_author);
  if (hadAuthor && !opts.force) {
    if (!base.author && existing[0]) {
      base.author = existing[0];
      base.authors = existing.slice(0, 8);
      base.author_enriched_from = base.author_enriched_from || 'creator_or_title';
      return { meta: base, authors: existing, changed: true };
    }
    return { meta: base, authors: existing, changed: false };
  }

  base.author = existing[0];
  base.authors = existing.slice(0, 8);
  if (!base.creator || opts.force) base.creator = existing[0];
  base.author_enriched_from = opts.from || 'title_meta_query';
  base.author_enriched_at = new Date().toISOString();
  return { meta: base, authors: existing, changed: true };
}

module.exports = {
  normalizeAuthor,
  normalizeCreator,
  looksLikePersonName,
  authorsFromTitle,
  authorsFromQuery,
  authorsFromMeta,
  extractAuthors,
  enrichMeta,
};
