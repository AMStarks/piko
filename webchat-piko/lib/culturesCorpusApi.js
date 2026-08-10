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
  // P3.3e: prefer tenant data dir; legacy repo path is read-only migration only.
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim();
  const underTenant = dataDir
    ? path.join(dataDir, 'egyptian-insights')
    : path.join(__dirname, '..', 'data', 'egyptian-insights');
  const legacyRepo = path.join(__dirname, '..', '..', 'data', 'egyptian-insights');
  if (fs.existsSync(underTenant)) return underTenant;
  if (fs.existsSync(legacyRepo) && legacyRepo !== underTenant) {
    try {
      console.warn(`[culturesDataRoot] WARN legacy repo path in use: ${legacyRepo} (prefer PIKO_DATA_DIR/egyptian-insights)`);
    } catch (_) { /* ok */ }
    return legacyRepo;
  }
  return underTenant;
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

function quarantineDir() {
  return path.join(culturesDataRoot(), 'quarantine');
}

function moveToQuarantine(absPath, harvestId, kind) {
  if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return null;
  }
  const qDir = path.join(quarantineDir(), String(harvestId));
  fs.mkdirSync(qDir, { recursive: true });
  const dest = path.join(qDir, `${kind}_${path.basename(absPath)}`);
  try {
    fs.renameSync(absPath, dest);
    return dest;
  } catch (_) {
    try {
      fs.copyFileSync(absPath, dest);
      fs.unlinkSync(absPath);
      return dest;
    } catch (_) {
      return null;
    }
  }
}

function cascadeRemoveNoteAndRag(harvestId) {
  const hid = Number(harvestId);
  try {
    const { notesDir } = require('./eiBibliography');
    const np = path.join(notesDir(), `item_${hid}.json`);
    if (fs.existsSync(np)) fs.unlinkSync(np);
  } catch (_) { /* optional */ }
  try {
    const { removeHarvestChunks } = require('./eiCorpusRag');
    Promise.resolve(removeHarvestChunks(hid)).catch(() => {});
  } catch (_) { /* optional */ }
}

/**
 * P1.5: quarantine (soft-delete) — move files, tombstone meta, cascade notes/RAG.
 * Reversible via restoreQuarantinedItem within the retention window.
 */
function quarantineHarvestItem(id, opts = {}) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) {
    return { ok: false, error: 'invalid id' };
  }
  const reason = String(opts.reason || 'mission_fit_drop').slice(0, 280);
  const sourceUrl = String(opts.sourceUrl || opts.source_url || '').slice(0, 500);
  let imagePath = null;
  let documentPath = null;
  let title = '';
  const db = openDbWritable();
  try {
    const row = db.prepare('SELECT id, title, image_path, meta_json FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return { ok: false, error: 'not found', harvest_id: hid };
    title = String(row.title || '');
    const meta = parseMeta(row.meta_json);
    if (meta.status === 'quarantined') {
      return { ok: true, harvest_id: hid, already: true, quarantined: true };
    }
    imagePath = resolveImagePath(row.image_path);
    documentPath = resolveDocumentPath(meta.document_path);
    const qImage = moveToQuarantine(imagePath, hid, 'image');
    const qDoc = moveToQuarantine(documentPath, hid, 'document');
    const tombstone = {
      ...meta,
      status: 'quarantined',
      quarantine: {
        reason,
        source_url: sourceUrl || meta.source_url || meta.url || meta.document_url || '',
        quarantined_at: new Date().toISOString(),
        original_image_path: imagePath || null,
        original_document_path: documentPath || null,
        quarantine_image_path: qImage,
        quarantine_document_path: qDoc,
      },
    };
    // Clear live asset pointers so corpus readers skip this row.
    db.prepare(
      'UPDATE harvest_items SET image_path = NULL, meta_json = ? WHERE id = ?',
    ).run(JSON.stringify(tombstone), hid);
  } finally {
    db.close();
  }
  cascadeRemoveNoteAndRag(hid);
  try {
    const { clearFlag } = require('./eiCorpusFlags');
    clearFlag(hid);
  } catch (_) { /* optional */ }
  return {
    ok: true,
    harvest_id: hid,
    title,
    quarantined: true,
    reason,
  };
}

/**
 * Restore a quarantined harvest item (move files back, clear tombstone).
 */
