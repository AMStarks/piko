/**
 * Knowledge Base: reference material for Legion, Aus Maker, forecasting, and POs.
 * Injected into the prompt when the user's message relates to business/operational context.
 */
const path = require('path');
const fs = require('fs');
const { toLowerAsciiish, includesAny, isAsciiLetter, isAsciiDigit } = require('./text');

const KNOWLEDGE_BASE_DIR = process.env.PIKO_KNOWLEDGE_BASE_DIR || path.join(__dirname, '..', 'data', 'knowledge-base');
const MAX_CHARS = Math.min(6000, Math.max(1000, parseInt(process.env.PIKO_KNOWLEDGE_BASE_MAX_CHARS, 10) || 4000));

/** Phrases that indicate business/operational context. */
const RELEVANT_PHRASES = [
  'aus maker',
  'ausmaker',
  'purchase order',
  'low stock',
  'safety stock',
  'moving average',
  'exponential smoothing',
];

const RELEVANT_WORDS = [
  'legion',
  'forecast',
  'forecasting',
  'po',
  'inventory',
  'supply',
  'mape',
  'mad',
  'rmse',
  'arima',
  'seasonal',
  'seasonality',
  'ordering',
  'recommend',
  'recommended',
  'recommendation',
  'unit',
  'units',
  'cin7',
  'shopify',
];

/** Pad with spaces and replace non-alnum with spaces for whole-token matching. */
function paddedTokens(s) {
  const str = toLowerAsciiish(s);
  let out = ' ';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    out += (isAsciiLetter(ch) || isAsciiDigit(ch)) ? ch : ' ';
  }
  return `${out} `;
}

function messageRelatesToKnowledgeBase(message) {
  if (!message || typeof message !== 'string') return false;
  const text = String(message).trim();
  if (text.length < 3) return false;
  const lower = toLowerAsciiish(text);
  if (includesAny(lower, RELEVANT_PHRASES)) return true;
  const padded = paddedTokens(lower);
  for (const w of RELEVANT_WORDS) {
    if (padded.includes(` ${w} `)) return true;
  }
  return false;
}

function loadKnowledgeBase() {
  const files = ['statistical_forecasting_ausmaker.md'];
  let content = '';
  for (const name of files) {
    try {
      const raw = fs.readFileSync(path.join(KNOWLEDGE_BASE_DIR, name), 'utf8');
      content += (content ? '\n\n---\n\n' : '') + raw.trim();
    } catch (_) {}
  }
  if (content.length > MAX_CHARS) content = content.slice(0, MAX_CHARS) + '\n\n[...truncated]';
  return content;
}

/**
 * Returns the knowledge base block for the prompt, or '' if the message doesn't relate.
 */
function getKnowledgeBaseBlockForPrompt(message) {
  if (!messageRelatesToKnowledgeBase(message)) return '';
  const content = loadKnowledgeBase();
  if (!content.trim()) return '';
  return (
    `**Knowledge Base (Aus Maker / Legion / forecasting reference)**\n` +
    `Use this when answering questions about Legion recommendations, Purchase Orders, Aus Maker supply data, or forecasting. Never cite it directly—reply in your own voice.\n\n` +
    `${content}\n\n`
  );
}

module.exports = {
  getKnowledgeBaseBlockForPrompt,
  loadKnowledgeBase,
  messageRelatesToKnowledgeBase,
  KNOWLEDGE_BASE_DIR,
};
