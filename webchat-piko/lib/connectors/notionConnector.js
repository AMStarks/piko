const { readJsonFile, writeJsonFile, resolveDataPath } = require('./utils');

function readNotionCache(ctx) {
  const filePath = resolveDataPath(ctx, 'notion-cache.json');
  const parsed = readJsonFile(filePath, {});
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  return pages.map((p, idx) => ({
    id: String(p.id || `notion_${idx}`),
    title: String(p.title || p.name || 'Untitled'),
    lastEdited: p.lastEdited || p.last_edited_time || null,
    url: p.url || null,
  }));
}

function writeNotionCache(ctx, pages) {
  const filePath = resolveDataPath(ctx, 'notion-cache.json');
  const parsed = readJsonFile(filePath, {});
  writeJsonFile(filePath, {
    ...parsed,
    pages: Array.isArray(pages) ? pages : [],
    updatedAt: new Date().toISOString(),
  });
}

async function status(ctx) {
  const env = ctx.env || {};
  const linked = ctx.linkedAccounts || {};
  const items = readNotionCache(ctx);
  const connected = !!(env.NOTION_TOKEN || env.NOTION_API_KEY || linked.notion);
  return {
    connected,
    account: linked.notion || null,
    cacheItems: items.length,
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
  };
}

async function list(ctx, params) {
  const limit = Math.max(1, Math.min(50, parseInt(params && params.limit, 10) || 20));
  return { items: readNotionCache(ctx).slice(0, limit), source: 'notion_cache' };
}

async function pull(ctx, params) {
  const id = String((params && params.id) || '').trim();
  if (!id) return { item: null, error: 'Missing id' };
  const item = readNotionCache(ctx).find((i) => i.id === id) || null;
  return { item, source: 'notion_cache' };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (action !== 'append_note') {
    const err = new Error(`Unsupported notion action: ${action}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const title = String((params && params.title) || '').trim() || 'Quick note';
  const content = String((params && params.content) || '').trim();
  if (!content) {
    const err = new Error('append_note requires content');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const filePath = resolveDataPath(ctx, 'notion-cache.json');
  const parsed = readJsonFile(filePath, {});
  const pages = Array.isArray(parsed.pages) ? parsed.pages.slice() : [];
  const note = {
    id: `manual_${Date.now()}`,
    title: title.slice(0, 160),
    content: content.slice(0, 4000),
    createdAt: new Date().toISOString(),
    source: 'connector_act',
    url: null,
  };
  pages.unshift(note);
  writeNotionCache(ctx, pages.slice(0, 200));
  return {
    ok: true,
    action,
    item: note,
    message: 'notion note appended to local cache',
  };
}

async function disconnect(ctx) {
  writeNotionCache(ctx, []);
  return {
    ok: true,
    disconnected: true,
    message: 'Notion cache cleared',
  };
}

module.exports = {
  id: 'notion',
  status,
  list,
  pull,
  act,
  disconnect,
};
