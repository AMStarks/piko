/**
 * Control panel API + OAuth + integrations routes (P3.1b).
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

function isControlPath(pathname) {
  return pathname === '/control'
    || pathname.startsWith('/control-')
    || pathname === '/api/control'
    || pathname === '/api/integrations/linked'
    || pathname === '/api/gmail/unread'
    || pathname === '/api/ea-alerts'
    || pathname === '/api/ea-preferences'
    || pathname === '/api/oauth/gmail/start'
    || pathname === '/api/oauth/slack/start'
    || pathname === '/api/oauth/notion/start'
    || pathname === '/api/oauth/gmail/callback'
    || pathname === '/api/oauth/slack/callback'
    || pathname === '/api/oauth/notion/callback'
    || (pathname && pathname.startsWith('/api/control/'));
}

function canAccessControl(req) {
  const allowedIps = (process.env.PIKO_CONTROL_ALLOWED_IP || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headerName = (process.env.PIKO_CONTROL_HEADER || '').trim().toLowerCase();
  if (allowedIps.length === 0 && !headerName) return true;
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  if (allowedIps.length && allowedIps.some((ip) => clientIp === ip || clientIp === `::ffff:${ip}`)) return true;
  if (headerName && req.headers[headerName] !== undefined && req.headers[headerName] !== '') return true;
  return false;
}

function isControlApiPath(pathname) {
  if (!pathname) return false;
  if (pathname === '/api/control' || pathname.startsWith('/api/control/')) return true;
  if (pathname === '/api/integrations/linked' || pathname === '/api/gmail/unread') return true;
  if (pathname === '/api/ea-alerts' || pathname === '/api/ea-preferences') return true;
  if (pathname.startsWith('/api/oauth/gmail/') || pathname.startsWith('/api/oauth/slack/') || pathname.startsWith('/api/oauth/notion/')) return true;
  return false;
}

function registerControlRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  const paths = [
    ['GET', '/api/control'],
    ['GET', '/api/control/proactive-policy'],
    ['POST', '/api/control/proactive-policy'],
    ['GET', '/api/control/operations'],
    ['GET', '/api/integrations/linked'],
    ['GET', '/api/gmail/unread'],
    ['GET', '/api/ea-alerts'],
    ['GET', '/api/ea-preferences'],
    ['PUT', '/api/ea-preferences'],
    ['GET', '/api/oauth/gmail/start'],
    ['GET', '/api/oauth/slack/start'],
    ['GET', '/api/oauth/notion/start'],
  ];
  for (const [method, p] of paths) {
    registry.add(method, p, wrap(tryHandleControl), { group: 'control', auth: 'control' });
  }
  registry.add('GET', '/api/control/', wrap(tryHandleControl), { match: 'prefix', group: 'control', auth: 'control' });
  registry.add('GET', '/api/oauth/', wrap(tryHandleControl), { match: 'prefix', group: 'control', auth: 'open' });
}

async function tryHandleControl(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isControlPath(pathname)) return false;

  const gated = pathname === '/control'
    || pathname.startsWith('/control-')
    || pathname === '/api/control'
    || pathname === '/api/integrations/linked'
    || pathname === '/api/gmail/unread'
    || pathname === '/api/ea-alerts'
    || pathname === '/api/ea-preferences'
    || pathname === '/api/oauth/gmail/start'
    || pathname === '/api/oauth/slack/start'
    || pathname === '/api/oauth/notion/start'
    || (pathname && pathname.startsWith('/api/control/'));
  if (gated && !canAccessControl(req)) {
    ctx.send(res, 403, JSON.stringify({ error: 'Control access not allowed' }));
    return true;
  }

  if (!isControlApiPath(pathname)) return false;

  const {
    send: _send,
    readBody,
    parseUrl,
    matchPath,
    stripTrailingSlash,
    rootDir,
    dataDir: DATA_DIR,
    legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
    sendLegionCommand,
    loadProactivePolicy,
    saveProactivePolicy,
    listLegateDecisions,
    findDecisionByTrace,
    executeDecisionAction,
    recordLegateObsEvent,
    loadLegateRollout,
    saveLegateRollout,
    canExecuteProductionAction,
    getLegateLinkReliability,
    getLegateObservability,
    getLegateSloSnapshot,
    getLegateTraceCorrelation,
    listLegateActionDeadLetters,
    replayDecisionActionDeadLetter,
    loadIntents,
    loadRules,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    listDevices,
    getMobileReliabilityMetrics,
    listConnectors,
    getConnectorHealth,
    buildConnectorContext,
    invokeConnector,
    proactiveEngine,
    proactiveCycleRunner,
    loadLinkedAccounts,
    saveLinkedAccounts,
    gmailAccessToken: GMAIL_ACCESS_TOKEN,
    gmailRefreshToken: GMAIL_REFRESH_TOKEN,
    gmailClientId: GMAIL_CLIENT_ID,
    gmailClientSecret: GMAIL_CLIENT_SECRET,
    gmailOAuthScopes: GMAIL_OAUTH_SCOPES,
    gmailOAuthStateMap,
    slackClientId: SLACK_CLIENT_ID,
    slackClientSecret: SLACK_CLIENT_SECRET,
    slackOAuthScopes: SLACK_OAUTH_SCOPES,
    slackOAuthStateMap,
    notionClientId: NOTION_CLIENT_ID,
    notionClientSecret: NOTION_CLIENT_SECRET,
    notionOAuthStateMap,
    pikoBaseUrl: PIKO_BASE_URL,
    httpsRequest,
    persistEnvVar,
    clearEnvVar,
    envHasKey,
    upsertEnvLine,
    removeNewlines,
    loadRegistry,
    getModelOpsOverview,
    upsertModel,
    promoteModel,
    rollbackModel,
    getLatestGateEvaluation,
    modelGateBlockCandidate: MODEL_GATE_BLOCK_CANDIDATE,
    setCurrentModelOverride,
    eaAlertsFile: EA_ALERTS_FILE,
    loadMobilePreferences,
    saveMobilePreferences,
    ai,
    ollamaModel: OLLAMA_MODEL,
    sessionStore,
    log,
    moltbookApiKey: MOLTBOOK_API_KEY,
    fetchMoltbookProfile,
    fetchMoltbookPostsByPiko,
    loadAllowlist,
    pendingNotificationsFile: PENDING_NOTIFICATIONS_FILE,
    promptsDir: PROMPTS_DIR,
    learningDir: LEARNING_DIR,
    splitLines,
    splitMarkdownH2,
    startsWithYyyyMmDd,
    stripWrappingQuotes,
    stripMarkdownFromText,
    stripListMarker,
    replaceAllLiteral,
  } = ctx;

  const __dirname = rootDir;
  const send = (...args) => { _send(...args); return true; };

  if (req.method === 'GET' && pathname === '/api/control/proactive-policy') {
  try {
    const policy = loadProactivePolicy();
    return send(res, 200, JSON.stringify({ ok: true, policy }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load policy' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/operations') {
  try {
    const { getOperationsStatus } = require('../lib/operationsOverrides');
    return send(res, 200, JSON.stringify({ ok: true, jobs: getOperationsStatus() }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load operations status' }));
  }
}

if (req.method === 'POST' && pathname === '/api/control/proactive-policy') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const expectedUpdatedAt = parsed && parsed.expectedUpdatedAt ? parsed.expectedUpdatedAt : '';
        const next = saveProactivePolicy(parsed && parsed.policy ? parsed.policy : parsed, { expectedUpdatedAt });
        return send(res, 200, JSON.stringify({ ok: true, policy: next }));
      } catch (e) {
        if (e && e.code === 'POLICY_CONFLICT') {
          return send(res, 409, JSON.stringify({
            ok: false,
            error: 'Policy version conflict',
            code: e.code,
            current: e.current || loadProactivePolicy(),
          }));
        }
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid policy payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save policy' })));
  return true;
}

if (req.method === 'GET' && pathname === '/api/control/legate-decisions') {
  try {
    const { query } = parseUrl(req.url);
    const limit = query && query.limit ? Number(query.limit) : 100;
    const rows = listLegateDecisions(DATA_DIR, limit);
    return send(res, 200, JSON.stringify({ ok: true, decisions: rows }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legate decisions' }));
  }
}

if (req.method === 'POST' && pathname === '/api/control/legate-decisions/execute') {
  const startedAt = Date.now();
  readBody(req)
    .then(async (body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const traceId = String(parsed && parsed.trace_id ? parsed.trace_id : '').trim();
        if (!traceId) {
          recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 400, latencyMs: Date.now() - startedAt, outcome: 'invalid_payload', errorCode: 'MISSING_TRACE_ID' });
          return send(res, 400, JSON.stringify({ ok: false, error: 'Missing trace_id' }));
        }
        const decision = findDecisionByTrace(DATA_DIR, traceId);
        if (!decision) {
          recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 404, latencyMs: Date.now() - startedAt, outcome: 'not_found', errorCode: 'DECISION_NOT_FOUND', trace_id: traceId });
          return send(res, 404, JSON.stringify({ ok: false, error: 'Decision not found' }));
        }
        const rollout = loadLegateRollout(DATA_DIR);
        const gate = canExecuteProductionAction(rollout);
        if (!gate.ok) {
          recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 409, latencyMs: Date.now() - startedAt, outcome: 'rollout_blocked', errorCode: gate.reason, trace_id: traceId });
          return send(res, 409, JSON.stringify({ ok: false, error: `Execution blocked by rollout gate: ${gate.reason}`, code: 'ROLLOUT_BLOCKED', gate: gate.reason, rollout }));
        }
        const execution = await executeDecisionAction(decision, { sendLegionCommand, dataDir: DATA_DIR });
        recordLegateObsEvent(DATA_DIR, {
          route: '/api/control/legate-decisions/execute',
          status: 200,
          latencyMs: Date.now() - startedAt,
          outcome: execution && execution.status === 'sent' ? 'execute_sent' : 'execute_not_sent',
          trace_id: traceId,
        });
        return send(res, 200, JSON.stringify({ ok: true, trace_id: traceId, execution }));
      } catch (e) {
        recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 400, latencyMs: Date.now() - startedAt, outcome: 'invalid_execute_payload', errorCode: 'INVALID_EXECUTE_PAYLOAD' });
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid execute payload' }));
      }
    })
    .catch((e) => {
      recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: Date.now() - startedAt, outcome: 'execute_failed', errorCode: 'EXECUTE_FAILED' });
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to execute decision action' }));
    });
  return true;
}

if (req.method === 'GET' && pathname === '/api/control/legate-rollout') {
  try {
    const rollout = loadLegateRollout(DATA_DIR);
    return send(res, 200, JSON.stringify({ ok: true, rollout }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legate rollout state' }));
  }
}

if (req.method === 'POST' && pathname === '/api/control/legate-rollout') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const expectedUpdatedAt = String(parsed && parsed.expectedUpdatedAt || '');
        const payload = parsed && parsed.rollout ? parsed.rollout : parsed;
        const rollout = saveLegateRollout(DATA_DIR, payload, { expectedUpdatedAt });
        return send(res, 200, JSON.stringify({ ok: true, rollout }));
      } catch (e) {
        if (e && e.code === 'ROLLOUT_CONFLICT') {
          return send(res, 409, JSON.stringify({ ok: false, error: 'Rollout version conflict', code: e.code, current: e.current || loadLegateRollout(DATA_DIR) }));
        }
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid rollout payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save rollout state' })));
  return true;
}

if (req.method === 'POST' && pathname === '/api/control/legate-rollout/rollback') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const current = loadLegateRollout(DATA_DIR);
        const rollout = saveLegateRollout(DATA_DIR, {
          ...current,
          emergencyRollback: true,
          rollbackReason: String(parsed && parsed.reason || 'manual_rollback'),
          stage: 'shadow',
          trafficPercent: 0,
        }, { expectedUpdatedAt: parsed && parsed.expectedUpdatedAt ? String(parsed.expectedUpdatedAt) : '' });
        return send(res, 200, JSON.stringify({ ok: true, rollout }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Failed to apply rollback' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to apply rollback' })));
  return true;
}

if (req.method === 'POST' && pathname === '/api/control/legate-rollout/failback') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const current = loadLegateRollout(DATA_DIR);
        const nextStage = String(parsed && parsed.stage || 'canary');
        const nextTraffic = Number(parsed && parsed.trafficPercent != null ? parsed.trafficPercent : 10);
        const rollout = saveLegateRollout(DATA_DIR, {
          ...current,
          emergencyRollback: false,
          rollbackReason: '',
          stage: nextStage,
          trafficPercent: nextTraffic,
        }, { expectedUpdatedAt: parsed && parsed.expectedUpdatedAt ? String(parsed.expectedUpdatedAt) : '' });
        return send(res, 200, JSON.stringify({ ok: true, rollout }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Failed to apply failback' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to apply failback' })));
  return true;
}

if (req.method === 'GET' && pathname === '/api/control/legate-link-reliability') {
  try {
    const snapshot = getLegateLinkReliability(DATA_DIR);
    return send(res, 200, JSON.stringify({ ok: true, reliability: snapshot }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load link reliability' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legion-scheduled') {
  try {
    const intents = loadIntents();
    const legionScheduled = intents.filter((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status));
    const items = legionScheduled.map((s) => ({
      id: s.id,
      task_id: s.task_id || s.taskId || null,
      title: s.title || s.description || '',
      objective: s.briefFields?.objective || s.title || s.description || '',
      schedule: s.schedule || null,
      dueAt: s.dueAt || null,
      lastFiredAt: s.lastFiredAt || null,
      lastRunId: s.lastRunId || null,
      lastRunStatus: s.lastRunStatus || null,
      lastRunOutcome: s.lastRunOutcome ? String(s.lastRunOutcome).slice(0, 300) : null,
      capability: s.capability || null,
      adapterId: s.adapterId || s.adapter_id || null,
      runbook_id: s.runbook_id || null,
      mode: s.mode || 'require_approval',
      business_unit: s.business_unit || null,
    }));
    return send(res, 200, JSON.stringify({ ok: true, items }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legion-scheduled' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legion-adapter-health') {
  try {
    const { checkLegionAdapterHealth } = require('../lib/legionAdapterHealth');
    const health = await checkLegionAdapterHealth({ baseUrl: LEGION_ADAPTER_API_BASE });
    return send(res, health.ok ? 200 : 503, JSON.stringify({ ok: health.ok, ...health }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to check legion adapter' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legion-runs') {
  try {
    const { query } = parseUrl(req.url);
    const { fetchLegionRuns } = require('../lib/legionRunApi');
    const out = await fetchLegionRuns({
      baseUrl: LEGION_ADAPTER_API_BASE,
      limit: query?.limit,
      offset: query?.offset,
      adapterId: query?.adapter_id,
      capability: query?.capability,
      status: query?.status,
    });
    return send(res, out.ok ? 200 : 503, JSON.stringify(out));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legion runs' }));
  }
}

const legionRunDetailMatch = pathname && matchPath(pathname, '/api/control/legion-runs/:id');
if (req.method === 'GET' && legionRunDetailMatch) {
  try {
    const { fetchLegionRunDetail } = require('../lib/legionRunApi');
    const out = await fetchLegionRunDetail(legionRunDetailMatch.id, { baseUrl: LEGION_ADAPTER_API_BASE });
    if (!out.ok && out.error === 'not_found') {
      return send(res, 404, JSON.stringify({ ok: false, error: 'run not found' }));
    }
    return send(res, out.ok ? 200 : 503, JSON.stringify(out));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load legion run' }));
  }
}
if (req.method === 'GET' && pathname === '/api/control/intents-failed') {
  try {
    const failedPath = path.join(DATA_DIR, 'intents-failed.json');
    let rows = [];
    if (fs.existsSync(failedPath)) {
      const raw = fs.readFileSync(failedPath, 'utf8');
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : [];
    }
    const { query } = parseUrl(req.url);
    const sinceHours = query?.sinceHours ? Number(query.sinceHours) : 24;
    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
    const recent = rows.filter((r) => new Date(r.at || 0).getTime() >= cutoff);
    return send(res, 200, JSON.stringify({ ok: true, items: recent, total: rows.length }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load intents-failed' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/webhook-rules') {
  try {
    const rules = loadRules();
    return send(res, 200, JSON.stringify({ ok: true, rules }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load webhook rules' }));
  }
}
if (req.method === 'POST' && pathname === '/api/control/webhook-rules') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const rule = createRule(parsed.rule || parsed);
        return send(res, 200, JSON.stringify({ ok: true, rule }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid rule payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to create rule' })));
  return true;
}
if (req.method === 'PUT' && pathname.startsWith('/api/control/webhook-rules/') && !pathname.endsWith('/toggle')) {
  const id = stripTrailingSlash(pathname.replace('/api/control/webhook-rules/', ''));
  if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const rule = updateRule(id, parsed.rule || parsed);
        if (!rule) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
        return send(res, 200, JSON.stringify({ ok: true, rule }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid update payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to update rule' })));
  return true;
}
if (req.method === 'DELETE' && pathname.startsWith('/api/control/webhook-rules/')) {
  const id = stripTrailingSlash(pathname.replace('/api/control/webhook-rules/', ''));
  if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
  try {
    const deleted = deleteRule(id);
    if (!deleted) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
    return send(res, 200, JSON.stringify({ ok: true }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to delete rule' }));
  }
}
if (req.method === 'POST' && matchPath(pathname, '/api/control/webhook-rules/:id/toggle')) {
  const id = pathname.replace('/api/control/webhook-rules/', '').endsWith('/toggle') ? ''.slice() : '';
  if (!id) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing rule id' }));
  try {
    const rule = toggleRule(id);
    if (!rule) return send(res, 404, JSON.stringify({ ok: false, error: 'Rule not found' }));
    return send(res, 200, JSON.stringify({ ok: true, rule }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to toggle rule' }));
  }
}
if (req.method === 'GET' && pathname === '/api/control/webhook-events') {
  try {
    const logPath = path.join(DATA_DIR, 'webhook-events-log.json');
    let log = [];
    if (fs.existsSync(logPath)) {
      try {
        log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      } catch (_) {}
    }
    const { query } = parseUrl(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(query?.limit, 10) || 50));
    const since = query?.since ? new Date(query.since).getTime() : 0;
    const filtered = (Array.isArray(log) ? log : []).filter((e) => !since || new Date(e.at || 0).getTime() >= since);
    const items = filtered.slice(0, limit);
    return send(res, 200, JSON.stringify({ ok: true, items, total: filtered.length }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load webhook events' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legate-observability') {
  try {
    const { query } = parseUrl(req.url);
    const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
    const snapshot = getLegateObservability(DATA_DIR, { sinceHours });
    return send(res, 200, JSON.stringify(snapshot));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load observability' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legate-slo') {
  try {
    const { query } = parseUrl(req.url);
    const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
    const targetAvailability = query && query.targetAvailability ? Number(query.targetAvailability) : undefined;
    const targetP95Ms = query && query.targetP95Ms ? Number(query.targetP95Ms) : undefined;
    const snapshot = getLegateSloSnapshot(DATA_DIR, { sinceHours, targetAvailability, targetP95Ms });
    return send(res, 200, JSON.stringify(snapshot));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load SLO snapshot' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legate-observability/trace') {
  try {
    const { query } = parseUrl(req.url);
    const traceId = query && query.traceId ? String(query.traceId) : '';
    const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
    const snapshot = getLegateTraceCorrelation(DATA_DIR, { traceId, sinceHours });
    if (!snapshot.ok) return send(res, 400, JSON.stringify(snapshot));
    return send(res, 200, JSON.stringify(snapshot));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load trace correlation' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legate-audit-export') {
  try {
    const { query } = parseUrl(req.url);
    const sinceHours = query && query.sinceHours ? Number(query.sinceHours) : 24;
    const cutoff = Date.now() - Math.max(1, Math.min(24 * 30, sinceHours)) * 60 * 60 * 1000;
    const decisions = listLegateDecisions(DATA_DIR, 1000).filter((d) => {
      const t = Date.parse(d && d.at || '');
      return Number.isFinite(t) && t >= cutoff;
    });
    const actionDeadLetters = listLegateActionDeadLetters(DATA_DIR, { limit: 1000 }).filter((d) => {
      const t = Date.parse(d && d.at || '');
      return Number.isFinite(t) && t >= cutoff;
    });
    const observability = getLegateObservability(DATA_DIR, { sinceHours });
    const reliability = getLegateLinkReliability(DATA_DIR);
    const slo = getLegateSloSnapshot(DATA_DIR, { sinceHours });
    const rollout = loadLegateRollout(DATA_DIR);
    return send(res, 200, JSON.stringify({
      ok: true,
      exportedAt: new Date().toISOString(),
      sinceHours: Math.max(1, Math.min(24 * 30, sinceHours)),
      reliability,
      observability,
      slo,
      rollout,
      decisions,
      actionDeadLetters,
    }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to build legate audit export' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/legate-action-dead-letters') {
  try {
    const { query } = parseUrl(req.url);
    const limit = query && query.limit ? Number(query.limit) : 100;
    const status = query && query.status ? String(query.status) : '';
    const rows = listLegateActionDeadLetters(DATA_DIR, { limit, status });
    return send(res, 200, JSON.stringify({ ok: true, deadLetters: rows }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load action dead letters' }));
  }
}

if (req.method === 'POST' && pathname.startsWith('/api/control/legate-action-dead-letters/replay/')) {
  const id = decodeURIComponent(pathname.slice('/api/control/legate-action-dead-letters/replay/'.length));
  const startedAt = Date.now();
  replayDecisionActionDeadLetter(id, { sendLegionCommand, dataDir: DATA_DIR })
    .then((out) => {
      recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 200, latencyMs: Date.now() - startedAt, outcome: 'replay_sent' });
      return send(res, 200, JSON.stringify({ ok: true, ...out }));
    })
    .catch((e) => {
      if (e && e.code === 'REPLAY_COOLDOWN') {
        recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 409, latencyMs: Date.now() - startedAt, outcome: 'replay_cooldown', errorCode: 'REPLAY_COOLDOWN' });
        return send(res, 409, JSON.stringify({ ok: false, error: e.message || 'Replay cooldown', code: e.code, deadLetter: e.deadLetter || null }));
      }
      recordLegateObsEvent(DATA_DIR, { route: '/api/control/legate-action-dead-letters/replay/:id', status: 404, latencyMs: Date.now() - startedAt, outcome: 'replay_failed', errorCode: e && e.code ? e.code : 'REPLAY_FAILED' });
      return send(res, 404, JSON.stringify({ ok: false, error: e.message || 'Replay failed', code: e.code || 'REPLAY_FAILED', deadLetter: e.deadLetter || null }));
    });
  return true;
}

if (req.method === 'GET' && pathname === '/api/control/mobile-devices') {
  try {
    const { query } = parseUrl(req.url);
    const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
    const out = listDevices(limit);
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile devices' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/mobile-reliability') {
  try {
    const { query } = parseUrl(req.url);
    const activeWithinMin = Math.max(5, Math.min(24 * 60, parseInt(query && query.activeWithinMin, 10) || 60));
    const staleAfterMin = Math.max(10, Math.min(7 * 24 * 60, parseInt(query && query.staleAfterMin, 10) || 6 * 60));
    const ackSinceHours = Math.max(1, Math.min(24 * 30, parseInt(query && query.ackSinceHours, 10) || 24));
    const out = getMobileReliabilityMetrics({ activeWithinMin, staleAfterMin, ackSinceHours });
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile reliability metrics' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/connectors') {
  const connectorIds = listConnectors();
  const health = await getConnectorHealth(buildConnectorContext());
  return send(res, 200, JSON.stringify({ ok: true, connectors: connectorIds, health }));
}

if (req.method === 'GET' && pathname === '/api/control/connector-health') {
  const health = await getConnectorHealth(buildConnectorContext());
  return send(res, 200, JSON.stringify({ ok: true, connectors: health }));
}

const connectorStatusMatch = req.method === 'GET' && matchPath(pathname, '/api/control/connectors/:id/status');
if (connectorStatusMatch) {
  const connectorId = decodeURIComponent(connectorStatusMatch.id || '').trim();
  const out = await invokeConnector(connectorId, 'status', buildConnectorContext(), {});
  if (!out.ok) {
    const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
    return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
  }
  return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, status: out.result || {} }));
}

const connectorListMatch = req.method === 'GET' && matchPath(pathname, '/api/control/connectors/:id/list');
if (connectorListMatch) {
  const connectorId = decodeURIComponent(connectorListMatch.id || '').trim();
  const { query } = parseUrl(req.url);
  const params = {
    limit: query && query.limit,
  };
  const out = await invokeConnector(connectorId, 'list', buildConnectorContext(), params);
  if (!out.ok) return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
  return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, ...out.result }));
}

const connectorPullMatch = req.method === 'GET' && matchPath(pathname, '/api/control/connectors/:id/pull');
if (connectorPullMatch) {
  const connectorId = decodeURIComponent(connectorPullMatch.id || '').trim();
  const { query } = parseUrl(req.url);
  const params = {
    id: query && query.id,
    messageId: query && query.messageId,
    eventId: query && query.eventId,
  };
  const out = await invokeConnector(connectorId, 'pull', buildConnectorContext(), params);
  if (!out.ok) return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
  return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, ...out.result }));
}

const connectorActMatch = req.method === 'POST' && matchPath(pathname, '/api/control/connectors/:id/act');
if (connectorActMatch) {
  const connectorId = decodeURIComponent(connectorActMatch.id || '').trim();
  readBody(req)
    .then(async (body) => {
      try {
        const params = body ? JSON.parse(body) : {};
        const out = await invokeConnector(connectorId, 'act', buildConnectorContext(), params || {});
        if (!out.ok) {
          const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
          return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
        }
        return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, result: out.result }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, connector: connectorId, error: e.message || 'Invalid payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, connector: connectorId, error: e.message || 'Connector act failed' })));
  return true;
}

const connectorDisconnectMatch = req.method === 'POST' && matchPath(pathname, '/api/control/connectors/:id/disconnect');
if (connectorDisconnectMatch) {
  const connectorId = decodeURIComponent(connectorDisconnectMatch.id || '').trim();
  const out = await invokeConnector(connectorId, 'disconnect', buildConnectorContext(), {});
  if (!out.ok) {
    const status = out.code === 'UNKNOWN_CONNECTOR' ? 404 : out.code === 'NOT_IMPLEMENTED' ? 501 : 400;
    return send(res, status, JSON.stringify({ ok: false, connector: connectorId, error: out.error, code: out.code || '' }));
  }
  return send(res, 200, JSON.stringify({ ok: true, connector: connectorId, result: out.result }));
}

if (req.method === 'GET' && pathname === '/api/control/proactive-events') {
  try {
    const { query } = parseUrl(req.url);
    const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
    const status = query && query.status ? String(query.status).trim() : '';
    const type = query && query.type ? String(query.type).trim() : '';
    const since = query && query.since ? String(query.since).trim() : '';
    const out = proactiveEngine.getStatus({ limit, status, type, since });
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive events' }));
  }
}

if (req.method === 'POST' && pathname === '/api/control/proactive-engine/run') {
  proactiveCycleRunner.run('manual', { skipIfBusy: true })
    .then((out) => {
      if (out && out.skipped) {
        return send(res, 409, JSON.stringify({
          ok: false,
          skipped: true,
          reason: out.reason || 'busy',
          activeSource: out.activeSource || '',
          activeForMs: Number(out.activeForMs || 0),
        }));
      }
      return send(res, 200, JSON.stringify({ ok: true, summary: out.summary, durationMs: out.durationMs }));
    })
    .catch((e) => {
      const status = e && e.code === 'PROACTIVE_CYCLE_TIMEOUT' ? 504 : 500;
      return send(res, status, JSON.stringify({ ok: false, code: e.code || '', error: e.message || 'Failed to run proactive engine' }));
    });
  return true;
}

if (req.method === 'GET' && pathname === '/api/control/proactive-deliveries') {
  try {
    const { query } = parseUrl(req.url);
    const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
    const status = query && query.status ? String(query.status) : '';
    const out = proactiveEngine.getDeliveries(limit, status);
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive deliveries' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/proactive-dead-letters') {
  try {
    const { query } = parseUrl(req.url);
    const limit = Math.max(1, Math.min(500, parseInt(query && query.limit, 10) || 100));
    const status = query && query.status ? String(query.status) : '';
    const out = proactiveEngine.getDeadLetters(limit, status);
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive dead letters' }));
  }
}

if (req.method === 'GET' && pathname === '/api/control/proactive-reliability') {
  try {
    const { query } = parseUrl(req.url);
    const sinceHours = Math.max(1, Math.min(24 * 30, parseInt(query && query.sinceHours, 10) || 24));
    const repeatThreshold = Math.max(2, Math.min(100, parseInt(query && query.repeatThreshold, 10) || 3));
    const out = proactiveEngine.getReliabilityMetrics({ sinceHours, repeatThreshold });
    return send(res, 200, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load proactive reliability metrics' }));
  }
}

if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-deliveries/') && pathname.endsWith('/ack')) {
  const id = decodeURIComponent(pathname.slice('/api/control/proactive-deliveries/'.length, -('/ack'.length)));
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const out = proactiveEngine.acknowledgeDelivery(id, {
          source: parsed && parsed.source ? parsed.source : 'api',
          channel: parsed && parsed.channel ? parsed.channel : 'manual',
          status: parsed && parsed.status ? parsed.status : 'acknowledged',
          ackType: parsed && parsed.ackType ? parsed.ackType : 'seen',
          ackId: parsed && parsed.ackId ? parsed.ackId : '',
          deviceId: parsed && parsed.deviceId ? parsed.deviceId : '',
          userResponse: parsed && parsed.userResponse ? parsed.userResponse : '',
          note: parsed && parsed.note ? parsed.note : '',
        });
        return send(res, 200, JSON.stringify({ ok: true, ...out }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Ack failed' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to process ack payload' })));
  return true;
}

if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-replay/')) {
  const id = decodeURIComponent(pathname.slice('/api/control/proactive-replay/'.length));
  proactiveEngine.replayDelivery(id, 'api')
    .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
    .catch((e) => {
      const status = e && (e.code === 'REPLAY_COOLDOWN' || e.code === 'REPLAY_IN_PROGRESS') ? 429 : 404;
      return send(res, status, JSON.stringify({ ok: false, code: e.code || '', error: e.message || 'Replay failed' }));
    });
  return true;
}

if (req.method === 'POST' && pathname.startsWith('/api/control/proactive-dead-letters/replay/')) {
  const id = decodeURIComponent(pathname.slice('/api/control/proactive-dead-letters/replay/'.length));
  proactiveEngine.replayDeadLetter(id, 'api_dead_letter_replay')
    .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
    .catch((e) => send(res, 404, JSON.stringify({ ok: false, error: e.message || 'Dead-letter replay failed' })));
  return true;
}

if (req.method === 'POST' && pathname === '/api/control/proactive-dispatch/test') {
  readBody(req)
    .then((body) => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid JSON' }));
      }
      proactiveEngine.dispatchTest(parsed || {})
        .then((out) => send(res, 200, JSON.stringify({ ok: true, ...out })))
        .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Dispatch test failed' })));
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to read body' })));
  return true;
}

if (req.method === 'GET' && pathname === '/api/integrations/linked') {
  const linked = loadLinkedAccounts();
  const configured = {
    gmail: !!(process.env.GMAIL_ACCESS_TOKEN || (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET)),
    slack: !!process.env.SLACK_BOT_TOKEN,
    notion: !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY),
  };
  return send(res, 200, JSON.stringify({ linkedAccounts: linked, configured }));
}

// —— Gmail unread API (JSON for app) ——
if (req.method === 'GET' && pathname === '/api/gmail/unread') {
  const gmailRefreshLive = process.env.GMAIL_REFRESH_TOKEN || GMAIL_REFRESH_TOKEN;
  if (!GMAIL_ACCESS_TOKEN && !(gmailRefreshLive && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET)) {
    return send(res, 200, JSON.stringify({ ok: false, error: 'Gmail not configured', emails: [] }));
  }
  try {
    let token = GMAIL_ACCESS_TOKEN;
    if (!token && gmailRefreshLive) {
      const body = new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: gmailRefreshLive, grant_type: 'refresh_token' }).toString();
      const opts = { hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
      const { data } = await httpsRequest(opts, body);
      const json = JSON.parse(data);
      token = json.access_token;
    }
    if (!token) return send(res, 200, JSON.stringify({ ok: false, error: 'No access token', emails: [] }));
    const listOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages?maxResults=15&q=is:unread', method: 'GET', headers: { 'Authorization': 'Bearer ' + token } };
    const { statusCode, data: listData } = await httpsRequest(listOpts);
    if (statusCode !== 200) return send(res, 200, JSON.stringify({ ok: false, error: 'Gmail API error', emails: [] }));
    const list = JSON.parse(listData);
    const ids = (list.messages || []).map((m) => m.id);
    const emails = [];
    for (const id of ids) {
      const msgOpts = { hostname: 'gmail.googleapis.com', port: 443, path: '/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', method: 'GET', headers: { 'Authorization': 'Bearer ' + token } };
      const { data: msgData } = await httpsRequest(msgOpts);
      const msg = JSON.parse(msgData);
      const headers = (msg.payload && msg.payload.headers) || [];
      const getH = (n) => (headers.find((h) => h.name === n) || {}).value || '';
      const snippet = (msg.snippet || '').slice(0, 120);
      emails.push({ id: id, from: getH('From'), subject: getH('Subject') || '(no subject)', date: getH('Date'), snippet });
    }
    return send(res, 200, JSON.stringify({ ok: true, emails }));
  } catch (e) {
    return send(res, 200, JSON.stringify({ ok: false, error: e.message || 'Gmail error', emails: [] }));
  }
}

// —— Gmail OAuth: Connect Gmail flow (same result as manual refresh token) ——
if (req.method === 'GET' && pathname === '/api/oauth/gmail/start') {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    return send(res, 400, 'Gmail OAuth not configured: set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env');
  }
  const { query } = parseUrl(req.url);
  const fromApp = query && query.from === 'app';
  const stateHex = crypto.randomBytes(24).toString('hex');
  const state = fromApp ? stateHex + ':app' : stateHex;
  gmailOAuthStateMap.set(stateHex, { createdAt: Date.now(), fromApp: !!fromApp });
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/gmail/callback';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  res.writeHead(302, { Location: authUrl });
  res.end();
  return true;
}
if (req.method === 'GET' && pathname === '/api/oauth/gmail/callback') {
  const { query } = parseUrl(req.url);
  const code = query && query.code;
  const state = query && query.state;
  const error = query && query.error;
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  for (const [s, v] of gmailOAuthStateMap.entries()) {
    if (v.createdAt < tenMinAgo) gmailOAuthStateMap.delete(s);
  }
  if (error) {
    const errStateHex = state && String(state).endsWith(':app') ? String(state).slice(0, -4) : state;
    const errFromApp = errStateHex && gmailOAuthStateMap.get(errStateHex)?.fromApp;
    const errRedirect = errFromApp ? 'piko://oauth-done?service=gmail&error=' + encodeURIComponent(error) : '/control-integrations?gmail=error&message=' + encodeURIComponent(error);
    res.writeHead(302, { Location: errRedirect });
    res.end();
    return;
  }
  const stateHex = state && state.endsWith(':app') ? state.slice(0, -4) : state;
  const stateMeta = stateHex ? gmailOAuthStateMap.get(stateHex) : undefined;
  if (!stateHex || !stateMeta) {
    return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
  }
  const fromApp = !!stateMeta.fromApp;
  gmailOAuthStateMap.delete(stateHex);
  if (!code) {
    return send(res, 400, 'Missing authorization code.');
  }
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/gmail/callback';
  const body = new URLSearchParams({
    code,
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();
  try {
    const tokenRes = await new Promise((resolve, reject) => {
      const reqOpt = new URL('https://oauth2.googleapis.com/token');
      const post = https.request(
        reqOpt,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        }
      );
      post.on('error', reject);
      post.write(body);
      post.end();
    });
    const parsed = JSON.parse(tokenRes.data);
    if (parsed.error) {
      const msg = encodeURIComponent(parsed.error + ': ' + (parsed.error_description || ''));
      const tokErrRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=' + msg : '/control-integrations?gmail=error&message=' + msg;
      res.writeHead(302, { Location: tokErrRedirect });
      res.end();
      return;
    }
    const refreshToken = parsed.refresh_token;
    if (!refreshToken) {
      const noTokRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=No+refresh+token' : '/control-integrations?gmail=error&message=No+refresh+token+returned';
      res.writeHead(302, { Location: noTokRedirect });
      res.end();
      return;
    }
    process.env.GMAIL_REFRESH_TOKEN = refreshToken;
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch (_) {}
    const line = 'GMAIL_REFRESH_TOKEN=' + removeNewlines(refreshToken) + '\n';
    if (envHasKey(envContent, 'GMAIL_REFRESH_TOKEN')) {
      envContent = upsertEnvLine(envContent, 'GMAIL_REFRESH_TOKEN', removeNewlines(refreshToken));
    } else {
      envContent = (envContent.trimEnd() ? envContent + '\n' : '') + line;
    }
    try {
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch (e) {
      log('warn', 'gmail-oauth-env-write', { error: e.message });
    }
    let gmailEmail = '';
    const accessToken = parsed.access_token;
    if (accessToken) {
      try {
        const profileRes = await new Promise((resolve, reject) => {
          https.get(
            'https://gmail.googleapis.com/gmail/v1/users/me/profile',
            { headers: { Authorization: 'Bearer ' + accessToken } },
            (resp) => {
              let data = '';
              resp.on('data', (c) => (data += c));
              resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
            }
          ).on('error', reject);
        });
        if (profileRes.statusCode === 200) {
          const profile = JSON.parse(profileRes.data);
          if (profile && profile.emailAddress) gmailEmail = profile.emailAddress;
        }
      } catch (_) {}
    }
    const linked = loadLinkedAccounts();
    if (gmailEmail) linked.gmail = { email: gmailEmail }; else delete linked.gmail;
    saveLinkedAccounts(linked);
    const redirectUrl = fromApp ? 'piko://oauth-done?service=gmail&success=1' : '/control-integrations?gmail=connected';
    res.writeHead(302, { Location: redirectUrl });
    res.end();
    return;
  } catch (e) {
    log('warn', 'gmail-oauth-token-exchange', { error: e.message });
    const msg = encodeURIComponent(e.message || 'Token exchange failed');
    const catchRedirect = fromApp ? 'piko://oauth-done?service=gmail&error=' + msg : '/control-integrations?gmail=error&message=' + msg;
    res.writeHead(302, { Location: catchRedirect });
    res.end();
    return;
  }
}

// —— Slack OAuth: Connect Slack (same pattern as Gmail) ——
if (req.method === 'GET' && pathname === '/api/oauth/slack/start') {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    return send(res, 400, 'Slack OAuth not configured: set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env');
  }
  const state = crypto.randomBytes(24).toString('hex');
  slackOAuthStateMap.set(state, { createdAt: Date.now() });
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/slack/callback';
  const authUrl = 'https://slack.com/oauth/v2/authorize?' + new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    scope: SLACK_OAUTH_SCOPES,
    redirect_uri: redirectUri,
    state,
  }).toString();
  res.writeHead(302, { Location: authUrl });
  res.end();
  return true;
}
if (req.method === 'GET' && pathname === '/api/oauth/slack/callback') {
  const { query } = parseUrl(req.url);
  const code = query && query.code;
  const state = query && query.state;
  const error = query && query.error;
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  for (const [s, v] of slackOAuthStateMap.entries()) {
    if (v.createdAt < tenMinAgo) slackOAuthStateMap.delete(s);
  }
  if (error) {
    res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(error) });
    res.end();
    return;
  }
  if (!state || !slackOAuthStateMap.has(state)) {
    return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
  }
  slackOAuthStateMap.delete(state);
  if (!code) {
    return send(res, 400, 'Missing authorization code.');
  }
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/slack/callback';
  const body = new URLSearchParams({ code, client_id: SLACK_CLIENT_ID, client_secret: SLACK_CLIENT_SECRET, redirect_uri: redirectUri }).toString();
  try {
    const tokenRes = await new Promise((resolve, reject) => {
      const post = https.request(
        new URL('https://slack.com/api/oauth.v2.access'),
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        (resp) => {
          let data = '';
          resp.on('data', (c) => (data += c));
          resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
        }
      );
      post.on('error', reject);
      post.write(body);
      post.end();
    });
    const parsed = JSON.parse(tokenRes.data);
    if (!parsed.ok || !parsed.access_token) {
      res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(parsed.error || 'No token returned') });
      res.end();
      return;
    }
    persistEnvVar('SLACK_BOT_TOKEN', parsed.access_token);
    const linked = loadLinkedAccounts();
    if (parsed.team && parsed.team.name) linked.slack = { team: parsed.team.name }; else delete linked.slack;
    saveLinkedAccounts(linked);
    res.writeHead(302, { Location: '/control-integrations?slack=connected' });
    res.end();
    return;
  } catch (e) {
    log('warn', 'slack-oauth-token', { error: e.message });
    res.writeHead(302, { Location: '/control-integrations?slack=error&message=' + encodeURIComponent(e.message || 'Token exchange failed') });
    res.end();
    return;
  }
}

// —— Notion OAuth: Connect Notion ——
if (req.method === 'GET' && pathname === '/api/oauth/notion/start') {
  if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
    return send(res, 400, 'Notion OAuth not configured: set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in .env (public integration)');
  }
  const state = crypto.randomBytes(24).toString('hex');
  notionOAuthStateMap.set(state, { createdAt: Date.now() });
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/notion/callback';
  const authUrl = 'https://api.notion.com/v1/oauth/authorize?' + new URLSearchParams({
    client_id: NOTION_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    owner: 'user',
    state,
  }).toString();
  res.writeHead(302, { Location: authUrl });
  res.end();
  return true;
}
if (req.method === 'GET' && pathname === '/api/oauth/notion/callback') {
  const { query } = parseUrl(req.url);
  const code = query && query.code;
  const state = query && query.state;
  const error = query && query.error;
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  for (const [s, v] of notionOAuthStateMap.entries()) {
    if (v.createdAt < tenMinAgo) notionOAuthStateMap.delete(s);
  }
  if (error) {
    res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(error) });
    res.end();
    return;
  }
  if (!state || !notionOAuthStateMap.has(state)) {
    return send(res, 400, 'Invalid or expired state. Start again from Control → Integrations.');
  }
  notionOAuthStateMap.delete(state);
  if (!code) {
    return send(res, 400, 'Missing authorization code.');
  }
  const baseUrl = PIKO_BASE_URL || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
  const redirectUri = baseUrl + '/api/oauth/notion/callback';
  const basicAuth = Buffer.from(NOTION_CLIENT_ID + ':' + NOTION_CLIENT_SECRET).toString('base64');
  const body = JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  try {
    const tokenRes = await new Promise((resolve, reject) => {
      const post = https.request(
        new URL('https://api.notion.com/v1/oauth/token'),
        { method: 'POST', headers: { 'Authorization': 'Basic ' + basicAuth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (resp) => {
          let data = '';
          resp.on('data', (c) => (data += c));
          resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
        }
      );
      post.on('error', reject);
      post.write(body);
      post.end();
    });
    const parsed = JSON.parse(tokenRes.data);
    if (parsed.error || !parsed.access_token) {
      res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(parsed.error || 'No token returned') });
      res.end();
      return;
    }
    persistEnvVar('NOTION_TOKEN', parsed.access_token);
    if (parsed.refresh_token) persistEnvVar('NOTION_REFRESH_TOKEN', parsed.refresh_token);
    let notionLabel = 'Workspace';
    try {
      const meRes = await new Promise((resolve, reject) => {
        https.get(
          'https://api.notion.com/v1/users/me',
          { headers: { Authorization: 'Bearer ' + parsed.access_token, 'Notion-Version': '2022-06-28' } },
          (resp) => {
            let data = '';
            resp.on('data', (c) => (data += c));
            resp.on('end', () => resolve({ statusCode: resp.statusCode, data }));
          }
        ).on('error', reject);
      });
      if (meRes.statusCode === 200) {
        const me = JSON.parse(meRes.data);
        if (me && me.name) notionLabel = me.name;
      }
    } catch (_) {}
    const linked = loadLinkedAccounts();
    linked.notion = { workspace: notionLabel };
    saveLinkedAccounts(linked);
    res.writeHead(302, { Location: '/control-integrations?notion=connected' });
    res.end();
    return;
  } catch (e) {
    log('warn', 'notion-oauth-token', { error: e.message });
    res.writeHead(302, { Location: '/control-integrations?notion=error&message=' + encodeURIComponent(e.message || 'Token exchange failed') });
    res.end();
    return;
  }
}
if (req.method === 'GET' && pathname === '/api/control/model-registry') {
  const registry = loadRegistry();
  return send(res, 200, JSON.stringify({ ok: true, registry }));
}

if (req.method === 'GET' && pathname === '/api/control/modelops/overview') {
  try {
    const overview = getModelOpsOverview();
    return send(res, 200, JSON.stringify({ ok: true, overview }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load modelops overview' }));
  }
}

if (req.method === 'POST' && pathname === '/api/control/model-registry/register-model') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const modelTag = String(parsed.modelTag || '').trim();
        if (!modelTag) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing modelTag' }));
        const next = upsertModel(modelTag, {
          notes: parsed.notes ? String(parsed.notes).slice(0, 500) : '',
          status: parsed.status ? String(parsed.status).slice(0, 40) : 'registered',
          source: parsed.source ? String(parsed.source).slice(0, 80) : 'manual',
        });
        return send(res, 200, JSON.stringify({ ok: true, registry: next }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid payload' }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to register model' })));
  return true;
}

if (req.method === 'POST' && pathname === '/api/control/model-registry/promote') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const targetStage = String(parsed.toStage || '').trim();
        const latestGate = targetStage === 'candidate' ? getLatestGateEvaluation() : null;
        if (
          targetStage === 'candidate'
          && MODEL_GATE_BLOCK_CANDIDATE
          && latestGate
          && latestGate.pass === false
          && !parsed.allowUnsafe
        ) {
          return send(res, 409, JSON.stringify({
            ok: false,
            code: 'GATE_BLOCKED',
            error: 'Candidate promotion blocked by failed gate',
            gate: latestGate,
          }));
        }
        const next = promoteModel({
          modelTag: parsed.modelTag,
          toStage: targetStage,
          by: parsed.by || 'api',
          notes: parsed.notes || '',
          allowUnsafe: !!parsed.allowUnsafe,
        });
        if (targetStage === 'primary') {
          setCurrentModelOverride(parsed.modelTag);
        }
        let warning = null;
        if (targetStage === 'candidate' && latestGate && latestGate.pass === false) {
          warning = {
            code: 'GATE_FAILED_SOFT',
            message: 'Candidate promotion succeeded, but latest gate did not pass.',
            gate: {
              id: latestGate.id || '',
              createdAt: latestGate.createdAt || '',
              pass: false,
              reasons: Array.isArray(latestGate.reasons) ? latestGate.reasons : [],
              metrics: latestGate.metrics || {},
            },
          };
        }
        return send(res, 200, JSON.stringify({
          ok: true,
          registry: next,
          gate: latestGate,
          warning,
        }));
      } catch (e) {
        const code = e.code || '';
        const status = (code === 'UNKNOWN_MODEL' || code === 'INVALID_STAGE' || code === 'INVALID_PROMOTION_PATH') ? 400 : 500;
        return send(res, status, JSON.stringify({ ok: false, error: e.message || 'Promotion failed', code }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Promotion failed' })));
  return true;
}

if (req.method === 'POST' && pathname === '/api/control/model-registry/rollback') {
  readBody(req)
    .then((body) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const next = rollbackModel({
          by: parsed.by || 'api',
          notes: parsed.notes || '',
          targetModel: parsed.targetModel || '',
        });
        if (next.stages && next.stages.primary) {
          setCurrentModelOverride(next.stages.primary);
        }
        return send(res, 200, JSON.stringify({ ok: true, registry: next }));
      } catch (e) {
        const code = e.code || '';
        const status = (code === 'NO_ROLLBACK_TARGET' || code === 'UNKNOWN_MODEL') ? 400 : 500;
        return send(res, status, JSON.stringify({ ok: false, error: e.message || 'Rollback failed', code }));
      }
    })
    .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Rollback failed' })));
  return true;
}
if (req.method === 'GET' && pathname === '/api/ea-alerts') {
  let list = [];
  try {
    if (fs.existsSync(EA_ALERTS_FILE)) {
      const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    }
  } catch (_) {}
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const alerts = list.filter((a) => (a.at || 0) > cutoff).sort((a, b) => (b.at || 0) - (a.at || 0));
  return send(res, 200, JSON.stringify({ alerts }));
}

// —— EA Phase 4: delivery preferences (quiet hours) ——
if (req.method === 'GET' && pathname === '/api/ea-preferences') {
  const prefs = loadMobilePreferences();
  return send(res, 200, JSON.stringify(prefs));
}
if (req.method === 'PUT' && pathname === '/api/ea-preferences') {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      const next = saveMobilePreferences(data, data && data.expectedUpdatedAt ? String(data.expectedUpdatedAt) : '');
      return send(res, 200, JSON.stringify(next));
    } catch (e) {
      if (e && e.code === 'PREFERENCES_CONFLICT') {
        return send(res, 409, JSON.stringify({ error: 'Preferences version conflict', code: e.code, current: e.current || loadMobilePreferences() }));
      }
      return send(res, 400, JSON.stringify({ error: e.message || 'Bad request' }));
    }
  });
  return true;
}
if (req.method === 'GET' && pathname === '/api/control') {
  const controlTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  let ollamaOk = false;
  try {
    await controlTimeout(ai('hi', { max_tokens: 2 }), 4000);
    ollamaOk = true;
  } catch (_) {}
  const intents = loadIntents();
  const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
  const reminders = intents.filter((i) => i.type === 'reminder');
  const scheduled = intents.filter((i) => i.type === 'scheduled');
  const now = new Date();
  const reminderDue = (r) => r.dueAt || r.time;
  const scheduledRun = (s) => s.dueAt || s.run;
  const futureReminders = reminders.filter((r) => new Date(reminderDue(r) || 0) > now).sort((a, b) => new Date(reminderDue(a)) - new Date(reminderDue(b)));
  const futureScheduled = scheduled.filter((s) => new Date(scheduledRun(s) || 0) > now).sort((a, b) => new Date(scheduledRun(a)) - new Date(scheduledRun(b)));
  const nextReminder = futureReminders[0];
  const nextScheduled = futureScheduled[0];
  let pendingCount = 0;
  try {
    const raw = fs.readFileSync(PENDING_NOTIFICATIONS_FILE, 'utf8');
    pendingCount = raw.split('\n').filter(Boolean).length;
  } catch (_) {}
  let lastMoltbookPostAt = null;
  let nextMoltbookPostEligibleAt = null;
  let lastMoltbookPostUrl = null;
  try {
    const lastPostRaw = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post.txt'), 'utf8').trim();
    const lastTs = Date.parse(lastPostRaw);
    if (!isNaN(lastTs)) {
      lastMoltbookPostAt = new Date(lastTs).toISOString();
      nextMoltbookPostEligibleAt = new Date(lastTs + 30 * 60 * 1000).toISOString();
    }
  } catch (_) {}
  let moltbookPosts = [];
  let moltbookProfile = null;
  if (MOLTBOOK_API_KEY) {
    try {
      await controlTimeout(
        (async () => {
          moltbookProfile = await fetchMoltbookProfile(MOLTBOOK_API_KEY);
          moltbookPosts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
          if (moltbookPosts.length && !lastMoltbookPostUrl) {
            lastMoltbookPostUrl = moltbookPosts[0].url;
          } else if (moltbookPosts.length && lastMoltbookPostUrl) {
            const byId = moltbookPosts.find((p) => p.url === lastMoltbookPostUrl);
            if (!byId && moltbookPosts[0]) lastMoltbookPostUrl = moltbookPosts[0].url;
          }
        })(),
        8000
      );
    } catch (e) {
      if (e.message !== 'timeout') log('warn', 'control-moltbook', { error: e.message });
    }
  }
  // Merge with local state so we show all posts we know about (API often returns only 1 recent).
  const statePath = path.join(DATA_DIR, 'moltbook-state.json');
  let postsFromLocal = 0;
  const apiPostsCount = moltbookPosts.length;
  if (fs.existsSync(statePath)) {
    try {
      let lastPostId = '';
      try {
        lastPostId = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post-id.txt'), 'utf8').trim();
      } catch (_) {}
      const stateRaw = fs.readFileSync(statePath, 'utf8');
      const state = JSON.parse(stateRaw);
      const localPosts = state.posts || [];
      if (!lastPostId && localPosts.length) lastPostId = (localPosts[localPosts.length - 1].id || '').toString().trim();
      if (lastPostId && !lastMoltbookPostUrl) lastMoltbookPostUrl = 'https://www.moltbook.com/post/' + lastPostId;
      const byId = new Map(moltbookPosts.map((p) => [String(p.id), p]));
      for (const p of localPosts) {
        const id = (p && p.id) ? String(p.id) : '';
        if (!id || byId.has(id)) continue;
        const rawTitle = (p.title || 'Post').slice(0, 80);
        const cleanTitle = stripWrappingQuotes(stripMarkdownFromText(rawTitle) || rawTitle) || stripMarkdownFromText(rawTitle) || rawTitle;
        byId.set(id, {
          id: p.id,
          title: cleanTitle,
          url: 'https://www.moltbook.com/post/' + id,
          createdAt: p.createdAt || null,
        });
        postsFromLocal += 1;
      }
      moltbookPosts = Array.from(byId.values()).sort((a, b) => {
        const ta = (a.createdAt && new Date(a.createdAt).getTime()) || 0;
        const tb = (b.createdAt && new Date(b.createdAt).getTime()) || 0;
        return tb - ta;
      });
      log('info', 'moltbook-merge', { apiPosts: apiPostsCount, localPosts: localPosts.length, mergedCount: moltbookPosts.length, statePath: statePath });
    } catch (e) {
      log('warn', 'moltbook-merge-fail', { error: e.message, statePath });
    }
  }
  let moltbookJournal = '';
  let moltbookPendingProposal = null;
  try {
    const journalPath = path.join(DATA_DIR, 'moltbook-journal.md');
    if (fs.existsSync(journalPath)) {
      const raw = fs.readFileSync(journalPath, 'utf8');
      moltbookJournal = raw.slice(-4000);
    }
  } catch (_) {}
  try {
    const proposalPath = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
    if (fs.existsSync(proposalPath)) {
      moltbookPendingProposal = fs.readFileSync(proposalPath, 'utf8').trim();
    }
  } catch (_) {}
  let pikoMemory = null;
  try {
    const memoryPath = path.join(DATA_DIR, 'piko-memory.json');
    if (fs.existsSync(memoryPath)) {
      const raw = fs.readFileSync(memoryPath, 'utf8');
      const m = JSON.parse(raw);
      if (m && typeof m.goals === 'object' && typeof m.metrics === 'object') pikoMemory = { goals: m.goals, metrics: m.metrics, lastCycle: m.lastCycle, selfAssessment: m.selfAssessment || null, cycleHistory: (m.cycleHistory || []).slice(0, 10) };
    }
  } catch (_) {}
  let moltbookLastRun = null;
  try {
    const lastRunPath = path.join(DATA_DIR, 'moltbook-last-run.txt');
    if (fs.existsSync(lastRunPath)) moltbookLastRun = fs.readFileSync(lastRunPath, 'utf8').trim();
  } catch (_) {}
  let moltbookFeedbackSignals = null;
  try {
    const feedbackPath = path.join(DATA_DIR, 'moltbook-feedback.json');
    if (fs.existsSync(feedbackPath)) {
      const raw = fs.readFileSync(feedbackPath, 'utf8');
      const fb = JSON.parse(raw);
      if (fb && typeof fb.signals === 'object' && Object.keys(fb.signals).length > 0) moltbookFeedbackSignals = { signals: fb.signals, lastUpdated: fb.lastUpdated || null };
    }
  } catch (_) {}
  // Learning velocity: causality, consolidation, sticky/tensions, Phase B, week number
  const nowMs = Date.now();
  const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
  const getISOWeek = (d) => {
    const dt = new Date(d);
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const dayMs = 86400000;
const days = (dt - yearStart) / dayMs;
return Math.ceil((days + 1) / 7);
  };
  let learningVelocity = {
    weekNumber: getISOWeek(nowMs),
    causalityPct: null,
    causalityFollowed: 0,
    causalityTotal: 0,
    consolidationCount: 0,
    refinementLinesCount: 0,
    stickyCount: 0,
    stickyNewThisWeek: false,
    tensionsCount: 0,
    tensionsFileUpdatedDaysAgo: null,
    phaseBTotal: 0,
    phaseBBreakdown: {},
  };
  if (pikoMemory && Array.isArray(pikoMemory.cycleHistory)) {
    const thisWeek = pikoMemory.cycleHistory.filter((c) => {
      const t = c.timestamp || c.lastCycle;
      return t && new Date(t).getTime() >= weekAgo;
    });
    const withEval = thisWeek.filter((c) => c.followedPlan === true || c.followedPlan === false);
    const followed = withEval.filter((c) => c.followedPlan === true).length;
    learningVelocity.causalityTotal = withEval.length;
    learningVelocity.causalityFollowed = followed;
    learningVelocity.causalityPct = withEval.length ? Math.round((followed / withEval.length) * 100) : null;
  }
  if (pikoMemory && pikoMemory.selfAssessment && Array.isArray(pikoMemory.selfAssessment.nextExperiments)) {
    learningVelocity.consolidationCount = pikoMemory.selfAssessment.nextExperiments.length;
  }
  try {
    const refinementsPath = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');
    if (fs.existsSync(refinementsPath)) {
      const raw = fs.readFileSync(refinementsPath, 'utf8');
      learningVelocity.refinementLinesCount = splitLines(raw).filter((l) => {
        const t = l.trim();
        return t.startsWith('- [') || t.startsWith('* [') || t.startsWith('- ');
      }).length;
    }
  } catch (_) {}
  try {
    const stickyPath = path.join(LEARNING_DIR, 'sticky-ideas.md');
    if (fs.existsSync(stickyPath)) {
      const raw = fs.readFileSync(stickyPath, 'utf8');
      learningVelocity.stickyCount = raw.split('\n').filter((l) => {
        const t = l.trim();
        return t.startsWith('- ') && !t.startsWith('#') && !t.toLowerCase().startsWith('- max ');
      }).length;
      try {
        const stat = fs.statSync(stickyPath);
        learningVelocity.stickyNewThisWeek = stat.mtimeMs >= weekAgo;
      } catch (_) {}
    }
    const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      learningVelocity.tensionsCount = raw.split('\n').filter((l) => {
        const t = l.trim();
        return t.startsWith('- ') && !t.startsWith('#') && !t.toLowerCase().startsWith('- max ');
      }).length;
      try {
        const stat = fs.statSync(tensionsPath);
        learningVelocity.tensionsFileUpdatedDaysAgo = Math.floor((nowMs - stat.mtimeMs) / (24 * 60 * 60 * 1000));
      } catch (_) {}
    }
  } catch (_) {}
  if (moltbookFeedbackSignals && typeof moltbookFeedbackSignals.signals === 'object') {
    const sig = moltbookFeedbackSignals.signals;
    learningVelocity.phaseBBreakdown = { ...sig };
    learningVelocity.phaseBTotal = Object.values(sig).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0);
  }
  // Weekly summary: this week vs last week for dashboard card
  let weeklySummary = { rabbitHoleNewThisWeek: 0, causalityTrend: null, phaseBSignalsUsed: learningVelocity.phaseBTotal || 0 };
  try {
    const rabbitPath = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
    if (fs.existsSync(rabbitPath)) {
      const raw = fs.readFileSync(rabbitPath, 'utf8');
      const blockDates = splitLines(raw).filter((l) => l.startsWith('## ') && startsWithYyyyMmDd(l.slice(3))).map((l) => l.slice(3, 13));
      const weekAgoDate = new Date(weekAgo);
      const y = weekAgoDate.getFullYear();
      const m = String(weekAgoDate.getMonth() + 1).padStart(2, '0');
      const d = String(weekAgoDate.getDate()).padStart(2, '0');
      const weekAgoStr = `${y}-${m}-${d}`;
      weeklySummary.rabbitHoleNewThisWeek = blockDates.filter((line) => {
        const match = (line.startsWith('## ') && startsWithYyyyMmDd(line.slice(3))) ? [null, line.slice(3, 13)] : null;
        return match && match[1] >= weekAgoStr;
      }).length;
    }
  } catch (_) {}
  if (pikoMemory && Array.isArray(pikoMemory.cycleHistory)) {
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    const lastWeek = pikoMemory.cycleHistory.filter((c) => {
      const t = c.timestamp || c.lastCycle;
      const ts = t ? new Date(t).getTime() : 0;
      return ts >= twoWeeksAgo && ts < weekAgo;
    });
    const lastWeekWithEval = lastWeek.filter((c) => c.followedPlan === true || c.followedPlan === false);
    const lastWeekFollowed = lastWeekWithEval.filter((c) => c.followedPlan === true).length;
    const lastWeekPct = lastWeekWithEval.length ? Math.round((lastWeekFollowed / lastWeekWithEval.length) * 100) : null;
    const thisPct = learningVelocity.causalityPct;
    if (thisPct != null && lastWeekPct != null) {
      const diff = thisPct - lastWeekPct;
      weeklySummary.causalityTrend = diff > 0 ? '↑' + diff + '%' : diff < 0 ? '↓' + Math.abs(diff) + '%' : '→0%';
      weeklySummary.causalityLastWeek = lastWeekPct;
      weeklySummary.causalityThisWeek = thisPct;
    }
  }
  let allowlist = {};
  try {
    allowlist = loadAllowlist();
  } catch (_) {}
  const linkedAccounts = loadLinkedAccounts();
  const integrations = {
    dailyMemoryEnabled: process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true',
    dailyMemoryDays: Math.min(30, Math.max(1, parseInt(process.env.PIKO_DAILY_MEMORY_DAYS || '7', 10))),
    telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN) && !!process.env.TELEGRAM_CHAT_ID,
    gmailConfigured: !!(process.env.GMAIL_ACCESS_TOKEN || (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET)),
    gmailOAuthAvailable: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
    slackConfigured: !!process.env.SLACK_BOT_TOKEN,
    slackOAuthAvailable: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
    notionConfigured: !!(process.env.NOTION_TOKEN || process.env.NOTION_API_KEY),
    notionOAuthAvailable: !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
    discordConfigured: !!(process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN),
    linkedAccounts: { gmail: linkedAccounts.gmail || null, slack: linkedAccounts.slack || null, notion: linkedAccounts.notion || null },
    eaGmailMinUnread: Math.max(0, parseInt(process.env.PIKO_EA_GMAIL_MIN_UNREAD || '1', 10)),
    eaUseLlmSynthesis: process.env.PIKO_EA_USE_LLM_SYNTHESIS === '1' || process.env.PIKO_EA_USE_LLM_SYNTHESIS === 'true',
    eaImessageConfigured: !!(process.env.PIKO_EA_IMESSAGE_CHAT_GUID && process.env.BLUEBUBBLES_URL && process.env.BLUEBUBBLES_API_KEY),
    eaPrepMeeting: process.env.PIKO_EA_PREP_MEETING === '1' || process.env.PIKO_EA_PREP_MEETING === 'true',
    eaGmailReadBody: process.env.PIKO_EA_GMAIL_READ_BODY === '1' || process.env.PIKO_EA_GMAIL_READ_BODY === 'true',
  };
  let connectorHealth = {};
  try {
    connectorHealth = await getConnectorHealth(buildConnectorContext());
  } catch (_) {}
  let legionAdapterHealth = null;
  try {
    const { checkLegionAdapterHealth } = require('../lib/legionAdapterHealth');
    legionAdapterHealth = await checkLegionAdapterHealth({ baseUrl: LEGION_ADAPTER_API_BASE });
  } catch (_) {}
  let mobileDevices = { totalDevices: 0, devices: [] };
  try {
    mobileDevices = listDevices(5);
  } catch (_) {}
  let eaAlertsCount = 0;
  try {
    if (fs.existsSync(EA_ALERTS_FILE)) {
      const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        eaAlertsCount = list.filter((a) => (a.at || 0) > cutoff).length;
      }
    }
  } catch (_) {}
  let proactive = null;
  try {
    proactive = proactiveEngine.getStatus(10);
  } catch (_) {}
  const payload = {
    health: { ollama: ollamaOk, model: OLLAMA_MODEL },
    integrations,
    legionAdapterHealth,
    connectorHealth,
    mobileDevices: {
      totalDevices: mobileDevices.totalDevices || 0,
      recent: Array.isArray(mobileDevices.devices) ? mobileDevices.devices.slice(0, 5) : [],
    },
    proactive: proactive ? {
      summary: proactive.summary,
      recentEvents: (proactive.events || []).slice(0, 5),
    } : null,
    eaAlertsCount,
    allowlist,
    moltbook: { profile: moltbookProfile, lastPostAt: lastMoltbookPostAt, nextPostEligibleAt: nextMoltbookPostEligibleAt, lastPostUrl: lastMoltbookPostUrl, posts: moltbookPosts, postsFromLocal: postsFromLocal, note: 'Cron runs every 30 min at :00 and :30', journal: moltbookJournal, pendingProposal: moltbookPendingProposal, memory: pikoMemory, lastRun: moltbookLastRun, feedbackSignals: moltbookFeedbackSignals },
    learningVelocity,
    weeklySummary,
    intentsCount: intents.length,
    queueLength: queue.length,
    remindersCount: reminders.length,
    scheduledCount: scheduled.length,
    pendingCount,
    sessionsCount: sessionStore.getSessionCount(),
    nextReminderAt: nextReminder ? (nextReminder.dueAt || nextReminder.time) : null,
    nextReminderText: nextReminder ? (nextReminder.title || nextReminder.message || nextReminder.text || '').slice(0, 60) : null,
    nextScheduledRun: nextScheduled ? (nextScheduled.dueAt || nextScheduled.run) : null,
    nextScheduledCommand: nextScheduled ? (nextScheduled.command || '').slice(0, 60) : null,
  };
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
    if (gpus.length) payload.gpuTemps = gpus;
  } catch (_) {}
  return send(res, 200, JSON.stringify(payload));
}

// —— Control: list/get/put prompt and config .md files (whitelist only) ——
const PROMPTS_WHITELIST = [
  { id: 'IDENTITY', file: 'IDENTITY.md', description: 'Who Piko is (system identity)' },
  { id: 'SOUL', file: 'SOUL.md', description: 'Piko’s soul / personality' },
  { id: 'INTERESTS', file: 'INTERESTS.md', description: 'Interests and topics' },
  { id: 'MEMORY', file: 'MEMORY.md', description: 'Durable memory facts' },
  { id: 'MOLTBOOK_AIM', file: 'MOLTBOOK_AIM.md', description: 'What Piko posts about on Moltbook' },
  { id: 'MOLTBOOK_REFINEMENTS', file: 'MOLTBOOK_REFINEMENTS.md', description: 'Approved Moltbook refinements' },
  { id: 'MOLTBOOK_POST_CONFIG', file: 'MOLTBOOK_POST_CONFIG.md', description: 'Post length (title_max_chars, body_max_chars)' },
];
if (req.method === 'GET' && pathname === '/api/control/prompts') {
  const list = PROMPTS_WHITELIST.map(({ id, file, description }) => ({ id, file, description }));
  return send(res, 200, JSON.stringify({ prompts: list }));
}
const promptsMatch = pathname && matchPath(pathname, '/api/control/prompts/:id');
if (promptsMatch) {
  const id = promptsMatch.id.toUpperCase().split('-').join('_');
  const entry = PROMPTS_WHITELIST.find((e) => e.id === id || e.file.toLowerCase() === id.toLowerCase() + '.md');
  if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown prompt id' }));
  const filePath = path.join(PROMPTS_DIR, entry.file);
  if (req.method === 'GET') {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return send(res, 200, JSON.stringify({ id: entry.id, file: entry.file, description: entry.description, content }));
    } catch (e) {
      if (e.code === 'ENOENT') return send(res, 200, JSON.stringify({ id: entry.id, file: entry.file, description: entry.description, content: '' }));
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'PUT') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const content = typeof body.content === 'string' ? body.content : '';
    try {
      fs.mkdirSync(PROMPTS_DIR, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, id: entry.id }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
}

const MOLTBOOK_PENDING_PROPOSAL_FILE = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
const MOLTBOOK_REFINEMENTS_FILE = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');

if (req.method === 'POST' && pathname === '/api/control/integrations/telegram') {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : (body.chat_id != null ? String(body.chat_id).trim() : '');
  if (!token) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing token' }));
  if (!chatId) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing chatId' }));
  persistEnvVar('TELEGRAM_BOT_TOKEN', token);
  persistEnvVar('TELEGRAM_CHAT_ID', chatId);
  return send(res, 200, JSON.stringify({ ok: true, message: 'Telegram connected.' }));
}
if (req.method === 'POST' && pathname === '/api/control/integrations/imessage') {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
  }
  const url = typeof body.blueBubblesUrl === 'string' ? body.blueBubblesUrl.trim() : (body.url && String(body.url).trim()) || '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : (body.api_key && String(body.api_key).trim()) || '';
  const chatGuid = typeof body.chatGuid === 'string' ? body.chatGuid.trim() : (body.chat_guid && String(body.chat_guid).trim()) || '';
  if (!url || !apiKey || !chatGuid) {
    return send(res, 400, JSON.stringify({ ok: false, error: 'Missing blueBubblesUrl, apiKey, or chatGuid' }));
  }
  persistEnvVar('BLUEBUBBLES_URL', url);
  persistEnvVar('BLUEBUBBLES_API_KEY', apiKey);
  persistEnvVar('PIKO_EA_IMESSAGE_CHAT_GUID', chatGuid);
  return send(res, 200, JSON.stringify({ ok: true, message: 'iMessage (EA) connected.' }));
}
if (req.method === 'POST' && pathname === '/api/control/integrations/discord') {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid JSON' }));
  }
  const token = typeof body.token === 'string' ? body.token.trim() : (body.botToken && String(body.botToken).trim()) || '';
  if (!token) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing token' }));
  persistEnvVar('DISCORD_TOKEN', token);
  return send(res, 200, JSON.stringify({ ok: true, message: 'Discord connected.' }));
}
if (req.method === 'POST' && pathname === '/api/control/integrations/gmail/disable') {
  clearEnvVar('GMAIL_REFRESH_TOKEN');
  clearEnvVar('GMAIL_ACCESS_TOKEN');
  const linked = loadLinkedAccounts();
  delete linked.gmail;
  saveLinkedAccounts(linked);
  return send(res, 200, JSON.stringify({ ok: true, message: 'Gmail disconnected.' }));
}
if (req.method === 'POST' && pathname === '/api/control/integrations/slack/disable') {
  clearEnvVar('SLACK_BOT_TOKEN');
  const linked = loadLinkedAccounts();
  delete linked.slack;
  saveLinkedAccounts(linked);
  return send(res, 200, JSON.stringify({ ok: true, message: 'Slack disconnected.' }));
}
if (req.method === 'POST' && pathname === '/api/control/integrations/notion/disable') {
  clearEnvVar('NOTION_TOKEN');
  clearEnvVar('NOTION_REFRESH_TOKEN');
  const linked = loadLinkedAccounts();
  delete linked.notion;
  saveLinkedAccounts(linked);
  return send(res, 200, JSON.stringify({ ok: true, message: 'Notion disconnected.' }));
}

if (req.method === 'POST' && pathname === '/api/control/aim-approve') {
  let proposal = '';
  try {
    proposal = fs.readFileSync(MOLTBOOK_PENDING_PROPOSAL_FILE, 'utf8').trim();
  } catch (_) {}
  if (!proposal) return send(res, 200, JSON.stringify({ ok: false, error: 'No pending proposal' }));
  const dateStr = new Date().toISOString().slice(0, 10);
  const line = '- [' + dateStr + '] ' + splitLines(proposal).map((l) => stripListMarker(l)).filter(Boolean).join('; ') + '\n';
  try {
    fs.appendFileSync(MOLTBOOK_REFINEMENTS_FILE, line, 'utf8');
  } catch (e) {
    return send(res, 200, JSON.stringify({ ok: false, error: e.message }));
  }
  try { fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE); } catch (_) {}
  return send(res, 200, JSON.stringify({ ok: true }));
}
if (req.method === 'POST' && pathname === '/api/control/session-reset') {
  let body;
  try {
    body = await new Promise((res, rej) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => { try { res(JSON.parse(data || '{}')); } catch (e) { rej(e); } });
      req.on('error', rej);
    });
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
  }
  const sid = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sid) return send(res, 400, JSON.stringify({ error: 'Missing sessionId' }));
  (async () => {
    try {
      const { flushSessionToVectorMemory } = require('../lib/vectorMemory');
      await flushSessionToVectorMemory(sid);
    } catch (_) {}
    sessionStore.clear(sid);
    log('info', 'session-reset', { sessionId: sid }, req.requestId);
    return send(res, 200, JSON.stringify({ ok: true, message: 'Session history cleared.' }));
  })().catch((e) => {
    log('error', 'session-reset', { error: e.message, sessionId: sid }, req.requestId);
    return send(res, 500, JSON.stringify({ error: e.message }));
  });
  return true;
}
if (req.method === 'POST' && pathname === '/api/control/aim-reject') {
  try {
    fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
  } catch (_) {}
  return send(res, 200, JSON.stringify({ ok: true }));
}

if (req.method === 'POST' && pathname === '/api/control/moltbook-prune') {
  const key = MOLTBOOK_API_KEY;
  if (!key) return send(res, 400, JSON.stringify({ error: 'MOLTBOOK_API_KEY not set' }));
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const postIds = Array.isArray(body.postIds) ? body.postIds.map((id) => String(id).trim()).filter(Boolean) : [];
  if (postIds.length === 0) return send(res, 200, JSON.stringify({ pruned: 0, failed: 0 }));
  let pruned = 0;
  let failed = 0;
  const errors = [];
  for (const id of postIds) {
    try {
      const opts = { hostname: 'www.moltbook.com', port: 443, path: '/api/v1/posts/' + encodeURIComponent(id), method: 'DELETE', headers: { 'Authorization': 'Bearer ' + key } };
      const { statusCode } = await httpsRequest(opts);
      if (statusCode >= 200 && statusCode < 300) pruned++;
      else { failed++; errors.push({ id, status: statusCode }); }
    } catch (e) { failed++; errors.push({ id, error: e.message }); }
  }
  return send(res, 200, JSON.stringify({ pruned, failed, errors: errors.length ? errors : undefined }));
}

// —— Control: Learning repo API (Notion-style databases: sticky-ideas, tensions, rabbit-hole) ——
const LEARNING_DATABASES = [
  { id: 'sticky-ideas', name: 'Sticky ideas', description: 'Ideas Piko keeps in mind' },
  { id: 'tensions', name: 'Tensions', description: 'Max 5 tensions to reflect on' },
  { id: 'rabbit-hole', name: 'Rabbit-hole notes', description: 'Exploration notes by date/topic' },
];
const STICKY_IDEAS_FILE_CONTROL = path.join(LEARNING_DIR, 'sticky-ideas.md');
const TENSIONS_FILE_CONTROL = path.join(LEARNING_DIR, 'tensions.md');
const RABBIT_HOLE_NOTES_FILE_CONTROL = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');

function readStickyIdeasControl() {
  if (!fs.existsSync(STICKY_IDEAS_FILE_CONTROL)) return [];
  const raw = fs.readFileSync(STICKY_IDEAS_FILE_CONTROL, 'utf8');
  const lines = splitLines(raw).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
      items.push(line.slice(2).trim());
    }
  }
  return items;
}
function readTensionsControl() {
  if (!fs.existsSync(TENSIONS_FILE_CONTROL)) return [];
  const raw = fs.readFileSync(TENSIONS_FILE_CONTROL, 'utf8');
  const lines = splitLines(raw).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
      items.push(line.slice(2).trim());
    }
  }
  return items;
}
function readRabbitHoleBlocksControl() {
  if (!fs.existsSync(RABBIT_HOLE_NOTES_FILE_CONTROL)) return [];
  const raw = fs.readFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, 'utf8');
  const blocks = splitMarkdownH2(raw).filter((b) => b.trim());
  return blocks.map((block) => {
    const titleLine = splitLines(block)[0] || '';
    const title = titleLine.trim().slice(0, 80);
    return { title, content: ('## ' + block).trim() };
  });
}

if (req.method === 'GET' && pathname === '/api/control/search') {
  const { query } = parseUrl(req.url);
  const q = (query && query.q && String(query.q).trim()) || '';
  const results = { learning: [], moltbook: [], journal: [], prompts: [] };
  const lower = q.toLowerCase();
  if (lower.length < 2) return send(res, 200, JSON.stringify(results));
  try {
    const stickyPath = path.join(LEARNING_DIR, 'sticky-ideas.md');
    if (fs.existsSync(stickyPath)) {
      const raw = fs.readFileSync(stickyPath, 'utf8');
      raw.split('\n').forEach((line) => {
        const t = line.trim();
        if (t.startsWith('- ') && !t.startsWith('#') && t.toLowerCase().indexOf(lower) !== -1) {
          results.learning.push({ type: 'sticky', text: t.slice(2).trim().slice(0, 80), id: 'sticky-ideas' });
        }
      });
    }
    const tensionsPath = path.join(LEARNING_DIR, 'tensions.md');
    if (fs.existsSync(tensionsPath)) {
      const raw = fs.readFileSync(tensionsPath, 'utf8');
      let i = 0;
      raw.split('\n').forEach((line) => {
        const t = line.trim();
        if (t.startsWith('- ') && !t.startsWith('#') && t.toLowerCase().indexOf(lower) !== -1) {
          i++;
          results.learning.push({ type: 'tension', text: t.slice(2).trim().slice(0, 80), id: 'tensions', label: 'Tension #' + i });
        }
      });
    }
    const rabbitPath = path.join(LEARNING_DIR, 'rabbit-hole-notes.md');
    if (fs.existsSync(rabbitPath)) {
      const raw = fs.readFileSync(rabbitPath, 'utf8');
      const blocks = splitMarkdownH2(raw).filter((b) => { const t=b.trim(); return t && startsWithYyyyMmDd(t); });
      blocks.forEach((block) => {
        if (block.toLowerCase().indexOf(lower) === -1) return;
        const firstLine = splitLines(block)[0] || '';
        const title = firstLine.trim().slice(0, 60);
        results.learning.push({ type: 'rabbit-hole', text: title, id: 'rabbit-hole' });
      });
    }
  } catch (_) {}
  try {
    const journalPath = path.join(DATA_DIR, 'moltbook-journal.md');
    if (fs.existsSync(journalPath)) {
      const raw = fs.readFileSync(journalPath, 'utf8');
      const chunk = raw.slice(-8000);
      const lines = chunk.split('\n');
      let count = 0;
      for (let i = 0; i < lines.length && count < 5; i++) {
        if (lines[i].toLowerCase().indexOf(lower) !== -1) {
          count++;
          results.journal.push({ text: lines[i].trim().slice(0, 100), line: i + 1 });
        }
      }
    }
  } catch (_) {}
  try {
    const statePath = path.join(DATA_DIR, 'moltbook-state.json');
    if (fs.existsSync(statePath)) {
      const stateRaw = fs.readFileSync(statePath, 'utf8');
      const state = JSON.parse(stateRaw);
      const posts = state.posts || [];
      posts.forEach((p) => {
        const title = replaceAllLiteral((p && p.title || 'Post'), '**', '');
        if (title.toLowerCase().indexOf(lower) !== -1) {
          results.moltbook.push({ text: title.slice(0, 60), date: p.createdAt, url: p.id ? 'https://www.moltbook.com/post/' + p.id : null, id: p.id });
        }
      });
    }
  } catch (_) {}
  return send(res, 200, JSON.stringify(results));
}
if (req.method === 'GET' && pathname === '/api/control/learning') {
  return send(res, 200, JSON.stringify({ databases: LEARNING_DATABASES }));
}
const TOPICS_FILE_CONTROL = path.join(LEARNING_DIR, 'topics.txt');
if (pathname === '/api/control/learning/topics') {
  if (req.method === 'GET') {
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const raw = fs.existsSync(TOPICS_FILE_CONTROL) ? fs.readFileSync(TOPICS_FILE_CONTROL, 'utf8') : '';
      const topics = splitLines(raw).map((l) => l.trim()).filter(Boolean);
      return send(res, 200, JSON.stringify({ topics }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const toAdd = [];
    if (typeof body.topic === 'string' && body.topic.trim()) toAdd.push(body.topic.trim());
    if (Array.isArray(body.topics)) toAdd.push(...body.topics.map((t) => String(t).trim()).filter(Boolean));
    if (toAdd.length === 0) return send(res, 400, JSON.stringify({ error: 'Provide topic or topics (string or array)' }));
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const existing = fs.existsSync(TOPICS_FILE_CONTROL) ? fs.readFileSync(TOPICS_FILE_CONTROL, 'utf8') : '';
      const line = (existing.trim() ? '\n' : '') + toAdd.join('\n') + '\n';
      fs.appendFileSync(TOPICS_FILE_CONTROL, line, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, added: toAdd.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  return send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }));
}
const SUGGESTED_TOPICS_FILE_CONTROL = path.join(LEARNING_DIR, 'suggested-topics.txt');
if (pathname === '/api/control/learning/suggest' && req.method === 'POST') {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const toAdd = [];
  if (typeof body.topic === 'string' && body.topic.trim()) toAdd.push(body.topic.trim());
  if (Array.isArray(body.topics)) toAdd.push(...body.topics.map((t) => String(t).trim()).filter(Boolean));
  if (toAdd.length === 0) return send(res, 400, JSON.stringify({ error: 'Provide topic or topics (string or array)' }));
  try {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const existing = fs.existsSync(SUGGESTED_TOPICS_FILE_CONTROL) ? fs.readFileSync(SUGGESTED_TOPICS_FILE_CONTROL, 'utf8') : '';
    const line = (existing.trim() ? '\n' : '') + toAdd.join('\n') + '\n';
    fs.appendFileSync(SUGGESTED_TOPICS_FILE_CONTROL, line, 'utf8');
    return send(res, 200, JSON.stringify({ ok: true, added: toAdd.length, message: 'Topic(s) queued for next rabbit-hole run' }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
}
if (pathname === '/api/control/learning/suggest' && req.method === 'GET') {
  try {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const raw = fs.existsSync(SUGGESTED_TOPICS_FILE_CONTROL) ? fs.readFileSync(SUGGESTED_TOPICS_FILE_CONTROL, 'utf8') : '';
    const topics = splitLines(raw).map((l) => l.trim()).filter(Boolean);
    return send(res, 200, JSON.stringify({ suggested: topics }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
}
const learningMatch = pathname && matchPath(pathname, '/api/control/learning/:id');
if (learningMatch) {
  const id = learningMatch.id;
  const entry = LEARNING_DATABASES.find((e) => e.id === id);
  if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown learning database' }));
  if (req.method === 'GET') {
    try {
      if (id === 'sticky-ideas') return send(res, 200, JSON.stringify({ id, ...entry, items: readStickyIdeasControl() }));
      if (id === 'tensions') return send(res, 200, JSON.stringify({ id, ...entry, items: readTensionsControl() }));
      if (id === 'rabbit-hole') return send(res, 200, JSON.stringify({ id, ...entry, blocks: readRabbitHoleBlocksControl() }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  if (req.method === 'PUT') {
    let body;
    try {
      body = await readBody(req);
      body = body ? JSON.parse(body) : {};
    } catch (_) {
      return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
    }
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      if (id === 'sticky-ideas') {
        const items = Array.isArray(body.items) ? body.items.map((s) => String(s).trim()).filter(Boolean) : [];
        const content = '# Piko sticky ideas\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
        fs.writeFileSync(STICKY_IDEAS_FILE_CONTROL, content, 'utf8');
      } else if (id === 'tensions') {
        const items = Array.isArray(body.items) ? body.items.map((s) => String(s).trim()).filter(Boolean) : [];
        const content = '# Piko tensions (synced from Notion)\n\nMax 5 entries.\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
        fs.writeFileSync(TENSIONS_FILE_CONTROL, content, 'utf8');
      } else if (id === 'rabbit-hole') {
        const blocks = Array.isArray(body.blocks) ? body.blocks : [];
        const datePrefix = new Date().toISOString().slice(0, 10);
        const lines = ['# Piko rabbit-hole notes\n'];
        for (const b of blocks) {
          const title = (b.title || '').trim() || datePrefix + ': Note';
          const t = startsWithYyyyMmDd(title) ? title : datePrefix + ': ' + title;
          lines.push('## ' + t);
          lines.push((b.content || '').trim());
          lines.push('');
        }
        fs.writeFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, lines.join('\n'), 'utf8');
      }
      return send(res, 200, JSON.stringify({ ok: true, id }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }
  return send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }));
}
const learningArchiveMatch = pathname && matchPath(pathname, '/api/control/learning/:id/archive');
if (req.method === 'POST' && learningArchiveMatch) {
  const id = learningArchiveMatch.id;
  const entry = LEARNING_DATABASES.find((e) => e.id === id);
  if (!entry) return send(res, 404, JSON.stringify({ error: 'Unknown learning database' }));
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const indices = Array.isArray(body.indices) ? body.indices.map((i) => parseInt(i, 10)).filter((n) => !isNaN(n) && n >= 0) : [];
  if (indices.length === 0) return send(res, 200, JSON.stringify({ ok: true, archived: 0 }));
  try {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const ARCHIVED_STICKY = path.join(LEARNING_DIR, 'sticky-ideas-archived.md');
    const ARCHIVED_TENSIONS = path.join(LEARNING_DIR, 'tensions-archived.md');
    const ARCHIVED_RABBIT = path.join(LEARNING_DIR, 'rabbit-hole-notes-archived.md');
    if (id === 'sticky-ideas') {
      const items = readStickyIdeasControl();
      const toArchive = indices.filter((i) => i < items.length).sort((a, b) => b - a);
      const archived = toArchive.map((i) => items[i]);
      const remaining = items.filter((_, i) => !toArchive.includes(i));
      const header = '# Piko sticky ideas (archived)\n\n';
      const line = archived.map((s) => '- ' + s).join('\n') + '\n';
      try { fs.appendFileSync(ARCHIVED_STICKY, (fs.existsSync(ARCHIVED_STICKY) ? '' : header) + line, 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_STICKY, header + line, 'utf8'); }
      fs.writeFileSync(STICKY_IDEAS_FILE_CONTROL, '# Piko sticky ideas\n\n' + remaining.map((s) => '- ' + s).join('\n') + '\n', 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
    }
    if (id === 'tensions') {
      const items = readTensionsControl();
      const toArchive = indices.filter((i) => i < items.length).sort((a, b) => b - a);
      const archived = toArchive.map((i) => items[i]);
      const remaining = items.filter((_, i) => !toArchive.includes(i));
      const header = '# Piko tensions (archived)\n\n';
      const line = archived.map((s) => '- ' + s).join('\n') + '\n';
      try { fs.appendFileSync(ARCHIVED_TENSIONS, (fs.existsSync(ARCHIVED_TENSIONS) ? '' : header) + line, 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_TENSIONS, header + line, 'utf8'); }
      fs.writeFileSync(TENSIONS_FILE_CONTROL, '# Piko tensions (synced from Notion)\n\nMax 5 entries.\n\n' + remaining.map((s) => '- ' + s).join('\n') + '\n', 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
    }
    if (id === 'rabbit-hole') {
      const blocks = readRabbitHoleBlocksControl();
      const toArchive = indices.filter((i) => i < blocks.length).sort((a, b) => b - a);
      const archived = toArchive.map((i) => blocks[i]);
      const remaining = blocks.filter((_, i) => !toArchive.includes(i));
      const datePrefix = new Date().toISOString().slice(0, 10);
      const lines = [];
      for (const b of archived) {
        const title = (b.title || '').trim() || datePrefix + ': Note';
        const t = startsWithYyyyMmDd(title) ? title : datePrefix + ': ' + title;
        lines.push('## ' + t);
        lines.push((b.content || '').trim());
        lines.push('');
      }
      const header = '# Piko rabbit-hole notes (archived)\n\n';
      try { fs.appendFileSync(ARCHIVED_RABBIT, (fs.existsSync(ARCHIVED_RABBIT) ? '' : header) + lines.join('\n'), 'utf8'); } catch (_) { fs.writeFileSync(ARCHIVED_RABBIT, header + lines.join('\n'), 'utf8'); }
      const mainLines = ['# Piko rabbit-hole notes\n'];
      for (const b of remaining) {
        const title = (b.title || '').trim() || datePrefix + ': Note';
        const t = startsWithYyyyMmDd(title) ? title : datePrefix + ': ' + title;
        mainLines.push('## ' + t);
        mainLines.push((b.content || '').trim());
        mainLines.push('');
      }
      fs.writeFileSync(RABBIT_HOLE_NOTES_FILE_CONTROL, mainLines.join('\n'), 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, archived: archived.length }));
    }
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
}
if (req.method === 'POST' && pathname === '/api/control/learning/preview') {
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const databaseId = (body.databaseId || body.database || '').trim() || 'sticky-ideas';
  const content = (body.content || '').trim().slice(0, 500);
  const title = (body.title || '').trim().slice(0, 120);
  const label = databaseId === 'rabbit-hole' ? 'a rabbit-hole note' : databaseId === 'tensions' ? 'a tension you\'re holding' : 'a sticky idea you\'re considering';
  const text = databaseId === 'rabbit-hole' && (title || content) ? (title ? title + '\n\n' : '') + content : content;
  if (!text) return send(res, 200, JSON.stringify({ preview: '' }));
  const userMsg = `This is ${label}:\n\n${text}\n\nIn one short sentence (under 15 words), say how you'd naturally mention this in conversation to the user. No preamble, just the sentence.`;
  try {
    const preview = (await ai(userMsg, { max_tokens: 80 })).trim().slice(0, 200);
    return send(res, 200, JSON.stringify({ preview }));
  } catch (e) {
    return send(res, 200, JSON.stringify({ preview: '', error: e.message }));
  }
}

  return false;
}

module.exports = {
  tryHandleControl,
  registerControlRoutes,
  isControlPath,
  canAccessControl,
  isControlApiPath,
};
