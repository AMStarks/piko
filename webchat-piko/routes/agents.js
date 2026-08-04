/**
 * Agent / mission / job API routes (P3.1b).
 */
function registerAgentRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/agents', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/runs', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('POST', '/api/agents/run', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/missions', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/missions/', wrap(tryHandleAgents), {
    match: 'prefix', group: 'agents', auth: 'open',
  });
  registry.add('POST', '/api/agents/missions', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/jobs', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/status', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
  registry.add('GET', '/api/agents/jobs/', wrap(tryHandleAgents), {
    match: 'prefix', group: 'agents', auth: 'open',
  });
  registry.add('POST', '/api/agents/jobs', wrap(tryHandleAgents), { group: 'agents', auth: 'open' });
}

function isAgentsPath(pathname) {
  return pathname === '/api/agents' || pathname.startsWith('/api/agents/');
}

function assertWorkPlaneOrDeny(req, res, send) {
  try {
    const { assertPlaneAllowed } = require('../lib/privilegePlanes');
    const { resolvePrincipal } = require('../lib/sessionOwner');
    const principal = resolvePrincipal(req, { dataDir: process.env.PIKO_DATA_DIR });
    const check = assertPlaneAllowed('work', { principal });
    if (!check.ok) {
      send(res, check.status || 403, JSON.stringify({
        ok: false,
        error: check.error || 'plane_denied',
        plane: check.plane,
      }));
      return false;
    }
  } catch (_) { /* fail open only if modules missing — auth still gates */ }
  return true;
}

