function detectDeadlineRisk({ intents, now }) {
  const out = [];
  const soonMs = 48 * 60 * 60 * 1000;
  for (const intent of intents || []) {
    if (!intent || intent.status !== 'pending') continue;
    const dueAt = intent.dueAt || intent.time || intent.run;
    if (!dueAt) continue;
    const dueTs = new Date(dueAt).getTime();
    if (!Number.isFinite(dueTs)) continue;
    const delta = dueTs - now.getTime();
    if (delta < 0 || delta > soonMs) continue;
    const hoursLeft = delta / (60 * 60 * 1000);
    const confidence = hoursLeft <= 6 ? 0.93 : hoursLeft <= 24 ? 0.86 : 0.74;
    const urgency = hoursLeft <= 6 ? 'high' : hoursLeft <= 24 ? 'normal' : 'low';
    const subject = (intent.title || intent.description || 'Untitled task').slice(0, 120);
    const hoursLabel = hoursLeft <= 1 ? 'in under an hour' : hoursLeft < 24 ? `in ~${Math.round(hoursLeft)}h` : `in ~${Math.round(hoursLeft / 24)}d`;
    out.push({
      category: 'deadlineRisk',
      confidence,
      urgency,
      subject,
      hoursLabel,
      dedupeKey: `deadline:${String(intent.id || subject).toLowerCase()}`,
      reason: 'pending intent due within 48 hours',
      signalSource: 'deadline.js',
    });
  }
  return out.slice(0, 5);
}

module.exports = {
  detectDeadlineRisk,
};
