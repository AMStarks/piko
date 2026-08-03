function detectProjectGap({ intents, now }) {
  const pending = (intents || []).filter((i) => i && i.status === 'pending');
  if (pending.length < 6) return [];
  let oldest = null;
  for (const item of pending) {
    const ts = new Date(item.createdAt || item.updatedAt || now).getTime();
    if (!Number.isFinite(ts)) continue;
    if (oldest == null || ts < oldest) oldest = ts;
  }
  const ageDays = oldest == null ? 0 : (now.getTime() - oldest) / (24 * 60 * 60 * 1000);
  if (ageDays < 3) return [];
  const confidence = ageDays >= 7 ? 0.86 : 0.72;
  const urgency = ageDays >= 7 ? 'normal' : 'low';
  return [{
    category: 'projectGap',
    confidence,
    urgency,
    subject: `${pending.length} pending tasks, oldest open ${Math.floor(ageDays)}d`,
    dedupeKey: 'projectGap:pendingBacklog',
    reason: 'pending backlog exceeds threshold and is aging',
    signalSource: 'projectGap.js',
  }];
}

module.exports = {
  detectProjectGap,
};
