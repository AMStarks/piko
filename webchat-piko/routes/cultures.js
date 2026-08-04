/**
 * Cultures / EI API routes (P3.1b) — extracted from server.js.
 */
const path = require('path');

function registerCulturesRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  const paths = [
    ['GET', '/api/cultures/stats'],
    ['GET', '/api/cultures/items'],
    ['POST', '/api/cultures/review/run'],
    ['GET', '/api/cultures/flags'],
    ['GET', '/api/cultures/unsure'],
    ['GET', '/api/cultures/campaign'],
    ['GET', '/api/cultures/articles'],
    ['POST', '/api/cultures/articles'],
    ['GET', '/api/cultures/dossiers'],
    ['POST', '/api/cultures/campaign'],
    ['POST', '/api/cultures/ingest-url'],
    ['GET', '/api/cultures/review/rules'],
    ['PUT', '/api/cultures/review/rules'],
    ['GET', '/api/ei/text-scout/latest'],
    ['GET', '/api/ei/text-scout/reports'],
    ['POST', '/api/ei/text-scout/run'],
    ['GET', '/api/ei/eval/latest'],
    ['GET', '/api/ei/eval/reports'],
    ['POST', '/api/ei/eval/run'],
    ['GET', '/api/ei/engineering/tasks'],
    ['GET', '/api/llm-usage'],
  ];
  for (const [method, p] of paths) {
    registry.add(method, p, wrap(tryHandleCultures), {
      group: p.startsWith('/api/ei') || p.startsWith('/api/cultures') ? 'cultures' : 'other',
      auth: p.startsWith('/api/cultures') || p.startsWith('/api/ei') ? 'admin_session' : 'api_auth',
    });
  }
}

