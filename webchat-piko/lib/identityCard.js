/**
 * Grounded identity / capability card (P2.6a) — never ungrounded persona.
 */
const path = require('path');

function tenantDisplayName(rootDir) {
  try {
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    const p = getTenantBackgroundProfile(rootDir || path.join(__dirname, '..'));
    return p.display_name || p.tenant_id || 'this tenant';
  } catch (_) {
    return String(process.env.PIKO_TENANT_ID || '').trim() || 'this workspace';
  }
}

function capabilityCard(opts = {}) {
  const name = tenantDisplayName(opts.rootDir);
  const lines = [
    'I\'m Piko — a local operator assistant for this workspace.',
    `Tenant: ${name}.`,
    '',
    'What I can do here:',
    '• Research — seek sources, ingest PDFs/URLs, build corpus notes',
    '• Corpus & opinions — answer from ingested material with citations when available',
    '• Campaigns — pause/resume/run the research campaign (operator sessions)',
    '• Status — report campaign progress, recent activity, and job state',
    '',
    'I do not invent capabilities I do not have. Ask for research, an opinion on a corpus topic, campaign control, or status.',
  ];
  return lines.join('\n');
}

function answerIdentityCapability(understanding, opts = {}) {
  const reply = capabilityCard(opts);
  return {
    reply,
    mode: 'answer',
    fallthrough: false,
    inject_campaign_state: false,
    decision: {
      mode: 'answer',
      reply: '',
      lookups: [],
      reason: 'identity_capability',
      source: 'grounded_identity',
      agent_id: null,
      control_action: null,
    },
    understanding: understanding || null,
  };
}

module.exports = {
  capabilityCard,
  answerIdentityCapability,
  tenantDisplayName,
};
