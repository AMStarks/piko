const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  parseMissionJudgment,
  harvestIdsFromToolResult,
  formatMissionFitReport,
  enforceDeliverableContract,
  enforceRelationConsistency,
  enforceProvenanceContract,
  applySingularTitleOverride,
  dedupeKeepJudgments,
} = require('../lib/eiMissionFitReview');

test('parseMissionJudgment authored_by keep', () => {
  const j = parseMissionJudgment(JSON.stringify({
    verdict: 'keep',
    relation: 'authored_by',
    author: 'W. M. Flinders Petrie',
    work_title: 'Tanis Part II',
    confidence: 0.91,
    why: 'Title page names Petrie as author',
  }));
  assert.equal(j.verdict, 'keep');
  assert.equal(j.relation, 'authored_by');
  assert.match(j.author, /Petrie/i);
});

test('parseMissionJudgment about → drop', () => {
  const j = parseMissionJudgment(JSON.stringify({
    verdict: 'drop',
    relation: 'about',
    author: 'Jane Scholar',
    confidence: 0.8,
    why: 'Modern paper about Petrie, not by him',
  }));
  assert.equal(j.verdict, 'drop');
  assert.equal(j.relation, 'about');
});

test('harvestIdsFromToolResult', () => {
  const ids = harvestIdsFromToolResult({
    items: [{ harvest_id: 10 }, { id: 11 }, { harvest_id: 'x' }],
  });
  assert.deepEqual(ids, [10, 11]);
});

test('formatMissionFitReport lists kept and dropped', () => {
  const text = formatMissionFitReport({
    reviewed: 2,
    counts: { keep: 1, drop: 1, unsure: 0, purged: 1 },
    judgments: [
      {
        harvest_id: 1, verdict: 'keep', relation: 'authored_by',
        work_title: 'Abydos', author: 'Petrie',
      },
      {
        harvest_id: 2, verdict: 'drop', relation: 'about',
        title: 'Publicising Petrie', why: 'secondary essay', purged: true,
      },
    ],
  });
  assert.match(text, /keep=1/);
  assert.match(text, /Kept/);
  assert.match(text, /purged/);
});

test('enforceDeliverableContract demotes keep without local document', () => {
  const j = enforceDeliverableContract(
    { verdict: 'keep', relation: 'authored_by', why: 'by Petrie' },
    { id: 1, has_local_document: false },
    { requireLocalDocument: true },
  );
  assert.equal(j.verdict, 'drop');
  assert.equal(j.demoted_from_keep, true);
});

test('enforceDeliverableContract keeps when local document present', () => {
  const j = enforceDeliverableContract(
    { verdict: 'keep', relation: 'authored_by', why: 'by Petrie' },
    { id: 1, has_local_document: true },
    { requireLocalDocument: true },
  );
  assert.equal(j.verdict, 'keep');
});

test('enforceRelationConsistency demotes keep+about for works asks', () => {
  const j = enforceRelationConsistency(
    {
      verdict: 'keep', relation: 'about', harvest_id: 231,
      work_title: 'mixing migration and the lessons of history',
      why: 'not a direct work by Petrie but related',
    },
    'Please find and add all PDFs and articles authored by W.M. Flinders Petrie',
  );
  assert.equal(j.verdict, 'drop');
  assert.equal(j.demoted_from_keep, true);
  assert.match(j.why, /relation=about/);
});

test('enforceRelationConsistency exempts missions asking for secondary material', () => {
  const j = enforceRelationConsistency(
    { verdict: 'keep', relation: 'about', harvest_id: 5, work_title: 'A biography of Petrie' },
    'Find biographical and secondary literature about Petrie',
  );
  assert.equal(j.verdict, 'keep');
});

test('enforceRelationConsistency leaves authored_by keeps alone', () => {
  const j = enforceRelationConsistency(
    { verdict: 'keep', relation: 'authored_by', harvest_id: 6, work_title: 'Abydos' },
    'Please find all works by Petrie',
  );
  assert.equal(j.verdict, 'keep');
});

