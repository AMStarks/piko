/**
 * Allowlist for chat markdown links. Only http(s) and same-origin relative paths.
 */
function isSafeChatHref(raw) {
  const href = String(raw || '').trim();
  if (!href) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

module.exports = { isSafeChatHref };
