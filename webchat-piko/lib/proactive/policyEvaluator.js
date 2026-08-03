const {
  parseHhMm,
} = require('../text');

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function numberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseHourMinute(value, fallbackHour, fallbackMinute) {
  const src = String(value || '').trim();
  const __hh = parseHhMm(src);
  const m = __hh ? [null, String(__hh.h), String(__hh.m).padStart(2, '0')] : null;
  if (!m) return { h: fallbackHour, m: fallbackMinute };
  return {
    h: clamp(parseInt(m[1], 10), 0, 23),
    m: clamp(parseInt(m[2], 10), 0, 59),
  };
}

function isInQuietHours(now, quietHours) {
  const start = parseHourMinute(quietHours && quietHours.start, 23, 0);
  const end = parseHourMinute(quietHours && quietHours.end, 6, 0);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = start.h * 60 + start.m;
  const endMinutes = end.h * 60 + end.m;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function underRateLimits(runtime, policy, now) {
  const perDay = numberOr(policy && policy.limits && policy.limits.perDay, 4);
  const perHour = numberOr(policy && policy.limits && policy.limits.perHour, 1);
  const hourCutoff = now.getTime() - (60 * 60 * 1000);
  const dayCutoff = now.getTime() - (24 * 60 * 60 * 1000);
  let hourCount = 0;
  let dayCount = 0;
  for (const d of runtime.deliveries || []) {
    const ts = Number(d.at || 0);
    if (!Number.isFinite(ts)) continue;
    if (ts >= hourCutoff) hourCount += 1;
    if (ts >= dayCutoff) dayCount += 1;
  }
  return {
    allowed: hourCount < perHour && dayCount < perDay,
    hourCount,
    dayCount,
    perHour,
    perDay,
  };
}

function isSuppressedByDedupe(runtime, dedupeKey, now, suppressionHours) {
  const since = now.getTime() - suppressionHours * 60 * 60 * 1000;
  return (runtime.keyHistory || []).some((h) => h && h.key === dedupeKey && Number(h.at || 0) >= since);
}

function isSuppressedByAck(runtime, dedupeKey, now, suppressionHours) {
  const since = now.getTime() - suppressionHours * 60 * 60 * 1000;
  return (runtime.ackHistory || []).some((h) => h && h.key === dedupeKey && Number(h.at || 0) >= since);
}

function isSuppressedByAckCategory(runtime, category, now, suppressionHours) {
  const since = now.getTime() - suppressionHours * 60 * 60 * 1000;
  return (runtime.ackHistory || []).some((h) => {
    if (!h || String(h.category || '') !== category) return false;
    const ts = Number(h.at || 0);
    return Number.isFinite(ts) && ts >= since;
  });
}

function evaluatePolicy(input) {
  const src = input && typeof input === 'object' ? input : {};
  const now = src.now instanceof Date ? src.now : new Date();
  const policy = src.policy && typeof src.policy === 'object' ? src.policy : {};
  const runtime = src.runtime && typeof src.runtime === 'object' ? src.runtime : {};
  const candidate = src.candidate && typeof src.candidate === 'object' ? src.candidate : {};
  const urgentSentThisRun = Number(src.urgentSentThisRun || 0);

  const confidence = clamp(Number(candidate.confidence || 0), 0, 1);
  const dedupeKey = String(candidate.dedupeKey || '').toLowerCase();
  const category = String(candidate.eventType || '');
  const urgency = String(candidate.urgency || 'normal');
  const dedupeHours = numberOr(policy.limits && policy.limits.duplicateSuppressionHours, 24);
  const categoryCooldownHours = numberOr(policy.limits && policy.limits.perCategoryCooldownHours, 6);
  const ackThreadSuppressionHours = numberOr(policy.limits && policy.limits.perThreadCooldownHours, dedupeHours);
  const ackCategorySuppressionHours = numberOr(policy.limits && policy.limits.ackCategorySuppressionHours, 2);
  const draftThreshold = numberOr(policy.thresholds && policy.thresholds.draft, 0.65);

  if (isSuppressedByDedupe(runtime, dedupeKey, now, dedupeHours)) {
    return { allowed: false, decision: 'suppressed_dedupe', forceDraft: false };
  }
  if (isSuppressedByAck(runtime, dedupeKey, now, ackThreadSuppressionHours)) {
    return { allowed: false, decision: 'suppressed_ack', forceDraft: false };
  }
  if (isSuppressedByAckCategory(runtime, category, now, ackCategorySuppressionHours)) {
    return { allowed: false, decision: 'suppressed_ack_category', forceDraft: false };
  }

  const categoryRecent = (runtime.keyHistory || []).find((h) => {
    if (!h || h.category !== category) return false;
    const ts = Number(h.at || 0);
    if (!Number.isFinite(ts)) return false;
    return ts >= now.getTime() - categoryCooldownHours * 60 * 60 * 1000;
  });
  if (categoryRecent) {
    return { allowed: false, decision: 'suppressed_category_cooldown', forceDraft: false };
  }

  const limits = underRateLimits(runtime, policy, now);
  if (!limits.allowed) {
    return { allowed: false, decision: 'suppressed_rate_limit', limits, forceDraft: false };
  }

  if (confidence < draftThreshold) {
    return { allowed: false, decision: 'skipped_low_confidence', forceDraft: false };
  }

  const quietHours = policy.quietHours || {};
  const quietHoursActive = isInQuietHours(now, quietHours);
  const maxUrgentPerNight = numberOr(quietHours.maxUrgentPerNight, 2);
  let forceDraft = false;
  if (quietHoursActive) {
    if (quietHours.draftOnly) forceDraft = true;
    if (quietHours.onlyHighUrgency && urgency !== 'high') forceDraft = true;
    if (urgency === 'high' && urgentSentThisRun >= maxUrgentPerNight) forceDraft = true;
  }

  return {
    allowed: true,
    decision: 'allowed',
    limits,
    forceDraft,
    quietHoursActive,
  };
}

module.exports = {
  evaluatePolicy,
};
