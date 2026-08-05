/**
 * Boot-time scheduler job registrations (P5.2).
 * Extracted from server.js listen callback — same job ids, tenant gates, and cron exprs.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { isBackgroundJobEnabled } = require('./tenantBackgroundJobs');

const EXPECTED_JOB_IDS = ['campaign_cycle_enqueue', 'unified_heartbeat', 'tripwire_eval', 'ausmaker_watchman', 'daily_digest', 'urgency_engine', 'weekly_po', 'history_dump', 'proactive_cycle', 'intent_poller', 'legion_watch', 'api_ping', 'legion_backup', 'context_refresh', 'nightly_wisdom', 'ei_platform_eval', 'ei_engineering_queue', 'ei_stance_synthesis', 'ei_quarantine_cleanup', 'nightly_quant', 'belief-consolidation', 'memory-consolidation', 'weekly-retro', 'daily_memory_summarize', 'rabbit_hole_daily', 'meta_reflection_weekly', 'ea_lookin'];

/**
 * @param {object} scheduler - createScheduler() instance
 * @param {object} ctx
 * @returns {string[]} registered job ids
 */
function registerBootJobs(scheduler, ctx) {
  const {
    rootDir,
    cultureOnly,
    jobEnabled,
    always,
    runUnifiedHeartbeat,
    telegramNotify,
    DATA_DIR,
    AUSMAKER_BASE_URL,
    stripTrailingSlash,
    dumpHistory,
    lastDumpDateRef,
    isJobEnabled,
    proactiveCycleRunner,
    log,
  } = ctx;
  const bootScheduler = scheduler;
    const TENANT_JOB_BY_OPS_ID = {
      'proactive-cycle': 'proactive_cycle',
      'intent-poller': 'intent_poller',
      'legion-watch': 'legion_watch',
      'api-ping': 'api_ping',
      'legion-backup': 'legion_backup',
      'context-refresh': 'context_refresh',
      'nightly-wisdom': 'nightly_wisdom',
      'nightly-quant': 'nightly_quant',
      'daily-memory-summarize': 'daily_memory_summarize',
      'rabbit-hole-daily': 'rabbit_hole_daily',
      'meta-reflection-weekly': 'meta_reflection_weekly',
      'ea-lookin': 'ea_lookin',
    };
    const runExternalOpScript = (jobId, scriptRel) => {
      const tenantJob = TENANT_JOB_BY_OPS_ID[jobId];
      if (tenantJob && !isBackgroundJobEnabled(tenantJob, rootDir)) return;
      if (!isJobEnabled(jobId)) return;
      const cwd = rootDir;
      exec(`node ${scriptRel}`, { cwd, env: process.env, timeout: 300000 }, (err) => {
        if (err) log('error', 'ops_external', { jobId, message: err.message });
      });
    };
    bootScheduler.register({
      id: 'campaign_cycle_enqueue',
      intervalMs: 60 * 1000,
      tenantGate: cultureOnly,
      fn: async () => {
        const { dueForCycle } = require('./eiResearchCampaign');
        if (!dueForCycle()) return;
        const { enqueueAgentJob } = require('./agentOrchestrator');
        const { listJobs } = require('./agentJobs');
        const pending = listJobs(60)
          .some((j) => j.type === 'campaign_cycle' && ['pending', 'running'].includes(j.status));
        if (pending) return;
        enqueueAgentJob('campaign_cycle', { source: 'scheduler' }, { rootDir: rootDir });
        console.log('[campaign] enqueued research campaign cycle');
      },
    });
    bootScheduler.register({
      id: 'unified_heartbeat',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('unified_heartbeat', rootDir),
      fn: async () => { runUnifiedHeartbeat(); },
    });
    bootScheduler.register({
      id: 'tripwire_eval',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('tripwire', rootDir),
      fn: async () => {
        const { evaluateTripwires } = require('./tripwireEngine');
        await evaluateTripwires(async (alertMessage) => {
          console.log('[TRIPWIRE TRIGGERED]:', alertMessage.slice(0, 120) + (alertMessage.length > 120 ? '…' : ''));
          await telegramNotify(alertMessage, { category: 'tripwire', title: 'Scheduled check', severity: 'warn', source: 'tripwireEngine' });
        });
      },
    });
    bootScheduler.register({
      id: 'ausmaker_watchman',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('ausmaker_watchman', rootDir),
      fn: async () => {
        const AUSMAKER_WATCH_FILE = path.join(DATA_DIR, 'ausmaker-watchman.json');
        const cooldownHours = Math.max(0.25, Number(process.env.PIKO_AUSMAKER_ALERT_COOLDOWN_HOURS || 4));
        const now = Date.now();
        let prev = { health: null, lastAlertAt: 0 };
        try {
          if (fs.existsSync(AUSMAKER_WATCH_FILE)) {
            prev = Object.assign(prev, JSON.parse(fs.readFileSync(AUSMAKER_WATCH_FILE, 'utf8') || '{}'));
          }
        } catch (_) { /* ok */ }
        const base = stripTrailingSlash(AUSMAKER_BASE_URL);
        const { getUrl } = require('./legionRunPoller');
        const forecastRes = await getUrl(`${base}/api/forecast/cached`);
        let forecast = null;
        if (forecastRes.statusCode === 200) {
          try { forecast = JSON.parse(forecastRes.body || '{}'); } catch (_) { forecast = null; }
        }
        const recs = (forecast && (forecast.purchase_recommendations || forecast.purchase_order_items)) || [];
        const reorderCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'reorder').length : 0;
        const reviewCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'review').length : 0;
        const orderedCount = Array.isArray(recs) ? recs.filter((r) => String(r.flag || r.status || '').toLowerCase() === 'ordered').length : 0;
        let health = 'GREEN';
        if (reorderCount > 0) health = 'RED';
        else if (reviewCount > 0) health = 'YELLOW';
        const salesRes = await getUrl(`${base}/api/sales/summary?period=today`);
        let salesTodayUnits = 0;
        try {
          if (salesRes.statusCode === 200) {
            const s = JSON.parse(salesRes.body || '{}');
            salesTodayUnits = Number(s.total_units_sold) || 0;
          }
        } catch (_) { /* ok */ }
        const syncTs = (forecast && (forecast.last_synced_at || forecast._cached_at || forecast.timestamp)) || null;
        const wasRed = String(prev.health || '').toUpperCase() === 'RED';
        const isRed = String(health).toUpperCase() === 'RED';
        const cooledDown = (now - Number(prev.lastAlertAt || 0)) >= cooldownHours * 3600 * 1000;
        if (!wasRed && isRed && cooledDown) {
          const msg = [
            '⚠️ **SOVEREIGN ALERT: AUSMAKER AT RISK**',
            '',
            'Inventory health is now **RED**.',
            `- Reorders Required: **${reorderCount}**`,
            `- Reviews Pending: **${reviewCount}**`,
            `- Ordered (awaiting): **${orderedCount}**`,
            `- Sales Today (units): **${Math.round(salesTodayUnits)}**`,
            syncTs ? `- Last Sync: **${String(syncTs)}**` : null,
          ].filter(Boolean).join('\n');
          await telegramNotify(msg);
          prev.lastAlertAt = now;
        }
        prev.health = health;
        prev.reorderCount = reorderCount;
        prev.reviewCount = reviewCount;
        prev.orderedCount = orderedCount;
        prev.salesTodayUnits = salesTodayUnits;
        prev.sync_ts = syncTs;
        prev.updated_at = new Date().toISOString();
        try {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(AUSMAKER_WATCH_FILE, JSON.stringify(prev, null, 2), 'utf8');
        } catch (_) { /* ok */ }
      },
    });
    bootScheduler.register({
      id: 'daily_digest',
      cronExpr: '* * * * *',
      tenantGate: jobEnabled('tripwire', rootDir),
      fn: async () => {
        const { loadSchedules, saveSchedules, flushDailyDigest } = require('./tripwireEngine');
        const schedules = loadSchedules();
        if (schedules.length === 0) return;
        const now = new Date();
        const currentDateString = now.toDateString();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        let schedulesUpdated = false;
        for (const sched of schedules) {
          const [schedH, schedM] = sched.time.split(':').map(Number);
          const schedMinutes = (schedH || 0) * 60 + (schedM || 0);
          if (currentMinutes >= schedMinutes && sched.lastSentDate !== currentDateString) {
            try {
              await flushDailyDigest(async (reportMessage) => {
                console.log('[DAILY DIGEST TO USER]:', reportMessage.slice(0, 80) + '…');
                await telegramNotify(reportMessage);
              });
              sched.lastSentDate = currentDateString;
              schedulesUpdated = true;
            } catch (e) {
              console.error('[DIGEST] Failed:', e.message);
            }
          }
        }
        if (schedulesUpdated) saveSchedules(schedules);
      },
    });
    bootScheduler.register({
      id: 'urgency_engine',
      cronExpr: '*/30 9-17 * * *',
      tenantGate: jobEnabled('urgency_engine', rootDir),
      fn: async () => {
        const { runInternalMonologue } = require('./urgencyEngine');
        await runInternalMonologue(async (msg) => await telegramNotify(msg));
      },
    });
    bootScheduler.register({
      id: 'weekly_po',
      cronExpr: '0 16 * * 4',
      tenantGate: jobEnabled('weekly_po', rootDir),
      fn: async () => {
        const { flushWeeklyPO } = require('./tripwireEngine');
        await flushWeeklyPO(async (reportMessage) => {
          await telegramNotify(reportMessage);
        });
      },
    });
    bootScheduler.register({
      id: 'history_dump',
      cronExpr: '* * * * *',
      tenantGate: jobEnabled('history_dump', rootDir),
      fn: async () => {
        const today = new Date().toISOString().slice(0, 10);
        if (today > lastDumpDateRef.value) {
          dumpHistory(lastDumpDateRef.value);
          lastDumpDateRef.value = today;
        }
      },
    });
    bootScheduler.register({
      id: 'proactive_cycle',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('proactive_cycle', rootDir),
      fn: async () => {
        if (!isJobEnabled('proactive-cycle')) return;
        await proactiveCycleRunner.run('scheduler', { skipIfBusy: true });
      },
    });
    bootScheduler.register({
      id: 'intent_poller',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('intent_poller', rootDir),
      fn: async () => {
        if (!isJobEnabled('intent-poller')) return;
        await new Promise((resolve) => {
          exec('node scripts/intent-poller.js', { cwd: rootDir, env: process.env, timeout: 60000 }, (err) => {
            if (err) log('error', 'intent_poller', { message: err.message }, null);
            resolve();
          });
        });
      },
    });
    bootScheduler.register({
      id: 'legion_watch',
      cronExpr: '*/5 * * * *',
      tenantGate: jobEnabled('legion_watch', rootDir),
      fn: async () => { runExternalOpScript('legion-watch', 'scripts/legion-watch.js'); },
    });
    bootScheduler.register({
      id: 'api_ping',
      cronExpr: '*/15 * * * *',
      tenantGate: jobEnabled('api_ping', rootDir),
      fn: async () => { runExternalOpScript('api-ping', 'scripts/api-ping-site.js'); },
    });
    bootScheduler.register({
      id: 'legion_backup',
      cronExpr: '30 2 * * *',
      tenantGate: jobEnabled('legion_backup', rootDir),
      fn: async () => {
        if (!isJobEnabled('legion-backup')) return;
        await new Promise((resolve) => {
          exec('bash scripts/legion-backup-onbox.sh', { cwd: rootDir, env: process.env, timeout: 300000 }, (err) => {
            if (err) log('error', 'legion_backup', { message: err.message });
            resolve();
          });
        });
      },
    });
    bootScheduler.register({
      id: 'context_refresh',
      cronExpr: '0 6,12,18 * * *',
      tenantGate: jobEnabled('context_refresh', rootDir),
      fn: async () => { runExternalOpScript('context-refresh', 'scripts/context-refresh.js'); },
    });
    // Continuous mind loop — processes due intents every 60s when ReAct agent enabled
    const useReAct = process.env.PIKO_USE_REACT_AGENT === '1' || process.env.PIKO_USE_REACT_AGENT === 'true';
    if (useReAct) {
      const { fork } = require('child_process');
      const mindPath = path.join(rootDir, 'workers', 'pikoMind.js');
      const mindProcess = fork(mindPath, [], { env: process.env, cwd: rootDir });
      mindProcess.on('error', (err) => console.error('[pikoMind] spawn error:', err.message));
      mindProcess.on('exit', (code, sig) => {
        if (code !== 0 && code !== null) console.warn('[pikoMind] exited', code, sig);
      });
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[boot] Mind loop spawned');
    }
    bootScheduler.register({
      id: 'nightly_wisdom',
      cronExpr: '0 2 * * *',
      tenantGate: jobEnabled('nightly_wisdom', rootDir),
      fn: async () => {
        if (!isJobEnabled('nightly-wisdom')) return;
        await require('../scripts/nightly_wisdom').runNightlyWisdom();
      },
    });
    bootScheduler.register({
      id: 'ei_platform_eval',
      cronExpr: '30 3 * * *',
      tenantGate: jobEnabled('ei_platform_eval', rootDir),
      fn: async () => {
        const { isAgentOrchEnabled, enqueueAgentJob } = require('./agentOrchestrator');
        if (!isAgentOrchEnabled(rootDir)) return;
        const queued = enqueueAgentJob('ei_platform_eval', {
          source: 'cron:nightly',
          notify: true,
          notify_telegram: true,
        }, { rootDir: rootDir });
        log('info', 'ei_platform_eval', { queued: queued.ok, job_id: queued.job && queued.job.id }, null);
      },
    });
    bootScheduler.register({
      id: 'ei_engineering_queue',
      cronExpr: '*/15 * * * *',
      tenantGate: jobEnabled('ei_engineering_queue', rootDir),
      fn: async () => {
        const { tickEngineeringQueue } = require('./eiEngineeringQueue');
        const out = tickEngineeringQueue(rootDir);
        if (out.processed > 0) log('info', 'ei_engineering_queue', out, null);
      },
    });
    bootScheduler.register({
      id: 'ei_stance_synthesis',
      cronExpr: '15 4 * * *',
      tenantGate: jobEnabled('ei_stance_synthesis', rootDir),
      fn: async () => {
        const { runStanceSynthesis } = require('./eiStancePositions');
        const out = await runStanceSynthesis({});
        log('info', 'ei_stance_synthesis', {
          rebuilt: out.rebuilt,
          skipped: (out.skipped || []).length,
        }, null);
      },
    });
    bootScheduler.register({
      id: 'ei_quarantine_cleanup',
      cronExpr: '30 5 * * *',
      tenantGate: jobEnabled('ei_quarantine_cleanup', rootDir),
      fn: async () => {
        const { purgeExpiredQuarantine } = require('./culturesCorpusApi');
        const out = purgeExpiredQuarantine({});
        if (out.purged > 0) log('info', 'ei_quarantine_cleanup', out, null);
      },
    });
    bootScheduler.register({
      id: 'nightly_quant',
      cronExpr: '0 1 * * *',
      tenantGate: jobEnabled('nightly_quant', rootDir),
      fn: async () => {
        if (!isJobEnabled('nightly-quant')) return;
        const { getConfig } = require('./configManager');
        if (getConfig().nightlyQuantEnabled === false) {
          console.log('[CRON] Nightly Quant Agent disabled in piko_config.json');
          return;
        }
        console.log('[CRON] Waking up Quant Agent for nightly batch forecast...');
        const { deploySubAgent } = require('./legionSwarm');
        const { notifyAdmin } = require('./notifyAdmin');
        const taskContext = 'Deploy the quant agent to run our statistical forecasts and write all SKUs to the database.';
        try {
          const result = await deploySubAgent('quant', taskContext);
          if (result && !result.startsWith('Error:') && !result.includes('Failed after')) {
            await notifyAdmin('Overnight forecasts are done — stock predictions for the whole catalogue are refreshed and ready for today.', {
              category: 'nightly_quant',
              title: 'Overnight forecasts',
              severity: 'info',
              source: 'cron:nightly_quant',
            });
          } else {
            console.error('[CRON] Quant Agent failed:', result || 'No result');
            await notifyAdmin("Last night's forecast run didn't finish, so today's stock predictions may be a day old. Piko will retry tonight automatically.", {
              category: 'nightly_quant',
              title: 'Overnight forecasts',
              severity: 'error',
              source: 'cron:nightly_quant',
              meta: { error: (result || '').slice(0, 500) },
            });
          }
        } catch (e) {
          console.error('[CRON] Quant Agent failed:', e.message);
          await notifyAdmin("Last night's forecast run didn't finish, so today's stock predictions may be a day old. Piko will retry tonight automatically.", {
            category: 'nightly_quant',
            title: 'Overnight forecasts',
            severity: 'error',
            source: 'cron:nightly_quant',
            meta: { error: e.message || 'Unknown error' },
          }).catch(() => {});
        }
      },
    });
    // P3.2c: enqueue-only — heavy belief/memory/retro work runs in the agent worker.
    bootScheduler.register({
      id: 'belief-consolidation',
      cronExpr: '0 3 * * *',
      tenantGate: always,
      fn: async () => {
        if (!isJobEnabled('belief-consolidation')) return;
        const { enqueueAgentJob } = require('./agentOrchestrator');
        const { listJobs } = require('./agentJobs');
        const pending = listJobs(60).some((j) => j.type === 'belief_consolidation'
          && ['pending', 'running'].includes(j.status));
        if (pending) return;
        enqueueAgentJob('belief_consolidation', { source: 'scheduler' }, { rootDir: rootDir });
      },
    });
    bootScheduler.register({
      id: 'memory-consolidation',
      cronExpr: '0 3 * * 0',
      tenantGate: always,
      fn: async () => {
        if (!isJobEnabled('memory-consolidation')) return;
        const { enqueueAgentJob } = require('./agentOrchestrator');
        const { listJobs } = require('./agentJobs');
        const pending = listJobs(60).some((j) => j.type === 'memory_consolidation'
          && ['pending', 'running'].includes(j.status));
        if (pending) return;
        enqueueAgentJob('memory_consolidation', { source: 'scheduler' }, { rootDir: rootDir });
      },
    });
    bootScheduler.register({
      id: 'weekly-retro',
      cronExpr: '0 8 * * 0',
      tenantGate: always,
      fn: async () => {
        if (!isJobEnabled('weekly-retro')) return;
        const { enqueueAgentJob } = require('./agentOrchestrator');
        const { listJobs } = require('./agentJobs');
        const pending = listJobs(60).some((j) => j.type === 'weekly_retro'
          && ['pending', 'running'].includes(j.status));
        if (pending) return;
        enqueueAgentJob('weekly_retro', { source: 'scheduler' }, { rootDir: rootDir });
      },
    });
    bootScheduler.register({
      id: 'daily_memory_summarize',
      cronExpr: '0 0 * * *',
      tenantGate: jobEnabled('daily_memory_summarize', rootDir),
      fn: async () => { runExternalOpScript('daily-memory-summarize', 'scripts/daily-memory-summarize.js'); },
    });
    bootScheduler.register({
      id: 'rabbit_hole_daily',
      cronExpr: '0 23 * * *',
      tenantGate: jobEnabled('rabbit_hole_daily', rootDir),
      fn: async () => { runExternalOpScript('rabbit-hole-daily', 'scripts/rabbit-hole-daily.js'); },
    });
    bootScheduler.register({
      id: 'meta_reflection_weekly',
      cronExpr: '0 10 * * 0',
      tenantGate: jobEnabled('meta_reflection_weekly', rootDir),
      fn: async () => { runExternalOpScript('meta-reflection-weekly', 'scripts/meta-reflection-weekly.js'); },
    });
    bootScheduler.register({
      id: 'ea_lookin',
      cronExpr: '*/30 * * * *',
      tenantGate: jobEnabled('ea_lookin', rootDir),
      fn: async () => { runExternalOpScript('ea-lookin', 'scripts/ea-lookin.js'); },
    });
  return bootScheduler.list().map((j) => j.id);
}

module.exports = {
  registerBootJobs,
  EXPECTED_JOB_IDS,
};
