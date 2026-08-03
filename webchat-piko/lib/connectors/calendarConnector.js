const { readJsonFile, writeJsonFile, resolveDataPath } = require('./utils');

function getEvents(ctx) {
  const filePath = resolveDataPath(ctx, 'calendar-snapshot.json');
  const parsed = readJsonFile(filePath, {});
  return Array.isArray(parsed.events) ? parsed.events : [];
}

function saveEvents(ctx, events) {
  const filePath = resolveDataPath(ctx, 'calendar-snapshot.json');
  const parsed = readJsonFile(filePath, {});
  const next = {
    ...parsed,
    events: Array.isArray(events) ? events : [],
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(filePath, next);
  return next;
}

async function status(ctx) {
  const events = getEvents(ctx);
  return {
    connected: events.length > 0,
    source: 'calendar_snapshot',
    eventCount: events.length,
    capabilities: ['status', 'list', 'pull', 'act', 'disconnect'],
  };
}

async function list(ctx, params) {
  const limit = Math.max(1, Math.min(50, parseInt(params && params.limit, 10) || 20));
  const now = Date.now();
  const items = getEvents(ctx)
    .map((e, idx) => ({
      id: String(e.id || e.eventId || `calendar_${idx}`),
      title: String(e.title || e.summary || 'Event'),
      start: e.start || null,
      end: e.end || null,
      location: e.location || null,
    }))
    .filter((e) => !e.start || new Date(e.start).getTime() >= now - (24 * 60 * 60 * 1000))
    .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0))
    .slice(0, limit);
  return { items, source: 'calendar_snapshot' };
}

async function pull(ctx, params) {
  const id = String((params && params.id) || '').trim();
  if (!id) return { item: null, error: 'Missing id' };
  const events = await list(ctx, { limit: 200 });
  const item = events.items.find((e) => e.id === id) || null;
  return { item, source: 'calendar_snapshot' };
}

async function act(ctx, params) {
  const action = String((params && params.action) || '').trim().toLowerCase();
  if (!action) {
    const err = new Error('Missing action');
    err.code = 'INVALID_PARAMS';
    throw err;
  }
  const events = getEvents(ctx);

  if (action === 'create_event') {
    const title = String((params && params.title) || '').trim();
    const start = String((params && params.start) || '').trim();
    const end = String((params && params.end) || '').trim();
    if (!title || !start || !end) {
      const err = new Error('create_event requires title, start, end');
      err.code = 'INVALID_PARAMS';
      throw err;
    }
    const event = {
      id: `manual_${Date.now()}`,
      title: title.slice(0, 160),
      start,
      end,
      location: params && params.location ? String(params.location).slice(0, 200) : null,
      source: 'connector_act',
    };
    events.push(event);
    saveEvents(ctx, events);
    return { ok: true, action, item: event, message: 'calendar event created in snapshot store' };
  }

  if (action === 'snooze_reminder') {
    const id = String((params && params.id) || '').trim();
    const minutes = Math.max(1, Math.min(24 * 60, parseInt(params && params.minutes, 10) || 30));
    if (!id) {
      const err = new Error('snooze_reminder requires id');
      err.code = 'INVALID_PARAMS';
      throw err;
    }
    const idx = events.findIndex((e, i) => String(e.id || e.eventId || `calendar_${i}`) === id);
    if (idx === -1) {
      const err = new Error('Calendar event not found');
      err.code = 'INVALID_PARAMS';
      throw err;
    }
    const currentStart = new Date(events[idx].start || Date.now());
    const currentEnd = new Date(events[idx].end || currentStart.getTime() + 60 * 60 * 1000);
    const delta = minutes * 60 * 1000;
    events[idx] = {
      ...events[idx],
      start: new Date(currentStart.getTime() + delta).toISOString(),
      end: new Date(currentEnd.getTime() + delta).toISOString(),
      snoozedByMinutes: minutes,
      source: 'connector_act',
    };
    saveEvents(ctx, events);
    return { ok: true, action, item: events[idx], message: `calendar event snoozed by ${minutes}m` };
  }

  const err = new Error(`Unsupported calendar action: ${action}`);
  err.code = 'INVALID_PARAMS';
  throw err;
}

async function disconnect(ctx) {
  saveEvents(ctx, []);
  return {
    ok: true,
    disconnected: true,
    message: 'Calendar snapshot cache cleared',
  };
}

module.exports = {
  id: 'calendar',
  status,
  list,
  pull,
  act,
  disconnect,
};
