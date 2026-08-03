/**
 * Read-only browser API for Egyptian Insights cultures_cache.sqlite.
 * Corpus grid fields: source_name, type, location, approx_date, link.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  toLowerAsciiish,
  includesAny,
  extractDigitRuns,
  collapseWhitespace,
  isAsciiDigit,
} = require('./text');

function hasWordPadded(haystack, word) {
  return ` ${haystack} `.includes(` ${word} `);
}

function hasAnyWordPadded(haystack, words) {
  for (const w of words) {
    if (hasWordPadded(haystack, w)) return true;
  }
  return false;
}

function publicDomainYear(blob) {
  for (const run of extractDigitRuns(blob)) {
    const y = run.value;
    if (run.text.length === 4 && ((y >= 1500 && y <= 1999) || (y >= 2000 && y <= 2029))) {
      return run.text;
    }
  }
  return null;
}

const SITE_LABELS = {
  abydos: 'Abydos / Oserion / Umm el-Qa\'ab',
  heliopolis: 'Heliopolis (Iunu)',
  giza: 'Giza complex',
};

function culturesDataRoot() {
  const env = String(
    process.env.EGYPTIAN_INSIGHTS_DATA_DIR
    || process.env.PIKO_EGYPTIAN_DATA_DIR
    || '',
  ).trim();
  if (env) return env;
  return path.join(__dirname, '..', '..', 'data', 'egyptian-insights');
}

function dbFile() {
  return path.join(culturesDataRoot(), 'cultures_cache.sqlite');
}

function imagesDir() {
  return path.join(culturesDataRoot(), 'assets', 'images');
}

function documentsDir() {
  return path.join(culturesDataRoot(), 'assets', 'documents');
}

function openDb() {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    const err = new Error(`cultures_cache not found at ${file}`);
    err.code = 'ENOENT';
    throw err;
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

function openDbWritable() {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    const err = new Error(`cultures_cache not found at ${file}`);
    err.code = 'ENOENT';
    throw err;
  }
  return new Database(file, { readonly: false, fileMustExist: true });
}

/**
 * Remove a harvest row + related transcriptions/critiques + local assets + corpus flag.
 * Used after mission-fit drop so the corpus stays the accepted deliverable only.
 */
function deleteHarvestItem(id) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) {
    return { ok: false, error: 'invalid id' };
  }
  let imagePath = null;
  let documentPath = null;
  const db = openDbWritable();
  try {
    const row = db.prepare('SELECT image_path, meta_json FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return { ok: false, error: 'not found', harvest_id: hid };
    const meta = parseMeta(row.meta_json);
    imagePath = resolveImagePath(row.image_path);
    documentPath = resolveDocumentPath(meta.document_path);
    db.prepare('DELETE FROM critiques WHERE harvest_id = ?').run(hid);
    db.prepare('DELETE FROM transcriptions WHERE harvest_id = ?').run(hid);
    db.prepare('DELETE FROM harvest_items WHERE id = ?').run(hid);
  } finally {
    db.close();
  }
  for (const p of [imagePath, documentPath]) {
    if (!p) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.unlinkSync(p);
    } catch (_) { /* best-effort */ }
  }
  try {
    const { clearFlag } = require('./eiCorpusFlags');
    clearFlag(hid);
  } catch (_) { /* optional */ }
  return { ok: true, harvest_id: hid, removed_image: !!imagePath, removed_document: !!documentPath };
}

