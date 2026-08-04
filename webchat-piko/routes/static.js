/**
 * Static HTML / MIME / serveFile fall-through (P4.2).
 */

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ico': 'image/x-icon',
};

function serveFile(filePath, contentType) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err);
      resolve({ data, contentType });
    });
  });
}

function registerStaticRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  // Catch-all static fall-through (exact pages resolved inside handler).
  registry.add('GET', '/', wrap(tryHandleStatic), { group: 'static', auth: 'public' });
}

function resolveStaticFile(pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/command-centre' || pathname === '/command-centre/') file = '/command-centre.html';
  if (pathname === '/admin' || pathname === '/admin/') file = '/admin.html';
  if (pathname === '/admin/login' || pathname === '/admin/login/') file = '/admin-login.html';
  if (pathname === '/ios-dashboard' || pathname === '/ios-dashboard/') file = '/piko-ios-dashboard.html';
  if (pathname === '/iphone-dashboard' || pathname === '/iphone-dashboard/') file = '/piko-ios-dashboard.html';
  if (pathname === '/corpus' || pathname === '/corpus/' || pathname === '/culture-corpus' || pathname === '/culture-corpus/') {
    file = '/ei-corpus.html';
  }
  if (pathname === '/ei-eval' || pathname === '/ei-eval/') {
    file = '/ei-eval.html';
  }
  if (pathname === '/hq-dashboard' || pathname === '/hq-dashboard/') file = '/hq-dashboard.html';
  if (pathname === '/dashboard' || pathname === '/dashboard/') file = '/piko-dashboard.html';
  if (pathname === '/piko-dashboard' || pathname === '/piko-dashboard/') file = '/piko-dashboard.html';
  if (pathname === '/control' || pathname === '/control/') file = '/control.html';
  if (pathname === '/control-moltbook' || pathname === '/control-moltbook/') file = '/control-moltbook.html';
  if (pathname === '/control-prompts' || pathname === '/control-prompts/') file = '/control-prompts.html';
  if (pathname === '/control-learning' || pathname === '/control-learning/') file = '/control-learning.html';
  if (pathname === '/control-mind' || pathname === '/control-mind/') file = '/control-mind.html';
  if (pathname === '/control-wisdom' || pathname === '/control-wisdom/') file = '/control-wisdom.html';
  if (pathname === '/control-wisdom-metrics' || pathname === '/control-wisdom-metrics/') file = '/control-wisdom-metrics.html';
  if (pathname === '/control-channels' || pathname === '/control-channels/') file = '/control-channels.html';
  if (pathname === '/control-integrations' || pathname === '/control-integrations/') file = '/control-integrations.html';
  if (pathname === '/control-accounts' || pathname === '/control-accounts/') file = '/control-accounts.html';
  return file;
}

async function tryHandleStatic(req, res, ctx = {}) {
  const { send, pathname, publicDir } = ctx;
  if (req.method !== 'GET') {
    send(res, 405, 'Method Not Allowed', 'text/plain');
    return true;
  }

  const file = resolveStaticFile(pathname || '');
  const filePath = path.join(publicDir, file);
  if (filePath.indexOf(publicDir) !== 0) {
    send(res, 403, 'Forbidden', 'text/plain');
    return true;
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  try {
    const { data } = await serveFile(filePath, contentType);
    send(res, 200, data, contentType);
  } catch (err) {
    if (err.code === 'ENOENT') {
      send(res, 404, 'Not Found', 'text/plain');
      return true;
    }
    send(res, 500, 'Internal Server Error', 'text/plain');
  }
  return true;
}

module.exports = {
  tryHandleStatic,
  registerStaticRoutes,
  serveFile,
  MIME,
  resolveStaticFile,
};
