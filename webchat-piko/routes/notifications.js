/**
 * Notifications / pending feed routes (P4.2).
 */

function registerNotificationsRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/notifications/recent', wrap(handleNotificationsRecent), { group: 'notifications', auth: 'open' });
  registry.add('GET', '/api/pending', wrap(handlePending), { group: 'notifications', auth: 'open' });
}

function isNotificationsPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/notifications/recent' || p === '/api/pending';
}

async function tryHandleNotifications(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'GET' || !isNotificationsPath(pathname)) return false;
  if (pathname === '/api/notifications/recent') return handleNotificationsRecent(req, res, ctx);
  if (pathname === '/api/pending') return handlePending(req, res, ctx);
  return false;
}

async function handleNotificationsRecent(req, res, ctx) {
  const { send } = ctx;
  try {
    const u = new URL(req.url, 'http://localhost');
    const limit = Math.min(100, Math.max(1, parseInt(u.searchParams.get('limit') || '40', 10) || 40));
    const { readMergedNotifications, getCategoryMeta } = require('../lib/notificationFeed');
    const { polishNotificationText } = require('../lib/operatorVoice');
    const items = readMergedNotifications(limit).map((n) => ({
      ...n,
      text: polishNotificationText(n.text),
    }));
    send(res, 200, JSON.stringify({
      ok: true,
      items,
      categories: getCategoryMeta(),
    }));
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notifications failed' }));
  }
  return true;
}

async function handlePending(req, res, ctx) {
  const { send, fs, pendingNotificationsFile } = ctx;
  let pending = [];
  try {
    const raw = fs.readFileSync(pendingNotificationsFile, 'utf8');
    pending = raw.split('\n').filter(Boolean);
    fs.writeFileSync(pendingNotificationsFile, '', 'utf8');
  } catch (_) { /* empty */ }
  send(res, 200, JSON.stringify({ pending }));
  return true;
}

module.exports = {
  tryHandleNotifications,
  registerNotificationsRoutes,
  isNotificationsPath,
};
