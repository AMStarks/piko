/**
 * UnchartedX / EI open-edition seed pack — preferred Archive.org IDs and
 * direct PDF URLs tried before broad web seek when the ask matches an author.
 */
const fs = require('fs');
const path = require('path');
const { authorMatch, parseNamedWork } = require('./eiGoalParse');

function overlayPath(name) {
  try {
    const { culturesDataRoot } = require('./culturesCorpusApi');
    return path.join(culturesDataRoot(), name);
  } catch (_) {
    return path.join(__dirname, '..', 'data', 'egyptian-insights', name);
  }
}

function loadOverlaySeeds() {
  try {
    const p = overlayPath('seed_pack_overlay.json');
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw.seeds) ? raw.seeds : [];
  } catch (_) {
    return [];
  }
}

function getSeeds() {
  return [...SEEDS, ...loadOverlaySeeds()];
}

function appendOverlaySeed(seed) {
  if (!seed || typeof seed !== 'object') return { ok: false, error: 'invalid_seed' };
  const authors = Array.isArray(seed.authors) ? seed.authors.filter(Boolean) : [];
  if (!authors.length) return { ok: false, error: 'authors_required' };
  const p = overlayPath('seed_pack_overlay.json');
  let raw = { seeds: [] };
  try {
    if (fs.existsSync(p)) raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { raw = { seeds: [] }; }
  if (!Array.isArray(raw.seeds)) raw.seeds = [];
  const entry = {
    authors,
    title_hints: Array.isArray(seed.title_hints) ? seed.title_hints : [],
    urls: Array.isArray(seed.urls) ? seed.urls : [],
    ia_ids: Array.isArray(seed.ia_ids) ? seed.ia_ids : [],
    thread: seed.thread || undefined,
    note: seed.note || 'operator-approved overlay seed',
  };
  raw.seeds.push(entry);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { ok: true, applied: 'seed_pack_entry', path: p, seed: entry };
}

function loadPdAuthorOverlay() {
  try {
    const p = overlayPath('pd_authors_overlay.json');
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw.authors) ? raw.authors.map((a) => String(a).toLowerCase()) : [];
  } catch (_) {
    return [];
  }
}

