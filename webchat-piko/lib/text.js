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

/** Word-boundary-ish check: phrase appears as a whole token (space-padded). */
function hasWord(haystack, word) {
  const h = ` ${String(haystack || '')} `;
  const w = String(word || '');
  if (!w) return false;
  return h.includes(` ${w} `);
}

function hasAnyWord(haystack, words) {
  for (const w of words || []) {
    if (hasWord(haystack, w)) return true;
  }
  return false;
}

function endsWithAny(s, suffixes) {
  const str = String(s || '');
  for (const suf of suffixes || []) {
    if (suf && str.endsWith(suf)) return true;
  }
  return false;
}

/** Literal multi-replace (no regex). */
function replaceAllLiteral(s, find, repl) {
  const str = String(s || '');
  const f = String(find);
  if (!f) return str;
  return str.split(f).join(String(repl));
}

/** Normalize curly/smart quotes to ASCII. */
function normalizeApostrophes(text) {
  let s = String(text || '');
  const map = {
    '\u2018': "'", '\u2019': "'", '\u201B': "'", '\u2032': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2033': '"',
  };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += map[ch] != null ? map[ch] : ch;
  }
  return out;
}

/** Case-insensitive startsWith. */
function startsWithIgnoreCase(s, prefix) {
  const str = String(s || '');
  const p = String(prefix || '');
  if (!p) return true;
  if (str.length < p.length) return false;
  return str.slice(0, p.length).toLowerCase() === p.toLowerCase();
}

/** Strip a case-insensitive prefix once; returns original if no match. */
function stripPrefixIgnoreCase(s, prefix) {
  const str = String(s || '');
  if (!startsWithIgnoreCase(str, prefix)) return str;
  return str.slice(String(prefix).length);
}

/** Tokens of ASCII alnum length >= minLen. */
function extractAlnumTokens(s, minLen = 4) {
  const str = toLowerAsciiish(s);
  const out = [];
  let buf = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch)) {
      buf += ch;
    } else if (buf) {
      if (buf.length >= minLen) out.push(buf);
      buf = '';
    }
  }
  if (buf.length >= minLen) out.push(buf);
  return out;
}

