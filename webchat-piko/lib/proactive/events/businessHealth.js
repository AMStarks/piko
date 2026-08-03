/**
 * Business health — runs unified business health review.
 * Same handler as on-demand chat; only emits when analyst finds an anomaly (not NO_ACTION).
 */
const { isContextFresh } = require('../../sharedContext');
const { runBusinessHealthReview } = require('../analyst');

const {
  slugify,
} = require('../../text');

async function detectBusinessHealth({ dataDir, now }) {
  if (!isContextFresh(dataDir)) return [];
  const out = await runBusinessHealthReview(dataDir);
  if (out.action !== 'alert' || !out.anomaly) return [];
  const a = out.anomaly;
  const summary = String(a.summary || a.detail || 'Business anomaly detected').slice(0, 120);
  const severity = (a.severity || 'normal').toLowerCase();
  const urgency = severity === 'high' ? 'high' : severity === 'low' ? 'low' : 'normal';
  const type = String(a.type || 'unknown').slice(0, 40);
  return [
    {
      category: 'businessHealth',
      eventType: 'businessHealth',
      confidence: 0.85,
      urgency,
      subject: summary,
      dedupeKey: `business:${type}:${slugify(summary.slice(0, 40))}`,
      reason: 'Analyst flagged business forecast/sales anomaly',
      signalSource: 'businessHealth.js',
      anomalyType: type,
      anomalyDetail: a.detail,
      anomaly: a,
    },
  ];
}

module.exports = {
  detectBusinessHealth,
};
