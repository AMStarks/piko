/**
 * Known-works checklist — curated expected titles per author so "all X"
 * reports kept / missing / unsure instead of aspirational incompleteness.
 */
const fs = require('fs');
const path = require('path');
const { culturesDataRoot } = require('./culturesCorpusApi');
const { authorMatch, normalizeTitle, titleMatchScore } = require('./eiGoalParse');
const {
  toLowerAsciiish,
  isAsciiLetter,
  isAsciiDigit,
  replaceAllLiteral,
} = require('./text');

function slugifyKey(s) {
  const str = toLowerAsciiish(s);
  let out = '';
  let prevUs = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isAsciiLetter(ch) || isAsciiDigit(ch)) {
      out += ch;
      prevUs = false;
    } else if (!prevUs && out.length) {
      out += '_';
      prevUs = true;
    }
  }
  while (out.startsWith('_')) out = out.slice(1);
  while (out.endsWith('_')) out = out.slice(0, -1);
  return out.slice(0, 80);
}

function knownWorksDir() {
  return path.join(culturesDataRoot(), 'known_works');
}

function knownWorksPath(authorKey) {
  const key = slugifyKey(authorKey || 'default') || 'default';
  return path.join(knownWorksDir(), `${key}.json`);
}

function authorKeyFromName(author) {
  return slugifyKey(author);
}

/**
 * Built-in UnchartedX starter checklist (can be overridden by data files).
 */
const BUILTIN = {
  flinders_petrie: {
    author: 'W. M. Flinders Petrie',
    aliases: ['Flinders Petrie', 'W.M. Flinders Petrie', 'Petrie'],
    works: [
      { title: 'The Pyramids and Temples of Gizeh', topics: ['giza', 'pyramid'] },
      { title: 'Medum', topics: ['meidum', 'hawara'] },
      { title: 'Abydos', topics: ['abydos'] },
      { title: 'Naqada and Ballas', topics: ['naqada'] },
      { title: 'The Arts and Crafts of Ancient Egypt', topics: ['crafts'] },
    ],
  },
  christopher_dunn: {
    author: 'Christopher Dunn',
    aliases: ['Chris Dunn'],
    works: [
      { title: 'Lost Technologies of Ancient Egypt', topics: ['precision', 'tool marks'] },
      { title: 'The Giza Power Plant', topics: ['giza'] },
    ],
  },
  john_anthony_west: {
    author: 'John Anthony West',
    aliases: ['J. A. West'],
    works: [
      { title: 'Serpent in the Sky', topics: ['egypt', 'symbolism'] },
      { title: 'Magical Egypt', topics: ['egypt'] },
    ],
  },
  robert_schoch: {
    author: 'Robert Schoch',
    aliases: ['Robert M. Schoch', 'Schoch'],
    works: [
      { title: 'Forgotten Civilization', topics: ['sphinx', 'catastrophe'] },
      { title: 'Origins of the Sphinx', topics: ['sphinx', 'erosion'] },
      { title: 'Voyages of the Pyramid Builders', topics: ['pyramid'] },
    ],
  },
  graham_hancock: {
    author: 'Graham Hancock',
    aliases: ['Hancock'],
    works: [
      { title: 'Fingerprints of the Gods', topics: ['lost civilisation'] },
      { title: 'The Message of the Sphinx', topics: ['sphinx', 'egypt'] },
      { title: 'Underworld', topics: ['flood', 'civilisation'] },
      { title: 'Magicians of the Gods', topics: ['catastrophe'] },
    ],
  },
  august_mariette: {
    author: 'Auguste Mariette',
    aliases: ['Mariette'],
    works: [
      { title: 'Le Sérapéum de Memphis', topics: ['serapeum', 'saqqara'] },
    ],
  },
  karl_richard_lepsius: {
    author: 'Karl Richard Lepsius',
    aliases: ['Lepsius', 'Richard Lepsius'],
    works: [
      { title: 'Denkmäler aus Aegypten und Aethiopien', topics: ['monuments', 'labyrinth'] },
    ],
  },
  herodotus: {
    author: 'Herodotus',
    aliases: [],
    works: [
      { title: 'Histories', topics: ['labyrinth', 'egypt', 'hawara'] },
    ],
  },
  diodorus_siculus: {
    author: 'Diodorus Siculus',
    aliases: ['Diodorus'],
    works: [
      { title: 'Bibliotheca Historica', topics: ['labyrinth', 'egypt'] },
    ],
  },
  strabo: {
    author: 'Strabo',
    aliases: [],
    works: [
      { title: 'Geography', topics: ['labyrinth', 'egypt'] },
    ],
  },
  pliny_the_elder: {
    author: 'Pliny the Elder',
    aliases: ['Pliny'],
    works: [
      { title: 'Natural History', topics: ['labyrinth', 'egypt'] },
    ],
  },
};

