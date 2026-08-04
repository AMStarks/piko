/**
 * Chat HTTP routes (P3.1b) — history/inject + dispatch into handleApiChat.
 * handleApiChat is injected from server.js via createHandleApiChat (lib/chatPipeline.js).
 */
function registerChatRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('POST', '/api/chat', wrap(tryHandleChat), { group: 'chat', auth: 'api_auth' });
  registry.add('GET', '/api/chat/history', wrap(tryHandleChat), { group: 'chat', auth: 'api_auth' });
  registry.add('DELETE', '/api/chat/history', wrap(tryHandleChat), { group: 'chat', auth: 'api_auth' });
  registry.add('POST', '/api/chat/inject', wrap(tryHandleChat), { group: 'chat', auth: 'admin_session' });
}

function isChatPath(pathname) {
  return pathname === '/api/chat'
    || pathname === '/api/chat/history'
    || pathname === '/api/chat/inject'
    || pathname.startsWith('/api/chat/');
}

async function tryHandleChat(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isChatPath(pathname)) return false;
  const {
    send, readBody, sessionStore, isAutomationSession, parseUrl, adminAuth, handleApiChat,
  } = ctx;

  if (req.method === 'POST' && pathname === '/api/chat') {
    await handleApiChat(req, res);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/chat/history') {
    try {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = String(u.searchParams.get('sessionId') || u.searchParams.get('session_id') || '').trim();
      const automationSession = isAutomationSession(sessionId);
      const key = automationSession
        ? (sessionId || 'automation')
        : (process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main');
      const { resolvePrincipal, assertSessionAccess, principalId } = require('../lib/sessionOwner');
      const principal = resolvePrincipal(req, {
        dataDir: ctx.DATA_DIR || process.env.PIKO_DATA_DIR,
        query: Object.fromEntries(u.searchParams.entries()),
      });
      const access = assertSessionAccess(key, principal, {
        req,
        query: Object.fromEntries(u.searchParams.entries()),
        sessionStore,
      });
      if (!access.ok) {
        return send(res, access.status || 403, JSON.stringify({ ok: false, error: access.error }));
      }
      // Stamp principal on first access for new empty sessions.
      sessionStore.ensureSessionMeta(key, principalId(principal));
      const history = sessionStore.getHistory(key) || [];
      send(res, 200, JSON.stringify({
        ok: true,
        sessionId: key,
        count: history.length,
        max: sessionStore.MAX_HISTORY,
        messages: history,
      }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'history failed' }));
    }
    return true;
  }

  if (req.method === 'DELETE' && pathname === '/api/chat/history') {
    try {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = String(u.searchParams.get('sessionId') || u.searchParams.get('session_id') || '').trim();
      const automationSession = isAutomationSession(sessionId);
      const key = automationSession
        ? (sessionId || 'automation')
        : (process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main');
      const { resolvePrincipal, assertSessionAccess } = require('../lib/sessionOwner');
      const principal = resolvePrincipal(req, {
        dataDir: ctx.DATA_DIR || process.env.PIKO_DATA_DIR,
        query: Object.fromEntries(u.searchParams.entries()),
      });
      const access = assertSessionAccess(key, principal, {
        req,
        query: Object.fromEntries(u.searchParams.entries()),
        sessionStore,
      });
      if (!access.ok) {
        return send(res, access.status || 403, JSON.stringify({ ok: false, error: access.error }));
      }
      sessionStore.clear(key);
      send(res, 200, JSON.stringify({ ok: true, sessionId: key, cleared: true }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'clear failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/chat/inject') {
    readBody(req)
      .then((body) => {
        let json;
        try {
          json = JSON.parse(body || '{}');
        } catch (_) {
          return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
        }
        const { query: q } = parseUrl(req.url);
        try {
          const { keyMatches, presentedKey } = require('../lib/apiAuth');
          const hasKey = keyMatches(presentedKey(req, q));
          if (!adminAuth.isEnabled() && !hasKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
        } catch (_) {
          if (!adminAuth.isEnabled()) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
        }
        const sessionId = String(json.sessionId || json.session_id || '').trim();
        const role = String(json.role || 'assistant').trim().toLowerCase();
        const content = json.content;
        if (!sessionId || typeof content !== 'string') {
          return send(res, 400, JSON.stringify({ error: 'Missing sessionId or content' }));
        }
        if (role !== 'user' && role !== 'assistant') {
          return send(res, 400, JSON.stringify({ error: 'role must be user or assistant' }));
        }
        const { resolvePrincipal, assertSessionAccess, principalId } = require('../lib/sessionOwner');
        const principal = resolvePrincipal(req, {
          dataDir: ctx.DATA_DIR || process.env.PIKO_DATA_DIR,
          query: q,
        });
        const access = assertSessionAccess(sessionId, principal, {
          req,
          query: q,
          sessionStore,
        });
        if (!access.ok) {
          return send(res, access.status || 403, JSON.stringify({ ok: false, error: access.error }));
        }
        const ok = sessionStore.append(sessionId, role, content.slice(0, 10000), {
          owner: principalId(principal),
        });
        try {
          const { recordNotification } = require('../lib/notificationFeed');
          recordNotification({
            category: 'system',
            severity: 'info',
            source: 'chat_inject',
            title: 'Chat inject',
            text: `Injected ${role} message into session ${sessionId.slice(0, 64)} (${String(content).length} chars)`,
            meta: { session_id: sessionId.slice(0, 128), role },
          });
        } catch (_) { /* optional */ }
        if (process.env.PIKO_LOG_PLANNER === '1') {
          console.log('[MEMORY] Injected', role, 'vision context into session', sessionId.slice(0, 30));
        }
        return send(res, 200, JSON.stringify({ success: !!ok }));
      })
      .catch((e) => {
        console.error('[MEMORY INJECTION]', e.message);
        return send(res, 500, JSON.stringify({ error: 'Failed to inject memory' }));
      });
    return true;
  }

  return false;
}

module.exports = {
  tryHandleChat,
  registerChatRoutes,
  isChatPath,
};