async function tryHandleCultures(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (
    !pathname.startsWith('/api/cultures')
    && !pathname.startsWith('/api/ei/')
    && pathname !== '/api/llm-usage'
  ) return false;
  const readBody = ctx.readBody;
  const matchPath = ctx.matchPath;
  const __dirname = ctx.rootDir;
  const getTenantBackgroundProfile = ctx.getTenantBackgroundProfile
    || require('../lib/tenantBackgroundJobs').getTenantBackgroundProfile;

  // Alias so inlined `return send(...)` exits the handler after responding.
  const _send = ctx.send;
  const send = (...args) => { _send(...args); return '__sent__'; };
  // —— Egyptian Insights cultures_cache browser ——
  if (req.method === 'GET' && pathname === '/api/cultures/stats') {
    try {
      const { getStats } = require('../lib/culturesCorpusApi');
      return send(res, 200, JSON.stringify(getStats()));
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 500;
      return send(res, code, JSON.stringify({ ok: false, error: e.message || 'cultures stats failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/items') {
    try {
      const { listItems } = require('../lib/culturesCorpusApi');
      const u = new URL(req.url, 'http://localhost');
      const out = listItems({
        q: u.searchParams.get('q') || '',
        site: u.searchParams.get('site') || '',
        source: u.searchParams.get('source') || '',
        type: u.searchParams.get('type') || '',
        flag: u.searchParams.get('flag') || '',
        limit: u.searchParams.get('limit'),
        offset: u.searchParams.get('offset'),
      });
      return send(res, 200, JSON.stringify(out));
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 500;
      return send(res, code, JSON.stringify({ ok: false, error: e.message || 'cultures list failed' }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/cultures/review/run') {
    try {
      const profile = getTenantBackgroundProfile(__dirname);
      if (!profile.isCulture) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'corpus review only on culture spine' }));
      }
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
      if (asyncMode) {
        const { enqueueAgentJob, isAgentOrchEnabled } = require('../lib/agentOrchestrator');
        if (!isAgentOrchEnabled(__dirname)) {
          return send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled' }));
        }
        const queued = enqueueAgentJob('agent_run', {
          agent_id: 'ei-corpus-reviewer',
          brief: parsed.brief || 'flag all corpus sources keep or drop',
        }, { rootDir: __dirname });
        return send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
      }
      const { runCorpusReview } = require('../lib/eiCorpusFlags');
      const out = await runCorpusReview({
        include_candidates: !!parsed.include_candidates,
      });
      return send(res, 200, JSON.stringify({
        ok: true,
        pass: out.pass,
        report: out.report,
        artifact_text: out.artifact_text,
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'corpus review failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/flags') {
    try {
      const { loadFlags } = require('../lib/eiCorpusFlags');
      return send(res, 200, JSON.stringify({ ok: true, ...loadFlags() }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'flags failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/unsure') {
    try {
      const { listUnsureQueue } = require('../lib/eiUnsureQueue');
      const u = new URL(req.url, 'http://localhost');
      const out = listUnsureQueue({ limit: u.searchParams.get('limit') });
      return send(res, 200, JSON.stringify(out));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'unsure queue failed' }));
    }
  }
  if (req.method === 'POST' && !!matchPath(pathname, '/api/cultures/unsure/:id/resolve')) {
    try {
      const { resolveUnsure } = require('../lib/eiUnsureQueue');
      const id = decodeURIComponent((matchPath(pathname, '/api/cultures/unsure/:id/resolve') || {}).id);
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const out = await resolveUnsure(id, parsed.action || parsed.verdict, {
        reason: parsed.reason,
        purge: parsed.purge,
        reviewer: 'operator',
      });
      return send(res, out.ok ? 200 : 400, JSON.stringify(out));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'unsure resolve failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/campaign') {
    try {
      const { getCampaignStatus } = require('../lib/eiResearchCampaign');
      return send(res, 200, JSON.stringify(getCampaignStatus()));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'campaign status failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/articles') {
    try {
      const { listArticles } = require('../lib/eiArticleWriter');
      return send(res, 200, JSON.stringify({ ok: true, articles: listArticles() }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'articles list failed' }));
    }
  }
  {
    const mArt = matchPath(pathname, '/api/cultures/articles/:id');
    if (req.method === 'GET' && mArt) {
      try {
        const { loadArticle } = require('../lib/eiArticleWriter');
        const art = loadArticle(mArt.id);
        if (!art) return send(res, 404, JSON.stringify({ ok: false, error: 'not_found' }));
        return send(res, 200, JSON.stringify({ ok: true, ...art }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'article get failed' }));
      }
    }
  }
  if (req.method === 'POST' && pathname === '/api/cultures/articles') {
    try {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const topic = String(parsed.topic || parsed.thread || '').trim();
      if (!topic) return send(res, 400, JSON.stringify({ ok: false, error: 'topic required' }));
      const { enqueueAgentJob } = require('../lib/agentOrchestrator');
      const queued = enqueueAgentJob('article_write', {
        topic,
        thread: parsed.thread || null,
        source: 'api',
      }, { rootDir: __dirname });
      return send(res, queued.ok ? 200 : 400, JSON.stringify(queued));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'article enqueue failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/dossiers') {
    try {
      const { listDossiers, THREAD_DEFS, dossierIsStale } = require('../lib/eiThreadDossiers');
      const dossiers = listDossiers();
      return send(res, 200, JSON.stringify({
        ok: true,
        threads: THREAD_DEFS.map((t) => t.id),
        dossiers: dossiers.map((d) => ({
          thread: d.thread,
          note_count: d.note_count,
          built_at: d.built_at,
          claims: (d.key_claims || []).length,
          gaps: (d.evidence_gaps || []).length,
          stale: dossierIsStale(d.thread),
          summary: (d.summary || '').slice(0, 240),
        })),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'dossiers list failed' }));
    }
  }
  {
    const m = matchPath(pathname, '/api/cultures/dossiers/:id'); /*dossier*/
    if (req.method === 'GET' && m) {
      try {
        const { loadDossier, buildDossier, dossierIsStale } = require('../lib/eiThreadDossiers');
        const thread = m.id.toLowerCase();
        const u = new URL(req.url, 'http://localhost');
        const rebuild = u.searchParams.get('rebuild') === '1' || u.searchParams.get('rebuild') === 'true';
        let dossier = loadDossier(thread);
        if (rebuild || !dossier) {
          const built = await buildDossier(thread);
          if (!built.ok) return send(res, 404, JSON.stringify(built));
          dossier = built.dossier;
        }
        return send(res, 200, JSON.stringify({
          ok: true,
          dossier,
          stale: dossierIsStale(thread),
        }));
      } catch (e) {
        return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'dossier get failed' }));
      }
    }
  }
  if (req.method === 'GET' && pathname === '/api/llm-usage') {
    try {
      const { aggregateLlmUsage } = require('../lib/llmUsage');
      const u = new URL(req.url, 'http://localhost');
      const hours = u.searchParams.get('hours');
      return send(res, 200, JSON.stringify(aggregateLlmUsage({ hours, rootDir: __dirname })));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'llm-usage failed' }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/cultures/campaign') {
    try {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const campaign = require('../lib/eiResearchCampaign');
      const action = String(parsed.action || '').toLowerCase();
      const adminAuth = ctx.adminAuth || require('../lib/adminAuth');
      const dataDir = ctx.dataDir || process.env.PIKO_DATA_DIR;
      if (adminAuth.isEnabled() && adminAuth.isOperatorOnlyCampaignAction(action)) {
        const session = adminAuth.getSessionFromRequest(req, dataDir);
        let apiKeyOk = false;
        if (!session) {
          try {
            const { keyMatches, presentedKey } = require('../lib/apiAuth');
            apiKeyOk = keyMatches(presentedKey(req, {}));
          } catch (_) { apiKeyOk = false; }
        }
        if (!session && !apiKeyOk) {
          return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized', login: '/admin/login' }));
        }
        if (session && session.role === 'client') {
          return send(res, 403, JSON.stringify({ ok: false, error: 'Operator access required' }));
        }
      }
      let out;
      if (action === 'start') {
        out = campaign.startCampaign({
          topic: parsed.topic,
          interval_minutes: parsed.interval_minutes,
          seeks_per_cycle: parsed.seeks_per_cycle,
        });
      } else if (action === 'pause') out = campaign.pauseCampaign();
      else if (action === 'resume') out = campaign.resumeCampaign();
      else if (action === 'stop') out = campaign.stopCampaign();
      else if (action === 'add_leads') out = campaign.addCampaignLeads(parsed.leads || []);
      else if (action === 'backfill_learning') {
        const { backfillCorpusLearning } = require('../lib/eiCorpusNotes');
        const bf = await backfillCorpusLearning({
          limit: parsed.limit != null ? Number(parsed.limit) : 40,
          deep: !!parsed.deep,
        });
        out = { ok: !!bf.ok, backfill: bf, status: campaign.getCampaignStatus().status };
      }
      else if (action === 'scorecard') {
        out = campaign.getLearningScorecard();
      }
      else if (action === 'findings') {
        const { readRecentFindings, maybeAppendDailyFindings } = require('../lib/eiImprovementLog');
        if (parsed.refresh) {
          const state = campaign.loadState();
          const appended = maybeAppendDailyFindings(state, { force: !!parsed.force });
          if (appended.ok && !appended.skipped) campaign.saveState(state);
          out = { ...readRecentFindings(parsed.limit), refreshed: appended };
        } else {
          out = readRecentFindings(parsed.limit);
        }
      }
      else if (action === 'flag_duplicate_urls') {
        out = campaign.flagDuplicateUrlKeeps({ limit: parsed.limit });
      }
      else if (action === 'run_now') {
        campaign.resetIdleStreak();
        const { enqueueAgentJob } = require('../lib/agentOrchestrator');
        const queued = enqueueAgentJob('campaign_cycle', { source: 'operator' }, { rootDir: __dirname });
        out = { ok: !!queued.ok, queued: queued.job || null, status: campaign.getCampaignStatus().status };
      } else {
        return send(res, 400, JSON.stringify({ ok: false, error: 'action must be start|pause|resume|stop|run_now|add_leads|backfill_learning|scorecard|findings|flag_duplicate_urls' }));
      }
      return send(res, out.ok ? 200 : 400, JSON.stringify(out));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'campaign action failed' }));
    }
  }
  if (req.method === 'POST' && pathname === '/api/cultures/ingest-url') {
    try {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const { runTool } = require('../lib/eiAgentTools');
      const out = await runTool('ingest_url', {
        url: parsed.url,
        note: parsed.note || parsed.mission || '',
        title: parsed.title || '',
      }, { goal: parsed.note || parsed.mission || `Ingest ${parsed.url}`, rootDir: __dirname });
      return send(res, out.ok ? 200 : 400, JSON.stringify(out));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'ingest-url failed' }));
    }
  }
  if (req.method === 'GET' && pathname === '/api/cultures/review/rules') {
    try {
      const { loadRules, formatRulesSummary, rulesPath } = require('../lib/corpusReviewRules');
      const rules = loadRules();
      return send(res, 200, JSON.stringify({
        ok: true,
        rules,
        summary: formatRulesSummary(rules),
        path: rulesPath(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'rules failed' }));
    }
  }
  if (req.method === 'PUT' && pathname === '/api/cultures/review/rules') {
    try {
      const profile = getTenantBackgroundProfile(__dirname);
      if (!profile.isCulture) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'corpus rules only on culture spine' }));
      }
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const { applyPatch, saveRules, normalizeRules, formatRulesSummary } = require('../lib/corpusReviewRules');
      let rules;
      if (parsed.patch && typeof parsed.patch === 'object') {
        rules = applyPatch(parsed.patch, { updated_by: parsed.updated_by || 'api' });
      } else if (parsed.rules && typeof parsed.rules === 'object') {
        rules = saveRules(normalizeRules(parsed.rules), { updated_by: parsed.updated_by || 'api' });
      } else {
        rules = applyPatch(parsed, { updated_by: parsed.updated_by || 'api' });
      }
      return send(res, 200, JSON.stringify({
        ok: true,
        rules,
        summary: formatRulesSummary(rules),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'rules save failed' }));
    }
  }
  if (req.method === 'POST' && matchPath(pathname, '/api/cultures/items/:id/flag')) {
    try {
      const id = (matchPath(pathname, '/api/cultures/items/:id/flag') || {}).id;
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
      const flag = String(parsed.flag || '').toLowerCase();
      if (!['keep', 'drop', 'review'].includes(flag)) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'flag must be keep|drop|review' }));
      }
      const { setFlag } = require('../lib/eiCorpusFlags');
      const entry = setFlag(id, {
        flag,
        reason: parsed.reason || 'manual',
        score: parsed.score,
        reviewer: parsed.reviewer || 'operator',
      });
      return send(res, 200, JSON.stringify({ ok: true, harvest_id: Number(id), ...entry }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'flag set failed' }));
    }
  }
  const culturesItemMatch = pathname && matchPath(pathname, '/api/cultures/items/:id');
  if (req.method === 'GET' && culturesItemMatch) {
    try {
      const { getItem } = require('../lib/culturesCorpusApi');
      const out = getItem(culturesItemMatch.id);
      return send(res, out.ok ? 200 : 404, JSON.stringify(out));
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 500;
      return send(res, code, JSON.stringify({ ok: false, error: e.message || 'cultures item failed' }));
    }
  }
  const culturesImageMatch = pathname && matchPath(pathname, '/api/cultures/items/:id/image');
  if (req.method === 'GET' && culturesImageMatch) {
    try {
      const { getImageBuffer } = require('../lib/culturesCorpusApi');
      const img = getImageBuffer(culturesImageMatch.id);
      if (!img) return send(res, 404, 'Not Found', 'text/plain');
      const ext = path.extname(img.path).toLowerCase();
      const type = ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
          : ext === '.gif' ? 'image/gif'
            : 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': img.buffer.length,
      });
      res.end(img.buffer);
      return true;
    } catch (e) {
      return send(res, 500, 'Internal Server Error', 'text/plain');
    }
  }
  const culturesDocMatch = pathname && matchPath(pathname, '/api/cultures/items/:id/document');
  if (req.method === 'GET' && culturesDocMatch) {
    try {
      const { getDocumentBuffer } = require('../lib/culturesCorpusApi');
      const doc = getDocumentBuffer(culturesDocMatch.id);
      if (!doc) return send(res, 404, 'Document not found', 'text/plain');
      const ext = path.extname(doc.path).toLowerCase();
      const type = ext === '.pdf' ? 'application/pdf'
        : ext === '.txt' ? 'text/plain; charset=utf-8'
          : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${replaceAllLiteral(String(doc.filename || 'document'), '"', '')}"`,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': doc.buffer.length,
      });
      res.end(doc.buffer);
      return true;
    } catch (e) {
      return send(res, 500, 'Internal Server Error', 'text/plain');
    }
  }

  // (agent job cancel / get / enqueue handled above via routes/agents.js)

  if (pathname.startsWith('/api/ei/eval') || pathname.startsWith('/api/ei/engineering') || pathname.startsWith('/api/ei/text-scout')) {
    try {
      const profile = getTenantBackgroundProfile(__dirname);
      if (!profile.isCulture) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'EI eval API only on culture spine' }));
      }
      const {
        readLatestReport,
        readReport,
        listReports,
        runPlatformEval,
      } = require('../lib/eiPlatformEval');
      const {
        listEngineeringTasks,
        processEngineeringTask,
        rejectEngineeringTask,
      } = require('../lib/eiEngineeringQueue');
      const {
        runTextScout,
        readLatestReport: readLatestScout,
        listReports: listScoutReports,
      } = require('../lib/eiTextScout');
      const { enqueueAgentJob, isAgentOrchEnabled } = require('../lib/agentOrchestrator');

      if (req.method === 'GET' && pathname === '/api/ei/text-scout/latest') {
        return send(res, 200, JSON.stringify({ ok: true, report: readLatestScout(__dirname) }));
      }
      if (req.method === 'GET' && pathname === '/api/ei/text-scout/reports') {
        const u = new URL(req.url, 'http://localhost');
        const limit = Math.min(50, Math.max(1, parseInt(u.searchParams.get('limit') || '20', 10) || 20));
        return send(res, 200, JSON.stringify({ ok: true, reports: listScoutReports(__dirname, limit) }));
      }
      if (req.method === 'POST' && pathname === '/api/ei/text-scout/run') {
        const body = await readBody(req);
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
        const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
        if (asyncMode) {
          if (!isAgentOrchEnabled(__dirname)) {
            return send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled' }));
          }
          const brief = parsed.brief
            || JSON.stringify({
              find: parsed.find !== false,
              assess: parsed.assess !== false,
              sites: parsed.sites || undefined,
              site: parsed.site || undefined,
              limit: parsed.limit,
              harvest_limit: parsed.harvest_limit,
            });
          const queued = enqueueAgentJob('agent_run', {
            agent_id: 'ei-text-scout',
            brief,
          }, { rootDir: __dirname });
          return send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
        }
        const out = await runTextScout({
          rootDir: __dirname,
          brief: parsed.brief || '',
          find: parsed.find,
          assess: parsed.assess,
          sites: parsed.sites,
          limit: parsed.limit,
          harvest_limit: parsed.harvest_limit,
          source: parsed.source || 'api',
        });
        return send(res, 200, JSON.stringify({
          ok: true,
          pass: out.pass,
          report: out.report,
          artifact_text: out.artifact_text,
        }));
      }

      if (req.method === 'GET' && pathname === '/api/ei/eval/latest') {
        const latest = readLatestReport(__dirname);
        return send(res, 200, JSON.stringify({ ok: true, report: latest }));
      }
      if (req.method === 'GET' && pathname === '/api/ei/eval/reports') {
        const u = new URL(req.url, 'http://localhost');
        const limit = Math.min(50, Math.max(1, parseInt(u.searchParams.get('limit') || '20', 10) || 20));
        return send(res, 200, JSON.stringify({ ok: true, reports: listReports(__dirname, limit) }));
      }
      const reportMatch = matchPath(pathname, '/api/ei/eval/reports/:id');
      if (req.method === 'GET' && reportMatch) {
        const report = readReport(decodeURIComponent(reportMatch.id), __dirname);
        if (!report) return send(res, 404, JSON.stringify({ ok: false, error: 'report not found' }));
        return send(res, 200, JSON.stringify({ ok: true, report }));
      }
      if (req.method === 'POST' && pathname === '/api/ei/eval/run') {
        const body = await readBody(req);
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
        const asyncMode = parsed.async === true || parsed.async === 1 || parsed.async === '1';
        if (asyncMode) {
          if (!isAgentOrchEnabled(__dirname)) {
            return send(res, 404, JSON.stringify({ ok: false, error: 'agent orchestration not enabled' }));
          }
          const queued = enqueueAgentJob('ei_platform_eval', {
            brief: parsed.brief || '',
            smoke: parsed.smoke,
            harvest: parsed.harvest,
            notify: parsed.notify !== false,
            notify_telegram: parsed.notify_telegram === true,
            source: parsed.source || 'api_async',
          }, { rootDir: __dirname });
          return send(res, queued.ok ? 202 : 400, JSON.stringify(queued));
        }
        const out = await runPlatformEval({
          rootDir: __dirname,
          brief: parsed.brief || '',
          smoke: parsed.smoke,
          harvest: parsed.harvest,
          notify: parsed.notify !== false,
          notifyTelegram: parsed.notify_telegram === true,
          source: parsed.source || 'api',
        });
        return send(res, 200, JSON.stringify({
          ok: true,
          pass: out.pass,
          report: out.report,
          artifact_text: out.artifact_text,
        }));
      }
      if (req.method === 'GET' && pathname === '/api/ei/engineering/tasks') {
        const u = new URL(req.url, 'http://localhost');
        const status = String(u.searchParams.get('status') || 'pending').trim();
        return send(res, 200, JSON.stringify({
          ok: true,
          tasks: listEngineeringTasks(__dirname, { status }),
        }));
      }
      const engApprove = matchPath(pathname, '/api/ei/engineering/tasks/:id/approve');
      if (req.method === 'POST' && engApprove) {
        const out = await processEngineeringTask(decodeURIComponent(engApprove.id), { rootDir: __dirname });
        const code = out.ok ? 200 : (out.statusCode || 400);
        return send(res, code, JSON.stringify(out));
      }
      const engReject = matchPath(pathname, '/api/ei/engineering/tasks/:id/reject');
      if (req.method === 'POST' && engReject) {
        const body = await readBody(req);
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
        const out = rejectEngineeringTask(
          decodeURIComponent(engReject.id),
          __dirname,
          parsed.reason || '',
        );
        return send(res, out.ok ? 200 : 400, JSON.stringify(out));
      }
      return send(res, 404, JSON.stringify({ ok: false, error: 'unknown ei eval route' }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'ei eval failed' }));
    }
  }

  return false;
}

module.exports = {
  tryHandleCultures,
  registerCulturesRoutes,
};
