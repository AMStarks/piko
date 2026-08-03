/**
 * Instant chat template detection — exact phrase allowlist (not routing intent regex).
 * Kept outside actionRouter/intentTriage/policyGate so those files stay regex-free.
 */

function stripOuterPunct(text) {
  let s = String(text || '').trim().toLowerCase();
  while (s.length && '!?.,'.includes(s[0])) s = s.slice(1).trim();
  while (s.length && '!?.,'.includes(s[s.length - 1])) s = s.slice(0, -1).trim();
  return s;
}

const INSTANT_PHRASES = new Set([
  'hi', 'hey', 'hello', 'howdy', 'yo', 'hiya', 'greetings', 'morning', 'evening', "g'day", 'gday',
  'hi piko', 'hey piko', 'hello piko', "g'day piko", 'gday piko',
  'thanks', 'thank you', 'cheers', 'ta', 'nice one', 'no worries', 'all good', 'sounds good',
  'see ya', 'later', 'bye', 'catch you', 'talk soon', 'good night',
  'how are you', 'how are you going', "how's it going", 'hows it going', "how's things", 'hows things',
  'you good',
]);

function isInstantChatMessage(message) {
  const normalized = stripOuterPunct(message);
  if (!normalized) return false;
  if (INSTANT_PHRASES.has(normalized)) return true;
  const tokens = [];
  let cur = '';
  for (const ch of normalized) {
    if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) tokens.push(cur);
  if (tokens.length <= 3 && tokens[0] && ['hi', 'hey', 'hello', "g'day", 'gday', 'morning', 'evening', 'thanks'].includes(tokens[0])) {
    return true;
  }
  return false;
}

module.exports = { isInstantChatMessage, stripOuterPunct };
