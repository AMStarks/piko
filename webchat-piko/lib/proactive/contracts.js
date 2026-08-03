const SIGNAL_TYPES = Object.freeze([
  'deadline.js',
  'calendarConflicts.js',
  'importantComms.js',
  'projectGap.js',
  'securityAlerts.js',
]);

const EVENT_TYPES = Object.freeze([
  'deadlineRisk',
  'calendarConflicts',
  'importantComms',
  'projectGap',
  'securityAlerts',
]);

const EVENT_STATUSES = Object.freeze([
  'queued',
  'suppressed',
  'draft_ready',
  'failed',
]);

const SUPPRESSION_REASONS = Object.freeze([
  'quiet_hours',
  'cooldown',
  'duplicate',
  'cap_reached',
  'low_confidence',
]);

const URGENCY_LEVELS = Object.freeze(['low', 'normal', 'high']);

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function cleanText(value, maxLen, fallback = '') {
  const s = String(value == null ? fallback : value).trim();
  if (!s) return fallback;
  return s.slice(0, maxLen);
}

function chooseOne(value, allowed, fallback) {
  const s = String(value || '').trim();
  return allowed.includes(s) ? s : fallback;
}

function toConfidence(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, 0, 1);
}

function normalizeSignal(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const signal = {
    source: chooseOne(src.source, SIGNAL_TYPES, 'deadline.js'),
    observedAt: cleanText(src.observedAt, 64, new Date().toISOString()),
    eventType: chooseOne(src.eventType, EVENT_TYPES, 'projectGap'),
    traceId: cleanText(src.traceId, 120, ''),
    payload: src.payload && typeof src.payload === 'object' ? src.payload : {},
  };
  return signal;
}

function normalizeCandidate(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const eventType = chooseOne(src.category || src.eventType, EVENT_TYPES, 'projectGap');
  const subject = cleanText(src.subject, 240, 'Proactive signal');
  const dedupeRaw = cleanText(src.dedupeKey, 280, `${eventType}:${subject}`);
  const dedupeKey = dedupeRaw.toLowerCase();
  return {
    eventType,
    confidence: toConfidence(src.confidence, 0),
    urgency: chooseOne(src.urgency, URGENCY_LEVELS, 'normal'),
    subject,
    reason: cleanText(src.reason, 240, ''),
    dedupeKey,
    signalSource: chooseOne(src.signalSource, SIGNAL_TYPES, 'deadline.js'),
  };
}

function toLifecycleStatus(decision) {
  const map = {
    drafted: 'draft_ready',
    sent: 'queued',
    delivery_failed: 'failed',
    suppressed_dedupe: 'suppressed',
    suppressed_ack: 'suppressed',
    suppressed_ack_category: 'suppressed',
    suppressed_category_cooldown: 'suppressed',
    suppressed_rate_limit: 'suppressed',
    skipped_low_confidence: 'suppressed',
  };
  return map[String(decision || '').trim()] || 'queued';
}

function toSuppressionReason(decision) {
  const map = {
    suppressed_dedupe: 'duplicate',
    suppressed_ack: 'duplicate',
    suppressed_ack_category: 'cooldown',
    suppressed_category_cooldown: 'cooldown',
    suppressed_rate_limit: 'cap_reached',
    skipped_low_confidence: 'low_confidence',
  };
  return map[String(decision || '').trim()] || '';
}

module.exports = {
  SIGNAL_TYPES,
  EVENT_TYPES,
  EVENT_STATUSES,
  SUPPRESSION_REASONS,
  URGENCY_LEVELS,
  normalizeSignal,
  normalizeCandidate,
  toLifecycleStatus,
  toSuppressionReason,
};
