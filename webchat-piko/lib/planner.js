/**
 * Response planner: turns memory user beliefs + mind (goals, tensions) into constraints for this turn.
 * Pure function, no LLM. See docs/RESPONSE_PLANNER_AND_CONTROL_SURFACES_RECOMMENDATION.md.
 */
const {
  toLowerAsciiish,
  normalizeApostrophes,
  includesAny,
  startsWithAny,
  endsWithAny,
  collapseWhitespace,
} = require('./text');

const DEPTH_CONFIDENCE_THRESHOLD = 0.7;
const DEPTH_KEYWORDS = ['depth', 'structure', 'structured', 'detail', 'in-depth', 'thorough'];
const GOAL_RELEVANT_KEYWORDS = ['plan', 'today', 'tomorrow', 'next', 'goal', 'priority', 'week'];

const GREETING_EXACT = [
  'hi', 'hey', 'hello', 'howdy', 'yo', 'sup', 'hiya', 'greetings', 'morning', 'evening',
  "g'day", 'gday', "what's up", 'whats up', 'how are you', "how's it going", 'hows it going',
  'checking in', 'just checking in', 'good morning', 'good afternoon', 'good evening',
  'hi there', 'hey there',
];

const CASUAL_EXACT = [
  'how are things', "how's things", 'hows things', "what's new", 'whats new',
  'learned anything', 'not much', "what's happening", 'whats happening',
  "how's it going", 'hows it going', 'you good', 'all good', 'same here',
];

const SHORT_ACK_EXACT = [
  "that's short", 'thats short', "that's cool", 'thats cool', 'cool', 'ok', 'okay',
  'nice', 'short', 'brief', 'thanks', 'cheers', 'sounds good', 'all good',
  'so far so good', 'so far, so good', 'good thanks', 'doing good', 'doing well',
  'not bad', 'pretty good', 'fine thanks', 'same here',
];

const SOCIAL_RECIPROCITY_STARTS = [
  'good', 'great', 'not bad', 'pretty good', 'same here', 'going well', 'going good',
  'doing alright', 'all good', 'you good', 'and you', 'same', 'likewise',
  'sorta', 'sort of', 'kinda', 'kind of',
];

const DEEP_PHRASES = [
  'help me think through', 'help me understand', 'help me work through',
  'why do you think', 'how do you think', 'why would you think', 'how would you approach',
  'how do you see it', 'explain why', 'explain how', 'explain the',
  "what's your take on", 'what is your take on', "what's your view on", 'what is your view on',
  "what's your perspective on", 'what is your perspective on',
  'reflect on', 'consider the', 'consider how', 'consider why',
  'weigh up', 'weigh the', 'weighing up', 'weighing the',
  'analyse the', 'analyze the', 'analyse this', 'analyze this', 'analyse how', 'analyze how',
  'what are the implications', 'what does it mean for',
  'discuss the', 'discuss this', 'discuss how',
  'explore the idea', 'explore this idea', 'explore the question', 'explore this question',
  'walk me through', 'talk me through',
  'should i really', 'should i actually', 'should we',
  'what would you do if', 'what would you do when', 'how would you handle',
];

const SHORT_DEEP = ['why', 'and?', 'explain', 'elaborate', 'go on', 'what do you mean', 'how so', 'in what way'];

const INSTRUCTION_PHRASES = [
  'set up', 'configure', 'login', 'sign up', 'signup', 'register', 'add my email',
  'give me', 'help me', 'what should i do', 'next step', 'one step',
  'summarise', 'summarize', 'words max', 'keep this to', 'keep it to',
  'todo', 'to-do', 'plan this', 'action item', 'action items',
];

function stripTrailPunct(s) {
  let t = String(s || '').trim();
  while (t.length && '!?., '.includes(t[t.length - 1])) t = t.slice(0, -1).trimEnd();
  return t;
}

function normMessage(msg) {
  return collapseWhitespace(toLowerAsciiish(normalizeApostrophes(msg)));
}

