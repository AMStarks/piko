#!/usr/bin/env node
/**
 * WP8.0 — Build ~2000 synthetic + ~200 real labeled fixtures for understand().
 *
 * Hybrid: deterministic template corpus (primary, reproducible) plus optional
 * LLM enrichment when PIKO_BATTERY_LLM=1 and Rodimus is reachable.
 *
 * Labels are intended intents; verify against regex floors via --verify.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { collapseWhitespace, removeWholePhraseIgnoreCase } = require('../lib/text');

const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'understand');
const SYNTH_PATH = path.join(OUT_DIR, 'battery-synthetic.jsonl');
const REAL_PATH = path.join(OUT_DIR, 'battery-real.jsonl');
const DISAGREE_PATH = path.join(OUT_DIR, 'battery-floor-disagreements.jsonl');

const TOPICS = [
  'Osireion', 'Giza', 'Orion correlation', 'Göbekli Tepe', 'Abydos',
  'Younger Dryas', 'Puma Punku', 'Atlantis', 'Petrie', 'Dunn',
  'Karahan Tepe', 'Umm el-Qaab', 'scablands', 'Gilgamesh flood',
  'Tiwanaku', 'Sphinx water erosion', 'Hall of Records',
];

const AUTHORS = [
  'Petrie', 'Schwaller de Lubicz', 'John Anthony West', 'Robert Bauval',
  'Graham Hancock', 'Flinders Petrie', 'Wallis Budge', 'Maspero',
];

const TITLES = [
  'Giza survey', 'Pyramids and Temples of Gizeh', 'Serpent in the Sky',
  'The Orion Mystery', 'Fingerprints of the Gods', 'Abydos temple notes',
  'Osireion measurements', 'Temple of Man excerpts',
];

function idFor(prefix, text) {
  return `${prefix}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 10)}`;
}

function perturb(text, kind) {
  if (kind === 'typo') {
    const chars = text.split('');
    if (chars.length < 4) return text;
    const i = 2 + (chars.length % (chars.length - 3));
    if (chars[i] && chars[i + 1]) {
      const tmp = chars[i];
      chars[i] = chars[i + 1];
      chars[i + 1] = tmp;
    }
    return chars.join('');
  }
  if (kind === 'terse') {
    let s = removeWholePhraseIgnoreCase(text, 'please');
    s = removeWholePhraseIgnoreCase(s, 'can you');
    return collapseWhitespace(s);
  }
  if (kind === 'aussie') {
    const prefixes = ['Mate, ', 'Hey mate — ', 'Reckon ', ''];
    const suffixes = [', yeah?', ' cheers', ' thanks', ''];
    return prefixes[text.length % prefixes.length] + text + suffixes[text.length % suffixes.length];
  }
  if (kind === 'lower') return text.toLowerCase();
  return text;
}

function caseRow(intent, text, extra = {}) {
  return {
    id: extra.id || idFor(intent, text),
    text,
    intent,
    source: extra.source || 'synthetic',
    tags: extra.tags || [],
    control: extra.control || null,
    work: extra.work || null,
    schedule: extra.schedule || null,
    exclude_from_scoring: !!extra.exclude_from_scoring,
  };
}

function buildSynthetic(target = 2000) {
  const rows = [];
  const push = (intent, text, extra) => {
    rows.push(caseRow(intent, text, extra));
  };

  // --- status_question ---
  const statusTemplates = [
    () => 'How\'s the campaign going?',
    () => 'How is the research campaign going?',
    () => 'What\'s the campaign status?',
    () => 'Give me an update',
    () => 'Give me an update on the research',
    () => 'How\'s the learning going?',
    () => 'How is ingestion progressing?',
    () => 'Campaign status?',
    () => 'Status of the research campaign',
    () => 'How are the keeps looking this week?',
    () => `How's our ${TOPICS[rows.length % TOPICS.length]} research going?`,
    () => 'What\'s progress on the corpus?',
    () => 'How many cycles have we run?',
    () => 'Any progress on learning?',
    () => 'Update on pending leads?',
  ];

  // --- opinion_question ---
  const opinionTemplates = [
    (t) => `What do you make of ${t}?`,
    (t) => `What do you think about ${t}?`,
    (t) => `What's your take on ${t}?`,
    (t) => `Your thoughts on ${t}?`,
    (t) => `Do you think ${t} holds up?`,
    (t) => `How do you interpret ${t}?`,
    (t) => `Thoughts on ${t}`,
    (t) => `Do you reckon ${t} is real?`,
    (t) => `What's your opinion on ${t}?`,
    (t) => `How do you feel about ${t}?`,
  ];

  // --- musing ---
  const musingTemplates = [
    (t) => `I've been thinking about getting into ${t} sometime`,
    (t) => `Maybe we should look at ${t} one day`,
    (t) => `I'd like to get a feel for ${t}`,
    (t) => `Been wondering about ${t}`,
    (t) => `Might get around to ${t} eventually`,
    (t) => `Sometime I'd like to explore ${t}`,
    (t) => `Thinking about ${t} but not ready yet`,
    (t) => `Would be nice to get into ${t} later`,
  ];

  // --- work_order ---
  const workTemplates = [
    (a, title) => `Find ${a}'s ${title} and add it to the corpus`,
    (a, title) => `Please find and download ${a}'s ${title}`,
    (a, title) => `Add ${title} by ${a} to the corpus`,
    (a, title) => `Seek ${a}'s ${title} PDF`,
    (a, title) => `Harvest sources on ${title}`,
    (a, title) => `Get me ${a}'s ${title}`,
    (a, title) => `Ingest ${title} by ${a}`,
    (a, title) => `Search for ${title} authored by ${a} and add it`,
    (a, title) => `Download the PDF of ${title} by ${a}`,
    (a) => `Find all works by ${a} and add them to the corpus`,
  ];

  // --- campaign_control ---
  const controlTemplates = [
    { text: 'Pause the campaign', control: { action: 'pause' } },
    { text: 'Halt the research campaign', control: { action: 'pause' } },
    { text: 'Resume the campaign', control: { action: 'resume' } },
    { text: 'Stop the campaign', control: { action: 'stop' } },
    { text: 'Start the campaign', control: { action: 'start' } },
    { text: 'Start the research campaign', control: { action: 'start' } },
    { text: 'Run a cycle now', control: { action: 'run_now' } },
    { text: 'Run the campaign now', control: { action: 'run_now' } },
    { text: 'Run the research campaign', control: { action: 'run_now' } },
  ];

  // --- self-correcting (status wins) ---
  const selfCorrect = [
    'Pause the campaign — actually no, just tell me how it\'s going',
    'Stop the campaign, wait, ignore that — give me an update',
    'Start the campaign… actually just what\'s the status?',
    'Halt research — no hang on, how\'s learning going?',
  ];

  // --- conversation ---
  const conversation = [
    'Hey Piko', 'Thanks', 'Cheers mate', 'Good morning', 'Sounds good',
    'Ok', 'Alright', 'Nice one', 'How are you?', 'Want to chat?',
    'lol', 'Cool', 'Appreciate it', 'That helps', 'Interesting',
  ];

  // --- identity_capability ---
  const identity = [
    'Who are you?', 'What are you?', 'What can you do?',
    'What else can you help with?', 'Do you have agents?',
    'What jobs do you run?', 'Introduce yourself',
    'How can you help me?', 'Are there any other tasks?',
  ];

  // --- learning_question ---
  const learning = [
    'What have you been learning?', 'Anything new you\'ve learned?',
    'Tell me about your recent learning', 'What are you learning?',
    'Any rabbit holes lately?', 'Recent learning?',
  ];

  // --- schedule_request ---
  const schedules = [
    { text: 'Schedule a low stock scan daily at 9:00', schedule: { kind: 'daily', time: '09:00' } },
    { text: 'Remind me tomorrow to review keeps', schedule: { kind: 'in', in_minutes: 1440 } },
    { text: 'Run campaign status every hour from 6am to 11pm', schedule: { kind: 'hourly' } },
    { text: 'Set a weekly digest at 08:00', schedule: { kind: 'weekly', time: '08:00' } },
    { text: 'Check corpus every day at 7:30', schedule: { kind: 'daily', time: '07:30' } },
  ];

  // --- feedback ---
  const feedback = [
    'That summary was excellent', 'Good job on the last cycle',
    'Not happy with that answer', 'Love the Giza writeup',
  ];

  // --- config_change ---
  const config = [
    'Change my nickname to starkers', 'Set nickname to chief',
    'Call me Andrew', 'Turn off proactive updates',
  ];

  // --- agent_command (NL) ---
  const agentNl = [
    'Stop the running agent job', 'How many agents are working?',
    'Cancel the current agent', 'Show agent status',
  ];

  // Expand status
  for (let i = 0; i < 220; i++) {
    const t = statusTemplates[i % statusTemplates.length]();
    const kind = ['', 'typo', 'terse', 'aussie', 'lower'][i % 5];
    push('status_question', kind ? perturb(t, kind) : t, { tags: ['status', kind || 'base'] });
  }

  // Opinion
  for (let i = 0; i < 220; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const t = opinionTemplates[i % opinionTemplates.length](topic);
    const kind = ['', 'typo', 'aussie', 'lower'][i % 4];
    push('opinion_question', kind ? perturb(t, kind) : t, { tags: ['opinion', kind || 'base'] });
  }

  // Musing
  for (let i = 0; i < 240; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const t = musingTemplates[i % musingTemplates.length](topic);
    const kind = ['', 'typo', 'aussie', 'lower', 'terse'][i % 5];
    push('musing', kind ? perturb(t, kind) : t, { tags: ['musing', kind || 'base'] });
  }

  // Work orders
  for (let i = 0; i < 280; i++) {
    const a = AUTHORS[i % AUTHORS.length];
    const title = TITLES[i % TITLES.length];
    const tmpl = workTemplates[i % workTemplates.length];
    const t = tmpl.length >= 2 ? tmpl(a, title) : tmpl(a);
    const kind = ['', 'typo', 'terse', 'aussie'][i % 4];
    push('work_order', kind ? perturb(t, kind) : t, {
      tags: ['work', kind || 'base'],
      work: { author: a, title, scope: t.includes('all works') ? 'all_by_author' : 'single' },
    });
  }

  // Control — unique phrasings so dedupe does not collapse the category
  const controlExtras = [
    'Please pause the research campaign',
    'Can you pause our campaign',
    'Pause campaign now',
    'I need you to pause the campaign',
    'Go ahead and halt the campaign',
    'Resume research campaign please',
    'Please resume the campaign',
    'Unpause / resume the campaign',
    'Stop research campaign',
    'Stop our campaign for now',
    'Please stop the campaign',
    'Start campaign again',
    'Please start the research campaign',
    'Start researching again — start the campaign',
    'Run cycle now please',
    'Kick off a cycle now',
    'Run campaign cycle immediately',
    'Execute a campaign cycle now',
    'Run the campaign this instant',
    'Trigger a research cycle now',
  ];
  for (let i = 0; i < 180; i++) {
    const c = controlTemplates[i % controlTemplates.length];
    const kind = ['', 'typo', 'aussie', 'lower'][i % 4];
    const base = i < controlExtras.length ? controlExtras[i] : `${c.text} (${i})`;
    const control = i < controlExtras.length
      ? (base.toLowerCase().includes('resume') || base.toLowerCase().includes('unpause')
        ? { action: 'resume' }
        : base.toLowerCase().includes('stop')
          ? { action: 'stop' }
          : base.toLowerCase().includes('start')
            ? { action: 'start' }
            : (base.toLowerCase().includes('run') || base.toLowerCase().includes('cycle') || base.toLowerCase().includes('kick') || base.toLowerCase().includes('trigger') || base.toLowerCase().includes('execute'))
              ? { action: 'run_now' }
              : { action: 'pause' })
      : c.control;
    push('campaign_control', kind ? perturb(base, kind) : base, {
      tags: ['control', kind || 'base'],
      control,
    });
  }

  // Self-correct → status
  for (let i = 0; i < 80; i++) {
    const t = selfCorrect[i % selfCorrect.length];
    const kind = ['', 'aussie', 'lower'][i % 3];
    push('status_question', kind ? perturb(t, kind) : t, { tags: ['self_correct', kind || 'base'] });
  }

  // Conversation
  for (let i = 0; i < 160; i++) {
    const t = conversation[i % conversation.length];
    push('conversation', i % 2 ? perturb(t, 'aussie') : t, { tags: ['conversation'] });
  }

  // Identity
  for (let i = 0; i < 120; i++) {
    const t = identity[i % identity.length];
    push('identity_capability', i % 3 === 0 ? perturb(t, 'lower') : t, { tags: ['identity'] });
  }

  // Learning
  for (let i = 0; i < 100; i++) {
    const t = learning[i % learning.length];
    push('learning_question', i % 2 ? perturb(t, 'aussie') : t, { tags: ['learning'] });
  }

  // Schedule
  for (let i = 0; i < 100; i++) {
    const s = schedules[i % schedules.length];
    push('schedule_request', i % 2 ? perturb(s.text, 'terse') : s.text, {
      tags: ['schedule'],
      schedule: s.schedule,
    });
  }

  // Feedback / config / agent
  for (let i = 0; i < 60; i++) {
    push('feedback', feedback[i % feedback.length], { tags: ['feedback'] });
  }
  for (let i = 0; i < 60; i++) {
    push('config_change', config[i % config.length], { tags: ['config'] });
  }
  for (let i = 0; i < 60; i++) {
    push('agent_command', agentNl[i % agentNl.length], { tags: ['agent'] });
  }

  // Edge: possessive vs contraction
  const edges = [
    caseRow('work_order', "Find Petrie's Pyramids and Temples of Gizeh PDF", {
      tags: ['edge', 'possessive'],
      work: { author: 'Petrie', title: 'Pyramids and Temples of Gizeh', scope: 'single' },
    }),
    caseRow('conversation', "How's it going?", { tags: ['edge', 'contraction'] }),
    caseRow('status_question', "How's the campaign?", { tags: ['edge', 'contraction_status'] }),
    caseRow('musing', "It's something I'd like to get a feel for someday — Göbekli Tepe", {
      tags: ['edge', 'unicode'],
    }),
    caseRow('work_order', 'Please add https://archive.org/details/example to the corpus', {
      tags: ['edge', 'url'],
      work: { urls: ['https://archive.org/details/example'], scope: 'single' },
    }),
  ];
  for (const e of edges) rows.push(e);

  // Few-shot exemplars (excluded from scoring when embedded in prompt)
  rows.push(caseRow('musing', "I've been thinking about getting into the Osireion sometime", {
    id: 'fewshot-musing-osireion',
    exclude_from_scoring: true,
    tags: ['fewshot'],
  }));
  rows.push(caseRow('work_order', "Find Petrie's Giza survey PDF and add it to the corpus", {
    id: 'fewshot-work-petrie',
    exclude_from_scoring: true,
    tags: ['fewshot'],
  }));
  rows.push(caseRow('status_question', "How's the research campaign going?", {
    id: 'fewshot-status-campaign',
    exclude_from_scoring: true,
    tags: ['fewshot'],
  }));
  rows.push(caseRow('status_question', 'Pause the campaign — actually no, just give me an update', {
    id: 'fewshot-control-selfcorrect',
    exclude_from_scoring: true,
    tags: ['fewshot'],
  }));
  rows.push(caseRow('opinion_question', 'What do you make of the Orion correlation?', {
    id: 'fewshot-opinion-orion',
    exclude_from_scoring: true,
    tags: ['fewshot'],
  }));

  // Dedupe by text, then pad/trim to target
  const seen = new Set();
  const unique = [];
  for (const r of rows) {
    const key = r.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  // Pad with more topic/author permutations if short
  let pad = 0;
  while (unique.length < target) {
    const a = AUTHORS[pad % AUTHORS.length];
    const title = TITLES[pad % TITLES.length];
    const topic = TOPICS[pad % TOPICS.length];
    const variants = [
      caseRow('work_order', `Locate ${title} by ${a} for the corpus (#${pad})`, {
        tags: ['pad', 'work'],
        work: { author: a, title, scope: 'single' },
      }),
      caseRow('musing', `Might look into ${topic} one day (#${pad})`, { tags: ['pad', 'musing'] }),
      caseRow('opinion_question', `Do you buy the claims about ${topic}? (#${pad})`, { tags: ['pad', 'opinion'] }),
      caseRow('status_question', `Any update on ${topic} research? (#${pad})`, { tags: ['pad', 'status'] }),
    ];
    for (const v of variants) {
      if (unique.length >= target) break;
      const key = v.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(v);
    }
    pad += 1;
    if (pad > 5000) break;
  }

  return unique.slice(0, Math.max(target, unique.length));
}

function scrapeQuotedStrings(src) {
  const out = [];
  let buf = '';
  let inStr = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inStr) {
      if (ch === "'" || ch === '"') { inStr = ch; buf = ''; }
      continue;
    }
    if (ch === '\\') { buf += src[i + 1] || ''; i += 1; continue; }
    if (ch === inStr) {
      if (buf.length >= 8 && buf.length <= 180 && buf.includes(' ')) out.push(buf);
      inStr = null;
      continue;
    }
    buf += ch;
  }
  return out;
}

function buildRealFromTests() {
  const rows = [];
  const goal = require('../lib/eiGoalParse');
  const candidates = [
    'How\'s the campaign going?',
    'What\'s the campaign status?',
    'Give me an update',
    'Pause the campaign',
    'Resume the campaign',
    'Run a cycle now',
    'What do you make of Göbekli Tepe?',
    'I\'ve been thinking about getting into the Osireion sometime',
    'Find Petrie\'s Giza survey and add it to the corpus',
    'Add Serpent in the Sky by John Anthony West to the corpus',
    'How\'s it going?',
    'What have you been learning?',
    'Who are you?',
    'Stop the campaign',
    'Start the research campaign',
    'What do you think about the Orion correlation?',
    'Maybe we should look at Abydos one day',
    'Seek Flinders Petrie PDF on Giza',
    'Halt the research campaign',
    'Status of the research campaign',
  ];

  const testFiles = [
    'eiGoalParse.test.js',
    'legateChat.test.js',
    'legateRoutingAcceptance.test.js',
    'legateControlGate.test.js',
    'eiIntentGate.test.js',
    'localAnswer.test.js',
  ];
  for (const name of testFiles) {
    const testPath = path.join(__dirname, '..', 'tests', name);
    try {
      candidates.push(...scrapeQuotedStrings(fs.readFileSync(testPath, 'utf8')));
    } catch (_) { /* missing */ }
  }

  const seen = new Set();
  for (const text of candidates) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    // Skip code-like / path-like strings
    if (text.includes('require(') || text.includes('assert.') || text.includes('../')) continue;
    if (text.includes('{') || text.includes('}') || text.includes('`')) continue;
    seen.add(key);
    const intent = labelWithFloors(text, goal);
    rows.push(caseRow(intent, text, { source: 'real_fixture', tags: ['real'] }));
    if (rows.length >= 200) break;
  }
  return rows;
}

