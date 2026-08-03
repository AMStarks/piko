/**
 * Charter-aligned text patterns for LASKO moderation fast-path.
 * WP8.7: normalized phrase / token matching — no regex.
 * High-precision rules only — ambiguous cases go to 8B.
 */
const { collapseWhitespace, toLowerAsciiish, includesAny, extractDigitRuns } = require('./text');

const HARD_PHRASES = [
  { category: 'illegal', phrases: ['child porn', 'childporn', 'child sexual', 'child abuse', 'child exploitation'] },
  { category: 'illegal', phrases: ['csam', 'cp links', 'cp link'] },
  { category: 'violence', phrases: [
    'kill you', 'kill u', 'kill him', 'kill her', 'kill them',
    'murder you', 'murder him', 'murder her', 'murder them',
    'shoot you', 'stab you', 'kill everyone', 'murder everyone',
  ] },
  { category: 'violence', phrases: ['i will kill', "i'll kill", 'gonna kill', 'going to kill', 'gonna murder', 'going to murder', 'gonna shoot', 'going to shoot', 'gonna stab', 'going to stab'] },
  { category: 'violence', phrases: ['death to '] },
  { category: 'self_harm', phrases: ['kill myself', 'hurt myself', 'how to suicide', 'how to commit suicide', 'end my life', 'end your life', 'cut myself', 'cut yourself'] },
  { category: 'malware', phrases: ['botnet', 'ransomware', 'keylogger', 'exploit code', 'stealer malware'] },
  { category: 'pii', phrases: ['ssn number', 'ssn #', 'ssn no', 'social security number', 'social security #'] },
];

const SOFT_PHRASES = [
  { category: 'spam', phrases: ['buy now', 'limited offer', 'click here', 'act now'] },
  { category: 'spam', phrases: ['win money', 'free crypto', 'guaranteed return', 'guaranteed returns', 'double your'] },
  { category: 'spam', phrases: ['airdrop', 'whitelist spot', 'send 1 btc', 'send 1 eth', 'send 1 usdt'] },
  { category: 'malware', phrases: ['bit.ly/', 'tinyurl.com/', 't.co/'] },
  { category: 'sexual', phrases: ['porn', 'xxx', 'onlyfans link', 'explicit porn'] },
];

function hasEmail(text) {
  const t = String(text || '');
  const at = t.indexOf('@');
  if (at <= 0 || at >= t.length - 3) return false;
  const dot = t.indexOf('.', at);
  return dot > at + 1 && dot < t.length - 1;
}

function hasPhoneLike(text) {
  const runs = extractDigitRuns(text);
  // Rough: a digit run of 7+ or multiple runs totaling 10+
  let total = 0;
  for (const r of runs) {
    if (r.text.length >= 7) return true;
    total += r.text.length;
  }
  return total >= 10 && runs.length >= 2;
}

function hasCreditCardCue(text) {
  const t = toLowerAsciiish(text);
  if (!t.includes('credit card')) return false;
  if (!(t.includes('number') || t.includes('#') || t.includes('no'))) return false;
  return extractDigitRuns(text).some((r) => r.text.length >= 4);
}

function hasDoxPhrase(text) {
  const t = toLowerAsciiish(collapseWhitespace(text));
  return includesAny(t, [
    'his number is', 'her number is', 'their number is',
    'his phone is', 'her phone is', 'their phone is',
    'his email is', 'her email is', 'their email is',
    'his address is', 'her address is', 'their address is',
  ]);
}

function matchPhraseGroups(sampleNorm, groups, severity) {
  const hits = [];
  for (const { category, phrases } of groups) {
    for (const p of phrases) {
      if (sampleNorm.includes(p)) {
        hits.push({ category, rule: p, severity });
        break;
      }
    }
  }
  return hits;
}

function evaluatePatterns(text) {
  const sample = String(text || '');
  const sampleNorm = toLowerAsciiish(collapseWhitespace(sample));
  const hits = [];

  hits.push(...matchPhraseGroups(sampleNorm, HARD_PHRASES, 'hard'));
  if (hasCreditCardCue(sample)) {
    hits.push({ category: 'pii', rule: 'credit card digits', severity: 'hard' });
  }

  hits.push(...matchPhraseGroups(sampleNorm, SOFT_PHRASES, 'soft'));
  if (hasEmail(sample) || hasPhoneLike(sample)) {
    hits.push({ category: 'pii', rule: 'email/phone', severity: 'soft' });
  }
  if (hasDoxPhrase(sample) && (hasEmail(sample) || hasPhoneLike(sample))) {
    hits.push({ category: 'pii', rule: 'dox phrase + contact', severity: 'soft' });
  }

  if (hits.some((h) => h.severity === 'hard')) {
    return { action: 'hard_block', hits };
  }
  if (hits.length > 0) {
    return { action: 'soft_block', hits };
  }
  return { action: 'allow', hits: [] };
}

// Back-compat export shapes (tests may inspect lengths)
const HARD_PATTERNS = HARD_PHRASES;
const SOFT_PATTERNS = SOFT_PHRASES;

module.exports = { evaluatePatterns, HARD_PATTERNS, SOFT_PATTERNS };