function isGreetingMsg(norm) {
  const t = stripTrailPunct(norm);
  if (GREETING_EXACT.includes(t)) return true;
  // "hi piko" / "hey mate"
  for (const g of ['hi', 'hey', 'hello', 'howdy', 'yo', 'sup', 'hiya', 'morning', 'evening', "g'day", 'gday']) {
    if (t === g || t === `${g} piko` || t === `${g} mate`) return true;
  }
  if (t.startsWith('good morning') || t.startsWith('good afternoon') || t.startsWith('good evening')) return true;
  if (t.startsWith("what's up") || t.startsWith('whats up') || t.startsWith('how are you') || t.startsWith("how's it going")) return true;
  return false;
}

function isCasualMsg(norm) {
  const t = stripTrailPunct(norm);
  return CASUAL_EXACT.includes(t) || CASUAL_EXACT.some((p) => t === p);
}

function isShortAckMsg(norm) {
  return SHORT_ACK_EXACT.includes(stripTrailPunct(norm));
}

function isSocialReciprocityMsg(norm) {
  const t = stripTrailPunct(norm);
  if (includesAny(t, [
    'how about you', 'how about yourself', 'what about you', 'what about yourself',
    'how are you', 'how are you doing', 'you doing ok', 'doing ok',
  ])) return true;
  if (endsWithAny(t, ['yourself', 'and you', ', you', ' yourself?', ' and you?'])) return true;
  if (t === 'yourself' || t === 'and you' || t.endsWith(' yourself') || t.endsWith(' and you')) return true;
  for (const p of SOCIAL_RECIPROCITY_STARTS) {
    if (t === p || t.startsWith(p + ' ')) return true;
  }
  return false;
}

function isYourselfFollowup(norm) {
  const t = stripTrailPunct(norm);
  return endsWithAny(t, ['yourself', 'and you', ', you']) || t === 'yourself' || t === 'and you';
}

function isCompoundGreeting(norm) {
  const t = stripTrailPunct(norm);
  if (!startsWithAny(t, ['hey', 'hi', 'hello', 'morning', 'evening', "g'day", 'gday'])) return false;
  return includesAny(t, [
    "how's it going", 'hows it going', 'how are you', 'how are ya', "how's ya", 'hows ya',
    "what's up", 'whats up', 'how are things', "how's things", 'hows things',
  ]);
}

function isWhatUpTo(norm) {
  const t = stripTrailPunct(norm);
  if (includesAny(t, ['what are you up to', "what're you up to", 'what are you up to'])) return true;
  if (includesAny(t, ["what's occupying you", 'whats occupying you', 'what is occupying you'])) return true;
  if (t.includes('what have you been up to')) return true;
  return false;
}

function isLightOpinion(norm) {
  const t = stripTrailPunct(norm);
  if (t.startsWith("what's your take on") || t.startsWith('whats your take on')) return true;
  if (t.startsWith('what do you think about') || t.startsWith('what do you think of')) return true;
  if (t.startsWith("what's about ") || t.startsWith('whats about ')) return true;
  return false;
}

function isSocialEmpathy(norm) {
  return startsWithAny(stripTrailPunct(norm), [
    'i had a rough', 'feeling a bit', 'feeling bit', "i'm feeling a bit", "i'm a bit",
    'im feeling a bit', 'im a bit', 'feels like', 'rough day', 'long week',
  ]);
}

function isSignOff(norm) {
  const t = stripTrailPunct(norm);
  return startsWithAny(t, [
    'thanks, that\'s all', 'thanks thats all', "thanks that's all", 'thanks all',
    'thanks, all', 'catch you later', 'catch you soon', 'cheers', 'cheers mate',
    'talk soon', 'gotta run', 'see you later', 'see you soon', 'see you', 'bye',
  ]) || t === 'thanks' || t === 'cheers';
}

function isGreetingWhatNew(norm) {
  const t = stripTrailPunct(norm);
  return startsWithAny(t, ['hi piko', 'hey piko', 'hello piko']) && t.includes("what's new") ||
    startsWithAny(t, ['hi piko', 'hey piko', 'hello piko']) && t.includes('whats new');
}

function isNotMuchYou(norm) {
  const t = stripTrailPunct(norm);
  return t.startsWith('not much') && (t.includes(' you') || t.includes('yourself'));
}