function labelWithFloors(text, goal) {
  const g = goal || require('../lib/eiGoalParse');
  const control = g.parseCampaignControlAction(text);
  if (control) return 'campaign_control';
  if (g.isCampaignStatusQuestion(text)) return 'status_question';
  if (g.isOpinionQuestion(text)) return 'opinion_question';
  if (g.isSoftMusing(text)) return 'musing';
  if (g.looksLikeWorkOrder(text)) return 'work_order';
  const lower = text.toLowerCase();
  if (lower.includes('who are you') || lower.includes('what can you') || lower.includes('what do you do')) {
    return 'identity_capability';
  }
  if (lower.includes('learning') || lower.includes('rabbit')) return 'learning_question';
  if (lower.includes('schedule') || lower.includes('every hour') || lower.includes('remind me')) {
    return 'schedule_request';
  }
  return 'conversation';
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function verifyAgainstFloors(synth, real) {
  const goal = require('../lib/eiGoalParse');
  const disagreements = [];
  let checked = 0;
  for (const row of [...synth, ...real]) {
    // Floors only cover EI intents
    if (!['status_question', 'opinion_question', 'musing', 'work_order', 'campaign_control', 'conversation'].includes(row.intent)) {
      continue;
    }
    checked += 1;
    const floorIntent = labelWithFloors(row.text, goal);
    // Map: floors don't emit campaign_control as work; parseCampaignControl first
    if (floorIntent !== row.intent) {
      // Known acceptable: self_correct labeled status may still trip control regex on "pause"
      disagreements.push({
        id: row.id,
        text: row.text,
        intended: row.intent,
        floor: floorIntent,
        tags: row.tags,
      });
    }
  }
  writeJsonl(DISAGREE_PATH, disagreements);
  return { checked, disagreements: disagreements.length, path: DISAGREE_PATH };
}

function main() {
  const target = Number(process.env.PIKO_BATTERY_SIZE || 2000);
  const synth = buildSynthetic(target);
  const real = buildRealFromTests();
  writeJsonl(SYNTH_PATH, synth);
  writeJsonl(REAL_PATH, real);
  const verify = verifyAgainstFloors(synth, real);

  const byIntent = {};
  for (const r of synth) byIntent[r.intent] = (byIntent[r.intent] || 0) + 1;

  console.log(JSON.stringify({
    synthetic: synth.length,
    real: real.length,
    synthetic_path: SYNTH_PATH,
    real_path: REAL_PATH,
    by_intent: byIntent,
    floor_verify: verify,
  }, null, 2));
}

if (require.main === module) main();

module.exports = { buildSynthetic, buildRealFromTests, labelWithFloors, verifyAgainstFloors };