function loadAuthorPack(author) {
  const key = authorKeyFromName(author);
  const file = knownWorksPath(key);
  try {
    if (fs.existsSync(file)) {
      return { ...JSON.parse(fs.readFileSync(file, 'utf8')), key, source: 'file' };
    }
  } catch (_) { /* fall through */ }
  // Fuzzy match builtins
  for (const [k, pack] of Object.entries(BUILTIN)) {
    const names = [pack.author, ...(pack.aliases || []), replaceAllLiteral(k, '_', ' ')];
    if (names.some((n) => authorMatch(author, n) || authorMatch(n, author))) {
      return { ...pack, key: k, source: 'builtin' };
    }
  }
  return null;
}

function ensureSkeletonFiles() {
  const dir = knownWorksDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, pack] of Object.entries(BUILTIN)) {
    const p = knownWorksPath(key);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify({ ...pack, key }, null, 2));
    }
  }
  return { ok: true, dir, count: Object.keys(BUILTIN).length };
}

/**
 * Compare known works for an author against kept corpus items.
 * @param {string} author
 * @param {Array<{title?:string, work_title?:string, author?:string, verdict?:string}>} keptItems
 * @param {{ topic?: string[] }} [opts]
 */
function assessCoverage(author, keptItems, opts = {}) {
  const pack = loadAuthorPack(author);
  if (!pack) {
    return {
      ok: true,
      author,
      known: false,
      kept: [],
      missing: [],
      unsure: [],
      summary: `No known-works checklist for ${author} yet.`,
    };
  }
  const topic = (opts.topic || []).map((t) => normalizeTitle(t));
  const works = (pack.works || []).filter((w) => {
    if (!topic.length) return true;
    const wt = (w.topics || []).map((t) => normalizeTitle(t));
    return topic.some((t) => wt.some((x) => x.includes(t) || t.includes(x)));
  });
  const items = (keptItems || []).filter((it) => {
    if (it.verdict && it.verdict !== 'keep') return false;
    const a = it.author || '';
    return !a || toLowerAsciiish(a) === 'unknown'
      || authorMatch(pack.author, a)
      || (pack.aliases || []).some((al) => authorMatch(al, a));
  });

  const kept = [];
  const missing = [];
  for (const w of works) {
    let best = null;
    let bestScore = 0;
    for (const it of items) {
      const cand = `${it.work_title || ''} ${it.title || ''}`;
      const score = titleMatchScore(w.title, cand);
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    if (best && bestScore >= 0.72) {
      kept.push({
        expected: w.title,
        harvest_id: best.harvest_id || best.id || null,
        matched: best.work_title || best.title,
        score: bestScore,
      });
    } else {
      missing.push({ expected: w.title, topics: w.topics || [] });
    }
  }

  return {
    ok: true,
    author: pack.author,
    known: true,
    source: pack.source,
    expected_count: works.length,
    kept,
    missing,
    summary: `${kept.length}/${works.length} known works present`
      + (missing.length ? `; missing: ${missing.map((m) => m.expected).slice(0, 4).join(', ')}` : ''),
  };
}

function formatKnownWorksReport(report) {
  if (!report) return '';
  if (!report.known) return `Known-works: ${report.summary}`;
  const lines = [
    `Known-works checklist (${report.author}): ${report.summary}`,
  ];
  if (report.kept && report.kept.length) {
    lines.push('  Present:');
    for (const k of report.kept.slice(0, 8)) {
      lines.push(`    ✓ ${k.expected}${k.harvest_id ? ` (#${k.harvest_id})` : ''}`);
    }
  }
  if (report.missing && report.missing.length) {
    lines.push('  Still missing:');
    for (const m of report.missing.slice(0, 8)) {
      lines.push(`    · ${m.expected}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  BUILTIN,
  knownWorksDir,
  loadAuthorPack,
  ensureSkeletonFiles,
  assessCoverage,
  formatKnownWorksReport,
  authorKeyFromName,
};
