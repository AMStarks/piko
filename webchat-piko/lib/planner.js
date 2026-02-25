/**
 * Response planner: turns memory user beliefs + mind (goals, tensions) into constraints for this turn.
 * Pure function, no LLM. See docs/RESPONSE_PLANNER_AND_CONTROL_SURFACES_RECOMMENDATION.md.
 */

const DEPTH_CONFIDENCE_THRESHOLD = 0.7;
const DEPTH_KEYWORDS = ['depth', 'structure', 'structured', 'detail', 'in-depth', 'thorough'];
const GOAL_RELEVANT_KEYWORDS = ['plan', 'today', 'tomorrow', 'next', 'goal', 'priority', 'week'];
/** Short greeting-like messages get low verbosity so replies stay one short line. */
const GREETING_PATTERN = /^(hi|hey|hello|howdy|yo|sup|hiya|greetings|morning|evening|g\'?day|what\'?s up|whats up|how are you|how\'?s it going|checking in|just checking in|good (morning|afternoon|evening)|hi there|hey there)([\s!?.]*|\s+piko[\s!?.]*|\s+mate[\s!?.]*)$/i;
/** Small-talk (short, no command): treat as casual so we don't over-structure the reply. */
const CASUAL_PATTERN = /^(how are things|how\'?s things|what\'?s new|whats new|learned anything|not much|what\'?s happening|how\'?s it going|you good|all good|same here)[\s!?.]*$/i;
/** "Hi Piko — what's new?" style (greeting + casual lead-in). */
const GREETING_WHAT_NEW = /^(hi|hey|hello)\s+piko\s*[—\-]\s*what'?s new/i;
/** Very short acknowledgments / one-word reactions: treat as casual (one short reply). */
const SHORT_ACK_PATTERN = /^(that\'?s short|that\'?s cool|cool|ok|okay|nice|short|brief)[\s!?.]*$/i;
/** Social reciprocity: starts with "good", "not bad", "sorta", etc., or contains "how about you/yourself" or "you doing ok", or ends with "yourself?" / "and you?" */
const SOCIAL_RECIPROCITY_PATTERN = /^(good|great|not bad|pretty good|same here|going well|going good|doing alright|all good|you good|and you|same|likewise|sorta|sort of|kinda|kind of)(\s|$)/i;
/** Matches "how about you", "how about yourself", "how's you", "how are you", "you doing ok" etc. anywhere in message. */
const HOW_ABOUT_YOU_FOLLOWUP = /((how|what)\s+(about\s+you|about\s+yourself)|how\s+[\u2019']?s\s+(it\s+)?you(\s+going)?|how\s+are\s+you(\s+doing)?)|you\s+doing\s+ok|doing\s+ok/i;
/** Matches "yourself?", "and you?", "you?" at end — reciprocal handback. */
const YOURSELF_FOLLOWUP = /(yourself|and you|,\s*you)\s*[.?]?\s*$/i;
/** Capability/identity questions: answer in one short line; do not assume debugging. */
const CAPABILITY_QUESTION_PATTERN = /^(who are you|what are you|what can you do|can you help me|how does this work|what\'?s your name(\s+again)?|introduce yourself|what do you do)[\s!?.]*$/i;
/** User is giving an instruction or request (e.g. set up, login, email); do not reply with only a greeting. */
const INSTRUCTION_LIKE_PATTERN = /(set\s+up|configure|login|sign\s*up|register|add\s+my\s+email|@|:\s*[a-z0-9._%+-]+@[a-z0-9.-]+)/i;
/** Compound greetings: "Hey, how's it going?" style. */
const COMPOUND_GREETING = /^(hey|hi|hello|morning|evening|g'?day)[\s,]+(how'?s it going|how are you|what'?s up|how are things|how'?s things)[\s!?.]*$/i;
/** "What are you up to?" style. */
const WHAT_UP_TO = /^what(\s+are|\s*'re)\s+you\s+up\s+to\??\s*$/i;
/** Light opinions: "What do you think about X?" / "What's your take on X?" */
const LIGHT_OPINION = /^what('?s| do you think) (about|of) \w+/i;
const LIGHT_OPINION_TAKE = /^what'?s your take on /i;
/** Light emotional disclosure: "I had a rough day", "Feeling a bit flat", "Feels like I'm not making progress" */
const SOCIAL_EMPATHY = /^(i had a rough|feeling (a )?bit|i'm (feeling )?(a )?bit|feels like|rough day|long week)/i;
/** Sign-offs */
const SIGN_OFF = /^(thanks,? ?(that'?s )?all( for now)?|catch you (later|soon)|cheers( mate)?|talk soon|gotta run|see you( later| soon)?|bye)[\s!?.]*$/i;
/** "Not much, just chilling. You?" — not much + reciprocity handback. */
const NOT_MUCH_YOU = /^not much.+\s+(you|yourself)\s*[.?]?\s*$/i;
/** "Ever tried X?" — light opinion / preference. */
const EVER_TRIED = /^ever tried \w+/i;
/** Explicit invitation to open chat (should keep short continuity without full worldview stack). */
const SOCIAL_CHAT_INVITE = /want to (chat|talk|have a chat)|up for a chat|feel like chatting|chat for a while|shoot the breeze|hang out/i;

/**
 * Create a response plan from context. Used before building the system prompt so beliefs and goals/tensions shape behaviour.
 * @param {Object} context - { userBeliefs, mind, userMessage?, recentEpisodic? }
 * @returns {{ verbosity, tone, follow_up_questions, challenge_level, assume_familiarity, proactivity?, reason? }}
 */
function createResponsePlan(context) {
  const userBeliefs = context.userBeliefs || [];
  const mind = context.mind || {};
  const goals = Array.isArray(mind.goals) ? mind.goals : [];
  const tensions = Array.isArray(mind.tensions) ? mind.tensions : [];
  const userMessage = (context.userMessage || '').toLowerCase();
  const reasons = [];

  let verbosity = 'medium';
  let tone = 'analytical';
  let follow_up_questions = 0;
  let challenge_level = 'low';
  const assume_familiarity = true;
  let proactivity = null;

  // Short greeting or small-talk → low verbosity, warm tone, casual (one short reply, minimal plan)
  const trimmed = (context.userMessage || '').trim();
  const norm = trimmed.replace(/[\u2019\u2018\u201B]/g, "'"); // normalize curly apostrophes for regex
  const isGreeting = trimmed.length <= 60 && GREETING_PATTERN.test(norm);
  const isCasualSmallTalk = trimmed.length <= 80 && !trimmed.startsWith('/') && CASUAL_PATTERN.test(norm);
  const isShortAck = trimmed.length <= 40 && !trimmed.startsWith('/') && SHORT_ACK_PATTERN.test(norm);
  const isSocialReciprocity = trimmed.length <= 80 && !trimmed.startsWith('/') &&
    (SOCIAL_RECIPROCITY_PATTERN.test(norm) || HOW_ABOUT_YOU_FOLLOWUP.test(norm) || YOURSELF_FOLLOWUP.test(norm));
  const isCompoundGreeting = trimmed.length <= 80 && !trimmed.startsWith('/') && COMPOUND_GREETING.test(norm);
  const isWhatUpTo = trimmed.length <= 60 && !trimmed.startsWith('/') && WHAT_UP_TO.test(norm);
  const isLightOpinion = trimmed.length <= 80 && !trimmed.startsWith('/') && (LIGHT_OPINION.test(norm) || LIGHT_OPINION_TAKE.test(norm));
  const isSocialEmpathy = trimmed.length <= 100 && !trimmed.startsWith('/') && SOCIAL_EMPATHY.test(norm);
  const isSignOff = trimmed.length <= 60 && !trimmed.startsWith('/') && SIGN_OFF.test(norm);
  const isGreetingWhatNew = trimmed.length <= 60 && !trimmed.startsWith('/') && GREETING_WHAT_NEW.test(norm);
  const isNotMuchYou = trimmed.length <= 80 && !trimmed.startsWith('/') && NOT_MUCH_YOU.test(norm);
  const isEverTried = trimmed.length <= 60 && !trimmed.startsWith('/') && EVER_TRIED.test(norm);
  const isSocialChatInvite = trimmed.length <= 180 && !trimmed.startsWith('/') && SOCIAL_CHAT_INVITE.test(norm);
  const isCapabilityQuestion = trimmed.length <= 80 && !trimmed.startsWith('/') && CAPABILITY_QUESTION_PATTERN.test(norm);
  if (isCapabilityQuestion) {
    verbosity = 'low';
    tone = 'warm';
    follow_up_questions = 0;
    if (!reasons.length) reasons.push('capability_question');
  }
  const looksLikeInstruction = INSTRUCTION_LIKE_PATTERN.test(norm);
  if ((isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity || isCompoundGreeting || isWhatUpTo || isLightOpinion || isSocialEmpathy || isSignOff || isGreetingWhatNew || isNotMuchYou || isEverTried) && !looksLikeInstruction) {
    verbosity = 'low';
    tone = 'warm';
    follow_up_questions = 0;
    if (!reasons.length) {
      reasons.push(isGreeting ? 'greeting' : (isShortAck ? 'short_ack' : (isSocialReciprocity ? 'social_reciprocity' : (isCompoundGreeting ? 'compound_greeting' : (isWhatUpTo ? 'what_up_to' : (isLightOpinion ? 'light_opinion' : (isSocialEmpathy ? 'social_empathy' : (isSignOff ? 'sign_off' : (isGreetingWhatNew ? 'greeting_what_new' : (isNotMuchYou ? 'not_much_you' : (isEverTried ? 'ever_tried' : 'casual')))))))))));
    }
    if (process.env.PIKO_DEBUG_CASUAL === '1' && (isSocialReciprocity || isCompoundGreeting || isWhatUpTo || isLightOpinion || isSocialEmpathy || isSignOff || isGreetingWhatNew || isNotMuchYou || isEverTried)) {
      console.log('[CASUAL] Casual type detected:', JSON.stringify(trimmed), '→', reasons[reasons.length - 1]);
    }
  }
  if (looksLikeInstruction && !reasons.length) reasons.push('instruction_like');

  // Belief: depth/structure preference → high verbosity
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

  // Active goals: if message seems goal-relevant, add one follow-up and moderate proactivity
  const activeGoals = goals.filter((g) => g.status !== 'done' && g.status !== 'completed');
  const messageGoalRelevant = GOAL_RELEVANT_KEYWORDS.some((k) => userMessage.includes(k));
  if (activeGoals.length > 0 && messageGoalRelevant) {
    follow_up_questions = 1;
    proactivity = 'moderate';
    reasons.push('goal_relevant');
  }

  // Active tensions → moderate challenge (engage, don't avoid)
  if (tensions.length > 0) {
    challenge_level = 'moderate';
    if (!reasons.includes('tensions')) reasons.push('tensions');
  }

  // Phase 5.1: One soft drive — maintain conversational coherence when we have recent context
  const recentEpisodic = context.recentEpisodic || [];
  const hasRecentContext = recentEpisodic.length > 0;
  const soft_drive = hasRecentContext ? 'coherence' : null;

  const reason = reasons.length ? reasons.join('; ') : null;
  const casual = (isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity || isCompoundGreeting || isWhatUpTo || isLightOpinion || isSocialEmpathy || isSignOff || isGreetingWhatNew || isNotMuchYou || isEverTried) && !looksLikeInstruction;
  const socialChat = !casual && !looksLikeInstruction && isSocialChatInvite;
  const casualMode = casual
    ? (isGreeting || isCompoundGreeting || isGreetingWhatNew ? 'GREETING' : (isSocialReciprocity || isShortAck || isNotMuchYou ? 'RECIPROCITY' : (isSocialEmpathy ? 'SOCIAL_EMPATHY' : (isLightOpinion || isEverTried ? 'LIGHT_OPINION' : (isSignOff ? 'SIGN_OFF' : 'CASUAL')))))
    : null;
  const capabilityQuestion = isCapabilityQuestion;
  if (process.env.PIKO_LOG_PLANNER === '1') {
    const route = casual ? (casualMode || 'CASUAL') : (socialChat ? 'SOCIAL_CHAT' : 'FULL');
    console.log(`[PLANNER] Prompt: "${trimmed}" | route: ${route} | reason: ${casual ? (reason || 'greeting/reciprocity/ack') : (socialChat ? 'social_chat_invite' : 'full')}`);
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
  };
}

/**
 * Format the plan as a one-line string for the system prompt.
 */
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
  DEPTH_CONFIDENCE_THRESHOLD,
  DEPTH_KEYWORDS,
};
