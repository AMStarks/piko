/**
 * Smart assistant layer — speech act, references, compound questions.
 * Retrieve deterministically; comprehend before routing to templates or synthesis.
 */
const { normalizeApostrophes, isQueueReadQuery } = require('./queueRead');
const { parseTaskIdFromMessage } = require('./taskRead');
const {
  includesAny,
  toLowerAsciiish,
  collapseWhitespace,
  isAsciiLetter,
  isAsciiDigit,
  parseHhMm,
} = require('./text');
const { tokenize } = require('./slashCommands');

function normDialogue(message) {
  return collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || '')))).trim();
}

function isWordChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '_';
}

function hasWord(haystack, word) {
  const h = String(haystack || '');
  const w = String(word || '');
  if (!w) return false;
  let from = 0;
  while (from <= h.length - w.length) {
    const idx = h.indexOf(w, from);
    if (idx < 0) return false;
    const before = idx === 0 ? '' : h[idx - 1];
    const after = idx + w.length >= h.length ? '' : h[idx + w.length];
    const leftOk = !before || !isWordChar(before);
    const rightOk = !after || !isWordChar(after);
    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
  return false;
}

function hasAnyWord(haystack, words) {
  for (const w of words || []) {
    if (hasWord(haystack, w)) return true;
  }
  return false;
}

function isTimeCore(s) {
  const str = String(s || '');
  if (!str) return false;
  const parts = str.split(':');
  if (parts.length === 1) {
    if (parts[0].length < 1 || parts[0].length > 2) return false;
    for (const ch of parts[0]) {
      if (!isAsciiDigit(ch)) return false;
    }
    return true;
  }
  if (parts.length === 2) {
    if (parseHhMm(str)) return true;
    if (parts[0].length < 1 || parts[0].length > 2 || parts[1].length !== 2) return false;
    for (const ch of parts[0] + parts[1]) {
      if (!isAsciiDigit(ch)) return false;
    }
    return true;
  }
  return false;
}

function hasAmPmTime(t) {
  const tokens = tokenize(t);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase();
    if ((tok.endsWith('am') || tok.endsWith('pm')) && tok.length > 2) {
      if (isTimeCore(tok.slice(0, -2))) return true;
    }
    if (tok === 'am' || tok === 'pm') {
      if (i > 0 && isTimeCore(tokens[i - 1])) return true;
    }
  }
  return false;
}

function hasToOrAtDigit(t) {
  for (const marker of ['to ', 'at ']) {
    let from = 0;
    while (from < t.length) {
      const idx = t.indexOf(marker, from);
      if (idx < 0) break;
      const before = idx === 0 ? '' : t[idx - 1];
      if (before && isWordChar(before)) {
        from = idx + 1;
        continue;
      }
      const d = t[idx + marker.length];
      if (d && isAsciiDigit(d)) return true;
      from = idx + 1;
    }
  }
  return false;
}

function hasReferencePhrase(t) {
  if (hasAnyWord(t, ['that', 'this', 'it', 'them', 'those'])) return true;
  return includesAny(t, ['the 6am', 'the 6am thing', 'the proactive', 'the proactive update']);
}

function splitCompoundMessage(message) {
  const raw = normalizeApostrophes(String(message || '')).trim();
  if (!raw) return [];
  const parts = [];
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '?') {
      const next = raw[i + 1];
      if (next === undefined || next === ' ' || next === '\t' || next === '\n' || next === '\r') {
        parts.push(cur);
        cur = '';
        while (i + 1 < raw.length && raw[i + 1] === '?') i += 1;
        continue;
      }
    }
    if (
      ch === '.' &&
      raw[i + 1] === ' ' &&
      raw[i + 2] &&
      raw[i + 2] >= 'A' &&
      raw[i + 2] <= 'Z'
    ) {
      parts.push(cur);
      cur = '';
      i += 1; // consume the space after '.'
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);

  const cleaned = parts
    .map((p) => {
      let s = String(p || '').trim();
      while (s.endsWith('?')) s = s.slice(0, -1);
      return s.trim();
    })
    .filter((p) => p.length > 2);

  if (cleaned.length <= 1) return [{ text: raw, index: 0 }];
  return cleaned.map((text, index) => ({ text: text.endsWith('?') ? text : `${text}?`, index }));
}