test('dedupeKeepJudgments collapses same work across hosts, keeps best', async () => {
  const { judgments, demoted } = await dedupeKeepJudgments([
    {
      harvest_id: 1, verdict: 'keep', work_title: 'Medum', title_score: 0.9, confidence: 0.9,
    },
    {
      harvest_id: 2, verdict: 'keep', work_title: 'Medum - The University of Chicago', title_score: 0.8, confidence: 0.8,
    },
    {
      harvest_id: 3, verdict: 'keep', work_title: 'The Pyramids and Temples of Gizeh', title_score: 0.9, confidence: 0.9,
    },
  ], { purgeDrops: false, applyFlags: false });
  assert.equal(demoted.length, 1);
  assert.equal(demoted[0].harvest_id, 2);
  const keeps = judgments.filter((j) => j.verdict === 'keep');
  assert.deepEqual(keeps.map((j) => j.harvest_id).sort(), [1, 3]);
  assert.match(demoted[0].why, /Duplicate of kept #1/);
});

test('dedupeKeepJudgments preserves multi-volume works', async () => {
  const { demoted } = await dedupeKeepJudgments([
    { harvest_id: 1, verdict: 'keep', work_title: 'Abydos Part I' },
    { harvest_id: 2, verdict: 'keep', work_title: 'Abydos Part II' },
  ], { purgeDrops: false, applyFlags: false });
  assert.equal(demoted.length, 0);
});

test('enforceProvenanceContract drops summary-mill PDFs', () => {
  const j = enforceProvenanceContract(
    { verdict: 'keep', work_title: 'Lost Technologies of Ancient Egypt' },
    { id: 4, source_url: 'https://cdn.bookey.app/files/pdf/book/en/lost-technologies-of-ancient-egypt.pdf', has_local_document: true },
    "Please find and add to Corpus Christopher Dunn's Lost Technologies of Ancient Egypt",
  );
  assert.equal(j.verdict, 'drop');
  assert.equal(j.demoted_from_keep, true);
  assert.match(j.why, /Summary-service/i);
});

test('enforceProvenanceContract exempts explicit summary asks', () => {
  const j = enforceProvenanceContract(
    { verdict: 'keep', work_title: 'Lost Technologies of Ancient Egypt' },
    { id: 4, source_url: 'https://cdn.bookey.app/x.pdf', has_local_document: true },
    'Find me a summary of Lost Technologies of Ancient Egypt',
  );
  assert.equal(j.verdict, 'keep');
});

test('promoter cannot resurrect a provenance demotion', () => {
  const named = {
    isSingularTitle: true,
    title: 'Lost Technologies of Ancient Egypt',
    author: 'Christopher Dunn',
  };
  const item = {
    id: 4,
    title: 'PDF Lost Technologies of Ancient Egypt PDF - cdn.bookey.app',
    source_url: 'https://cdn.bookey.app/files/pdf/book/en/lost-technologies-of-ancient-egypt.pdf',
    has_local_document: true,
  };
  let j = enforceProvenanceContract(
    { verdict: 'keep', work_title: 'Lost Technologies of Ancient Egypt', author: 'Christopher Dunn' },
    item,
    "Please find and add to Corpus Christopher Dunn's Lost Technologies of Ancient Egypt",
  );
  j = applySingularTitleOverride(j, item, named, {});
  assert.equal(j.verdict, 'drop');
});

test('deleteHarvestItem removes row and flag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-purge-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = tmp;
  fs.mkdirSync(path.join(tmp, 'assets', 'documents'), { recursive: true });
  const dbPath = path.join(tmp, 'cultures_cache.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE harvest_items (
      id INTEGER PRIMARY KEY, source TEXT, source_id TEXT, source_url TEXT,
      title TEXT, culture TEXT, official_text TEXT, image_path TEXT, image_url TEXT, meta_json TEXT
    );
    CREATE TABLE transcriptions (id INTEGER PRIMARY KEY, harvest_id INTEGER);
    CREATE TABLE critiques (id INTEGER PRIMARY KEY, harvest_id INTEGER);
  `);
  const doc = path.join(tmp, 'assets', 'documents', 't.pdf');
  fs.writeFileSync(doc, '%PDF-1.4 test');
  db.prepare(
    `INSERT INTO harvest_items (id, source, source_id, title, meta_json)
     VALUES (1, 'web_pdf', 'x', 'Drop me', ?)`,
  ).run(JSON.stringify({ kind: 'literature', document_path: doc }));
  db.close();

  // Fresh requires after env set
  delete require.cache[require.resolve('../lib/eiCorpusFlags')];
  delete require.cache[require.resolve('../lib/culturesCorpusApi')];
  const { setFlag, getFlag } = require('../lib/eiCorpusFlags');
  setFlag(1, { flag: 'drop', reason: 'test' });
  assert.equal(getFlag(1).flag, 'drop');

  const { deleteHarvestItem, getItem } = require('../lib/culturesCorpusApi');
  const del = deleteHarvestItem(1);
  assert.equal(del.ok, true);
  assert.equal(getItem(1).ok, false);
  assert.equal(getFlag(1), null);
  assert.equal(fs.existsSync(doc), false);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
});

// --- Author contract + thin-keep floor (Schoch fixes) ---

const {
  enforceAuthorConsistency,
  enforceThinContentFloor,
} = require('../lib/eiMissionFitReview');
const { parseNamedWork: parseForAuthor } = require('../lib/eiGoalParse');

test('enforceAuthorConsistency demotes keep with a different named author', () => {
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceAuthorConsistency({
    verdict: 'keep',
    relation: 'authored_by',
    author: 'Zahi Hawass',
    work_title: 'The Great Sphinx at Giza: Date and Function',
    why: 'discusses Sphinx erosion',
  }, named, named.raw);
  assert.equal(j.verdict, 'drop');
  assert.equal(j.demoted_from_keep, true);
  assert.match(j.why, /Author contract/);
});

test('enforceAuthorConsistency demotes unknown author to unsure on author-works asks', () => {
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceAuthorConsistency({
    verdict: 'keep', author: 'unknown', work_title: 'Sphinx erosion notes',
  }, named, named.raw);
  assert.equal(j.verdict, 'unsure');
  assert.equal(j.demoted_from_keep, true);
});

test('enforceTopicRelevance demotes keeps that never mention the topic', () => {
  const { enforceTopicRelevance } = require('../lib/eiMissionFitReview');
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceTopicRelevance({
    verdict: 'keep', author: 'Robert Schoch',
    work_title: 'Voyages of the Pyramid Builders',
    why: 'authored by Robert Schoch',
  }, named);
  assert.equal(j.verdict, 'unsure');
  assert.match(j.why, /Topic contract/);
});

test('enforceTopicRelevance keeps topic-matching titles', () => {
  const { enforceTopicRelevance } = require('../lib/eiMissionFitReview');
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceTopicRelevance({
    verdict: 'keep', author: 'Robert Schoch',
    work_title: 'Redating the Great Sphinx of Giza',
    why: 'discusses water weathering of the Sphinx enclosure',
  }, named);
  assert.equal(j.verdict, 'keep');
});

test('enforceAuthorConsistency accepts byline in title when author field misfiled', () => {
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceAuthorConsistency({
    verdict: 'keep',
    author: 'Boston University',
    work_title: 'Redating the Great Sphinx of Giza by Robert M. Schoch',
  }, named, named.raw);
  assert.equal(j.verdict, 'keep');
});

test('enforceThinContentFloor demotes stub keeps to unsure on plural asks', () => {
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceThinContentFloor({
    verdict: 'keep', content_chars: 626, work_title: 'Pyramid Quest',
  }, named);
  assert.equal(j.verdict, 'unsure');
  assert.match(j.why, /stub|preview/i);
});

test('enforceThinContentFloor exempts singular-title asks (scans OCR thin)', () => {
  const named = parseForAuthor("Please find Christopher Dunn's Lost Technologies of Ancient Egypt");
  const j = enforceThinContentFloor({
    verdict: 'keep', content_chars: 400, work_title: 'Lost Technologies of Ancient Egypt',
  }, named);
  assert.equal(j.verdict, 'keep');
});

test('enforceThinContentFloor passes keeps with substantial content', () => {
  const named = parseForAuthor('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  const j = enforceThinContentFloor({
    verdict: 'keep', content_chars: 42000, work_title: 'Forgotten Civilization',
  }, named);
  assert.equal(j.verdict, 'keep');
});
