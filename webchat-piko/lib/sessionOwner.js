/**
 * Session ownership (P3.3c) — bind history read/clear/inject to a principal.
 * Existing sessions without meta are stamped owner=operator (additive).
 */
const { keyMatches, presentedKey } = require('./apiAuth');

function principalId(principal) {
  if (!principal || typeof principal !== 'object') return 'operator';
  const kind = String(principal.kind || 'operator').trim() || 'operator';
  const id = String(principal.id || 'operator').trim() || 'operator';
  return `${kind}:${id}`;
}

/**
 * Resolve the authenticated principal for a request.
 * Admin session wins; else API key; else operator (legacy / channel).
 */
function resolvePrincipal(req, opts = {}) {
  const dataDir = opts.dataDir;
  const query = opts.query || {};
  try {
    const adminAuth = require('./adminAuth');
    if (adminAuth.isEnabled() && dataDir) {
      const session = adminAuth.getSessionFromRequest(req, dataDir);
      if (session && session.username) {
        return { kind: 'admin', id: String(session.username) };
      }
    }
  } catch (_) { /* ok */ }
  try {
    if (keyMatches(presentedKey(req, query))) {
      return { kind: 'api_key', id: 'shared' };
    }
  } catch (_) { /* ok */ }
  if (opts.channelIdentity) {
    return { kind: 'channel', id: String(opts.channelIdentity).slice(0, 128) };
  }
  return { kind: 'operator', id: 'operator' };
}

function operatorOverrideAllowed(req, query, principal) {
  const env = String(process.env.PIKO_SESSION_OWNER_OVERRIDE || '').trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'on') return true;
  const flag = String((query && (query.operator_override || query.operator)) || '').trim();
  if (flag === '1' || flag.toLowerCase() === 'true') {
    return !!(principal && principal.kind === 'admin');
  }
  return false;
}

/**
 * @returns {{ ok: true, owner: string } | { ok: false, status: number, error: string }}
 */
function assertSessionAccess(sessionId, principal, opts = {}) {
  const sessionStore = opts.sessionStore || require('./sessionStore');
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, status: 400, error: 'Missing sessionId' };

  const want = principalId(principal);
  const unified = String(process.env.PIKO_UNIFIED_SESSION_ID || 'main').trim() || 'main';
  // Shared operator / automation sessions: any authenticated principal may access.
  if (sid === unified || sid === 'main' || sid === 'automation'
    || sid.startsWith('automation') || sid.startsWith('eval-gate')) {
    sessionStore.ensureSessionMeta(sid, 'operator:operator');
    return { ok: true, owner: 'operator:operator', shared: true };
  }

  let meta = typeof sessionStore.getSessionMeta === 'function'
    ? sessionStore.getSessionMeta(sid)
    : null;
  if (!meta) {
    // Legacy rows (messages, no meta) → owner=operator; brand-new → current principal.
    let hasHistory = false;
    try {
      const hist = sessionStore.getHistory(sid) || [];
      hasHistory = hist.length > 0;
    } catch (_) { /* ok */ }
    const stamp = hasHistory ? 'operator:operator' : want;
    meta = sessionStore.ensureSessionMeta(sid, stamp);
  }
  const owner = String((meta && meta.owner) || want);

  if (owner === want) return { ok: true, owner };

  if (operatorOverrideAllowed(opts.req, opts.query, principal)) {
    try {
      require('./logger').log('warn', 'session_owner_override', {
        tag: 'session_owner_override',
        session_id: sid.slice(0, 128),
        owner,
        principal: want,
      });
    } catch (_) {
      console.warn('[sessionOwner] override', sid.slice(0, 40), owner, '→', want);
    }
    return { ok: true, owner, override: true };
  }

  try {
    require('./opsMetrics').recordSessionForbidden({ session_id: sid.slice(0, 64), owner, principal: want });
  } catch (_) { /* ok */ }
  return { ok: false, status: 403, error: 'session_forbidden' };
}

module.exports = {
  principalId,
  resolvePrincipal,
  assertSessionAccess,
  operatorOverrideAllowed,
};
