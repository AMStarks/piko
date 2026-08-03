/**
 * Operator voice — final polish for chat-visible assistant text.
 *
 * Piko should read like a capable assistant, not a job scheduler. This module
 * is the deterministic safety net applied at the outbound sinks (HTTP reply,
 * SSE stream, session store): it strips internal telemetry, job UUIDs, and
 * worker tags that individual code paths may still emit.
 *
 * It deliberately does NOT use an LLM: polish must be instant, predictable,
 * and testable. Friendlier phrasing belongs at the message source (see
 * legateChat formatters); this layer just guarantees a floor.
 *
 * Kill switch: PIKO_OPERATOR_VOICE=off
 */
const {
  splitLines,
  squeezeBlankLines,
  stripTrailingSpacesPerLine,
  toLowerAsciiish,
  startsWithIgnoreCase,
  includesAny,
  isAsciiDigit,
  isHexChar,
  isAsciiLetter,
  replaceAllLiteral,
  collapseWhitespace,
} = require('./text');

const AGENT_FRIENDLY_NAMES = {
  'ei-worker': 'my researcher',
  'ei-harvester': 'my collector',
  'ei-scholar': 'the scholar',
  'ei-scribe': 'the scribe',
  'ei-pipeline': 'the pipeline crew',
  'ei-qa': 'my reviewer',
};

function friendlyAgentName(agentId) {
  return AGENT_FRIENDLY_NAMES[String(agentId || '').trim()] || 'my agent';
}

function isJobIdChar(ch) {
  return isAsciiDigit(ch) || isHexChar(ch) || ch === '-';
}

/** Find /agent stop job_... spans; returns [{start,end,text}] */
function findStopHints(s) {
  const out = [];
  const needle = '/agent stop job_';
  let from = 0;
  while (from < s.length) {
    const idx = s.toLowerCase().indexOf(needle, from);
    if (idx < 0) break;
    let i = idx + needle.length;
    while (i < s.length && (isAsciiLetter(s[i]) || isAsciiDigit(s[i]) || s[i] === '_' || s[i] === '-')) i += 1;
    out.push({ start: idx, end: i, text: s.slice(idx, i) });
    from = i;
  }
  return out;
}

function isJobUuidAt(s, idx) {
  // job_ + hex/digit + at least 7 more hex/digit/-
  if (toLowerAsciiish(s.slice(idx, idx + 4)) !== 'job_') return false;
  let i = idx + 4;
  let n = 0;
  while (i < s.length && isJobIdChar(s[i])) {
    n += 1;
    i += 1;
  }
  return n >= 8;
}

function protectStops(text) {
  const stops = [];
  const hits = findStopHints(text);
  if (!hits.length) return { text, stops };
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += text.slice(cursor, h.start);
    stops.push(h.text);
    out += `\u0000STOP${stops.length - 1}\u0000`;
    cursor = h.end;
  }
  out += text.slice(cursor);
  return { text: out, stops };
}

function restoreStops(text, stops) {
  let out = text;
  for (let i = 0; i < stops.length; i++) {
    out = replaceAllLiteral(out, `\u0000STOP${i}\u0000`, stops[i] || '');
  }
  return out;
}