/** Find outermost {...} JSON-ish slice; returns string or null. */
function extractBalancedJsonObject(s) {
  const str = String(s || '');
  const start = str.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse "at 10am", "to 9:30 pm", "@ 14:00", or bare "10am".
 * Returns HH:MM 24h string or null.
 */
function parseClockMention(message) {
  const text = String(message || '');
  const low = toLowerAsciiish(text);
  // Prefer "to|at|@" then bare am/pm clock.
  const tryAt = (idx) => {
    if (idx < 0) return null;
    let i = idx;
    while (i < low.length && isWhitespace(low[i])) i += 1;
    let num = '';
    while (i < low.length && isAsciiDigit(low[i])) {
      num += low[i];
      i += 1;
    }
    if (!num || num.length > 2) return null;
    let min = '00';
    if (low[i] === ':') {
      i += 1;
      let mbuf = '';
      while (i < low.length && isAsciiDigit(low[i]) && mbuf.length < 2) {
        mbuf += low[i];
        i += 1;
      }
      if (mbuf.length !== 2) return null;
      min = mbuf;
    }
    while (i < low.length && isWhitespace(low[i])) i += 1;
    let ampm = '';
    if (low.slice(i, i + 2) === 'am' || low.slice(i, i + 2) === 'pm') {
      ampm = low.slice(i, i + 2);
    }
    let hour = Number(num);
    const minute = Number(min);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!ampm && hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  for (const cue of ['to ', 'at ', '@ ']) {
    let from = 0;
    while (from < low.length) {
      const idx = low.indexOf(cue, from);
      if (idx < 0) break;
      // word-ish: start or preceded by non-letter
      if (idx === 0 || !isAsciiLetter(low[idx - 1])) {
        const hit = tryAt(idx + cue.length);
        if (hit) return hit;
      }
      from = idx + cue.length;
    }
  }
  // Bare N:MM am/pm or Nam/pm
  for (let i = 0; i < low.length; i++) {
    if (!isAsciiDigit(low[i])) continue;
    if (i > 0 && (isAsciiDigit(low[i - 1]) || isAsciiLetter(low[i - 1]))) continue;
    const hit = tryAt(i);
    if (hit && (low.includes('am') || low.includes('pm') || low.includes(':'))) {
      // require am/pm for bare forms without cue, unless HH:MM 24h-looking
      const slice = low.slice(i, i + 8);
      if (slice.includes('am') || slice.includes('pm')) return hit;
    }
  }
  return null;
}

/** Strip trailing `/` characters from a URL/path base. */
function stripTrailingSlash(s) {
  let base = String(s || '');
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

/** Remove CR/LF from a string (env values, tokens). */
function removeNewlines(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (ch !== '\n' && ch !== '\r') out += ch;
  }
  return out;
}

/** True if s is all ASCII digits (and non-empty). */
function isAllAsciiDigits(s) {
  const str = String(s || '');
  if (!str) return false;
  for (let i = 0; i < str.length; i++) {
    if (!isAsciiDigit(str[i])) return false;
  }
  return true;
}

/** YYYY-MM-DD at start of string (optionally more after). */
function startsWithYyyyMmDd(s) {
  const str = String(s || '');
  if (str.length < 10) return false;
  for (let i = 0; i < 10; i++) {
    const ch = str[i];
    if (i === 4 || i === 7) {
      if (ch !== '-') return false;
    } else if (!isAsciiDigit(ch)) return false;
  }
  return true;
}

/** Exact YYYY-MM. */
function isYyyyMm(s) {
  const str = String(s || '');
  if (str.length !== 7) return false;
  for (let i = 0; i < 7; i++) {
    const ch = str[i];
    if (i === 4) {
      if (ch !== '-') return false;
    } else if (!isAsciiDigit(ch)) return false;
  }
  return true;
}

/** UUID-ish: 36 chars hex + hyphens (8-4-4-4-12). */
function isUuidLike(s) {
  const str = String(s || '');
  if (str.length !== 36) return false;
  const groups = [8, 4, 4, 4, 12];
  let i = 0;
  for (let g = 0; g < groups.length; g++) {
    if (g > 0) {
      if (str[i] !== '-') return false;
      i += 1;
    }
    for (let k = 0; k < groups[g]; k++) {
      if (!isHexChar(str[i])) return false;
      i += 1;
    }
  }
  return i === 36;
}

/** Safe cookie/path prefix: `/` + word/./- chars only. */
function isSafePathPrefix(s) {
  const str = String(s || '');
  if (!str.startsWith('/')) return false;
  for (let i = 1; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '_' || ch === '.' || ch === '/' || ch === '-') continue;
    return false;
  }
  return true;
}

/**
 * Match pathname against a template like '/api/foo/:id/bar'.
 * `:name` captures one segment; `*` captures the rest joined.
 * Returns params object or null.
 */
function matchPath(pathname, template) {
  const path = String(pathname || '');
  const tpl = String(template || '');
  const pParts = path.split('/').filter((x) => x.length > 0);
  const tParts = tpl.split('/').filter((x) => x.length > 0);
  // Allow trailing empty from leading /
  if (path.startsWith('/') !== tpl.startsWith('/') && path !== '' && tpl !== '') {
    // both should typically start with /
  }
  const params = {};
  let pi = 0;
  for (let ti = 0; ti < tParts.length; ti++) {
    const t = tParts[ti];
    if (t === '*') {
      params.rest = pParts.slice(pi).join('/');
      return params;
    }
    if (pi >= pParts.length) return null;
    if (t.startsWith(':')) {
      params[t.slice(1)] = decodeURIComponent(pParts[pi]);
      pi += 1;
      continue;
    }
    if (t !== pParts[pi]) return null;
    pi += 1;
  }
  if (pi !== pParts.length) return null;
  return params;
}

/** Split markdown on lines that start a `## ` heading. Keeps heading text with body. */
function splitMarkdownH2(raw) {
  const lines = splitLines(raw);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (cur != null) blocks.push(cur);
      cur = line.slice(3); // drop "## "
      continue;
    }
    if (cur == null) {
      // preamble before first ## — keep as its own block if non-empty
      if (line.length || blocks.length) {
        if (cur == null) cur = line;
        else cur += '\n' + line;
      }
      continue;
    }
    cur += '\n' + line;
  }
  if (cur != null && String(cur).trim()) blocks.push(cur);
  return blocks;
}