function appendPdAuthorOverlay(author) {
  const a = String(author || '').trim().toLowerCase();
  if (a.length < 2) return { ok: false, error: 'author_required' };
  const p = overlayPath('pd_authors_overlay.json');
  let raw = { authors: [] };
  try {
    if (fs.existsSync(p)) raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { raw = { authors: [] }; }
  if (!Array.isArray(raw.authors)) raw.authors = [];
  if (!raw.authors.map((x) => String(x).toLowerCase()).includes(a)) raw.authors.push(a);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { ok: true, applied: 'pd_author_addition', path: p, author: a };
}

/**
 * Each seed: author match key, optional title hint, open URLs / IA identifiers.
 * Prefer archive.org/details/… and known open PDFs — never paywalled-only links
 * as the sole seed (operator URL ingest covers those).
 */
const SEEDS = [
  {
    authors: ['Christopher Dunn'],
    title_hints: ['Lost Technologies of Ancient Egypt'],
    urls: [],
    ia_ids: [],
    note: 'Real Lost Technologies often paywalled; use ingest_url with operator link.',
  },
  {
    authors: ['W. M. Flinders Petrie', 'Flinders Petrie', 'W.M. Flinders Petrie'],
    title_hints: ['Pyramids and Temples of Gizeh', 'Medum', 'Abydos'],
    thread: 'giza',
    urls: [
      'https://archive.org/details/pyramidstempleso00petruoft',
      'https://archive.org/details/cu31924028619814',
      'https://archive.org/details/medum00petr',
    ],
    ia_ids: ['pyramidstempleso00petruoft', 'medum00petr'],
  },
  {
    authors: ['John Anthony West'],
    title_hints: ['Serpent in the Sky'],
    urls: [
      'https://archive.org/details/serpentinskytheh00west',
    ],
    ia_ids: ['serpentinskytheh00west'],
  },
  {
    authors: ['Robert Schoch', 'Robert M. Schoch'],
    title_hints: ['Forgotten Civilization', 'Origins of the Sphinx', 'Sphinx'],
    urls: [],
    ia_ids: [],
    note: 'Prefer peer papers / author site PDFs; Bookey summaries are denylisted.',
  },
  {
    authors: ['Graham Hancock'],
    title_hints: ['Fingerprints of the Gods', 'Message of the Sphinx', 'Underworld'],
    urls: [
      'https://archive.org/details/fingerprintsofgod00hanc',
    ],
    ia_ids: ['fingerprintsofgod00hanc'],
  },
  {
    authors: ['Auguste Mariette', 'Mariette'],
    title_hints: ['Serapeum', 'Sérapéum'],
    urls: [
      'https://archive.org/details/lesrapeumdememp00marigoog',
    ],
    ia_ids: ['lesrapeumdememp00marigoog'],
  },
  {
    authors: ['Karl Richard Lepsius', 'Lepsius'],
    title_hints: ['Denkmäler', 'Denkmaeler'],
    urls: [
      'https://archive.org/details/denkmlerausaegy01lepsgoog',
    ],
    ia_ids: ['denkmlerausaegy01lepsgoog'],
  },
  {
    authors: ['Herodotus'],
    title_hints: ['Histories', 'Labyrinth'],
    urls: [
      'https://archive.org/details/herodotuswitheng01hero',
    ],
    ia_ids: ['herodotuswitheng01hero'],
  },
  {
    authors: ['Diodorus Siculus', 'Diodorus'],
    title_hints: ['Bibliotheca', 'Library of History'],
    urls: [
      'https://archive.org/details/diodorusofsicul01dioduoft',
    ],
    ia_ids: ['diodorusofsicul01dioduoft'],
  },
  {
    authors: ['Strabo'],
    title_hints: ['Geography'],
    urls: [
      'https://archive.org/details/geographyofstrab01strarich',
    ],
    ia_ids: ['geographyofstrab01strarich'],
  },
  {
    authors: ['Pliny the Elder', 'Pliny'],
    title_hints: ['Natural History', 'Naturalis Historia'],
    urls: [
      'https://archive.org/details/naturalhistoryof01plinuoft',
    ],
    ia_ids: ['naturalhistoryof01plinuoft'],
  },
  // --- Alternative-history canon (direct open PDFs verified 2026-07-29) ---
  {
    authors: ['Charles Hapgood', 'Charles Hutchins Hapgood'],
    title_hints: ['Maps of the Ancient Sea Kings'],
    urls: [
      'https://archive.org/download/HapgoodCharlesHutchinsMapsOfTheAncientSeaKings/Hapgood%20Charles%20Hutchins%20-%20Maps%20of%20the%20ancient%20sea%20kings.pdf',
    ],
    ia_ids: [],
  },
  {
    authors: ['Charles Hapgood'],
    title_hints: ['Path of the Pole'],
    urls: [
      'https://archive.org/download/the-path-of-the-pole-charles-hapgood/The%20Path%20of%20the%20Pole%20-%20Charles%20Hapgood.pdf',
    ],
    ia_ids: [],
  },
  {
    authors: ['Giorgio de Santillana', 'Santillana', 'Hertha von Dechend', 'von Dechend'],
    title_hints: ["Hamlet's Mill", 'Hamlets Mill'],
    urls: [
      "https://archive.org/download/de-santillana-and-von-dechend-hamlets-mill/de%20Santillana%20and%20von%20Dechend%20-%20Hamlet%27s%20Mill.pdf",
    ],
    ia_ids: [],
  },
  {
    authors: ['Ignatius Donnelly'],
    title_hints: ['Atlantis', 'Antediluvian World'],
    thread: 'atlantis',
    urls: [
      'https://archive.org/download/atlantis-the-antediluvian-world-1882-ignatius-donnelly/Atlantis%20the%20antediluvian%20world%20%281882%29%20-%20Ignatius%20Donnelly.pdf',
    ],
    ia_ids: [],
  },
  {
    authors: ['R. A. Schwaller de Lubicz', 'Schwaller de Lubicz', 'Schwaller'],
    title_hints: ['Sacred Science', 'Temple of Man', 'Temple in Man'],
    urls: [
      'https://archive.org/download/r-a-schwaller-de-lubicz-sacred-science/R%20A%20Schwaller%20de%20Lubicz%20-%20Sacred%20Science.pdf',
    ],
    ia_ids: [],
  },
  {
    authors: ['Peter Tompkins'],
    title_hints: ['Secrets of the Great Pyramid'],
    urls: [
      'https://archive.org/download/secrets-of-the-great-pyramid/secrets%20of%20the%20great%20pyramid.pdf',
    ],
    ia_ids: [],
  },
  {
    authors: ['Arthur Posnansky', 'Posnansky'],
    title_hints: ['Tiahuanacu', 'Tihuanacu', 'Tiwanaku'],
    thread: 'tiahuanaco',
    urls: [
      'https://archive.org/download/gri_33125006525261/gri_33125006525261.pdf',
    ],
    ia_ids: [],
    note: 'Getty scan of Posnansky Tiahuanacu monuments volume (Spanish).',
  },
  {
    authors: ['Robert Bauval', 'Adrian Gilbert'],
    title_hints: ['Orion Mystery'],
    urls: [],
    ia_ids: [],
    note: 'The Orion Mystery has no open scan on IA; ask operator for a URL.',
  },
  {
    authors: ['J Harlen Bretz', 'Harlen Bretz', 'Bretz'],
    title_hints: ['Channeled Scabland', 'Missoula'],
    thread: 'cataclysm',
    urls: [
      'https://archive.org/details/jstor-30058578',
    ],
    ia_ids: ['jstor-30058578'],
    note: 'Bretz 1923 Channeled Scabland JSTOR/IA mirror when available.',
  },
  {
    authors: ['Plato'],
    title_hints: ['Timaeus', 'Critias', 'Atlantis'],
    thread: 'flood-myths',
    urls: [
      'https://archive.org/details/platotimaeus00platuoft',
      'https://archive.org/details/critias00plat',
    ],
    ia_ids: ['platotimaeus00platuoft', 'critias00plat'],
  },
  {
    authors: ['Ignatius Donnelly'],
    title_hints: ['Ragnarok', 'Age of Fire and Gravel'],
    thread: 'cataclysm',
    urls: [
      'https://archive.org/details/ragnarokageoffir00donn',
    ],
    ia_ids: ['ragnarokageoffir00donn'],
  },
  {
    authors: ['James Churchward'],
    title_hints: ['Lost Continent of Mu', 'Children of Mu', 'Sacred Symbols of Mu'],
    urls: [],
    ia_ids: [],
    note: 'Churchward Mu books are not Antediluvian World (that is Donnelly). Prefer operator URL.',
  },
  {
    authors: ['W. M. Flinders Petrie', 'Flinders Petrie'],
    title_hints: ['Abydos'],
    thread: 'abydos',
    urls: [
      'https://archive.org/download/abydos1petr/abydos1petr.pdf',
      'https://archive.org/details/abydos01petr',
    ],
    ia_ids: ['abydos01petr'],
  },
];

/** Seeds tagged for a research thread (dead-thread refill). */
function seedsForThread(threadId) {
  const id = String(threadId || '').trim().toLowerCase();
  if (!id) return [];
  return getSeeds().filter((s) => String(s.thread || '').toLowerCase() === id);
}

function iaDownloadUrl(id) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return `https://archive.org/download/${encodeURIComponent(clean)}/${encodeURIComponent(clean)}.pdf`;
}

