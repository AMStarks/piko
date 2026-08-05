#!/usr/bin/env node
/**
 * Legion schedule handler — used by intent-poller.js and pikoMind for `legion_scheduled` intents.
 *
 * Phase 4 modes:
 * - auto + capability (stored or inferred): POST Legion adapter → poll → context + optional Telegram
 * - auto + task_id only (legacy): activate via /api/ios-hub
 * - require_approval: Telegram nudge (no execution)
 */
const { execFile } = require('child_process');
const path = require('path');

const fs = require('fs');
const WEBCHAT_URL = process.env.PIKO_WEBCHAT_URL || 'http://localhost:3000';
const PIKO_REPO_ROOT = process.env.PIKO_REPO_ROOT || path.join(__dirname, '..', '..');
const venvPy = path.join(PIKO_REPO_ROOT, '.venv-os', 'bin', 'python');
const PY_BIN = process.env.PIKO_PYTHON || (fs.existsSync(venvPy) ? venvPy : 'python3');

function postJson(url, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const body = Buffer.from(JSON.stringify(payload));
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: (() => {
        const h = {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        };
        const key = String(process.env.PIKO_API_KEY || '').trim();
        if (key) h['X-Piko-Key'] = key;
        return h;
      })(),
    }, (res) => {
      let data = '';
      res.on('data', (ch) => { data += ch; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function sendTelegramNudge(message) {
  return new Promise((resolve, reject) => {
    const py = [
      'import json',
      'from yolo_protocol import execute_tool_yolo',
      `print(execute_tool_yolo("send_telegram_message", json.dumps({"message": ${JSON.stringify(String(message).slice(0, 3900))}})))`,
    ].join('; ');
    execFile(PY_BIN, ['-c', py], { cwd: PIKO_REPO_ROOT, timeout: 45000, env: process.env }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || 'telegram send failed').toString().slice(0, 400)));
      resolve((stdout || '').trim());
    });
  });
}

async function processLegionSchedule(intent) {
  if (!intent || intent.enabled === false) return { ok: false, skipped: true, reason: 'disabled' };

  const mode = String(intent.mode || 'require_approval').trim().toLowerCase();
  const taskId = Number(intent.task_id || intent.taskId || 0);
  const title = String(intent.title || '').trim();
  const schedule = String(intent.schedule || '').trim();
  const bu = String(intent.business_unit || intent.businessUnit || '').trim();

  if (mode === 'require_approval') {
    const msg =
      `⚡️ MISSION PROPOSAL (Scheduled)\n\n` +
      `Task: ${title || '(untitled)'}\n` +
      (taskId >= 1 ? `ID: #${taskId}\n` : '') +
      (intent.capability ? `Capability: ${intent.capability}\n` : '') +
      (bu ? `Business unit: ${bu}\n` : '') +
      (schedule ? `Schedule: ${schedule}\n` : '') +
      `\nIt is time for this scheduled mission. Reply "Proceed" to run it, or "Cancel" to skip.`;
    const out = await sendTelegramNudge(msg);
    return { ok: true, mode, telegram: out || 'sent' };
  }

  if (mode === 'auto') {
    const { resolveScheduleExecution, executeScheduledCapability } = require(path.join(__dirname, '..', 'lib', 'legionScheduleExecution'));
    const plan = resolveScheduleExecution(intent);
    if (plan && plan.capability === 'ausmaker.weekly.health.digest') {
      const { runWeeklyHealthDigest } = require(path.join(__dirname, '..', 'lib', 'ausmakerWeeklyDigest'));
      const out = await runWeeklyHealthDigest(intent, { notifyTelegram: true, source: 'scheduled' });
      return {
        ok: !!out.ok,
        mode: 'auto',
        execution: 'weekly_digest',
        capability: out.capability,
        lastRunStatus: out.lastRunStatus,
        lastRunOutcome: out.lastRunOutcome,
        summary: out.summary,
        error: out.error,
      };
    }
    if (plan && plan.capability === 'ei.platform.eval') {
      const { runPlatformEval } = require(path.join(__dirname, '..', 'lib', 'eiPlatformEval'));
      const out = await runPlatformEval({
        rootDir: path.join(__dirname, '..'),
        source: `scheduled:${intent.id || 'legion'}`,
        notify: true,
        notifyTelegram: true,
      });
      return {
        ok: !!out.pass,
        mode: 'auto',
        execution: 'ei_platform_eval',
        capability: 'ei.platform.eval',
        lastRunStatus: out.pass ? 'completed' : 'needs_revision',
        lastRunOutcome: String(out.artifact_text || '').slice(0, 500),
        summary: out.report?.summary || out.artifact_text,
        report_id: out.report?.id,
        error: out.pass ? null : 'eval_failed',
      };
    }
    if (plan && plan.capability) {
      const out = await executeScheduledCapability(intent, {
        notifyTelegram: true,
        source: 'scheduled',
      });
      return {
        ok: !!out.ok,
        mode: 'auto',
        execution: 'adapter',
        capability: out.capability,
        runId: out.runId,
        lastRunStatus: out.lastRunStatus,
        lastRunOutcome: out.lastRunOutcome,
        summary: out.summary,
        error: out.error || out.message,
      };
    }

    if (Number.isFinite(taskId) && taskId >= 1) {
      const res = await postJson(`${WEBCHAT_URL.replace(/\/$/, '')}/api/ios-hub`, {
        action: 'legion_task_update',
        task_id: taskId,
        new_status: 'active',
        source: 'intent-poller',
        sessionId: 'intent-poller-legion-auto',
      }, 30000);
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      return {
        ok,
        mode,
        execution: 'ios_hub',
        statusCode: res.statusCode,
        bodyPreview: String(res.body || '').slice(0, 500),
      };
    }

    return { ok: false, error: 'No capability or task_id on legion_scheduled intent' };
  }

  return { ok: false, error: `unsupported mode: ${mode}` };
}

module.exports = { processLegionSchedule };