/** Strip leading list markers like "- ", "* ", "• ", "1. ", "1) ". */
function stripListMarker(s) {
  let str = String(s || '').trim();
  if (!str) return str;
  for (const m of ['- ', '* ', '• ']) {
    if (str.startsWith(m)) {
      str = str.slice(m.length).trim();
      break;
    }
  }
  // optional leading digits + . or )
  let i = 0;
  while (i < str.length && isAsciiDigit(str[i])) i += 1;
  if (i > 0 && (str[i] === '.' || str[i] === ')')) {
    const after = str[i + 1];
    if (after === undefined || after === ' ' || after === '\t') {
      str = str.slice(i + 1).trim();
    }
  }
  return str;
}

/** Strip ``` / ```json fences from LLM output. */
function stripCodeFences(s) {
  let str = String(s || '').trim();
  if (str.startsWith('```')) {
    const nl = str.indexOf('\n');
    if (nl >= 0) str = str.slice(nl + 1);
    else str = str.slice(3);
  }
  if (str.endsWith('```')) str = str.slice(0, -3);
  // also remove mid-string ```json markers via literal split
  str = replaceAllLiteral(str, '```json', '');
  str = replaceAllLiteral(str, '```', '');
  return str.trim();
}

/** Upsert/remove KEY=value lines in .env content (line startsWith). */
function upsertEnvLine(envContent, key, value) {
  const lines = splitLines(envContent);
  const prefix = key + '=';
  const safe = removeNewlines(String(value)).trim();
  const nextLine = prefix + safe;
  let found = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      if (!found) {
        out.push(nextLine);
        found = true;
      }
      // drop duplicate key lines
      continue;
    }
    out.push(line);
  }
  if (!found) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(nextLine);
  }
  return out.join('\n');
}

function removeEnvLine(envContent, key) {
  const lines = splitLines(envContent);
  const prefix = key + '=';
  const out = [];
  for (const line of lines) {
    if (line.startsWith(prefix)) continue;
    out.push(line);
  }
  // squeeze consecutive blanks
  return squeezeBlankLines(out.join('\n')).trimEnd();
}


/** Index of first non-whitespace char, or -1. */
function firstNonWhitespaceIndex(s) {
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    if (!isWhitespace(str[i])) return i;
  }
  return -1;
}

/** Replace tabs with two spaces. */
function tabsToSpaces(s, width = 2) {
  const pad = ' '.repeat(width);
  return replaceAllLiteral(s, '\t', pad);
}

/** Slug: keep a-z0-9 as-is, map other chars to sep, collapse/trim sep. */
function slugify(s, opts = {}) {
  const sep = opts.sep != null ? opts.sep : '_';
  const lower = opts.lower !== false;
  let str = String(s || '');
  if (lower) str = str.toLowerCase();
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch)) out += lower ? ch.toLowerCase() : ch;
    else out += sep;
  }
  while (out.includes(sep + sep)) out = out.split(sep + sep).join(sep);
  while (out.startsWith(sep)) out = out.slice(1);
  while (out.endsWith(sep)) out = out.slice(0, -1);
  return out;
}

/** Keep only chars in allow set (string of allowed chars); others → repl. */
function sanitizeCharset(s, allowed, repl = '') {
  const allow = new Set(String(allowed || '').split(''));
  let out = '';
  for (const ch of String(s || '')) {
    if (isAsciiLetter(ch) || isAsciiDigit(ch) || allow.has(ch)) out += ch;
    else out += repl;
  }
  return out;
}

/** Strip trailing . ! ? chars. */
function stripTrailingSentencePunct(s) {
  let str = String(s || '').trim();
  while (str.length && '.!?'.includes(str[str.length - 1])) str = str.slice(0, -1);
  return str;
}

/** Find "key": number in JSON-ish text. */
function extractJsonNumberField(s, key) {
  const needle = '"' + key + '"';
  const str = String(s || '');
  let from = 0;
  while (from < str.length) {
    const idx = str.indexOf(needle, from);
    if (idx < 0) return null;
    let i = idx + needle.length;
    while (i < str.length && isWhitespace(str[i])) i++;
    if (str[i] !== ':') { from = idx + 1; continue; }
    i++;
    while (i < str.length && isWhitespace(str[i])) i++;
    let num = '';
    if (str[i] === '-') { num = '-'; i++; }
    while (i < str.length && isAsciiDigit(str[i])) { num += str[i]; i++; }
    if (num && num !== '-') return Number(num);
    from = idx + 1;
  }
  return null;
}