async function tryHandleAgents(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isAgentsPath(pathname)) return false;
  const { send, readBody, rootDir, matchPath } = ctx;
  const orch = () => require('../lib/agentOrchestrator');

  // P3.4a: mutating agent routes require the work plane.
  if (String(req.method || '').toUpperCase() !== 'GET') {
    if (!assertWorkPlaneOrDeny(req, res, send)) return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents') {
    try {
      const { isAgentOrchEnabled, listAgents } = orch();
      const enabled = isAgentOrchEnabled(rootDir);
      send(res, 200, JSON.stringify({
        ok: true,
        orch_enabled: enabled,
        agents: enabled ? listAgents(rootDir) : [],
      }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'agents list failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents/runs') {
    try {
      const { isAgentOrchEnabled, listRuns } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const u = new URL(req.url, 'http://localhost');
      const limit = Math.min(100, Math.max(1, parseInt(u.searchParams.get('limit') || '20', 10) || 20));
      send(res, 200, JSON.stringify({ ok: true, runs: listRuns(limit) }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'agent runs failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/agents/run') {
    try {
      const { isAgentOrchEnabled, runAgent, enqueueAgentJob } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const agentId = String(parsed.agent_id || parsed.agentId || '').trim();
      const brief = String(parsed.brief || parsed.task || parsed.message || '').trim();
      if (!agentId || !brief) {
        send(res, 400, JSON.stringify({ ok: false, error: 'agent_id and brief required' }));
        return true;
      }
      const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
      if (asyncMode) {
        const queued = enqueueAgentJob('agent_run', { agent_id: agentId, brief }, { rootDir });
        send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
        return true;
      }
      const out = await runAgent(agentId, brief, { rootDir });
      send(res, 200, JSON.stringify({ ok: !!out.ok, reply: out.reply, run: out.run }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'agent run failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents/missions') {
    try {
      const { isAgentOrchEnabled, listMissions } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const u = new URL(req.url, 'http://localhost');
      const limit = Math.min(100, Math.max(1, parseInt(u.searchParams.get('limit') || '20', 10) || 20));
      send(res, 200, JSON.stringify({ ok: true, missions: listMissions(limit) }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'missions list failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/agents/missions/')) {
    try {
      const { isAgentOrchEnabled, readMission } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const id = decodeURIComponent(pathname.slice('/api/agents/missions/'.length).split('/')[0] || '').trim();
      if (!id || id.includes('..')) {
        send(res, 400, JSON.stringify({ ok: false, error: 'invalid mission id' }));
        return true;
      }
      const mission = readMission(id);
      if (!mission) {
        send(res, 404, JSON.stringify({ ok: false, error: 'mission not found' }));
        return true;
      }
      send(res, 200, JSON.stringify({ ok: true, mission }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mission get failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/agents/missions') {
    try {
      const { isAgentOrchEnabled, createMission, enqueueAgentJob } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const goal = String(parsed.goal || parsed.mission || parsed.message || '').trim();
      if (!goal) {
        send(res, 400, JSON.stringify({ ok: false, error: 'goal required' }));
        return true;
      }
      const execute = parsed.execute === true || parsed.execute === 1 || parsed.execute === '1';
      const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
      if (asyncMode) {
        const type = execute ? 'mission' : 'mission_plan';
        const queued = enqueueAgentJob(type, { goal }, { rootDir });
        send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
        return true;
      }
      const out = await createMission(goal, { rootDir, execute });
      const status = out.ok || out.mission ? 200 : 400;
      send(res, status, JSON.stringify(out));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mission create failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && matchPath && matchPath(pathname, '/api/agents/missions/:id/execute')) {
    try {
      const { isAgentOrchEnabled, executeMission, enqueueAgentJob } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const id = decodeURIComponent(pathname.split('/')[4] || '').trim();
      if (!id) {
        send(res, 400, JSON.stringify({ ok: false, error: 'invalid mission id' }));
        return true;
      }
      const body = await readBody(req).catch(() => '{}');
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
      if (asyncMode) {
        const queued = enqueueAgentJob('mission_execute', { mission_id: id }, { rootDir });
        send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
        return true;
      }
      const out = await executeMission(id, { rootDir });
      send(res, out.mission ? 200 : 404, JSON.stringify(out));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mission execute failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents/jobs') {
    try {
      const { isAgentOrchEnabled } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const { listJobs, jobCounts } = require('../lib/agentJobs');
      const u = new URL(req.url, 'http://localhost');
      const limit = Math.min(100, Math.max(1, parseInt(u.searchParams.get('limit') || '30', 10) || 30));
      send(res, 200, JSON.stringify({ ok: true, jobs: listJobs(limit), counts: jobCounts() }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'jobs list failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/agents/status') {
    try {
      const { getAgentStatus } = orch();
      send(res, 200, JSON.stringify(getAgentStatus({ rootDir })));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'agent status failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && matchPath && matchPath(pathname, '/api/agents/jobs/:id/cancel')) {
    try {
      const { isAgentOrchEnabled } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const id = decodeURIComponent(pathname.split('/')[4] || '').trim();
      if (!id || id.includes('..')) {
        send(res, 400, JSON.stringify({ ok: false, error: 'invalid job id' }));
        return true;
      }
      const { cancelJob } = require('../lib/agentJobs');
      const out = cancelJob(id);
      send(res, out.ok ? 200 : 400, JSON.stringify(out));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'job cancel failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && matchPath && matchPath(pathname, '/api/agents/missions/:id/cancel')) {
    try {
      const { isAgentOrchEnabled, cancelMission } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const id = decodeURIComponent(pathname.split('/')[4] || '').trim();
      if (!id || id.includes('..')) {
        send(res, 400, JSON.stringify({ ok: false, error: 'invalid mission id' }));
        return true;
      }
      const out = cancelMission(id, { rootDir });
      send(res, out.ok ? 200 : 400, JSON.stringify(out));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'mission cancel failed' }));
    }
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/agents/jobs/')) {
    try {
      const { isAgentOrchEnabled } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const id = decodeURIComponent(pathname.slice('/api/agents/jobs/'.length).split('/')[0] || '').trim();
      if (!id || id.includes('..')) {
        send(res, 400, JSON.stringify({ ok: false, error: 'invalid job id' }));
        return true;
      }
      const { readJob } = require('../lib/agentJobs');
      const job = readJob(id);
      if (!job) {
        send(res, 404, JSON.stringify({ ok: false, error: 'job not found' }));
        return true;
      }
      send(res, 200, JSON.stringify({ ok: true, job }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'job get failed' }));
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/agents/jobs') {
    try {
      const { isAgentOrchEnabled, enqueueAgentJob } = orch();
      if (!isAgentOrchEnabled(rootDir)) {
        send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled on this spine' }));
        return true;
      }
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const type = String(parsed.type || '').trim();
      const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
      if (type === 'agent_run') {
        payload.agent_id = payload.agent_id || parsed.agent_id;
        payload.brief = payload.brief || parsed.brief;
      }
      if (type === 'mission' || type === 'mission_plan') {
        payload.goal = payload.goal || parsed.goal;
      }
      if (type === 'mission_execute') {
        payload.mission_id = payload.mission_id || parsed.mission_id;
      }
      if (type === 'ei_platform_eval') {
        payload.brief = payload.brief || parsed.brief;
        payload.source = payload.source || parsed.source || 'api_job';
      }
      const queued = enqueueAgentJob(type, payload, { rootDir });
      send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'job enqueue failed' }));
    }
    return true;
  }

  return false;
}

module.exports = {
  tryHandleAgents,
  registerAgentRoutes,
  isAgentsPath,
};
