/**
 * Char-scan text helpers — no regex.
 * Used by WP8 regex-elimination replacements (normalize, parse, validate).
 */

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
    || ch === '\u00a0' || ch === '\u2000' || ch === '\u2001' || ch === '\u2002'
    || ch === '\u2003' || ch === '\u2009' || ch === '\u200a' || ch === '\u2028' || ch === '\u2029';
}

function isAsciiDigit(ch) {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function isAsciiLetter(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isHexChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

/**
 * Letter/number check without regex. ASCII alnum + non-ASCII code points
 * outside known punctuation/symbol ranges (keeps ö/é/ö for Göbekli etc.).
 */
function isLetterOrNumber(ch) {
  if (!ch) return false;
  if (isAsciiDigit(ch) || isAsciiLetter(ch)) return true;
  const code = ch.codePointAt(0);
  if (code <= 127) return false;
  if (code === 0xfeff) return false;
  // General punctuation, quotes, dashes
  if (code >= 0x2000 && code <= 0x206f) return false;
  if (code >= 0x2e00 && code <= 0x2e7f) return false;
  // CJK symbols/punctuation
  if (code >= 0x3000 && code <= 0x303f) return false;
  // Variation selectors / combining marks treated as not letter for keep filter
  if (code >= 0xfe00 && code <= 0xfe0f) return false;
  // Emoji / pictographs
  if (code >= 0x1f300 && code <= 0x1faff) return false;
  return true;
}

function collapseWhitespace(s) {
  const str = String(s || '');
  let out = '';
  let prevWs = false;
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (isWhitespace(ch)) {
      if (!prevWs && out.length) {
        out += ' ';
        prevWs = true;
      }
      continue;
    }
    out += ch;
    prevWs = false;
  }
  return out.trim();
}

const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', '"', "'", '”', '’', ')', ']', '}']);

function stripTrailingPunct(s) {
  let str = String(s || '');
  while (str.length && TRAILING_PUNCT.has(str[str.length - 1])) {
    str = str.slice(0, -1);
  }
  return str.trim();
}

function keepLettersDigitsSpaces(s) {
  const str = String(s || '');
  let out = '';
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (isLetterOrNumber(ch) || isWhitespace(ch)) out += ch;
    else out += ' ';
  }
  return collapseWhitespace(out);
}

function splitLines(s) {
  const str = String(s || '');
  const lines = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\n') {
      if (cur.endsWith('\r')) cur = cur.slice(0, -1);
      lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  lines.push(cur);
  return lines;
}

/** Extract runs of ASCII digits as numbers (and their string forms). */
function extractDigitRuns(s) {
  const str = String(s || '');
  const runs = [];
  let buf = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiDigit(ch)) {
      buf += ch;
    } else if (buf) {
      runs.push({ text: buf, value: Number(buf), index: i - buf.length });
      buf = '';
    }
  }
  if (buf) runs.push({ text: buf, value: Number(buf), index: str.length - buf.length });
  return runs;
}

/**
 * Safe identifier check: every char must be in alphabet string.
 * alphabet examples: 'a-z0-9_-' via explicit charset helpers.
 */
function isSafeName(s, opts = {}) {
  const str = String(s || '');
  const min = opts.min != null ? opts.min : 1;
  const max = opts.max != null ? opts.max : 128;
  if (str.length < min || str.length > max) return false;
  const allowDot = opts.allowDot === true;
  const allowColon = opts.allowColon === true;
  const allowHyphen = opts.allowHyphen !== false;
  const allowUnderscore = opts.allowUnderscore !== false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch)) continue;
    if (allowUnderscore && ch === '_') continue;
    if (allowHyphen && ch === '-') continue;
    if (allowDot && ch === '.') continue;
    if (allowColon && ch === ':') continue;
    return false;
  }
  if (str.includes('..')) return false;
  return true;
}

function startsWithAny(s, prefixes) {
  const str = String(s || '');
  for (const p of prefixes || []) {
    if (str.startsWith(p)) return true;
  }
  return false;
}

function includesAny(haystack, phrases) {
  const h = String(haystack || '');
  for (const p of phrases || []) {
    if (p && h.includes(p)) return true;
  }
  return false;
}

function toLowerAsciiish(s) {
  return String(s || '').toLowerCase();
}

/** Squeeze runs of blank lines so at most one empty line remains between content. */
function squeezeBlankLines(s) {
  const lines = splitLines(s);
  const out = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun += 1;
      if (blankRun <= 1) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out.join('\n');
}

function stripTrailingSpacesPerLine(s) {
  return splitLines(s).map((line) => {
    let end = line.length;
    while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
    return line.slice(0, end);
  }).join('\n');
}

/** Parse HH:MM; returns {h,m} or null. */
function parseHhMm(s) {
  const str = String(s || '').trim();
  const parts = str.split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (parts[0].length < 1 || parts[0].length > 2) return null;
  if (parts[1].length !== 2) return null;
  for (const ch of parts[0] + parts[1]) {
    if (!isAsciiDigit(ch)) return null;
  }
  return { h, m };
}

/** Duration token like 5m / 2h / 1d — returns {value, unit} or null. */
function parseDurationToken(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  let i = 0;
  let num = '';
  while (i < str.length && isAsciiDigit(str[i])) {
    num += str[i];
    i += 1;
  }
  if (!num || i !== str.length - 1) return null;
  const unit = str[i].toLowerCase();
  if (!'smhdw'.includes(unit)) return null;
  return { value: Number(num), unit };
}

function hasHttpUrl(s) {
  const lower = toLowerAsciiish(s);
  return lower.includes('http://') || lower.includes('https://');
}

module.exports = {
  isWhitespace,
  isAsciiDigit,
  isAsciiLetter,
  isHexChar,
  isLetterOrNumber,
  collapseWhitespace,
  stripTrailingPunct,
  keepLettersDigitsSpaces,
  splitLines,
  extractDigitRuns,
  isSafeName,
  startsWithAny,
  includesAny,
  toLowerAsciiish,
  squeezeBlankLines,
  stripTrailingSpacesPerLine,
  parseHhMm,
  parseDurationToken,
  hasHttpUrl,
};