/** Find "key": "value" (basic escapes) or null literal. Returns {value, isNull}. */
function extractJsonStringField(s, key) {
  const needle = '"' + key + '"';
  const str = String(s || '');
  let from = 0;
  while (from < str.length) {
    const idx = str.indexOf(needle, from);
    if (idx < 0) return null;
    let i = idx + needle.length;
    while (i < str.length && isWhitespace(str[i])) i++;
    if (str[i] !== ':') { from = idx + 1; continue; }
    i++;
    while (i < str.length && isWhitespace(str[i])) i++;
    if (str.slice(i, i + 4) === 'null') return { value: null, isNull: true };
    if (str[i] !== '"') { from = idx + 1; continue; }
    i++;
    let out = '';
    let esc = false;
    while (i < str.length) {
      const ch = str[i];
      if (esc) { out += ch; esc = false; i++; continue; }
      if (ch === '\\') { esc = true; i++; continue; }
      if (ch === '"') return { value: out, isNull: false };
      out += ch;
      i++;
    }
    // truncated string
    return { value: out, isNull: false, truncated: true };
  }
  return null;
}

/** Replace {{dotted.keys}} in template from payload object. */
function interpolateDoubleMustache(template, payload) {
  const src = String(template || '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{{', i);
    if (open < 0) { out += src.slice(i); break; }
    out += src.slice(i, open);
    const close = src.indexOf('}}', open + 2);
    if (close < 0) { out += src.slice(open); break; }
    const k = src.slice(open + 2, close).trim();
    if (k === 'payload') out += JSON.stringify(payload || {});
    else {
      const parts = k.split('.');
      let v = payload;
      for (const p of parts) v = v && typeof v === 'object' ? v[p] : undefined;
      out += v != null ? String(v) : '';
    }
    i = close + 2;
  }
  return out;
}

/** Word-boundary match for alias (multi-word → includes collapsed; single → hasWord). */
function aliasMatch(text, alias) {
  const t = toLowerAsciiish(text);
  const a = toLowerAsciiish(alias).trim();
  if (!a || !t) return false;
  if (a.includes(' ')) return collapseWhitespace(t).includes(collapseWhitespace(a));
  return hasWord(t, a);
}

function envHasKey(envContent, key) {
  const prefix = key + '=';
  for (const line of splitLines(envContent)) {
    if (line.startsWith(prefix)) return true;
  }
  return false;
}

/** Strip HTML/XML tags to spaces, then collapse whitespace. */
function stripHtmlTags(s) {
  const str = String(s || '');
  let out = '';
  let inTag = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<') { inTag = true; continue; }
    if (ch === '>' && inTag) { inTag = false; out += ' '; continue; }
    if (!inTag) out += ch;
  }
  return collapseWhitespace(out);
}

/** Remove <...> spans (e.g. email angle-addresses). */
function stripAngleBrackets(s) {
  const str = String(s || '');
  let out = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '<') {
      const close = str.indexOf('>', i + 1);
      if (close < 0) { out += str.slice(i); break; }
      i = close + 1;
      continue;
    }
    out += str[i];
    i += 1;
  }
  return out;
}

/** Non-overlapping case-insensitive occurrence count. */
function countOccurrencesIgnoreCase(haystack, needle) {
  const h = toLowerAsciiish(haystack);
  const n = toLowerAsciiish(needle);
  if (!n) return 0;
  let count = 0;
  let from = 0;
  while (from < h.length) {
    const idx = h.indexOf(n, from);
    if (idx < 0) break;
    count += 1;
    from = idx + n.length;
  }
  return count;
}

/** True if line is a ## heading with at least one space after ##. Returns body after ##\s+ or null. */
function markdownH2Body(line) {
  const s = String(line || '');
  if (!s.startsWith('##')) return null;
  let i = 2;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i += 1;
  if (i === 2) return null;
  return s.slice(i);
}

/**
 * Split on ## headings (requires whitespace after ##), like String#split(/\n##\s+/).
 * First block keeps a leading ## if present; later blocks start with heading text only.
 */
function splitMarkdownH2Loose(raw) {
  const lines = splitLines(raw);
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const body = i > 0 ? markdownH2Body(line) : null;
    if (body != null) {
      if (cur != null) blocks.push(cur);
      cur = body;
      continue;
    }
    if (cur == null) cur = line;
    else cur += '\n' + line;
  }
  if (cur != null) blocks.push(cur);
  return blocks;
}

/** True if line is `## YYYY-MM-DD...` (optional spaces after ##). */
function isMarkdownDateH2(line) {
  const body = markdownH2Body(line);
  if (body == null) return false;
  return startsWithYyyyMmDd(body.trim());
}

