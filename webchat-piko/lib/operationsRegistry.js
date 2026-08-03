/**
 * Background job registry — maps catalog names to runtime control hooks.
 */
const { DEFAULTS } = require('./configManager');

const JOBS = [
  {
    id: 'intent-poller',
    name: 'intent-poller',
    aliases: ['intent poller', 'intent-poller', 'intent poller cron'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: 'fires due intents (reminders, scheduled, queue)',
  },
  {
    id: 'proactive-cycle',
    name: 'proactive-cycle',
    aliases: ['proactive cycle', 'proactive engine', 'business health engine', 'proactive alerts'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: 'proactive anomaly detection cycle',
  },
  {
    id: 'nightly-quant',
    name: 'nightly-quant',
    aliases: ['nightly quant', 'nightly forecasts', 'quant agent', 'nightly quant forecasts'],
    source: 'node-cron',
    toggleType: 'config',
    configKey: 'nightlyQuantEnabled',
    purpose: '1 AM statistical forecasts',
  },
  {
    id: 'nightly-wisdom',
    name: 'nightly-wisdom',
    aliases: ['nightly wisdom', 'wisdom cron'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: '2 AM wisdom synthesis',
  },
  {
    id: 'belief-consolidation',
    name: 'belief-consolidation',
    aliases: ['belief consolidation', 'belief loop'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: '3 AM belief consolidation',
  },
  {
    id: 'memory-consolidation',
    name: 'memory-consolidation',
    aliases: ['memory consolidation', 'soul consolidation', 'daily memory consolidate'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: 'Sunday 3 AM SOUL consolidation',
  },
  {
    id: 'weekly-retro',
    name: 'weekly-retro',
    aliases: ['weekly retro', 'weekly retrospective', 'weekly review'],
    source: 'node-cron',
    toggleType: 'override',
    purpose: 'Sunday 8 AM weekly retro',
  },
  {
    id: 'daily-memory-summarize',
    name: 'daily-memory-summarize',
    aliases: ['daily memory', 'memory summarize', 'daily memory summarize'],
    source: 'external',
    toggleType: 'override',
    script: 'scripts/daily-memory-summarize.js',
    purpose: 'midnight memory summarisation',
  },
  {
    id: 'rabbit-hole-daily',
    name: 'rabbit-hole-daily',
    aliases: ['rabbit hole', 'rabbit-hole', 'rabbit hole daily'],
    source: 'external',
    toggleType: 'override',
    script: 'scripts/rabbit-hole-daily.js',
    purpose: '11pm learning exploration',
  },
  {
    id: 'meta-reflection-weekly',
    name: 'meta-reflection-weekly',
    aliases: ['meta reflection', 'meta-reflection', 'weekly meta reflection'],
    source: 'external',
    toggleType: 'override',
    script: 'scripts/meta-reflection-weekly.js',
    purpose: 'Sunday 10am meta reflection',
  },
  {
    id: 'ea-lookin',
    name: 'ea-lookin',
    aliases: ['ea lookin', 'ea look-in', 'ea look in', 'calendar check', 'gmail check'],
    source: 'external',
    toggleType: 'override',
    script: 'scripts/ea-lookin.js',
    purpose: 'calendar/Gmail alerts',
  },
  {
    id: 'ollama-keep-warm',
    name: 'ollama-keep-warm',
    aliases: ['keep warm', 'ollama keep warm', 'keep-warm'],
    source: 'deprecated',
    toggleType: 'none',
    purpose: 'deprecated — OLLAMA_KEEP_ALIVE=-1 handles VRAM',
  },
];

const {
  collapseWhitespace,
} = require('./text');

function normalizeJobQuery(text) {
  let out = '';
  for (const ch of String(text || '').toLowerCase()) {
    if (ch === '.' || ch === '_' || ch === '-') out += ' ';
    else out += ch;
  }
  return collapseWhitespace(out);
}

function findJobByMessage(message) {
  const t = normalizeJobQuery(message);
  if (!t) return null;
  for (const job of JOBS) {
    if (job.toggleType === 'none') continue;
    const names = [job.id, job.name, ...(job.aliases || [])].map(normalizeJobQuery);
    for (const name of names) {
      if (name.length >= 4 && t.includes(name)) return job;
    }
  }
  return null;
}

function listControllableJobs() {
  return JOBS.filter((j) => j.toggleType !== 'none');
}

function isJobControllable(jobId) {
  return listControllableJobs().some((j) => j.id === jobId);
}

module.exports = {
  JOBS,
  findJobByMessage,
  listControllableJobs,
  isJobControllable,
  DEFAULTS,
};
