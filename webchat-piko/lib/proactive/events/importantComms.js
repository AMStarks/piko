const { readEaAlerts } = require('./utils');

function detectImportantComms({ dataDir, now }) {
  const alerts = readEaAlerts(dataDir);
  const recent = alerts.filter((a) => {
    const ts = a && a.at ? Number(a.at) : NaN;
    return Number.isFinite(ts) && ts >= now.getTime() - (4 * 60 * 60 * 1000);
  });
  const hit = recent.find((a) => String(a.category || '').toLowerCase().includes('email')
    || String(a.category || '').toLowerCase().includes('gmail'));
  if (!hit) return [];
  const subject = String(hit.title || hit.message || 'Priority message needs review').slice(0, 140);
  return [{
    category: 'importantComms',
    confidence: 0.78,
    urgency: 'normal',
    subject,
    dedupeKey: `comms:${subject.toLowerCase()}`,
    reason: 'recent email-related EA alert',
    signalSource: 'importantComms.js',
  }];
}

module.exports = {
  detectImportantComms,
};