/** Split markdown before each `## YYYY-MM-DD` heading (keeps heading with its block). */
function splitMarkdownDateSections(raw) {
  const lines = splitLines(raw);
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (isMarkdownDateH2(line) && cur.length) {
      blocks.push(cur.join('\n'));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks;
}

/** YYYY-MM-DD from a ## date heading, or null. */
function parseMarkdownDateH2(line) {
  const body = markdownH2Body(line);
  if (body == null) return null;
  const t = body.trim();
  if (!startsWithYyyyMmDd(t)) return null;
  return t.slice(0, 10);
}

/** Title text after `## `, or null. */
function markdownH2Title(line) {
  const body = markdownH2Body(String(line || '').trim());
  if (body == null) return null;
  const t = body.trim();
  return t || null;
}

/** Strip leading bullets/ws then numbered markers (repeat-safe). */
function stripListPrefixLoose(s) {
  let str = String(s || '').trim();
  let guard = 0;
  while (str.length && guard < 8) {
    guard += 1;
    const ch = str[0];
    if (ch === '-' || ch === '*' || ch === '•' || isWhitespace(ch)) {
      str = str.slice(1).trim();
      continue;
    }
    const next = stripListMarker(str);
    if (next === str) break;
    str = next;
  }
  return str;
}

function startsWithNumberedMarker(line) {
  const s = String(line || '');
  let i = 0;
  while (i < s.length && isAsciiDigit(s[i])) i += 1;
  if (i === 0) return false;
  if (s[i] !== '.' && s[i] !== ')') return false;
  const after = s[i + 1];
  return after === undefined || isWhitespace(after) || after === '-' || after === '*' || after === '•';
}

/** Split text into chunks at numbered list item starts (1. / 2)). */
function splitNumberedListChunks(text) {
  const lines = splitLines(text);
  const chunks = [];
  let cur = null;
  for (const line of lines) {
    if (startsWithNumberedMarker(line)) {
      if (cur != null && String(cur).trim()) chunks.push(cur);
      cur = line;
    } else if (cur == null) {
      cur = line;
    } else {
      cur += '\n' + line;
    }
  }
  if (cur != null && String(cur).trim()) chunks.push(cur);
  return chunks;
}

/** Newlines → space, then collapse whitespace. */
function collapseNewlinesToSpace(s) {
  let out = '';
  for (const ch of String(s || '')) {
    out += (ch === '\n' || ch === '\r') ? ' ' : ch;
  }
  return collapseWhitespace(out);
}

/** Strip one leading+trailing quote pair (" or '). */
function stripWrappingQuotesLoose(s) {
  let str = String(s || '').trim();
  if (str.length >= 2) {
    const a = str[0];
    const b = str[str.length - 1];
    if ((a === '"' || a === "'") && (b === '"' || b === "'")) {
      str = str.slice(1, -1).trim();
    }
  }
  return str;
}

/** Remove whole-word/phrase matches (ASCII letter/digit boundaries), case-insensitive. */
function removeWholePhraseIgnoreCase(s, phrase) {
  const str = String(s || '');
  const p = String(phrase || '');
  if (!p) return str;
  const low = toLowerAsciiish(str);
  const plow = toLowerAsciiish(p);
  let out = '';
  let i = 0;
  while (i < str.length) {
    const idx = low.indexOf(plow, i);
    if (idx < 0) { out += str.slice(i); break; }
    const before = idx === 0 ? ' ' : low[idx - 1];
    const afterIdx = idx + plow.length;
    const after = afterIdx >= low.length ? ' ' : low[afterIdx];
    const beforeOk = !isAsciiLetter(before) && !isAsciiDigit(before);
    const afterOk = !isAsciiLetter(after) && !isAsciiDigit(after);
    if (beforeOk && afterOk) {
      out += str.slice(i, idx);
      i = afterIdx;
    } else {
      out += str.slice(i, idx + 1);
      i = idx + 1;
    }
  }
  return out;
}

/** Keep only ASCII digits, `.`, and `-`. */
function keepAsciiDigitsDotMinus(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (isAsciiDigit(ch) || ch === '.' || ch === '-') out += ch;
  }
  return out;
}

