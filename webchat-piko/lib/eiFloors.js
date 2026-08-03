/**
 * WP8.2 — Deterministic veto helpers without regex.
 * Used as fail-closed backup when understand() is unavailable/failed.
 * Primary path: lib/understand.js intent enum.
 */
const { toLowerAsciiish, includesAny, collapseWhitespace, hasHttpUrl } = require('./text');

function norm(message) {
  return collapseWhitespace(toLowerAsciiish(message));
}

function hasWord(haystack, word) {
  const h = ` ${haystack} `;
  return h.includes(` ${word} `);
}

function isCampaignStatusQuestion(message) {
  const t = norm(message);
  if (!t) return false;
  if (parseCampaignControlAction(message)) return false;

  // Bare / near-bare update asks
  if (t === 'give me an update' || t === 'give me an update?' || t === 'an update' || t === 'an update?'
    || t === 'update' || t === 'update?' || t.startsWith('give me an update')) {
    return true;
  }

  const hasStatusLex = includesAny(t, [
    'status', 'update', 'progress', 'progressing', 'going', 'doing',
  ]);
  const hasDomain = includesAny(t, [
    'campaign', 'research', 'learning', 'ingestion', 'corpus', 'giza',
    'keep', 'keeps', 'cycle', 'cycles', 'lead', 'leads',
  ]);

  if (t.includes('campaign status') || t.includes('research campaign status')) return true;
  if (t.includes('status of') && hasDomain) return true;
  if (t.includes('status of the campaign') || t.includes('status of our campaign')) return true;
  if (t.includes('what\'s the campaign') || t.includes('whats the campaign')) return true;
  if (t.includes('what\'s our campaign') || t.includes('whats our campaign')) return true;
  if (t.includes('how\'s research') || t.includes('how is research') || t.includes('hows research')) return true;
  if (t.includes('how\'s the campaign') || t.includes('how is the campaign')) return true;
  if (t.includes('how is learning') || t.includes('how\'s learning')) return true;
  if (t.includes('how is ingestion') || t.includes('how\'s ingestion')) return true;
  if (t.includes('how are we doing') && hasDomain) return true;
  if (hasStatusLex && hasDomain) return true;
  return false;
}

function isOpinionQuestion(message) {
  const t = norm(message);
  if (!t) return false;
  return includesAny(t, [
    'what do you make',
    'what do you think',
    'what do you reckon',
    'what do you know',
    'what\'s your take',
    'whats your take',
    'what is your take',
    'what\'s your view',
    'whats your view',
    'what is your view',
    'what\'s your opinion',
    'your thoughts on',
    'your take on',
    'your opinion on',
    'your view on',
    'how do you feel',
    'how do you see',
    'how do you interpret',
    'how do you read',
    'do you think',
    'do you believe',
    'do you reckon',
    'do you buy',
    'do you agree',
    'thoughts on',
    'opinions on',
    'opinion on',
    'takes on',
  ]);
}

function looksLikeWorkOrder(message) {
  const t = norm(message);
  if (!t) return false;
  if (isCampaignStatusQuestion(message) || isOpinionQuestion(message)) return false;

  // Inventory / library questions are not work.
  if ((t.startsWith('what ') || t.startsWith('how many') || t.startsWith('who ') || t.startsWith('list ') || t.startsWith('show me'))
    && includesAny(t, ['corpus', 'author', 'authors', 'kept', 'in the library', 'do we have'])) {
    return false;
  }

  if ((t.includes('get into') || t.includes('get a feel') || t.includes('get around to') || t.includes('started thinking'))
    && !includesAny(t, ['find ', 'add ', 'ingest', 'download', 'fetch'])) {
    return false;
  }

  try {
    if (require('./eiSeedSnowball').looksLikeSeedSnowball(message)) return true;
  } catch (_) { /* optional */ }

  // Campaign control telemetry still counts as work-like for looksLikeWorkOrder.
  if (parseCampaignControlAction(message)) return true;
  if (includesAny(t, ['keep researching', 'keep ingesting', 'keep seeking', 'keep gathering'])) {
    return true;
  }

  const workVerb = includesAny(t, [
    'find ', 'add ', 'download', 'seek ', 'locate', 'search for',
    'ingest', 'harvest', 'research ', 'fetch', 'pull ', 'expand',
    'look into',
  ]) || t.includes('get me') || t.includes('get us') || t.startsWith('research ');

  if (!workVerb) return false;

  return includesAny(t, [
    'corpus', 'pdf', 'book', 'article', 'paper', 'volume', 'account',
    'survey', 'material', 'source', 'text', 'report', 'writing',
    'bibliography', 'citation', 'snowball', 'iterate', 'theories',
  ])
    || t.includes(' by ')
    || t.includes('authored by')
    || t.includes('written by')
    || hasHttpUrl(t)
    || t.includes("'s ");
}

function isSoftMusing(message) {
  const t = norm(message);
  if (!t) return false;
  if (looksLikeWorkOrder(message)) return false;
  if (isOpinionQuestion(message) || isCampaignStatusQuestion(message)) return false;
  if (includesAny(t, ['find ', 'add ', 'ingest', 'harvest', 'download', 'fetch'])) return false;
  return includesAny(t, [
    'sometime', 'one day', 'someday', 'get into', 'get a feel',
    'thinking about', 'been wondering', 'i\'d like to get a feel',
    'might ', 'maybe ',
  ]);
}

function parseCampaignControlAction(message) {
  const t = norm(message);
  if (!t) return null;

  // Self-correction: later status ask wins over an earlier control verb.
  if (includesAny(t, ['actually no', 'ignore that', 'hang on', 'wait,'])) {
    if (includesAny(t, ['update', 'status', 'going', 'how\'s', 'how is'])) return null;
  }

  const mentionsCampaign = t.includes('campaign');
  if ((hasWord(t, 'pause') || hasWord(t, 'halt')) && mentionsCampaign) return 'pause';
  if (hasWord(t, 'resume') && mentionsCampaign) return 'resume';
  if (hasWord(t, 'stop') && mentionsCampaign) return 'stop';
  if (hasWord(t, 'start') && mentionsCampaign) return 'start';
  if (hasWord(t, 'run') && (hasWord(t, 'cycle') || hasWord(t, 'now'))) return 'run_now';
  if (t.includes('run the campaign') || t.includes('run campaign')) return 'run_now';
  return null;
}

function floorsFromUnderstanding(understanding) {
  if (!understanding || understanding.failed) {
    return {
      status: false,
      opinion: false,
      musing: false,
      work: false,
      control: null,
      source: 'understand_failed',
    };
  }
  const intent = understanding.intent;
  return {
    status: intent === 'status_question',
    opinion: intent === 'opinion_question',
    musing: intent === 'musing',
    work: intent === 'work_order',
    control: intent === 'campaign_control' && understanding.control
      ? understanding.control.action
      : null,
    source: 'understand',
  };
}

function floorsFromPhrases(message) {
  return {
    status: isCampaignStatusQuestion(message),
    opinion: isOpinionQuestion(message),
    musing: isSoftMusing(message),
    work: looksLikeWorkOrder(message),
    control: parseCampaignControlAction(message),
    source: 'phrases',
  };
}

module.exports = {
  isCampaignStatusQuestion,
  isOpinionQuestion,
  isSoftMusing,
  looksLikeWorkOrder,
  parseCampaignControlAction,
  floorsFromUnderstanding,
  floorsFromPhrases,
};
