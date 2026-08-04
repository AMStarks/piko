/**
 * Widget / iOS dashboard routes (P4.2).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function registerDashboardRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/widget', wrap(handleWidget), { group: 'dashboard', auth: 'open' });
  registry.add('GET', '/api/ios-dashboard', wrap(handleIosDashboard), { group: 'dashboard', auth: 'open' });
}

function isDashboardPath(pathname) {
  const p = String(pathname || '');
  return p === '/api/widget' || p === '/api/ios-dashboard';
}

async function tryHandleDashboard(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'GET' || !isDashboardPath(pathname)) return false;

  if (pathname === '/api/widget') {
    return handleWidget(req, res, ctx);
  }

  if (pathname === '/api/ios-dashboard') {
    return handleIosDashboard(req, res, ctx);
  }

  return false;
}

async function handleWidget(req, res, ctx) {
  const {
    send, learningDir, dataDir, loadIntents, splitLines, toWidgetPayload,
  } = ctx;
  const widget = { tensions: 0, nextReminder: null, moltbook: null };
  const generatedAt = new Date().toISOString();
  try {
    const tensionsPath = path.join(learningDir, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      widget.tensions = splitLines(raw).filter((l) => { const t = l.trim(); return t.startsWith('- '); }).length;
    }
    const intents = loadIntents();
    const now = new Date();
    const reminders = (Array.isArray(intents) ? intents : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
    const dueAt = (r) => r.dueAt || r.time;
    const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
    if (next) widget.nextReminder = (next.title || next.message || next.text || '').slice(0, 60);
    const moltbookPath = path.join(dataDir, 'moltbook-state.json');
    if (fs.existsSync(moltbookPath)) {
      const data = JSON.parse(fs.readFileSync(moltbookPath, 'utf8'));
      const last = (data.posts || [])[0];
      widget.moltbook = last && last.upvotes != null ? String(last.upvotes) + ' upvotes' : null;
    }
  } catch (_) {}
  send(res, 200, JSON.stringify(toWidgetPayload(widget, {
    generatedAt,
    refreshAfterSec: 300,
  })));
  return true;
}

async function handleIosDashboard(req, res, ctx) {
  const {
    send, learningDir, dataDir, loadIntents, splitLines, splitMarkdownH2,
    startsWithYyyyMmDd, eaAlertsFile, toIosDashboardPayload, log,
  } = ctx;
  const dashboard = {
    learning: {},
    nextReminder: null,
    moltbookLast: null,
    contextHint: null,
    freeSlot: null,
    ea: null,
    rabbitHole: null,
    calendarTodayCount: null,
    remindersPendingCount: null,
    tensionsUpdatedDaysAgo: null,
    gpuTemps: null,
  };
  try {
    const tensionsPath = path.join(learningDir, 'tensions.md');
    const stickyPath = path.join(learningDir, 'sticky-ideas.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#') && !l.toLowerCase().startsWith('- max '));
      dashboard.learning.tensionsCount = lines.length;
      dashboard.learning.firstTension = lines[0] ? lines[0].slice(2).trim().slice(0, 80) : null;
      try { const stat = fs.statSync(tensionsPath); dashboard.tensionsUpdatedDaysAgo = Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)); } catch (_) {}
    } else {
      dashboard.learning.tensionsCount = 0;
      dashboard.learning.firstTension = null;
    }
    if (fs.existsSync(stickyPath)) {
      const raw = fs.readFileSync(stickyPath, 'utf8');
      const lines = splitLines(raw).map((l) => l.trim()).filter((l) => l.startsWith('- ') && !l.startsWith('#'));
      dashboard.learning.stickyCount = lines.length;
      dashboard.learning.firstSticky = lines[0] ? lines[0].slice(2).trim().slice(0, 80) : null;
    } else {
      dashboard.learning.stickyCount = 0;
      dashboard.learning.firstSticky = null;
    }
    const intents = loadIntents();
    const now = new Date();
    const reminders = (Array.isArray(intents) ? intents : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
    dashboard.remindersPendingCount = reminders.length;
    const dueAt = (r) => r.dueAt || r.time;
    const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
    if (next) dashboard.nextReminder = { text: (next.title || next.message || next.text || '').slice(0, 120), dueAt: next.dueAt || next.time };
    const moltbookPath = path.join(dataDir, 'moltbook-state.json');
    if (fs.existsSync(moltbookPath)) {
      const raw = fs.readFileSync(moltbookPath, 'utf8');
      const data = JSON.parse(raw);
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const last = posts[0];
      if (last) {
        dashboard.moltbookLast = { title: (last.title || '').slice(0, 60), upvotes: last.upvotes != null ? last.upvotes : 0 };
        if (last.createdAt) dashboard.moltbookLast.createdAt = last.createdAt;
      }
    }
    const calendarPath = path.join(dataDir, 'calendar-snapshot.json');
    if (fs.existsSync(calendarPath)) {
      const cal = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));
      const events = Array.isArray(cal.events) ? cal.events : [];
      const today = new Date().toISOString().slice(0, 10);
      const todayEvents = events.filter((e) => (e.start || '').toString().slice(0, 10) === today);
      dashboard.calendarTodayCount = todayEvents.length;
      const tensionsCount = dashboard.learning.tensionsCount || 0;
      if (todayEvents.length > 3 && tensionsCount >= 1) {
        dashboard.contextHint = 'Busy day + ' + tensionsCount + ' tension(s). Prioritize Tension #1?';
        const withStart = todayEvents.map((e) => ({ start: e.start ? new Date(e.start).getTime() : 0, end: e.end ? new Date(e.end).getTime() : 0 })).filter((e) => e.start > 0).sort((a, b) => a.start - b.start);
        const dayStart = new Date().setHours(9, 0, 0, 0);
        const dayEnd = new Date().setHours(18, 0, 0, 0);
        for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000) {
          const blockEnd = t + 30 * 60 * 1000;
          const overlaps = withStart.some((e) => (e.start < blockEnd && (e.end || e.start + 3600000) > t));
          if (!overlaps && blockEnd <= dayEnd) {
            dashboard.freeSlot = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '–' + new Date(blockEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            break;
          }
        }
      }
    }
    if (fs.existsSync(eaAlertsFile)) {
      try {
        const raw = fs.readFileSync(eaAlertsFile, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          dashboard.ea = { alertsLast24h: list.filter((a) => (a.at || 0) > cutoff).length };
        }
      } catch (_) {}
    }
    const rabbitPath = path.join(learningDir, 'rabbit-hole-notes.md');
    if (fs.existsSync(rabbitPath)) {
      try {
        const raw = fs.readFileSync(rabbitPath, 'utf8');
        const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffStr = sevenDaysAgo.toISOString().slice(0, 10);
        let notesLast7Days = 0; let lastNoteDate = null; let lastNoteTitle = null; let lastNoteExcerpt = null;
        const blocks = splitMarkdownH2(raw);
        for (let i = 1; i < blocks.length; i++) {
          const headLine = splitLines(blocks[i])[0] || '';
          if (startsWithYyyyMmDd(headLine) && headLine[10] === ':') {
            const d = headLine.slice(0, 10);
            const title = headLine.slice(11).trim().slice(0, 60);
            if (d >= cutoffStr) notesLast7Days++;
            if (!lastNoteDate || d > lastNoteDate) {
              lastNoteDate = d; lastNoteTitle = title;
              const linesB = splitLines(blocks[i]);
              let bi = 1;
              while (bi < linesB.length && linesB[bi].trim() === '') bi++;
              const body = linesB.slice(bi).join('\n').trim().slice(0, 220);
              lastNoteExcerpt = body ? body + (body.length >= 220 ? '…' : '') : null;
            }
          }
        }
        dashboard.rabbitHole = { notesLast7Days, lastNoteDate, lastNoteTitle, lastNoteExcerpt };
      } catch (_) {}
    }
    const topicsPath = path.join(learningDir, 'topics.txt');
    if (fs.existsSync(topicsPath)) {
      try {
        const raw = fs.readFileSync(topicsPath, 'utf8');
        dashboard.researchTopics = splitLines(raw).map((l) => l.trim()).filter(Boolean);
      } catch (_) {}
    }
    try {
      const out = execSync('nvidia-smi --query-gpu=index,name,temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 });
      const gpus = [];
      out.trim().split('\n').forEach((line) => {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 3) {
          const temp = parseInt(parts[2], 10);
          gpus.push({ index: parseInt(parts[0], 10), name: parts[1], temp: isNaN(temp) ? null : temp });
        }
      });
      if (gpus.length) dashboard.gpuTemps = gpus;
    } catch (_) {}
  } catch (e) {
    if (typeof log === 'function') log('warn', 'ios-dashboard', { error: e.message });
  }
  send(res, 200, JSON.stringify(toIosDashboardPayload(dashboard, {
    generatedAt: new Date().toISOString(),
    refreshAfterSec: 300,
  })));
  return true;
}

module.exports = {
  tryHandleDashboard,
  registerDashboardRoutes,
  isDashboardPath,
};
