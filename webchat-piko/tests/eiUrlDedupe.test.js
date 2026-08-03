const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('normalizeSourceUrl canonicalizes archive.org download/details', () => {
  const { normalizeSourceUrl } = require('../lib/eiResearchCampaign');
  assert.equal(
    normalizeSourceUrl('https://archive.org/download/abydos1petr/abydos1petr.pdf'),
    'https://archive.org/details/abydos1petr',
  );
  assert.equal(
    normalizeSourceUrl('https://www.archive.org/details/abydos1petr?utm_source=x'),
    'https://archive.org/details/abydos1petr',
  );
  assert.equal(
    normalizeSourceUrl('https://Example.com/Foo/Bar.PDF?utm_campaign=1'),
    'https://example.com/Foo/bar.pdf',
  );
});

test('alreadyKeptUrl matches normalized source_url across items', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-urldedupe-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;

  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  delete require.cache[campaignPath];
  delete require.cache[corpusPath];

  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(dir, 'cultures_cache.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE harvest_items (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        title TEXT,
        culture TEXT,
        official_text TEXT,
        image_path TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT,
        UNIQUE(source, source_id)
      );
      CREATE TABLE transcriptions (id INTEGER PRIMARY KEY, harvest_id INTEGER);
      CREATE TABLE critiques (id INTEGER PRIMARY KEY, harvest_id INTEGER);
    `);
    db.prepare(`
      INSERT INTO harvest_items (id, source, source_id, source_url, title, culture, meta_json, created_at)
      VALUES (1, 'archive_org', 'abydos1petr',
        'https://archive.org/details/abydos1petr',
        'https://archive.org/download/abydos1petr/abydos1petr.pdf',
        'egypt', '{}', datetime('now'))
    `).run();
    db.close();

    delete require.cache[campaignPath];
    delete require.cache[corpusPath];
    const { alreadyKeptUrl, alreadyInCorpus, normalizeSourceUrl } = require('../lib/eiResearchCampaign');

    assert.equal(
      alreadyKeptUrl('https://archive.org/download/abydos1petr/abydos1petr.pdf'),
      true,
    );
    assert.equal(alreadyKeptUrl('https://archive.org/details/abydos1petr'), true);
    assert.equal(alreadyKeptUrl('https://archive.org/details/totally-different'), false);
    assert.equal(
      alreadyInCorpus('https://archive.org/download/abydos1petr/abydos1petr.pdf'),
      true,
    );
    assert.equal(
      normalizeSourceUrl('https://archive.org/download/abydos1petr/abydos1petr.pdf'),
      'https://archive.org/details/abydos1petr',
    );
    // exceptHarvestId: same item does not count as duplicate of itself
    assert.equal(
      alreadyKeptUrl('https://archive.org/details/abydos1petr', { exceptHarvestId: 1 }),
      false,
    );
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[campaignPath];
    delete require.cache[corpusPath];
  }
});

test('flagDuplicateUrlKeeps marks older notes merged_into without deleting items', () => {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-flagdup-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;

  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const corpusPath = require.resolve('../lib/culturesCorpusApi');
  const notesPath = require.resolve('../lib/eiCorpusNotes');
  const bibPath = require.resolve('../lib/eiBibliography');
  for (const p of [campaignPath, corpusPath, notesPath, bibPath]) delete require.cache[p];

  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'cultures_cache.sqlite'));
    db.exec(`
      CREATE TABLE harvest_items (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        title TEXT,
        culture TEXT,
        official_text TEXT,
        image_path TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT,
        UNIQUE(source, source_id)
      );
      CREATE TABLE transcriptions (id INTEGER PRIMARY KEY, harvest_id INTEGER);
      CREATE TABLE critiques (id INTEGER PRIMARY KEY, harvest_id INTEGER);
    `);
    const ins = db.prepare(`
      INSERT INTO harvest_items (id, source, source_id, source_url, title, culture, meta_json, created_at)
      VALUES (?, 'archive_org', ?, ?, ?, 'egypt', '{}', datetime('now'))
    `);
    ins.run(10, 'abydos1petr-a', 'https://archive.org/details/abydos1petr', 'Abydos I old');
    ins.run(20, 'abydos1petr-b', 'https://archive.org/download/abydos1petr/abydos1petr.pdf', 'Abydos I new');
    db.close();

    for (const p of [campaignPath, corpusPath, notesPath, bibPath]) delete require.cache[p];
    const { flagDuplicateUrlKeeps } = require('../lib/eiResearchCampaign');
    const { loadNote } = require('../lib/eiCorpusNotes');
    const out = flagDuplicateUrlKeeps();
    assert.equal(out.ok, true);
    assert.ok(out.flagged.length >= 1);
    const older = loadNote(10);
    assert.ok(older);
    assert.equal(older.merged_into, 20);
    // Corpus rows untouched
    const api = require('../lib/culturesCorpusApi');
    assert.equal(api.getItem(10).ok, true);
    assert.equal(api.getItem(20).ok, true);
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    for (const p of [campaignPath, corpusPath, notesPath, bibPath]) delete require.cache[p];
  }
});