function restoreQuarantinedItem(id) {
  const hid = Number(id);
  if (!Number.isFinite(hid) || hid <= 0) {
    return { ok: false, error: 'invalid id' };
  }
  const db = openDbWritable();
  try {
    const row = db.prepare('SELECT id, title, meta_json FROM harvest_items WHERE id = ?').get(hid);
    if (!row) return { ok: false, error: 'not found', harvest_id: hid };
    const meta = parseMeta(row.meta_json);
    if (meta.status !== 'quarantined' || !meta.quarantine) {
      return { ok: false, error: 'not_quarantined', harvest_id: hid };
    }
    const q = meta.quarantine;
    let imagePath = q.original_image_path || null;
    let documentPath = q.original_document_path || null;
    if (q.quarantine_image_path && fs.existsSync(q.quarantine_image_path)) {
      let base = path.basename(q.quarantine_image_path);
      if (base.startsWith('image_')) base = base.slice('image_'.length);
      const dest = imagePath || path.join(imagesDir(), base);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.renameSync(q.quarantine_image_path, dest); imagePath = dest; } catch (_) { /* keep */ }
    }
    if (q.quarantine_document_path && fs.existsSync(q.quarantine_document_path)) {
      let base = path.basename(q.quarantine_document_path);
      if (base.startsWith('document_')) base = base.slice('document_'.length);
      const dest = documentPath || path.join(documentsDir(), base);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.renameSync(q.quarantine_document_path, dest); documentPath = dest; } catch (_) { /* keep */ }
    }
    const restored = { ...meta };
    delete restored.status;
    delete restored.quarantine;
    if (documentPath) restored.document_path = documentPath;
    db.prepare(
      'UPDATE harvest_items SET image_path = ?, meta_json = ? WHERE id = ?',
    ).run(imagePath, JSON.stringify(restored), hid);
    return { ok: true, harvest_id: hid, restored: true, image_path: imagePath, document_path: documentPath };
  } finally {
    db.close();
  }
}

/**
 * Permanently delete quarantined items older than retentionDays (default 14).
 */
function purgeExpiredQuarantine(opts = {}) {
  const retentionDays = Math.max(1, Number(opts.retentionDays || process.env.PIKO_QUARANTINE_DAYS || 14) || 14);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const db = openDbWritable();
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, meta_json FROM harvest_items WHERE meta_json LIKE '%"status":"quarantined"%' OR meta_json LIKE '%"status": "quarantined"%'`,
    ).all();
  } finally {
    db.close();
  }
  const purged = [];
  for (const r of rows) {
    const meta = parseMeta(r.meta_json);
    const at = meta.quarantine && meta.quarantine.quarantined_at;
    if (!at) continue;
    const ts = Date.parse(at);
    if (!Number.isFinite(ts) || ts > cutoff) continue;
    // Remove quarantine files then hard-delete the row.
    const q = meta.quarantine || {};
    for (const p of [q.quarantine_image_path, q.quarantine_document_path]) {
      if (!p) continue;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ok */ }
    }
    const del = deleteHarvestItem(r.id);
    if (del.ok) purged.push(r.id);
  }
  return { ok: true, purged: purged.length, ids: purged, retentionDays };
}

/**
 * Remove a harvest row + related transcriptions/critiques + local assets + corpus flag.
 * Prefer quarantineHarvestItem for mission-fit drops (reversible).
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
    // Also wipe quarantine copies if present.
    if (meta.quarantine) {
      for (const p of [meta.quarantine.quarantine_image_path, meta.quarantine.quarantine_document_path]) {
        if (!p) continue;
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ok */ }
      }
    }
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
  cascadeRemoveNoteAndRag(hid);
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

function rowToItem(row, { includeText = false, includeMeta = false, db = null } = {}) {
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
  }
  if (includeMeta || includeText) {
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
  const includeMeta = opts.include_meta === true || opts.include_meta === '1';

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
    // P1.5: hide quarantined rows from normal corpus listings.
    if (opts.include_quarantined !== true && opts.include_quarantined !== '1') {
      where.push(`COALESCE(h.meta_json,'') NOT LIKE '%"status":"quarantined"%'`);
      where.push(`COALESCE(h.meta_json,'') NOT LIKE '%"status": "quarantined"%'`);
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

    let items = rows.map((r) => rowToItem(r, { db, includeMeta }));
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
    const prev = parseMeta(row.meta_json);
    const locked = !!(prev.pm_confirmed || prev.pm_confirm_id || prev.spine_retag);
    const patchLocks = !!(patch.pm_confirmed || patch.pm_confirm_id || patch.spine_retag || patch.force_thread);
    const meta = { ...prev, ...patch };
    if (locked && !patchLocks) {
      if (prev.thread) meta.thread = prev.thread;
      if (prev.site) meta.site = prev.site;
      if (prev.pm_confirmed) meta.pm_confirmed = prev.pm_confirmed;
      if (prev.pm_confirm_id) meta.pm_confirm_id = prev.pm_confirm_id;
      if (prev.spine_retag) meta.spine_retag = prev.spine_retag;
    }
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
  quarantineDir,
  getStats,
  listItems,
  getItem,
  deleteHarvestItem,
  quarantineHarvestItem,
  restoreQuarantinedItem,
  purgeExpiredQuarantine,
  getImageBuffer,
  getDocumentBuffer,
  patchItemMeta,
  backfillAuthors,
  inferMaterialType,
  SITE_LABELS,
};