function classifySpeechAct(message, sessionState = {}) {
  const t = normDialogue(message);
  if (!t) return { act: 'chat', topic: null, confidence: 0 };

  if (isQueueReadQuery(message)) {
    return { act: 'list', topic: 'queue', confidence: 1 };
  }

  try {
    const { isConfigMutateIntent } = require('./configMutate');
    const { isLegionScheduleMutateIntent } = require('./legionScheduleMutate');
    const { isOperationsMutateIntent } = require('./operationsMutate');
    if (isConfigMutateIntent(message)) {
      return { act: 'mutate', topic: 'settings', confidence: 0.98 };
    }
    if (isLegionScheduleMutateIntent(message)) {
      return { act: 'mutate', topic: 'task', confidence: 0.98 };
    }
    if (isOperationsMutateIntent(message)) {
      return { act: 'mutate', topic: 'operations', confidence: 0.98 };
    }
  } catch (_) {}

  if (parseTaskIdFromMessage(message)) {
    if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop'])) {
      return { act: 'cancel', topic: 'task', confidence: 0.95 };
    }
    if (hasAnyWord(t, ['run', 'start', 'execute', 'trigger'])) {
      return { act: 'mutate', topic: 'task', confidence: 0.9 };
    }
    if (
      hasWord(t, 'explain') ||
      includesAny(t, ["what's", 'what is', 'what does'])
    ) {
      return { act: 'explain', topic: 'task', confidence: 0.95 };
    }
    return { act: 'explain', topic: 'task', confidence: 0.85 };
  }

  const explicitMutateVerb =
    hasAnyWord(t, ['move', 'set', 'disable', 'enable', 'delete', 'create', 'schedule', 'turn off', 'turn on']);
  if (
    explicitMutateVerb &&
    (hasToOrAtDigit(t) || hasAmPmTime(t) || hasAnyWord(t, ['daily', 'hourly']))
  ) {
    return { act: 'mutate', topic: inferTopic(t), confidence: 0.9 };
  }

  const vagueMutate =
    hasAnyWord(t, ['adjust', 'change', 'modify', 'edit', 'configure', 'update', 'tweak']) &&
    !hasAnyWord(t, ['can', 'could', 'how']) &&
    !includesAny(t, ['am i able', 'is it possible']) &&
    parseTaskIdFromMessage(message) == null &&
    !includesAny(t, ['turn off', 'turn on']) &&
    !hasAnyWord(t, ['enable', 'disable', 'move', 'reschedule', 'cancel']);
  if (vagueMutate) {
    return { act: 'clarify_mutate', topic: inferTopic(t), confidence: 0.85 };
  }

  if (
    (includesAny(t, ['am i able to', 'is it possible', 'are we able to', 'may i']) ||
      hasAnyWord(t, ['can', 'could'])) &&
    (hasAnyWord(t, ['adjust', 'change', 'modify', 'edit', 'configure', 'enable', 'disable', 'move', 'reschedule', 'cancel']) ||
      includesAny(t, ['turn off']))
  ) {
    return { act: 'permission', topic: inferTopic(t), confidence: 0.95 };
  }
  if (
    includesAny(t, ['am i able']) &&
    hasAnyWord(t, ['move', 'reschedule', 'cancel', 'schedule', 'task', 'queue'])
  ) {
    return { act: 'permission', topic: inferTopic(t), confidence: 0.95 };
  }

  if (
    includesAny(t, ['how do i', 'how can i']) &&
    (hasAnyWord(t, ['adjust', 'change', 'configure', 'edit', 'move', 'reschedule', 'cancel', 'schedule']) ||
      includesAny(t, ['set up', 'setup']))
  ) {
    return { act: 'howto', topic: inferTopic(t), confidence: 0.95 };
  }

  if (hasReferencePhrase(t) && sessionState.lastDiscussed) {
    return {
      act: 'follow_up',
      topic: sessionState.lastDiscussed.topic || inferTopic(t),
      confidence: 0.9,
      refersTo: sessionState.lastDiscussed.entities || [],
    };
  }

  if (
    includesAny(t, ["what's that", 'what is that', "what's it", 'what is it', "what's this", 'what is this', 'what was that'])
  ) {
    return {
      act: 'follow_up',
      topic: sessionState.lastDiscussed?.topic || inferTopic(t) || 'proactive',
      confidence: sessionState.lastDiscussed ? 0.85 : 0.6,
    };
  }

  if (
    includesAny(t, [
      'what else',
      'anything else you',
      'what can you do',
      'what do you do',
      'proactive update',
    ])
  ) {
    return { act: 'explain', topic: 'capabilities', confidence: 0.9, compound: splitCompoundMessage(message).length > 1 };
  }

  if (hasWord(t, 'explain') || includesAny(t, ['what does', 'how does'])) {
    return { act: 'explain', topic: inferTopic(t), confidence: 0.85 };
  }

  if (
    includesAny(t, ["what's running", 'what is running', 'what are running']) ||
    (hasWord(t, 'list') && hasAnyWord(t, ['background', 'cron', 'job', 'jobs'])) ||
    (hasWord(t, 'background') && hasAnyWord(t, ['job', 'jobs', 'task', 'tasks', 'cron']) && hasWord(t, 'what'))
  ) {
    return { act: 'list', topic: 'operations', confidence: 0.9 };
  }

  if (includesAny(t, ['who are you', 'what are you'])) {
    return { act: 'explain', topic: 'identity', confidence: 0.95 };
  }

  return { act: 'chat', topic: inferTopic(t), confidence: 0.4 };
}

