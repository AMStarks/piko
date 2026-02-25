/**
 * Phase 4.5: Impact tracker — record when user acts on Piko (e.g. advice followed, reminder created).
 * Feeds into getImpactBlockForPrompt() so the model can see recent impact. One clear signal at a time.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const IMPACT_FILE = path.join(DATA_DIR, 'impact.json');
const MAX_IMPACT_ENTRIES = 50;
const IMPACT_FOR_PROMPT_DAYS = 14;

function readJson(file, defaultValue) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getImpact() {
  const list = readJson(IMPACT_FILE, []);
  return Array.isArray(list) ? list : [];
}

function appendImpact(entry) {
  const list = getImpact();
  const at = new Date().toISOString();
  list.push({
    type: entry.type || 'advice_followed',
    at,
    source: entry.source || null,
  });
  const trimmed = list.length > MAX_IMPACT_ENTRIES ? list.slice(-MAX_IMPACT_ENTRIES) : list;
  writeJson(IMPACT_FILE, trimmed);
}

function getImpactBlockForPrompt() {
  const list = getImpact();
  if (!list.length) return '';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - IMPACT_FOR_PROMPT_DAYS);
  const cutoffIso = cutoff.toISOString();
  const recent = list.filter((e) => (e.at || '') >= cutoffIso).slice(-10);
  if (!recent.length) return '';
  const lines = recent.map((e) => `- ${e.type}${e.source ? ` (${e.source})` : ''} at ${(e.at || '').slice(0, 10)}`);
  return '\n\n**Recent impact (user acted on your suggestions):**\n' + lines.join('\n') + '\n\n';
}

module.exports = {
  getImpact,
  appendImpact,
  getImpactBlockForPrompt,
  IMPACT_FILE,
};
