const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

test('culturesCorpusApi lists and serves items from sqlite', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-corpus-'));
  const dbPath = path.join(tmp, 'cultures_cache.sqlite');
  const imgDir = path.join(tmp, 'assets', 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  const imgFile = path.join(imgDir, 'sample.jpg');
  fs.writeFileSync(imgFile, Buffer.alloc(12000, 7));

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE harvest_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    CREATE TABLE transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harvest_id INTEGER NOT NULL
    );
    CREATE TABLE critiques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harvest_id INTEGER NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO harvest_items (source, source_id, title, official_text, image_path, meta_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'met',
    '1',
    'Abydos ivory label',
    'Official text here',
    imgFile,
    JSON.stringify({ site: 'abydos', connector: 'met', is_stub: false, image_bytes: 12000 }),
  );
  db.close();

  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = tmp;
  delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  const api = require('../lib/culturesCorpusApi');

  const stats = api.getStats();
  assert.equal(stats.harvest_items, 1);
  assert.equal(stats.by_site.abydos, 1);

  const list = api.listItems({ site: 'abydos', limit: 10 });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].title, 'Abydos ivory label');
  assert.equal(list.items[0].source_name, 'Abydos ivory label');
  assert.equal(list.items[0].type, 'Ivory label');
  assert.match(list.items[0].location, /Abydos/);
  assert.equal(list.items[0].has_image, true);
  assert.equal(list.items[0].link_kind, 'image');

  const item = api.getItem(1);
  assert.equal(item.ok, true);
  assert.match(item.item.official_text, /Official text/);

  const img = api.getImageBuffer(1);
  assert.ok(img);
  assert.equal(img.buffer.length, 12000);

  // Local document link
  const docs = path.join(tmp, 'assets', 'documents');
  fs.mkdirSync(docs, { recursive: true });
  const pdf = path.join(docs, 'book.pdf');
  fs.writeFileSync(pdf, Buffer.alloc(800, 1));
  const db2 = new Database(dbPath);
  db2.prepare(`UPDATE harvest_items SET meta_json=? WHERE id=1`).run(JSON.stringify({
    site: 'abydos',
    connector: 'archive_org',
    kind: 'literature',
    document_path: pdf,
  }));
  db2.close();
  delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  const api2 = require('../lib/culturesCorpusApi');
  const again = api2.getItem(1);
  assert.equal(again.item.has_local_document, true);
  assert.equal(again.item.link_kind, 'local_document');
  const doc = api2.getDocumentBuffer(1);
  assert.ok(doc);
  assert.equal(doc.buffer.length, 800);

  fs.rmSync(tmp, { recursive: true, force: true });
});
