const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNamedWork,
  focusedSeekQuery,
  titleMatchScore,
  authorMatch,
} = require('../lib/eiGoalParse');
const { enforceNamedWorkKeeps } = require('../lib/eiMissionFitReview');

const ASK = "Please find and add to Corpus Christopher Dunn's Lost Technologies of Ancient Egypt";

test('parseNamedWork extracts Dunn Lost Technologies', () => {
  const n = parseNamedWork(ASK);
  assert.equal(n.isSingularTitle, true);
  assert.match(n.author || '', /Christopher Dunn/i);
  assert.match(n.title || '', /Lost Technologies of Ancient Egypt/i);
  assert.equal(n.maxKeeps, 1);
  assert.match(n.seekQuery, /Lost Technologies/i);
  assert.match(n.seekQuery, /PDF/i);
  assert.doesNotMatch(n.seekQuery, /Please find/i);
});

test('focusedSeekQuery strips corpus instruction', () => {
  const q = focusedSeekQuery(ASK);
  assert.match(q, /Lost Technologies of Ancient Egypt/i);
  assert.match(q, /"/);
  assert.doesNotMatch(q, /add to Corpus/i);
});

test('titleMatchScore accepts Lost Technologies editions', () => {
  const expected = 'Lost Technologies of Ancient Egypt';
  assert.ok(titleMatchScore(expected, 'Lost Technologies Of Ancient Egypt') >= 0.9);
  assert.ok(titleMatchScore(expected, 'PDF Lost Technologies of Ancient Egypt Advanced Engineering') >= 0.9);
});

test('titleMatchScore rejects other Dunn / Egypt PDFs', () => {
  const expected = 'Lost Technologies of Ancient Egypt';
  assert.ok(titleMatchScore(expected, 'The Giza Power Plant Technologies Of Ancient Egypt') < 0.72);
  assert.ok(titleMatchScore(expected, 'Between Heaven and Earth - Birds in Ancient Egypt') < 0.72);
});

test('authorMatch Christopher Dunn', () => {
  assert.equal(authorMatch('Christopher Dunn', 'Christopher Dunn'), true);
  assert.equal(authorMatch('Christopher Dunn', 'unknown'), false);
});

test('applySingularTitleOverride promotes LLM drop on exact title with author match', () => {
  const { applySingularTitleOverride } = require('../lib/eiMissionFitReview');
  const named = parseNamedWork(ASK);
  // WP2.6: drop + unknown author must NOT promote (even at high title score).
  const noAuth = applySingularTitleOverride(
    {
      verdict: 'drop',
      relation: 'unrelated',
      why: 'looks like a summary',
      author: 'unknown',
      work_title: '',
      title: 'PDF Lost Technologies Of Ancient Egypt',
      confidence: 0.8,
    },
    { title: 'PDF Lost Technologies Of Ancient Egypt', has_local_document: true },
    named,
  );
  assert.equal(noAuth.verdict, 'drop');

  // Matching author + strong title → promote from drop.
  const out = applySingularTitleOverride(
    {
      verdict: 'drop',
      relation: 'unrelated',
      why: 'LLM misfire',
      author: 'Christopher Dunn',
      work_title: '',
      title: 'PDF Lost Technologies Of Ancient Egypt',
      confidence: 0.8,
    },
    { title: 'PDF Lost Technologies Of Ancient Egypt', has_local_document: true },
    named,
  );
  assert.equal(out.verdict, 'keep');
  assert.equal(out.promoted_from_drop, true);
  assert.ok(out.title_score >= 0.9);
});

test('enforceNamedWorkKeeps keeps one Lost Technologies only', async () => {
  const mission = ASK;
  const judgments = [
    {
      harvest_id: 1, verdict: 'keep', relation: 'title_match', confidence: 0.9,
      work_title: 'Lost Technologies of Ancient Egypt', title: 'Lost Technologies',
      author: 'Christopher Dunn',
    },
    {
      harvest_id: 2, verdict: 'keep', relation: 'authored_by', confidence: 0.85,
      work_title: 'The Giza Power Plant', title: 'Giza Power Plant Technologies Of Ancient Egypt',
      author: 'Christopher Dunn',
    },
    {
      harvest_id: 3, verdict: 'keep', relation: 'title_match', confidence: 0.7,
      work_title: 'Birds in Ancient Egypt', title: 'Birds',
      author: 'unknown',
    },
  ];
  const out = await enforceNamedWorkKeeps(judgments, mission, {
    purgeDrops: false,
    applyFlags: false,
    maxKeeps: 1,
  });
  const keeps = out.judgments.filter((j) => j.verdict === 'keep');
  assert.equal(keeps.length, 1);
  assert.equal(keeps[0].harvest_id, 1);
  assert.ok(out.demoted.length >= 2);
});

// --- Author+topic plural asks (Schoch-class) ---

test('parseNamedWork extracts author from "all <Name> articles" ask', () => {
  const n = parseNamedWork('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  assert.equal(n.isSingularTitle, false);
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Robert Schoch/);
});

test('parseNamedWork extracts author from "authored by" ask', () => {
  const n = parseNamedWork('Please find and add to Corpus all PDFs and articles authored by W.M. Flinders Petrie regarding Ancient Egypt.');
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Flinders Petrie/);
});

