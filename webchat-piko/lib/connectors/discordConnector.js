const { readJsonFile, writeJsonFile, resolveDataPath } = require('./utils');

function readDiscordCache(ctx) {
  const filePath = resolveDataPath(ctx, 'discord-state.json');
  const parsed = readJsonFile(filePath, {});
  const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
  return channels.map((c, idx) => ({
    id: String(c.id || `discord_${idx}`),
    name: String(c.name || c.channel || 'channel'),
    lastMessageAt: c.lastMessageAt || null,
  }));
}

async function status(ctx) {
  const env = ctx.env || {};
  return {
    connected: !!(env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN),
    cacheItems: readDiscordCache(ctx).length,
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
  };
}

async function list(ctx, params) {
  const limit = Math.max(1, Math.min(50, parseInt(params && params.limit, 10) || 20));
  return { items: readDiscordCache(ctx).slice(0, limit), source: 'discord_cache' };
}

async function pull(ctx, params) {
  const id = String((params && params.id) || '').trim();
  if (!id) return { item: null, error: 'Missing id' };
  const item = readDiscordCache(ctx).find((i) => i.id === id) || null;
  return { item, source: 'discord_cache' };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  if (action !== 'post_message') {
    const err = new Error(`Unsupported discord action: ${action}`);
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const channelId = String((params && (params.channelId || params.id || params.channel)) || '').trim();
  const text = String((params && (params.text || params.message)) || '').trim();
  if (!channelId || !text) {
    const err = new Error('post_message requires channelId and text');
    err.code = 'INVALID_PARAMS';
    throw err;
  }

  const filePath = resolveDataPath(ctx, 'discord-state.json');
  const parsed = readJsonFile(filePath, {});
  const channels = Array.isArray(parsed.channels) ? parsed.channels.slice() : [];
  const nowIso = new Date().toISOString();
  const idx = channels.findIndex((c) => String(c.id || '') === channelId);
  if (idx === -1) {
    channels.push({ id: channelId, name: channelId, lastMessageAt: nowIso, lastMessage: text.slice(0, 500) });
  } else {
    channels[idx] = {
      ...channels[idx],
      lastMessageAt: nowIso,
      lastMessage: text.slice(0, 500),
    };
  }
  writeJsonFile(filePath, {
    ...parsed,
    channels,
    updatedAt: nowIso,
  });
  return {
    ok: true,
    action,
    channelId,
    message: 'discord message queued in local connector state',
    transport: 'local_cache',
  };
}

async function disconnect(ctx) {
  const filePath = resolveDataPath(ctx, 'discord-state.json');
  const parsed = readJsonFile(filePath, {});
  writeJsonFile(filePath, {
    ...parsed,
    channels: [],
    updatedAt: new Date().toISOString(),
  });
  return {
    ok: true,
    disconnected: true,
    message: 'Discord cache cleared',
  };
}

module.exports = {
  id: 'discord',
  status,
  list,
  pull,
  act,
  disconnect,
};
