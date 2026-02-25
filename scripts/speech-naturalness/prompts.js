/**
 * Seed prompts for naturalness harness: greetings, small talk, edge cases.
 * Mix order each run so we don't always hit the same sequence.
 */

const GREETINGS = [
  'Hey',
  'Hey hey',
  'Hi',
  'Hello',
  'Morning',
  'What\'s up?',
  'How are you?',
  'How\'s it going?',
  'Yo',
  'Checking in',
  'Hey — you there?',
  'Hi Piko',
  'Hello again',
];

const SMALL_TALK = [
  'Not much',
  'Just coding',
  'Tired today',
  'Been a long week',
  'Nothing special',
  'Same old',
  'You?',
  'What have you been up to?',
  'Any ideas?',
  'Just thinking',
  'Cool',
  'Yeah',
  'Nice',
  'Fair enough',
  'Makes sense',
];

const FOLLOW_UPS = [
  'Tell me more',
  'Why do you think that?',
  'And then?',
  'What would you do?',
  'Yeah but what about the edge case?',
  'So in practice?',
  'Anything else?',
];

const TRIGGERS = [
  'What can you do?',
  'Introduce yourself',
  'Who are you?',
  'What are you?',
  'Are you an AI?',
  'How does this work?',
  'What\'s your name again?',
  'Can you help me?',
  'What do you think about that?',
  'Give me a summary',
];

const MIXED = [
  'Hey. What can you do?',
  'Hi — just checking in, been busy',
  'Morning. Any thoughts on the project?',
  'Yo. Tired. You?',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a list of prompts for a run. Repeats and shuffles to fill target count.
 */
function buildPrompts(targetCount) {
  const pool = [...GREETINGS, ...SMALL_TALK, ...FOLLOW_UPS, ...TRIGGERS, ...MIXED];
  const out = [];
  while (out.length < targetCount) {
    out.push(...shuffle(pool));
  }
  return out.slice(0, targetCount);
}

module.exports = {
  GREETINGS,
  SMALL_TALK,
  FOLLOW_UPS,
  TRIGGERS,
  MIXED,
  buildPrompts,
};
