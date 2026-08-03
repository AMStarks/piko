/**
 * Seek query strategy pack — builds multi-query strings and host denylist
 * for open-web literature seek.
 */
const { parseNamedWork, focusedSeekQuery } = require('./eiGoalParse');
const { loadAuthorPack } = require('./eiKnownWorks');
const { seedsForGoal } = require('./eiSeedPack');

const SUMMARY_MILL_HOSTS = [
  'bookey.app',
  'cdn.bookey.app',
  'blinkist.com',
  'sparknotes.com',
  'cliffsnotes.com',
  'shortform.com',
  'litcharts.com',
  'gradesaver.com',
  'getabstract.com',
  'instaread.co',
  '12min.com',
  'quickread.com',
  'nikipress.com',
];

const SUMMARY_MILL_PHRASES = [
  ...SUMMARY_MILL_HOSTS,
  'bookey', 'blinkist', 'sparknotes', 'cliffsnotes', "cliff's notes", 'cliff notes', 'nikipress',
  'scan to download', 'download the book', 'iapsop',
];

const {
  includesAny,
} = require('./text');

function hasGCodeLabel(s) {
  const u = String(s || '');
  for (let i = 0; i < u.length; i++) {
    const ch = u[i];
    if (ch !== 'G' && ch !== 'g') continue;
    if (i > 0) {
      const prev = u[i - 1];
      if ((prev >= 'a' && prev <= 'z') || (prev >= 'A' && prev <= 'Z') || (prev >= '0' && prev <= '9')) continue;
    }
    let j = i + 1;
    let n = 0;
    while (j < u.length && n < 4 && u[j] >= '0' && u[j] <= '9') { n++; j++; }
    if (n === 4 && u[j] === ':') return true;
  }
  return false;
}

function isSummaryMillUrl(url) {
  const u = String(url || '').toLowerCase();
  if (includesAny(u, SUMMARY_MILL_PHRASES)) return true;
  return hasGCodeLabel(u);
}

/** Title/URL patterns that look like course handouts or summary mills — drop, don't keep. */
function isJunkKeepTitle(titleOrUrl) {
  return isSummaryMillUrl(titleOrUrl);
}

/**
 * Build ordered seek queries for a mission.
 * @returns {{ queries: string[], seed_urls: string[], denylist_hosts: string[], named: object }}
 */
function buildSeekQueryPack(goal) {
  const named = parseNamedWork(goal);
  const queries = [];
  const primary = focusedSeekQuery(goal) || named.seekQuery || String(goal || '').slice(0, 160);
  if (primary) queries.push(primary);

  if (named.isSingularTitle && named.title) {
    const quoted = named.title.includes(' ') ? `"${named.title}"` : named.title;
    queries.push(`${quoted} filetype:pdf`);
    if (named.author) {
      queries.push(`"${named.title}" ${named.author} PDF`);
      queries.push(`creator:(${named.author}) ${named.title}`);
    }
  } else if (named.isAuthorWorks && named.author) {
    queries.push(`"${named.author}" filetype:pdf`);
    const topic = (named.topic || []).slice(0, 4).join(' ');
    if (topic) {
      queries.push(`"${named.author}" ${topic} PDF`);
      queries.push(`${named.author} ${topic} filetype:pdf`);
    }
    // Alternate titles from known-works
    const pack = loadAuthorPack(named.author);
    if (pack && pack.works) {
      for (const w of pack.works.slice(0, 4)) {
        const t = w.title;
        if (!t) continue;
        if (topic.length) {
          const wt = (w.topics || []).map((x) => String(x).toLowerCase());
          const overlap = named.topic.some((tok) => wt.some((x) => x.includes(tok) || tok.includes(x)));
          if (!overlap && named.topic.length) continue;
        }
        queries.push(`"${t}" ${named.author} PDF`);
      }
    }
  }

  // Deduplicate preserving order
  const seen = new Set();
  const uniq = [];
  for (const q of queries) {
    const k = String(q || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(String(q).trim().slice(0, 220));
  }

  const seeds = seedsForGoal(named);
  return {
    queries: uniq.slice(0, 8),
    seed_urls: seeds.urls || [],
    seed_note: seeds.note || null,
    denylist_hosts: [...SUMMARY_MILL_HOSTS],
    named,
    primary: uniq[0] || primary,
  };
}

/**
 * Encode seed URLs into a harvest query note the Python side can parse.
 * Format: primary query, then lines `SEED_URL:https://...`
 */
function encodeHarvestQuery(pack) {
  const lines = [pack.primary || (pack.queries && pack.queries[0]) || ''];
  for (const q of (pack.queries || []).slice(1, 5)) {
    lines.push(`ALT_QUERY:${q}`);
  }
  for (const u of pack.seed_urls || []) {
    lines.push(`SEED_URL:${u}`);
  }
  return lines.filter(Boolean).join('\n').slice(0, 2000);
}

module.exports = {
  SUMMARY_MILL_HOSTS,
  SUMMARY_MILL_PHRASES,
  isSummaryMillUrl,
  isJunkKeepTitle,
  buildSeekQueryPack,
  encodeHarvestQuery,
};