function scrubJobIds(text) {
  let out = '';
  let i = 0;
  const s = text;
  while (i < s.length) {
    if (isJobUuidAt(s, i)) {
      // "job job_uuid" → "job" (drop the space before the uuid too)
      if (out.endsWith('job ')) {
        out = out.slice(0, -1);
        let j = i + 4;
        while (j < s.length && isJobIdChar(s[j])) j += 1;
        i = j;
        continue;
      }
      let j = i + 4;
      while (j < s.length && isJobIdChar(s[j])) j += 1;
      out += 'this job';
      i = j;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

function stripInlineReviewStamps(line) {
  let s = line;
  // [Piko review: accept]
  const accept = '[piko review: accept]';
  let low = toLowerAsciiish(s);
  while (low.includes(accept)) {
    const idx = low.indexOf(accept);
    s = s.slice(0, idx) + s.slice(idx + accept.length);
    // trim following spaces
    while (s[idx] === ' ' || s[idx] === '\t') s = s.slice(0, idx) + s.slice(idx + 1);
    low = toLowerAsciiish(s);
  }
  for (const kind of ['revise', 'escalate', 'fail']) {
    const stamp = `[piko review: ${kind}]`;
    low = toLowerAsciiish(s);
    while (low.includes(stamp)) {
      const idx = low.indexOf(stamp);
      let rest = s.slice(idx + stamp.length);
      while (rest.startsWith(' ') || rest.startsWith('\t')) rest = rest.slice(1);
      s = s.slice(0, idx) + 'Note: ' + rest;
      low = toLowerAsciiish(s);
    }
  }
  return s;
}

function stripLeadingWorkerTag(line) {
  if (!line.startsWith('[')) return line;
  const close = line.indexOf(']');
  if (close < 1 || close > 61) return line;
  // keep markdown links [text](url)
  if (line[close + 1] === '(') return line;
  let rest = line.slice(close + 1);
  while (rest.startsWith(' ') || rest.startsWith('\t')) rest = rest.slice(1);
  return rest;
}

function transformLegateReviewLine(line) {
  const low = toLowerAsciiish(line);
  if (!low.startsWith('legate review — ') && !low.startsWith('legate review - ')) return null;
  const onIdx = line.indexOf(' on “');
  const onIdx2 = line.indexOf(' on "');
  const idx = onIdx >= 0 ? onIdx : onIdx2;
  if (idx >= 0) {
    const quoteChar = onIdx >= 0 ? '“' : '"';
    const endQuote = onIdx >= 0 ? '”' : '"';
    const start = idx + ' on '.length;
    const end = line.indexOf(endQuote, start + 1);
    if (end > start) {
      return `Here's where I landed on ${line.slice(start, end + 1)}:`;
    }
  }
  return "Here's where I landed:";
}

function polishOutbound(text) {
  if (process.env.PIKO_OPERATOR_VOICE === 'off') return text;
  if (typeof text !== 'string' || !text) return text;

  const protected_ = protectStops(text);
  let out = protected_.text;

  out = splitLines(out)
    .filter((line) => {
      const t = line.trim();
      const low = toLowerAsciiish(t);
      if (startsWithIgnoreCase(t, 'Job:') && low.includes('job_')) return false;
      if (startsWithIgnoreCase(t, 'Planner:')) return false;
      if (low.startsWith('planner=') || low.startsWith('planner:')) return false;
      return true;
    })
    .map((line) => {
      let s = line;
      // Status: /agents status ·
      const statusCue = 'status: /agents status';
      let low = toLowerAsciiish(s);
      while (low.includes(statusCue)) {
        const idx = low.indexOf(statusCue);
        let end = idx + statusCue.length;
        while (end < s.length && (s[end] === ' ' || s[end] === '·' || s[end] === '\t')) end += 1;
        s = s.slice(0, idx) + s.slice(end);
        low = toLowerAsciiish(s);
      }
      s = stripInlineReviewStamps(s);
      s = stripLeadingWorkerTag(s);
      const legate = transformLegateReviewLine(s.trim());
      if (legate != null && s.trim() === s.trim()) {
        // only transform if whole line is the legate header
        if (startsWithIgnoreCase(s.trim(), 'Legate review')) s = legate;
      }
      const t = s.trim();
      const tl = toLowerAsciiish(t);
      if (tl.startsWith('verdict:')) {
        const rest = tl.slice('verdict:'.length).trim();
        if (rest === 'accept') return '';
        if (rest === 'revise') return 'This needs another pass.';
        if (rest === 'escalate' || rest === 'fail') return 'This one needs attention.';
      }
      if (startsWithIgnoreCase(t, 'Progress — ') || startsWithIgnoreCase(t, 'Progress - ')) {
        // Progress — id · rest
        const body = t.slice('Progress — '.length);
        const dot = body.indexOf(' · ');
        if (dot >= 0) return 'Update — ' + body.slice(dot + 3);
        const dot2 = body.indexOf(' ·');
        if (dot2 >= 0) return 'Update — ' + body.slice(dot2 + 2).trim();
      }
      return s;
    })
    .join('\n');

  out = replaceAllLiteral(out, 'mission-fit review', 'relevance check');
  out = replaceAllLiteral(out, 'Mission-fit review', 'relevance check');
  out = replaceAllLiteral(out, 'Mission-Fit review', 'relevance check');
  out = replaceAllLiteral(out, 'MISSION-FIT review', 'relevance check');
  // case variants via lower scan
  {
    let built = '';
    let i = 0;
    const low = toLowerAsciiish(out);
    while (i < out.length) {
      if (low.startsWith('mission-fit review', i)) {
        built += 'relevance check';
        i += 'mission-fit review'.length;
        continue;
      }
      if (low.startsWith('mission-fit', i)) {
        // avoid double-replacing the review form already handled
        built += 'relevance';
        i += 'mission-fit'.length;
        continue;
      }
      built += out[i];
      i += 1;
    }
    out = built;
  }

  out = scrubJobIds(out);
  out = restoreStops(out, protected_.stops);
  out = stripTrailingSpacesPerLine(out);
  out = squeezeBlankLines(out).trim();

  return out || text.trim();
}

function polishNotificationText(text, opts = {}) {
  if (process.env.PIKO_OPERATOR_VOICE === 'off') return text;
  if (typeof text !== 'string' || !text) return text;
  const maxLen = Number(opts.maxLen || 400);

  let out = text;
  const tb = toLowerAsciiish(out).indexOf('traceback (most recent call');
  if (tb >= 0) out = out.slice(0, tb);

  out = splitLines(out)
    .map((line) => {
      const low = toLowerAsciiish(line);
      const idx = low.indexOf('last python error:');
      const idx2 = low.indexOf('last error:');
      const cut = idx >= 0 ? idx : idx2;
      if (cut >= 0) return line.slice(0, cut);
      return line;
    })
    .filter((line) => {
      const t = line.trim();
      if (startsWithIgnoreCase(t, 'File "/') || startsWithIgnoreCase(t, "File '/")) return false;
      if (t.startsWith('at ') && t.includes('(') && t.endsWith(')')) return false;
      if (startsWithIgnoreCase(t, 'Execution Error')) return false;
      if (startsWithIgnoreCase(t, 'Last Python Error:')) return false;
      return true;
    })
    .join('\n');

  // Strip "Approve at /..." / "POST /api/..."
  {
    const lines = splitLines(out);
    out = lines.map((line) => {
      let s = line;
      const low = toLowerAsciiish(s);
      for (const cue of ['approve at /', 'approve via /', 'approve all at /', 'approve all via /', 'post /', 'get /']) {
        const idx = low.indexOf(cue);
        if (idx >= 0) {
          s = s.slice(0, idx).trimEnd();
          break;
        }
      }
      return s;
    }).join('\n');
  }

  // eval eval_... / eval_...
  {
    let built = '';
    let i = 0;
    const s = out;
    const low = toLowerAsciiish(s);
    while (i < s.length) {
      if (low.startsWith('eval eval_', i)) {
        built += 'an automated check';
        i += 'eval eval_'.length;
        while (i < s.length && (isAsciiLetter(s[i]) || isAsciiDigit(s[i]) || s[i] === '_' || s[i] === '.')) i += 1;
        continue;
      }
      if (low.startsWith('eval_', i)) {
        // require enough length
        let j = i + 5;
        let n = 0;
        while (j < s.length && (isAsciiLetter(s[j]) || isAsciiDigit(s[j]) || s[j] === '_' || s[j] === '.')) {
          n += 1;
          j += 1;
        }
        if (n >= 8) {
          built += 'an automated check';
          i = j;
          continue;
        }
      }
      built += s[i];
      i += 1;
    }
    out = built;
  }

  // Bare server paths /home /opt /var /Users
  {
    let built = '';
    let i = 0;
    const s = out;
    while (i < s.length) {
      if (s[i] === '/' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\n' || s[i - 1] === '\t')) {
        const rest = s.slice(i);
        if (rest.startsWith('/home/') || rest.startsWith('/opt/') || rest.startsWith('/var/') || rest.startsWith('/Users/')) {
          let j = i + 1;
          while (j < s.length && s[j] !== ' ' && s[j] !== '\n' && s[j] !== '\t') j += 1;
          built += ' ';
          i = j;
          continue;
        }
      }
      built += s[i];
      i += 1;
    }
    out = built;
  }

  out = stripTrailingSpacesPerLine(out);
  // collapse multi spaces
  {
    let built = '';
    let prevSpace = false;
    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      if (ch === ' ' || ch === '\t') {
        if (ch === '\t') {
          if (!prevSpace) built += ' ';
          prevSpace = true;
        } else {
          if (!prevSpace) built += ' ';
          prevSpace = true;
        }
      } else if (ch === '\n') {
        built += '\n';
        prevSpace = false;
      } else {
        built += ch;
        prevSpace = false;
      }
    }
    out = built;
  }
  out = squeezeBlankLines(out).trim();
  // strip trailing punctuation clutter
  while (out.length && ' —·:,-'.includes(out[out.length - 1])) {
    out = out.slice(0, -1).trimEnd();
  }

  if (out.length > maxLen) out = `${out.slice(0, maxLen).trimEnd()}…`;
  return out || 'See Activity for details.';
}

module.exports = { polishOutbound, polishNotificationText, friendlyAgentName };