function isEverTried(norm) {
  return stripTrailPunct(norm).startsWith('ever tried ');
}

function isSocialChatInvite(norm) {
  return includesAny(norm, [
    'want to chat', 'want to talk', 'want to have a chat', 'up for a chat',
    'feel like chatting', 'chat for a while', 'shoot the breeze', 'hang out',
  ]);
}

function isInstructionLike(norm) {
  if (includesAny(norm, INSTRUCTION_PHRASES)) return true;
  if (norm.includes('@') && norm.includes('.')) return true; // email-ish
  if (norm.includes('in ') && norm.includes(' words')) return true;
  if (norm.includes('under ') && norm.includes(' words')) return true;
  return false;
}

function isRecall(norm) {
  return includesAny(norm, [
    'what did you do today', 'what did you do this week',
    'what have you do today', 'what have you do this week',
    'what did you actually do today', 'what have you actually do today',
    "what's been on your list today", 'whats been on your list today',
    "what's on your list today", 'whats on your list today',
    "what's on your plate today", 'whats on your plate today',
    "what's been on your plate lately", 'whats been on your plate lately',
    'what have you been up to today', 'what have you been doing today',
    'what have you been up to lately', 'what have you been doing lately',
    'summarize your activity', 'summarize what youve activity',
    'summarize your actions', 'summarize activity today',
  ]);
}

function isDeepFromPatterns(norm) {
  if (includesAny(norm, DEEP_PHRASES)) return true;
  if (norm.includes('how does ') && (norm.includes(' relate to') || norm.includes(' connect to'))) return true;
  if (includesAny(norm, ["what's the difference between", 'what is the difference between']) && norm.includes(' and')) return true;
  return false;
}

function isShortDeepFollowup(norm) {
  return SHORT_DEEP.includes(stripTrailPunct(norm));
}

const { isIdentityQuery, isCapabilitiesQuery } = require('./answerLocal');

/**
 * Create a response plan from context.
 */
