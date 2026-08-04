/**
 * Channel allowlist — fail closed for non-webchat sources (P0.3).
 * Opt into open channels with PIKO_CHANNEL_ALLOWLIST_OPEN=1.
 */

function isChannelAllowlistOpen() {
  const v = String(process.env.PIKO_CHANNEL_ALLOWLIST_OPEN || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
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
  isChannelAllowlistOpen,
  isAllowedByAllowlist,
};