function iaDetailsUrl(id) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return `https://archive.org/details/${encodeURIComponent(clean)}`;
}

/**
 * Resolve seed URLs for a goal / author.
 */
function seedsForGoal(goal) {
  const named = typeof goal === 'object' && goal && goal.author
    ? goal
    : require('./eiGoalParse').parseNamedWork(goal);
  const author = named.author;
  if (!author) return { urls: [], matched: null, note: null };

  const title = String(named.title || '').toLowerCase();
  const matched = [];
  for (const seed of getSeeds()) {
    if (!(seed.authors || []).some((a) => authorMatch(author, a))) continue;
    matched.push(seed);
  }
  if (!matched.length) return { urls: [], matched: null, note: null };

  const urls = [];
  const notes = [];
  for (const seed of matched) {
    if (seed.note) notes.push(seed.note);
    for (const u of seed.urls || []) {
      if (u && !urls.includes(u)) urls.push(u);
    }
    for (const id of seed.ia_ids || []) {
      const d = iaDetailsUrl(id);
      if (d && !urls.includes(d)) urls.push(d);
    }
    // If singular title ask, prefer seeds whose title_hints overlap
    if (named.isSingularTitle && title && seed.title_hints) {
      const hit = seed.title_hints.some((h) => title.includes(String(h).toLowerCase().slice(0, 20))
        || String(h).toLowerCase().includes(title.slice(0, 20)));
      if (!hit) continue;
    }
  }
  return {
    urls: urls.slice(0, 12),
    matched: matched.map((m) => m.authors[0]),
    note: notes[0] || null,
  };
}

module.exports = {
  SEEDS,
  getSeeds,
  loadOverlaySeeds,
  appendOverlaySeed,
  loadPdAuthorOverlay,
  appendPdAuthorOverlay,
  seedsForGoal,
  seedsForThread,
  iaDownloadUrl,
  iaDetailsUrl,
};