function createResponsePlan(context) {
  const userBeliefs = context.userBeliefs || [];
  const mind = context.mind || {};
  const goals = Array.isArray(mind.goals) ? mind.goals : [];
  const tensions = Array.isArray(mind.tensions) ? mind.tensions : [];
  const userMessage = (context.userMessage || '').toLowerCase();
  const recentTurns = context.recentTurns || [];
  const reasons = [];

  let verbosity = 'medium';
  let tone = 'analytical';
  let follow_up_questions = 0;
  let challenge_level = 'low';
  const assume_familiarity = true;
  let proactivity = null;

  const trimmed = (context.userMessage || '').trim();
  const norm = normMessage(trimmed);
  const useReduced = process.env.PIKO_PLANNER_REDUCED === '1' || process.env.PIKO_PLANNER_REDUCED === 'true';
  const isGreeting = trimmed.length <= 60 && isGreetingMsg(norm);
  const isCasualSmallTalk = trimmed.length <= 80 && !trimmed.startsWith('/') && isCasualMsg(norm);
  const isShortAck = trimmed.length <= 40 && !trimmed.startsWith('/') && isShortAckMsg(norm);
  const isSocialReciprocity = trimmed.length <= 80 && !trimmed.startsWith('/') &&
    (isSocialReciprocityMsg(norm) || isYourselfFollowup(norm) || (!useReduced && isNotMuchYou(norm)));
  const isCompoundGreetingFlag = trimmed.length <= 80 && !trimmed.startsWith('/') && isCompoundGreeting(norm);
  const isWhatUpToFlag = trimmed.length <= 80 && !trimmed.startsWith('/') && isWhatUpTo(norm);
  const isLightOpinionFlag = trimmed.length <= 80 && !trimmed.startsWith('/') && isLightOpinion(norm);
  const isSocialEmpathyFlag = trimmed.length <= 100 && !trimmed.startsWith('/') && isSocialEmpathy(norm);
  const isSignOffFlag = trimmed.length <= 60 && !trimmed.startsWith('/') && isSignOff(norm);
  const isGreetingWhatNewFlag = !useReduced && trimmed.length <= 60 && !trimmed.startsWith('/') && isGreetingWhatNew(norm);
  const isNotMuchYouFlag = !useReduced && trimmed.length <= 80 && !trimmed.startsWith('/') && isNotMuchYou(norm);
  const isEverTriedFlag = !useReduced && trimmed.length <= 60 && !trimmed.startsWith('/') && isEverTried(norm);
  const isSocialChatInviteFlag = trimmed.length <= 180 && !trimmed.startsWith('/') && isSocialChatInvite(norm);
  const isCapabilityQuestion = trimmed.length <= 120 && !trimmed.startsWith('/') &&
    (isIdentityQuery(trimmed) || isCapabilitiesQuery(trimmed));
  if (isCapabilityQuestion) {
    verbosity = 'low';
    tone = 'warm';
    follow_up_questions = 0;
    if (!reasons.length) reasons.push('capability_question');
  }
  const looksLikeInstruction = isInstructionLike(norm);
  if ((isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity || isCompoundGreetingFlag || isWhatUpToFlag || isLightOpinionFlag || isSocialEmpathyFlag || isSignOffFlag || isGreetingWhatNewFlag || isNotMuchYouFlag || isEverTriedFlag) && !looksLikeInstruction) {
    verbosity = 'low';
    tone = 'warm';
    follow_up_questions = 0;
    if (!reasons.length) {
      reasons.push(isGreeting ? 'greeting' : (isShortAck ? 'short_ack' : (isSocialReciprocity ? 'social_reciprocity' : (isCompoundGreetingFlag ? 'compound_greeting' : (isWhatUpToFlag ? 'what_up_to' : (isLightOpinionFlag ? 'light_opinion' : (isSocialEmpathyFlag ? 'social_empathy' : (isSignOffFlag ? 'sign_off' : (isGreetingWhatNewFlag ? 'greeting_what_new' : (isNotMuchYouFlag ? 'not_much_you' : (isEverTriedFlag ? 'ever_tried' : 'casual')))))))))));
    }
  }
  if (looksLikeInstruction && !reasons.length) reasons.push('instruction_like');

  const depthBelief = userBeliefs.find(
    (b) =>
      b.proposition &&
      DEPTH_KEYWORDS.some((k) => b.proposition.toLowerCase().includes(k)) &&
      (b.confidence || 0) >= DEPTH_CONFIDENCE_THRESHOLD
  );
  if (depthBelief) {
    verbosity = 'high';
    reasons.push('belief:' + (depthBelief.proposition || '').slice(0, 40));
  }

  const activeGoals = goals.filter((g) => g.status !== 'done' && g.status !== 'completed');
  const messageGoalRelevant = GOAL_RELEVANT_KEYWORDS.some((k) => userMessage.includes(k));
  if (activeGoals.length > 0 && messageGoalRelevant) {
    follow_up_questions = 1;
    proactivity = 'moderate';
    reasons.push('goal_relevant');
  }

  if (tensions.length > 0) {
    challenge_level = 'moderate';
    if (!reasons.includes('tensions')) reasons.push('tensions');
  }

  const recentEpisodic = context.recentEpisodic || [];
  const hasRecentContext = recentEpisodic.length > 0;
  const soft_drive = hasRecentContext ? 'coherence' : null;

  const reason = reasons.length ? reasons.join('; ') : null;
  const casual = (isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity || isCompoundGreetingFlag || isWhatUpToFlag || isLightOpinionFlag || isSocialEmpathyFlag || isSignOffFlag || isGreetingWhatNewFlag || isNotMuchYouFlag || isEverTriedFlag) && !looksLikeInstruction;
  const socialChat = !casual && !looksLikeInstruction && isSocialChatInviteFlag;

  let isDeepFromHistory = false;
  if (!casual && !socialChat && !looksLikeInstruction && trimmed.length <= 30 && isShortDeepFollowup(norm)) {
    const lastUser = recentTurns.filter((t) => t.role === 'user').pop();
    const lastAssistant = recentTurns.filter((t) => t.role === 'assistant').pop();
    const priorContent = (lastUser && lastUser.content) || (lastAssistant && lastAssistant.content) || '';
    const priorSubstantive = priorContent.length >= 40 && (priorContent.trim().endsWith('?') || priorContent.length >= 80);
    if (priorSubstantive) {
      isDeepFromHistory = true;
      if (!reasons.includes('deep_from_history')) reasons.push('deep_from_history');
    }
  }

  const isDeepFromPatternsFlag = !casual && !socialChat && !looksLikeInstruction &&
    isDeepFromPatterns(norm) &&
    trimmed.length >= 20;
  const isDeepReasoning = isDeepFromHistory || isDeepFromPatternsFlag;
  if (isDeepReasoning && !reasons.includes('deep_reasoning') && !reasons.includes('deep_from_history')) reasons.push('deep_reasoning');
  const casualMode = casual
    ? (isGreeting || isCompoundGreetingFlag || isGreetingWhatNewFlag ? 'GREETING' : (isSocialReciprocity || isNotMuchYouFlag ? 'RECIPROCITY' : (isShortAck ? 'ACK' : (isSocialEmpathyFlag ? 'SOCIAL_EMPATHY' : (isLightOpinionFlag || isEverTriedFlag ? 'LIGHT_OPINION' : (isSignOffFlag ? 'SIGN_OFF' : 'CASUAL'))))))
    : null;
  const capabilityQuestion = isCapabilityQuestion;

  const mode = casual ? (isGreeting || isCompoundGreetingFlag || isGreetingWhatNewFlag ? 'GREETING' : 'SOCIAL') : (socialChat ? 'SOCIAL' : (isDeepReasoning ? 'DEEP' : 'NORMAL'));

  const recallRequested = !trimmed.startsWith('/') && isRecall(norm);

  if (process.env.PIKO_LOG_PLANNER === '1') {
    const route = casual ? (casualMode || 'CASUAL') : (socialChat ? 'SOCIAL_CHAT' : (isDeepReasoning ? 'DEEP' : 'FULL'));
    console.log(`[PLANNER] Prompt: "${trimmed}" | route: ${route} | mode: ${mode} | reason: ${casual ? (reason || 'greeting/reciprocity/ack') : (socialChat ? 'social_chat_invite' : (isDeepReasoning ? 'deep' : 'full'))}`);
  }
  return {
    verbosity,
    tone,
    follow_up_questions,
    challenge_level,
    assume_familiarity,
    proactivity,
    soft_drive,
    reason,
    casual,
    socialChat,
    casualMode,
    capabilityQuestion,
    deepReasoning: isDeepReasoning,
    mode,
    recallRequested,
  };
}

