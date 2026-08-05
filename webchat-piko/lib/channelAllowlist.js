/**
 * Channel allowlist — fail closed for non-webchat sources (P0.3).
 * Opt into open channels with PIKO_CHANNEL_ALLOWLIST_OPEN=1.
 */

/** Real messaging / app channels. Browser UUIDs and other opaque ids are webchat. */
const CHANNEL_SOURCES = new Set([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'ios',
  'bluebubbles',
  'imessage',
]);

function isChannelAllowlistOpen() {
  const v = String(process.env.PIKO_CHANNEL_ALLOWLIST_OPEN || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Derive source + externalId from sessionId.
 * Only known channel prefixes (telegram-123, ios-main, …) are non-webchat.
 * Browser UUID sessions (a1b2c3d4-e5f6-…) must stay webchat — splitting on the
 * first hyphen falsely invents a channel and 403s real WebChat users.
 *
 * @param {string} sessionId
 * @returns {{ source: string, externalId: string|null }}
 */
function parseSessionSource(sessionId) {
  if (!sessionId || sessionId === 'default' || sessionId === 'main') {
    return { source: 'webchat', externalId: null };
  }
  const sid = String(sessionId);
  const idx = sid.indexOf('-');
  if (idx <= 0) return { source: 'webchat', externalId: null };
  const source = sid.slice(0, idx).toLowerCase();
  if (!CHANNEL_SOURCES.has(source)) {
    return { source: 'webchat', externalId: null };
  }
  return { source, externalId: sid.slice(idx + 1) };
}

/**
 * @param {object} allowlist - { discord: [...], slack: [...], ... }
 * @param {string} source
 * @param {string} externalId
 */
function isAllowedByAllowlist(allowlist, source, externalId) {
  if (source === 'webchat') return true;
  const list = allowlist && allowlist[source];
  if (!list || !Array.isArray(list)) {
    return isChannelAllowlistOpen();
  }
  if (list.length === 0) return false;
  if (list.includes('*')) return true;
  return list.includes(String(externalId));
}

module.exports = {
  CHANNEL_SOURCES,
  isChannelAllowlistOpen,
  isAllowedByAllowlist,
  parseSessionSource,
};