function parseMeta(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function resolveImagePath(stored) {
  if (!stored) return null;
  if (fs.existsSync(stored) && fs.statSync(stored).isFile()) return stored;
  const name = path.basename(String(stored));
  const candidate = path.join(imagesDir(), name);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

function resolveDocumentPath(stored) {
  if (!stored) return null;
  // Paths inside Docker often use /data/egyptian-insights/...
  if (fs.existsSync(stored) && fs.statSync(stored).isFile()) return stored;
  const name = path.basename(String(stored));
  const candidate = path.join(documentsDir(), name);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  // Host path remaps from container mount
  const remapped = String(stored).replace(
    /^\/data\/egyptian-insights\//,
    `${culturesDataRoot()}/`,
  );
  if (remapped !== stored && fs.existsSync(remapped) && fs.statSync(remapped).isFile()) {
    return remapped;
  }
  return null;
}

/**
 * Infer material / document type for the corpus Type column.
 */
function inferMaterialType(row, meta = {}) {
  const blob = [
    row.title,
    row.source,
    meta.kind,
    meta.literature_role,
    meta.connector,
    row.official_text ? String(row.official_text).slice(0, 400) : '',
  ].filter(Boolean).join(' ').toLowerCase();

  if (meta.kind === 'source_candidate') return 'Archive candidate';
  if (hasWordPadded(blob, 'papyrus')) return 'Papyrus';
  if (includesAny(blob, ['wall relief', 'relief fragment', 'tomb relief', 'temple relief'])) return 'Wall relief';
  if (hasAnyWordPadded(blob, ['stela', 'stele'])) return 'Stela';
  if (includesAny(blob, ['ivory label', 'ivory tag', 'bone label'])) return 'Ivory label';
  if (hasWordPadded(blob, 'obelisk')) return 'Obelisk';
  if (hasAnyWordPadded(blob, ['statue', 'statuette', 'heilstatue'])) return 'Statue';
  if (hasWordPadded(blob, 'mastaba')) return 'Mastaba';
  if (includesAny(blob, ['sarcophag', 'coffin', 'sarg'])) return 'Sarcophagus';
  if (hasAnyWordPadded(blob, ['ostracon', 'ostraka'])) return 'Ostracon';
  if (hasAnyWordPadded(blob, ['seal', 'scarab'])) return 'Seal / scarab';
  if (meta.kind === 'literature' || ['archive_org', 'topbib', 'tla'].includes(String(row.source || ''))) {
    if (row.source === 'topbib') return 'Bibliography record';
    if (row.source === 'tla') return 'Catalogue record';
    if (meta.literature_role === 'chunk') return 'Book section';
    if (hasAnyWordPadded(blob, ['excavation', 'petrie', 'vyse', 'pyramid', 'temple', 'report'])) {
      return 'Excavation report';
    }
    return 'Book';
  }
  if (includesAny(blob, ['photograph', 'photo', 'lantern slide']) || (row.image_path && !meta.kind)) {
    return 'Photograph';
  }
  if (meta.kind === 'object') return 'Museum object';
  return 'Other';
}

function locationFor(meta = {}, row = {}) {
  const site = String(meta.site || '').toLowerCase();
  if (SITE_LABELS[site]) return SITE_LABELS[site];
  if (meta.site) return String(meta.site);
  // Fallback: scan title for site names
  const title = toLowerAsciiish(row.title || '');
  if (includesAny(title, ['abydos', 'osireion', 'umm el'])) return SITE_LABELS.abydos;
  if (includesAny(title, ['heliopolis', 'iunu', 'matariya'])) return SITE_LABELS.heliopolis;
  if (includesAny(title, ['giza', 'gizeh', 'khufu', 'sphinx'])) return SITE_LABELS.giza;
  return '—';
}

function approxDateFor(meta = {}, row = {}) {
  const period = String(meta.period || meta.year || '').trim();
  if (period) return period;
  const blob = `${row.title || ''} ${String(row.official_text || '').slice(0, 800)}`;
  const year = publicDomainYear(blob);
  if (year) return year;
  const low = toLowerAsciiish(blob);
  if (includesAny(low, ['early dynastic'])) return 'Early Dynastic';
  if (includesAny(low, ['old kingdom'])) return 'Old Kingdom';
  if (includesAny(low, ['predynastic'])) return 'Predynastic';
  return '—';
}

function cleanSourceName(title) {
  let t = String(title || '').trim();
  if (!t) return 'Untitled';
  // Drop trailing " — section N" / " - section N" chunk markers
  const low = toLowerAsciiish(t);
  const marker = ' section ';
  const idx = low.lastIndexOf(marker);
  if (idx >= 0) {
    const before = t.slice(0, idx).trimEnd();
    const after = t.slice(idx + marker.length).trim();
    let digits = '';
    for (let i = 0; i < after.length && isAsciiDigit(after[i]); i++) digits += after[i];
    if (digits && digits.length === after.length) {
      const sep = before.slice(-1);
      if (sep === '—' || sep === '–' || sep === '-') {
        t = before.slice(0, -1).trimEnd();
      } else if (before.endsWith(' -') || before.endsWith(' —') || before.endsWith(' –')) {
        t = before.slice(0, -2).trimEnd();
      }
    }
  }
  return collapseWhitespace(t) || 'Untitled';
}

function findParentLocalDocument(db, source, parentId) {
  if (!parentId || !db) return null;
  const row = db.prepare(
    'SELECT id, meta_json FROM harvest_items WHERE source = ? AND source_id = ? LIMIT 1',
  ).get(String(source || ''), String(parentId));
  if (!row) return null;
  const meta = parseMeta(row.meta_json);
  const resolved = resolveDocumentPath(meta.document_path);
  if (!resolved) return null;
  return `/api/cultures/items/${row.id}/document`;
}

function rowToItem(row, { includeText = false, db = null } = {}) {
  const meta = parseMeta(row.meta_json);
  const hasImage = !!resolveImagePath(row.image_path);
  const localDoc = resolveDocumentPath(meta.document_path);
  const hasLocalDocument = !!localDoc;
  const materialType = inferMaterialType(row, meta);
  const sourceName = cleanSourceName(row.title);
  const location = locationFor(meta, row);
  const approxDate = approxDateFor(meta, { ...row, official_text: includeText ? row.official_text : '' });
  let author = null;
  let authors = [];
  try {
    const { extractAuthors } = require('./corpusAuthorMeta');
    const src = String(row.source || '');
    const isLiterature = meta.kind === 'literature'
      || !!meta.literature_role
      || ['archive_org', 'web_pdf', 'topbib', 'tla'].includes(src);
    if (isLiterature) {
      authors = extractAuthors(row.title, meta, { query: meta.query || '' });
    } else {
      // Museum/object rows: title by-line only (ignore query/creator backfill bleed).
      const { authorsFromTitle } = require('./corpusAuthorMeta');
      authors = authorsFromTitle(row.title);
    }
    author = authors[0] || null;
  } catch (_) {
    author = meta.author || meta.work_author || null;
    if (!author && meta.creator) author = String(meta.creator).split(';')[0].trim() || null;
    authors = author ? [author] : [];
  }

  let linkUrl = null;
  let linkKind = null;
  if (hasLocalDocument) {
    linkUrl = `/api/cultures/items/${row.id}/document`;
    linkKind = 'local_document';
  } else if (meta.literature_role === 'chunk' && meta.parent_id) {
    const parentDoc = findParentLocalDocument(db, row.source, meta.parent_id);
    if (parentDoc) {
      linkUrl = parentDoc;
      linkKind = 'local_document';
    } else {
      linkUrl = row.source_url || `https://archive.org/details/${meta.parent_id}`;
      linkKind = 'source_page';
    }
  } else if (String(row.source || '') === 'archive_org' && row.source_url) {
    // Prefer the IA item page when the PDF is not stored locally (borrow/403 cases)
    linkUrl = String(row.source_url);
    linkKind = 'source_page';
  } else if (meta.document_url || meta.pdf_url) {
    linkUrl = String(meta.document_url || meta.pdf_url);
    linkKind = 'remote_document';
  } else if (hasImage) {
    linkUrl = `/api/cultures/items/${row.id}/image`;
    linkKind = 'image';
  } else if (row.source_url) {
    linkUrl = String(row.source_url);
    linkKind = 'source_page';
  }

  const out = {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    source_url: row.source_url,
    title: row.title,
    source_name: sourceName,
    type: materialType,
    source_type: materialType,
    author,
    authors,
    location,
    approx_date: approxDate,
    link_url: linkUrl,
    link_kind: linkKind,
    culture: row.culture,
    image_url: row.image_url,
    has_image: hasImage,
    thumb_url: hasImage ? `/api/cultures/items/${row.id}/image` : null,
    created_at: row.created_at,
    site: meta.site || null,
    period: meta.period || null,
    connector: meta.connector || row.source || null,
    license: meta.license || null,
    is_stub: !!meta.is_stub,
    kind: meta.kind || null,
    document_path: meta.document_path || null,
    has_document: !!(localDoc || meta.document_url || meta.pdf_url),
    has_local_document: hasLocalDocument || linkKind === 'local_document',
    document_url: hasLocalDocument ? `/api/cultures/items/${row.id}/document` : (meta.document_url || meta.pdf_url || null),
    image_bytes: meta.image_bytes != null ? Number(meta.image_bytes) : null,
    research_goal_id: meta.research_goal_id || null,
    transcription_count: row.transcription_count != null ? Number(row.transcription_count) : undefined,
    critique_count: row.critique_count != null ? Number(row.critique_count) : undefined,
  };
  if (includeText) {
    out.official_text = row.official_text || '';
    out.meta = meta;
  }
  return out;
}

function getStats() {
  const db = openDb();
  try {
    const harvest = db.prepare('SELECT COUNT(*) AS n FROM harvest_items').get().n;
    const transcriptions = db.prepare('SELECT COUNT(*) AS n FROM transcriptions').get().n;
    const critiques = db.prepare('SELECT COUNT(*) AS n FROM critiques').get().n;
    const bySite = {};
    const byKind = {};
    const bySource = {};
    const byType = {};
    const rows = db.prepare('SELECT id, source, title, image_path, official_text, meta_json FROM harvest_items').all();
    for (const r of rows) {
      const m = parseMeta(r.meta_json);
      const site = m.site || 'unknown';
      bySite[site] = (bySite[site] || 0) + 1;
      const kind = m.kind || 'object';
      byKind[kind] = (byKind[kind] || 0) + 1;
      const src = String(r.source || 'unknown');
      bySource[src] = (bySource[src] || 0) + 1;
      const t = inferMaterialType(r, m);
      byType[t] = (byType[t] || 0) + 1;
    }
    return {
      ok: true,
      db_path: dbFile(),
      images_dir: imagesDir(),
      documents_dir: documentsDir(),
      harvest_items: harvest,
      transcriptions,
      critiques,
      by_site: bySite,
      by_kind: byKind,
      by_source: bySource,
      by_type: byType,
    };
  } finally {
    db.close();
  }
}

function listItems(opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const site = String(opts.site || '').trim().toLowerCase();
  const q = String(opts.q || '').trim();
  const source = String(opts.source || '').trim().toLowerCase();
  const typeFilter = String(opts.type || '').trim().toLowerCase();
  const excludeCandidates = opts.exclude_candidates !== false && opts.exclude_candidates !== '0';

  const db = openDb();
  try {
    const where = [];
    const params = {};
    if (site) {
      where.push(`(COALESCE(h.meta_json,'') LIKE @siteLike1 OR COALESCE(h.meta_json,'') LIKE @siteLike2)`);
      params.siteLike1 = `%"site":"${site}"%`;
      params.siteLike2 = `%"site": "${site}"%`;
    }
    if (source) {
      where.push(`LOWER(h.source) = @source`);
      params.source = source;
    }
    if (excludeCandidates) {
      where.push(`COALESCE(h.meta_json,'') NOT LIKE '%"kind": "source_candidate"%'`);
      where.push(`COALESCE(h.meta_json,'') NOT LIKE '%"kind":"source_candidate"%'`);
    }
    if (q) {
      where.push(`(
        COALESCE(h.title,'') LIKE @q
        OR COALESCE(h.official_text,'') LIKE @q
        OR COALESCE(h.source_id,'') LIKE @q
        OR COALESCE(h.meta_json,'') LIKE @q
      )`);
      params.q = `%${q}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const flagFilter = String(opts.flag || '').trim().toLowerCase();
    const needsJsFilter = !!(typeFilter || flagFilter);
    const fetchLimit = needsJsFilter ? Math.min(800, Math.max(limit * 10, 120)) : limit;
    const fetchOffset = needsJsFilter ? 0 : offset;
    const rows = db.prepare(
      `
      SELECT h.*,
        (SELECT COUNT(*) FROM transcriptions t WHERE t.harvest_id = h.id) AS transcription_count,
        (SELECT COUNT(*) FROM critiques c WHERE c.harvest_id = h.id) AS critique_count
      FROM harvest_items h
      ${whereSql}
      ORDER BY h.id DESC
      LIMIT @limit OFFSET @offset
      `,
    ).all({ ...params, limit: fetchLimit, offset: fetchOffset });

    let items = rows.map((r) => rowToItem(r, { db }));
    try {
      const { attachFlag } = require('./eiCorpusFlags');
      items = items.map((it) => attachFlag(it));
    } catch (_) { /* flags optional */ }
    if (typeFilter) {
      items = items.filter((it) => String(it.type || '').toLowerCase() === typeFilter);
    }
    if (flagFilter) {
      items = items.filter((it) => String(it.flag || '') === flagFilter);
    }
    if (needsJsFilter) {
      const total = items.length;
      const page = items.slice(offset, offset + limit);
      return { ok: true, total, limit, offset, items: page };
    }

    const total = db.prepare(`SELECT COUNT(*) AS n FROM harvest_items h ${whereSql}`).get(params).n;
    return {
      ok: true,
      total,
      limit,
      offset,
      items,
    };
  } finally {
    db.close();
  }
}

function getItem(id) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) return { ok: false, error: 'invalid id' };
  const db = openDb();
  try {
    const row = db.prepare(
      `
      SELECT h.*,
        (SELECT COUNT(*) FROM transcriptions t WHERE t.harvest_id = h.id) AS transcription_count,
        (SELECT COUNT(*) FROM critiques c WHERE c.harvest_id = h.id) AS critique_count
      FROM harvest_items h WHERE h.id = ?
      `,
    ).get(hid);
    if (!row) return { ok: false, error: 'not found' };
    const item = rowToItem(row, { includeText: true, db });
    try {
      const { attachFlag } = require('./eiCorpusFlags');
      attachFlag(item);
    } catch (_) { /* optional */ }
    const transcriptions = db.prepare(
      'SELECT * FROM transcriptions WHERE harvest_id = ? ORDER BY id DESC LIMIT 5',
    ).all(hid).map((t) => ({
      id: t.id,
      model: t.model || null,
      gardiner_tokens: t.gardiner_tokens || null,
      confidence: t.confidence != null ? Number(t.confidence) : null,
      notes: t.notes || null,
      created_at: t.created_at || null,
    }));
    const critiques = db.prepare(
      'SELECT * FROM critiques WHERE harvest_id = ? ORDER BY id DESC LIMIT 5',
    ).all(hid).map((c) => ({
      id: c.id,
      model: c.model || null,
      review_markdown: String(c.review_markdown || '').slice(0, 2000),
      created_at: c.created_at || null,
    }));
    return { ok: true, item, transcriptions, critiques };
  } finally {
    db.close();
  }
}

function getImageBuffer(id) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) return null;
  const db = openDb();
  try {
    const row = db.prepare('SELECT image_path FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return null;
    const resolved = resolveImagePath(row.image_path);
    if (!resolved) return null;
    return { path: resolved, buffer: fs.readFileSync(resolved) };
  } finally {
    db.close();
  }
}

function getDocumentBuffer(id) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) return null;
  const db = openDb();
  try {
    const row = db.prepare('SELECT meta_json FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return null;
    const meta = parseMeta(row.meta_json);
    const resolved = resolveDocumentPath(meta.document_path);
    if (!resolved) return null;
    return {
      path: resolved,
      buffer: fs.readFileSync(resolved),
      filename: path.basename(resolved),
    };
  } finally {
    db.close();
  }
}

/**
 * Merge fields into harvest_items.meta_json.
 */
function patchItemMeta(id, patch = {}) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) return { ok: false, error: 'invalid id' };
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'invalid patch' };
  const db = openDbWritable();
  try {
    const row = db.prepare('SELECT id, title, meta_json FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return { ok: false, error: 'not found' };
    const meta = { ...parseMeta(row.meta_json), ...patch };
    db.prepare('UPDATE harvest_items SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), hid);
    return { ok: true, id: hid, title: row.title, meta };
  } finally {
    db.close();
  }
}

/**
 * Backfill author/authors on rows missing them (creator + title heuristics).
 */
function backfillAuthors(opts = {}) {
  const { enrichMeta } = require('./corpusAuthorMeta');
  const db = openDbWritable();
  const limit = Math.max(1, Math.min(5000, Number(opts.limit || 5000)));
  const force = opts.force === true;
  try {
    const rows = db.prepare('SELECT id, title, meta_json FROM harvest_items ORDER BY id ASC LIMIT ?').all(limit);
    const upd = db.prepare('UPDATE harvest_items SET meta_json = ? WHERE id = ?');
    let scanned = 0;
    let changed = 0;
    const samples = [];
    const tx = db.transaction(() => {
      for (const r of rows) {
        scanned += 1;
        const meta = parseMeta(r.meta_json);
        const out = enrichMeta(meta, r.title, {
          query: meta.query || '',
          force,
          from: 'backfill',
        });
        if (!out.changed) continue;
        upd.run(JSON.stringify(out.meta), r.id);
        changed += 1;
        if (samples.length < 12) {
          samples.push({ id: r.id, title: String(r.title || '').slice(0, 80), author: out.authors[0] });
        }
      }
    });
    tx();
    return { ok: true, scanned, changed, samples };
  } finally {
    db.close();
  }
}

module.exports = {
  culturesDataRoot,
  dbFile,
  documentsDir,
  getStats,
  listItems,
  getItem,
  deleteHarvestItem,
  getImageBuffer,
  getDocumentBuffer,
  patchItemMeta,
  backfillAuthors,
  inferMaterialType,
  SITE_LABELS,
};