async function classifyDepthOptional(message, recentTurns, model) {
  if (process.env.PIKO_MODEL_ROUTING !== '1' && process.env.PIKO_MODEL_ROUTING !== 'true') return null;
  const historySnippet = recentTurns.slice(-2).map((t) => (t.content || '').trim()).join('\n');
  const prompt = `One word only: normal or deep

Message: ${(message || '').slice(0, 200)}
Recent: ${historySnippet.slice(0, 300)}

Answer:`;
  try {
    const { ollamaNativeChat } = require('./llm');
    const result = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
      max_tokens: 2,
      temperature: 0,
    });
    const word = (result || '').toLowerCase().trim();
    if (word.includes('deep')) return 'deep';
    return 'normal';
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[PLANNER] classifyDepthOptional failed:', e.message);
    return null;
  }
}

function formatPlanForPrompt(plan) {
  const parts = [
    `verbosity ${plan.verbosity}`,
    `tone ${plan.tone}`,
    `follow-up questions ${plan.follow_up_questions}`,
    `challenge ${plan.challenge_level}`,
    `assume familiarity ${plan.assume_familiarity}`,
  ];
  if (plan.proactivity) parts.push(`${plan.proactivity} proactivity`);
  if (plan.soft_drive === 'coherence') parts.push('when relevant maintain conversational coherence with the recent exchange');
  return '**Response plan (this turn):** ' + parts.join(', ') + '.';
}

module.exports = {
  createResponsePlan,
  formatPlanForPrompt,
  classifyDepthOptional,
  DEPTH_CONFIDENCE_THRESHOLD,
  DEPTH_KEYWORDS,
};
