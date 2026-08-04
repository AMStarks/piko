/**
 * Persist user feedback as append-only JSONL (P2.6b).
 */
const path = require('path');
const crypto = require('crypto');
const { atomicAppendJsonl } = require('./atomicJson');

function feedbackPath(rootDir) {
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  return path.join(dataDir, 'feedback.jsonl');
}

function recordFeedback(message, opts = {}) {
  const entry = {
    id: typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `fb_${Date.now()}`,
    ts: new Date().toISOString(),
    text: String(message || '').slice(0, 4000),
    session_id: opts.sessionId || opts.sessionKey || null,
    tenant_id: process.env.PIKO_TENANT_ID || null,
    understanding_intent: opts.understanding && opts.understanding.intent
      ? opts.understanding.intent
      : 'feedback',
  };
  atomicAppendJsonl(feedbackPath(opts.rootDir), entry);
  return entry;
}

function answerFeedback(message, understanding, opts = {}) {
  let recorded = null;
  try {
    recorded = recordFeedback(message, opts);
  } catch (e) {
    return {
      reply: 'I heard the feedback but could not persist it just now — please try again.',
      mode: 'answer',
      fallthrough: false,
      inject_campaign_state: false,
      decision: {
        mode: 'answer',
        reply: '',
        lookups: [],
        reason: 'feedback_persist_failed',
        source: 'feedback_handler',
        agent_id: null,
        control_action: null,
      },
      understanding: understanding || null,
      error: String(e && e.message ? e.message : e),
    };
  }
  return {
    reply: 'Thanks — I recorded that feedback and will keep it with the operator notes.',
    mode: 'answer',
    fallthrough: false,
    inject_campaign_state: false,
    decision: {
      mode: 'answer',
      reply: '',
      lookups: [],
      reason: 'feedback',
      source: 'feedback_handler',
      agent_id: null,
      control_action: null,
    },
    feedback_id: recorded.id,
    understanding: understanding || null,
  };
}

module.exports = {
  feedbackPath,
  recordFeedback,
  answerFeedback,
};
