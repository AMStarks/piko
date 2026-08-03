const { readEaAlerts } = require('./utils');

function detectSecurityAlerts({ dataDir, now }) {
  const cutoff = now.getTime() - (6 * 60 * 60 * 1000);
  const alerts = readEaAlerts(dataDir).filter((a) => {
    const ts = a && a.at ? Number(a.at) : NaN;
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const hit = alerts.find((a) => {
    const sev = String(a.severity || a.level || '').toLowerCase();
    const cat = String(a.category || '').toLowerCase();
    return sev === 'high' || sev === 'critical' || cat.includes('security');
  });
  if (!hit) return [];
  const label = String(hit.title || hit.message || hit.reason || 'Recent high-severity event').slice(0, 140);
  return [{
    category: 'securityAlerts',
    confidence: 0.95,
    urgency: 'high',
    subject: label,
    dedupeKey: `security:${label.toLowerCase()}`,
    reason: 'high/critical security event in recent EA alerts',
    signalSource: 'securityAlerts.js',
  }];
}

module.exports = {
  detectSecurityAlerts,
};
