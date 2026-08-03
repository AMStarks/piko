function isPhase0LegionEnabled() {
  const v = String(process.env.PIKO_LEGION_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getBearerToken(req) {
  const h = String((req && req.headers && req.headers.authorization) || '').trim();
  if (!h.toLowerCase().startsWith('bearer ')) return '';
  return h.slice(7).trim();
}

function getAcceptedTokens() {
  const tokens = [
    String(process.env.PIKO_LEGION_API_KEY || '').trim(),
    String(process.env.PIKO_LEGION_API_KEY_NEXT || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(tokens));
}

function isAuthorized(req) {
  const expected = getAcceptedTokens();
  if (expected.length === 0) return false;
  const got = getBearerToken(req);
  return !!got && expected.includes(got);
}

function isAllowedOrigin(req) {
  const raw = String(process.env.PIKO_LEGION_ALLOWED_ORIGINS || '').trim();
  if (!raw) return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const host = String((req && req.headers && req.headers.host) || '').trim();
  const origin = String((req && req.headers && req.headers.origin) || '').trim();
  return list.some((allowed) => host.includes(allowed) || origin.includes(allowed));
}

module.exports = {
  isPhase0LegionEnabled,
  isAuthorized,
  isAllowedOrigin,
  getAcceptedTokens,
};
