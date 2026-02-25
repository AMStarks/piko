/**
 * Corpus loader: fixed bedrock of inalienable truths. Option C: summary generated only when corpus is saved.
 * At chat time we only read cached summary or core_truths + snippets; no AI call.
 */
const path = require('path');
const fs = require('fs');
const { ai } = require('./llm');

const CORPUS_DIR = process.env.PIKO_CORPUS_DIR || path.join(__dirname, '..', 'data', 'corpus');
const INDEX_FILE = path.join(CORPUS_DIR, 'corpus_index.json');
const DOCS = ['01_worldview.md', '02_loyalty.md', '03_reality.md', '04_life_nav.md'];
const MAX_SNIPPET_CHARS = 400;
const SUMMARY_MAX_TOKENS = 500;

function readIndex() {
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { documents: DOCS.length, core_truths: [], wisdom_hierarchy: {}, summary: null, last_summarized: null };
  }
}

function writeIndex(index) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function readDoc(name) {
  try {
    return fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

/**
 * Load full corpus from disk (all docs + index). No AI.
 */
function loadCorpus() {
  const index = readIndex();
  const docs = {};
  for (const name of DOCS) {
    docs[name] = readDoc(name);
  }
  return { index, docs };
}

/**
 * Build the corpus block to prepend to the system prompt. Injects primaryHuman into 02_loyalty content.
 * Uses cached summary from index if present (Option C); otherwise uses core_truths + short doc snippets.
 * No AI call.
 */
function getCorpusBlockForPrompt(primaryHuman = '') {
  const { index, docs } = loadCorpus();
  const truths = index.core_truths || [];
  const name = (primaryHuman || 'the primary human').trim() || 'the primary human';

  if (index.summary && index.last_summarized) {
    const summaryWithName = index.summary.replace(/\[INJECTED[^\]]*\]/g, name).replace(/primary human/g, name);
    return (
      `**Fixed corpus (bedrock — inalienable truth)**\n${summaryWithName}\n\n` +
      `**Honesty protocol:** Never say "From corpus" or cite the corpus—reply in your own voice. When the user corrects you, acknowledge with "You corrected me…" or similar. Prefer "I'm not sure" or "You told me X" when that's the case.\n\n`
    );
  }

  const lines = truths.map((t) => `- ${t}`);
  const snippet = [];
  for (const docName of DOCS) {
    let content = docs[docName] || '';
    content = content.replace(/\[INJECTED[^\]]*\]/g, name);
    if (content.length > MAX_SNIPPET_CHARS) content = content.slice(0, MAX_SNIPPET_CHARS) + '…';
    if (content.trim()) snippet.push(content);
  }
  const block =
    `**Fixed corpus (bedrock — inalienable truth)**\n${lines.join('\n')}\n\n` +
    (snippet.length ? snippet.join('\n\n') + '\n\n' : '') +
    `**Honesty protocol:** Never say "From corpus" or cite the corpus—reply in your own voice. When the user corrects you, acknowledge with "You corrected me…" or similar. Prefer "I'm not sure" or "You told me X" when that's the case.\n\n`;
  return block;
}

/**
 * Regenerate the corpus summary (Option C): run once when corpus is saved. Calls AI once, writes to index.
 * Corpus stays static between edits; this gives Piko a stable foundation.
 */
async function regenerateSummary() {
  const { index, docs } = loadCorpus();
  const fullText = DOCS.map((name) => `## ${name}\n${docs[name] || ''}`).join('\n\n');
  if (!fullText.trim()) {
    writeIndex({ ...index, summary: null, last_summarized: null });
    return { ok: true, summary: null };
  }
  const prompt = `Summarize the following corpus of inalienable truths and rules into a single block of about 300–400 words. Preserve: loyalty to the primary human, truth-seeking, epistemology (provenance, corrections), and practical wisdom. Output only the summary, no preamble. Use "the primary human" as the placeholder for the person (it will be replaced at runtime).\n\n---\n${fullText.slice(0, 8000)}`;
  try {
    const summary = (await ai(prompt, { max_tokens: SUMMARY_MAX_TOKENS, temperature: 0.3 })).trim();
    const next = {
      ...index,
      summary,
      last_summarized: new Date().toISOString().slice(0, 10),
    };
    writeIndex(next);
    return { ok: true, summary };
  } catch (e) {
    if (process.env.LITELLM_LOG) console.error('[corpus] regenerateSummary error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  loadCorpus,
  getCorpusBlockForPrompt,
  regenerateSummary,
  CORPUS_DIR,
  DOCS,
  readIndex,
  writeIndex,
  readDoc,
};
