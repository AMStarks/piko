/**
 * Grounded identity / capability card (P2.6a) — never ungrounded persona.
 * Pack override via ontology capabilityCard; hardcoded lines remain the fallback.
 */
const path = require('path');

const DEFAULT_CAPABILITY_CARD_LINES = [
  'I\'m Piko — a local operator assistant for this workspace.',
  'Tenant: {{tenant}}.',
  '',
  'What I can do here:',
  '• Research — seek sources, ingest PDFs/URLs, build corpus notes',
  '• Corpus & opinions — answer from ingested material with citations when available',
  '• Campaigns — pause/resume/run the research campaign (operator sessions)',
  '• Status — report campaign progress, recent activity, and job state',
  '',
  'I do not invent capabilities I do not have. Ask for research, an opinion on a corpus topic, campaign control, or status.',
];

function tenantDisplayName(rootDir) {
  try {
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    const p = getTenantBackgroundProfile(rootDir || path.join(__dirname, '..'));
    return p.display_name || p.tenant_id || 'this tenant';
  } catch (err) {
    return String(process.env.PIKO_TENANT_ID || '').trim() || 'this workspace';
  }
}

function defaultCapabilityCardText(tenantName) {
  const name = String(tenantName || 'this workspace');
  return DEFAULT_CAPABILITY_CARD_LINES.join('\n').split('{{tenant}}').join(name);
}

function capabilityCard(opts = {}) {
  const name = tenantDisplayName(opts.rootDir);
  try {
    const { getPackCapabilityCard, applyTenantPlaceholder } = require('./ontologyPack');
    const packCard = getPackCapabilityCard(opts.rootDir);
    if (packCard && packCard.text) {
      return applyTenantPlaceholder(packCard.text, name);
    }
  } catch (err) {
    // fall through to hardcoded card
  }
  return defaultCapabilityCardText(name);
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
  DEFAULT_CAPABILITY_CARD_LINES,
  defaultCapabilityCardText,
};