/** Extract quoted "..." / '...' spans with length in [minLen, maxLen]. */
function extractQuotedSpans(s, minLen = 2, maxLen = 20) {
  const str = String(s || '');
  const out = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      let buf = '';
      while (j < str.length && str[j] !== q) {
        buf += str[j];
        j += 1;
      }
      if (j < str.length && buf.length >= minLen && buf.length <= maxLen) out.push(buf);
      i = j < str.length ? j + 1 : j;
      continue;
    }
    i += 1;
  }
  return out;
}

function unwrapDelimOnce(s, delim) {
  const str = String(s || '');
  let out = '';
  let i = 0;
  while (i < str.length) {
    const open = str.indexOf(delim, i);
    if (open < 0) { out += str.slice(i); break; }
    out += str.slice(i, open);
    const close = str.indexOf(delim, open + delim.length);
    if (close < 0) { out += str.slice(open); break; }
    out += str.slice(open + delim.length, close);
    i = close + delim.length;
  }
  return out;
}

/** Strip markdown **bold** / __bold__ / *em* / _em_ markers. */
function stripMarkdownEmphasis(str) {
  let s = String(str || '');
  s = unwrapDelimOnce(s, '**');
  s = unwrapDelimOnce(s, '__');
  s = unwrapDelimOnce(s, '*');
  s = unwrapDelimOnce(s, '_');
  s = replaceAllLiteral(s, '**', '');
  s = replaceAllLiteral(s, '__', '');
  return s.trim();
}

/** Parse `key: 123` line (optional surrounding whitespace). Returns number or null. */
function parseKeyColonInt(line, key) {
  let s = String(line || '').trim();
  const k = String(key || '');
  if (!k || !startsWithIgnoreCase(s, k)) return null;
  s = s.slice(k.length).trim();
  if (!s.startsWith(':')) return null;
  s = s.slice(1).trim();
  if (!isAllAsciiDigits(s)) return null;
  return Number(s);
}

/** Text after `prefix` through end of line (first line only). */
function textAfterPrefixOnFirstLine(block, prefix) {
  const str = String(block || '');
  const p = String(prefix || '');
  if (!p) return null;
  const idx = str.indexOf(p);
  if (idx < 0) return null;
  let i = idx + p.length;
  while (i < str.length && isWhitespace(str[i]) && str[i] !== '\n' && str[i] !== '\r') i += 1;
  let end = i;
  while (end < str.length && str[end] !== '\n' && str[end] !== '\r') end += 1;
  const out = str.slice(i, end).trim();
  return out || null;
}

/** Phrase match with space-padding (multi-word) after collapse+lower. */
function includesCollapsedPhrase(haystack, phrase) {
  const h = ` ${collapseWhitespace(toLowerAsciiish(haystack))} `;
  const p = collapseWhitespace(toLowerAsciiish(phrase));
  if (!p) return false;
  return h.includes(` ${p} `);
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
  hasWord,
  hasAnyWord,
  endsWithAny,
  replaceAllLiteral,
  normalizeApostrophes,
  startsWithIgnoreCase,
  stripPrefixIgnoreCase,
  extractAlnumTokens,
  extractBalancedJsonObject,
  parseClockMention,
  stripTrailingSlash,
  removeNewlines,
  isAllAsciiDigits,
  startsWithYyyyMmDd,
  isYyyyMm,
  isUuidLike,
  isSafePathPrefix,
  matchPath,
  splitMarkdownH2,
  stripListMarker,
  stripCodeFences,
  upsertEnvLine,
  removeEnvLine,
  envHasKey,
  firstNonWhitespaceIndex,
  tabsToSpaces,
  slugify,
  sanitizeCharset,
  stripTrailingSentencePunct,
  extractJsonNumberField,
  extractJsonStringField,
  interpolateDoubleMustache,
  aliasMatch,
  stripHtmlTags,
  stripAngleBrackets,
  countOccurrencesIgnoreCase,
  markdownH2Body,
  splitMarkdownH2Loose,
  isMarkdownDateH2,
  splitMarkdownDateSections,
  parseMarkdownDateH2,
  markdownH2Title,
  stripListPrefixLoose,
  startsWithNumberedMarker,
  splitNumberedListChunks,
  collapseNewlinesToSpace,
  stripWrappingQuotesLoose,
  removeWholePhraseIgnoreCase,
  keepAsciiDigitsDotMinus,
  extractQuotedSpans,
  stripMarkdownEmphasis,
  parseKeyColonInt,
  textAfterPrefixOnFirstLine,
  includesCollapsedPhrase,
};