test('parseNamedWork does not treat a capitalised topic as an author', () => {
  const n = parseNamedWork('Please find all Sphinx articles about erosion.');
  assert.equal(n.isAuthorWorks, false);
  assert.equal(n.author, null);
});

test('parseNamedWork extracts single-name ancient author via by-clause', () => {
  const n = parseNamedWork('Find all accounts of the Labyrinth written by Herodotus.');
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Herodotus/);
});

test('parseNamedWork extracts Mariette via "accounts" work-noun', () => {
  const n = parseNamedWork('Please find all Auguste Mariette accounts of the Serapeum of Saqqara.');
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Auguste Mariette/);
});

test('parseNamedWork extracts Lepsius via "surveys" work-noun', () => {
  const n = parseNamedWork('Please find all Karl Richard Lepsius surveys of Egyptian monuments or the Labyrinth at Hawara.');
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Lepsius/);
});

test('parseNamedWork treats "accounts by Herodotus" as author-works, not a book title', () => {
  const n = parseNamedWork('Please find ancient written accounts of the Egyptian Labyrinth by Herodotus.');
  assert.equal(n.isSingularTitle, false);
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /^Herodotus$/);
  assert.equal(n.title, null);
});

test('parseNamedWork handles name particles (Pliny the Elder)', () => {
  const n = parseNamedWork('Please find ancient written accounts of the Egyptian Labyrinth by Pliny the Elder.');
  assert.equal(n.isAuthorWorks, true);
  assert.match(n.author || '', /Pliny the Elder/);
});

test('parseNamedWork extracts topic tokens for author+topic asks', () => {
  const n = parseNamedWork('Please find all Robert Schoch articles dealing with Sphinx erosion.');
  assert.ok(Array.isArray(n.topic));
  assert.ok(n.topic.some((t) => /sphinx/i.test(t)));
});

test('parseNamedWork does not treat prioritise-research chat as a book title', () => {
  const { parseNamedWork, extractResearchTopicPhrase } = require('../lib/eiGoalParse');
  const n = parseNamedWork('Yes please; prioritise research of the Osireion.');
  assert.equal(n.isSingularTitle, false);
  assert.equal(n.title, null);
  assert.equal(extractResearchTopicPhrase('Yes please; prioritise research of the Osireion.'), 'Osireion');
  assert.ok(String(n.seekQuery).toLowerCase().includes('osireion'));
  assert.ok(!String(n.seekQuery).toLowerCase().includes('yes please'));
});

test('looksLikeWorkOrder detects find/add asks and exempts inventory questions', () => {
  const { looksLikeWorkOrder } = require('../lib/eiGoalParse');
  assert.equal(looksLikeWorkOrder("Please find and add to Corpus John Anthony West's Serpent in the Sky."), true);
  assert.equal(looksLikeWorkOrder('What authors are in the corpus?'), false);
  assert.equal(looksLikeWorkOrder("I've been thinking about pyramid construction."), false);
  // Status questions are answers — not work orders (phrasing must not fork subsystems).
  assert.equal(looksLikeWorkOrder('campaign status'), false);
  assert.equal(looksLikeWorkOrder('Status of the research campaign'), false);
  assert.equal(looksLikeWorkOrder('Give me an update on the campaign'), false);
  // Control verbs still dispatch.
  assert.equal(looksLikeWorkOrder('Pause the research campaign'), true);
  assert.equal(looksLikeWorkOrder('Start the research campaign'), true);
});

test('isCampaignStatusQuestion floors status phrasings, not control verbs', () => {
  const { isCampaignStatusQuestion, looksLikeWorkOrder } = require('../lib/eiGoalParse');
  assert.equal(isCampaignStatusQuestion('campaign status'), true);
  assert.equal(isCampaignStatusQuestion('Campaign status?'), true);
  assert.equal(isCampaignStatusQuestion('campaign status please'), true);
  assert.equal(isCampaignStatusQuestion('Status of the research campaign'), true);
  assert.equal(isCampaignStatusQuestion('status of campaign'), true);
  assert.equal(isCampaignStatusQuestion("What's the campaign status?"), true);
  assert.equal(isCampaignStatusQuestion("What's our campaign status?"), true);
  assert.equal(isCampaignStatusQuestion('Give me an update on the campaign'), true);
  assert.equal(isCampaignStatusQuestion('Give me an update'), true);
  assert.equal(isCampaignStatusQuestion('How is the campaign going?'), true);
  assert.equal(isCampaignStatusQuestion("How's research going?"), true);
  assert.equal(isCampaignStatusQuestion('how are we doing on Giza?'), true);
  assert.equal(looksLikeWorkOrder("How's research going?"), false);
  assert.equal(looksLikeWorkOrder('I might get into Petrie articles sometime'), false);
  assert.equal(looksLikeWorkOrder("I'd like to get a feel for the corpus"), false);
  // Control verbs and work orders are NOT status questions.
  assert.equal(isCampaignStatusQuestion('Pause the research campaign'), false);
  assert.equal(isCampaignStatusQuestion('Start the campaign'), false);
  assert.equal(isCampaignStatusQuestion("Please find Dunn's book"), false);
  assert.equal(isCampaignStatusQuestion('What have you learned so far?'), false);
});