function inferTopic(t) {
  if (hasWord(t, 'queue')) return 'queue';
  if (hasWord(t, 'proactive') || includesAny(t, ['6 am', '6am'])) return 'proactive';
  if (hasWord(t, 'background') || hasWord(t, 'cron')) return 'operations';
  if (hasAnyWord(t, ['task', 'mission', 'schedule'])) return 'task';
  if (t.includes('capabilit') || includesAny(t, ['what else'])) return 'capabilities';
  return null;
}

function resolveDialogueTurn(message, opts = {}) {
  const sessionState = opts.sessionState || {};
  const units = splitCompoundMessage(message);
  const speechActs = units.map((u) => ({
    ...u,
    speechAct: classifySpeechAct(u.text, sessionState),
  }));

  const primary = speechActs[0]?.speechAct || classifySpeechAct(message, sessionState);
  const compound = speechActs.length > 1;

  let responseClass = 'B';
  if (primary.act === 'list' && primary.confidence >= 0.9 && !compound) {
    responseClass = 'A';
  } else if (primary.act === 'mutate' || primary.act === 'cancel') {
    responseClass = 'C';
  } else if (primary.act === 'chat' && primary.confidence < 0.5) {
    responseClass = 'chat';
  }

  const suppressWorkAck =
    primary.act === 'permission' ||
    primary.act === 'howto' ||
    primary.act === 'explain' ||
    primary.act === 'follow_up' ||
    primary.act === 'list' ||
    primary.act === 'clarify_mutate';

  return {
    message,
    units: speechActs,
    speechAct: primary.act,
    topic: primary.topic,
    responseClass,
    compound,
    suppressWorkAck,
    refersTo: primary.refersTo || sessionState.lastDiscussed?.entities || [],
  };
}

function topicToRoute(topic, speechAct) {
  if (speechAct === 'list' && topic === 'queue') return 'queue_read';
  if (speechAct === 'list' && topic === 'operations') return 'operations_read';
  if (speechAct === 'permission' || speechAct === 'howto') return 'config_explain';
  if (topic === 'capabilities' || topic === 'proactive') return 'capabilities_read';
  if (topic === 'operations' && speechAct === 'explain') return 'config_explain';
  if (topic === 'identity') return 'capabilities_read';
  if (topic === 'task') return 'task_explain_read';
  return null;
}

function recordDiscussedTopic(sessionId, patch, dataDir) {
  const { setSessionState } = require('./sessionState');
  return setSessionState(
    sessionId,
    {
      lastDiscussed: {
        topic: patch.topic,
        entities: patch.entities || [],
        route: patch.route,
        at: new Date().toISOString(),
      },
    },
    dataDir,
  );
}

module.exports = {
  splitCompoundMessage,
  classifySpeechAct,
  resolveDialogueTurn,
  topicToRoute,
  recordDiscussedTopic,
};
