/**
 * iOS hub route — Shortcuts / Share / app actions (P4.2).
 */

const fsDefault = require('fs');
const pathDefault = require('path');
const httpDefault = require('http');
const httpsDefault = require('https');
const { execFileSync: execFileSyncDefault, execSync: execSyncDefault, spawn: spawnDefault } = require('child_process');
const {
  splitLines,
  toLowerAsciiish,
  isAsciiDigit,
  parseHhMm,
} = require('../lib/text');

function registerIosHubRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('POST', '/api/ios-hub', wrap(tryHandleIosHub), { group: 'iosHub', auth: 'open' });
}

function isIosHubPath(pathname) {
  return String(pathname || '') === '/api/ios-hub';
}

async function tryHandleIosHub(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (req.method !== 'POST' || !isIosHubPath(pathname)) return false;
  const fullCtx = {
    fs: fsDefault,
    path: pathDefault,
    http: httpDefault,
    https: httpsDefault,
    execFileSync: execFileSyncDefault,
    execSync: execSyncDefault,
    spawn: spawnDefault,
    ...ctx,
  };
  await handleIosHub(req, res, fullCtx);
  return true;
}

/** Parse ACTIONS: 1. ... 2. ... from Ollama conversation summary reply. Returns [{ title }, ...]. */
function parseConversationActions(summaryReply) {
  if (!summaryReply || typeof summaryReply !== 'string') return [];
  const lines = splitLines(summaryReply);
  const actions = [];
  let inActions = false;
  const numberedTitle = (line) => {
    let s = line.trim();
    let i = 0;
    while (i < s.length && isAsciiDigit(s[i])) i++;
    if (i === 0 || i >= s.length || s[i] !== '.') return '';
    return s.slice(i + 1).trim().slice(0, 200);
  };
  for (const line of lines) {
    if (toLowerAsciiish(line.trim()) === 'actions:') {
      inActions = true;
      continue;
    }
    if (inActions) {
      const title = numberedTitle(line);
      if (title) actions.push({ title });
    }
  }
  if (actions.length === 0) {
    for (const line of lines) {
      const title = numberedTitle(line);
      if (title) actions.push({ title });
    }
  }
  return actions.slice(0, 5);
}

function parseIosHubDue(dueStr) {
  if (!dueStr || typeof dueStr !== 'string') return null;
  const s = dueStr.trim().toLowerCase();
  const now = new Date();
  if (s === 'tomorrow') {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d;
  }
  if (s === 'today') {
    const d = new Date(now); d.setHours(20, 0, 0, 0); return d <= now ? new Date(now.getTime() + 3600000) : d;
  }
  const hhmm = (() => { const p = parseHhMm(s); return p ? [null, String(p.h), String(p.m).padStart(2,'0')] : null; })();
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const at = new Date(now); at.setHours(h, m, 0, 0);
      if (at <= now) at.setDate(at.getDate() + 1);
      return at;
    }
  }
  try {
    const d = new Date(dueStr);
    if (!isNaN(d.getTime())) return d;
  } catch (_) {}
  return null;
}

async function handleIosHub(req, res, ctx = {}) {
  const {
    send,
    readBody,
    createIntent,
    telegramNotify,
    learningDir: LEARNING_DIR,
    dataDir: DATA_DIR,
    port: PORT,
    ollamaChat,
    log,
    pikoUpload,
    yoloBridge,
    listLegionScheduleIntents,
    createLegionScheduleIntent,
    updateIntent,
    collapseWhitespace,
    toLowerAsciiish,
    hasWord,
    includesAny,
    rootDir,
    fs,
    path,
    http,
    https,
    execFileSync,
    execSync,
    spawn,
  } = ctx;
  let body;
  try {
    body = await readBody(req);
    body = body ? JSON.parse(body) : {};
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }));
  }
  const action = (body.action || '').trim().toLowerCase();
  const source = body.source || 'ios-hub';
  const sessionId = body.sessionId || 'main';

  if (action === 'reminder') {
    const text = (body.text || body.title || '').trim();
    if (!text) return send(res, 400, JSON.stringify({ error: 'Missing text for reminder' }));
    const dueAt = parseIosHubDue(body.due || body.dueAt);
    const at = dueAt || new Date(Date.now() + 3600000);
    createIntent({ type: 'reminder', title: text, dueAt: at.toISOString(), source, sessionId });
    telegramNotify('🔔 Reminder set for ' + at.toLocaleString() + ': ' + text.slice(0, 80)).catch(() => {});
    return send(res, 200, JSON.stringify({ ok: true, action: 'reminder', dueAt: at.toISOString(), text: text.slice(0, 80) }));
  }

  if (action === 'calendar') {
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'calendar',
      message: 'Calendar events will be created when iOS EventKit or Google Calendar is connected. Use reminder for now.',
    }));
  }

  if (action === 'notes_capture') {
    const text = (body.text || body.payload || body.content || '').trim();
    if (!text) return send(res, 400, JSON.stringify({ error: 'Missing text for notes_capture' }));
    try {
      fs.mkdirSync(LEARNING_DIR, { recursive: true });
      const capturePath = path.join(LEARNING_DIR, 'notes-capture.md');
      const dateLine = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const line = `\n## ${dateLine}\n${text.slice(0, 10000)}\n`;
      fs.appendFileSync(capturePath, line, 'utf8');
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'notes_capture' }));
  }

  if (action === 'inquiry') {
    const message = (body.text || body.message || '').trim();
    if (!message) return send(res, 400, JSON.stringify({ error: 'Missing text/message for inquiry' }));
    const chatBody = JSON.stringify({ message, sessionId });
    const host = '127.0.0.1';
    const port = PORT;
    const inquiryTimeoutMs = Math.max(30000, Number(process.env.PIKO_OLLAMA_TIMEOUT_MS || 45000)) + 10000; // model timeout + buffer
    return new Promise((resolve) => {
      const opts = { hostname: host, port, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } };
      const reqIn = http.request(opts, (resIn) => {
        let data = '';
        resIn.on('data', (ch) => (data += ch));
        resIn.on('end', () => {
          try {
            const out = JSON.parse(data || '{}');
            resolve(send(res, 200, JSON.stringify({ ok: true, action: 'inquiry', reply: out.reply || out.error || '' })));
          } catch (_) {
            resolve(send(res, 200, JSON.stringify({ ok: true, action: 'inquiry', reply: data || '' })));
          }
        });
      });
      reqIn.on('error', (e) => resolve(send(res, 502, JSON.stringify({ error: 'Chat request failed: ' + e.message }))));
      reqIn.setTimeout(inquiryTimeoutMs, () => { reqIn.destroy(); resolve(send(res, 504, JSON.stringify({ error: 'Chat timeout' }))); });
      reqIn.write(chatBody);
      reqIn.end();
    });
  }

  if (action === 'file_capture') {
    const url = (body.url || '').trim();
    const text = (body.text || body.payload || body.content || '').trim();
    if (!url && !text) return send(res, 400, JSON.stringify({ error: 'Missing url or text for file_capture' }));
    const dateLine = new Date().toISOString().slice(0, 19).replace('T', ' ');
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    const capturePath = path.join(LEARNING_DIR, 'notes-capture.md');
    const append = (content) => {
      const line = `\n## ${dateLine}${url ? ' — ' + url.slice(0, 80) : ''}\n${content.slice(0, 50000)}\n`;
      fs.appendFileSync(capturePath, line, 'utf8');
    };
    if (text) {
      append(text);
      const isConversation = text.length > 50 && (text.includes(':\n') || text.split('\n').length > 5);
      if (isConversation) {
        try {
          const prompt = `Summarize this conversation. Extract 1-3 actionable items.

${text.slice(0, 4000)}

Respond ONLY in this format:
SUMMARY: [one sentence]
ACTIONS:
1. [action item]
2. [action item]`;
          const summaryReply = await ollamaChat([{ role: 'user', content: prompt }]);
          const summaryMatch = (() => {
            const low = summaryReply;
            const idx = toLowerAsciiish(low).indexOf('summary:');
            if (idx < 0) return null;
            let rest = low.slice(idx + 8).trim();
            const cut = toLowerAsciiish(rest).indexOf('actions:');
            if (cut >= 0) rest = rest.slice(0, cut);
            const nl = rest.indexOf('\n');
            if (nl >= 0) rest = rest.slice(0, nl);
            return [null, rest.trim()];
          })();
          const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 200) : 'Conversation noted';
          const actions = parseConversationActions(summaryReply);
          return send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'text', type: 'conversation', summary, actions }));
        } catch (e) {
          log('warn', 'conversation summary failed', { error: e.message });
        }
      }
      return send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'text' }));
    }
    const lib = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET' };
    lib.request(opts, (resIn) => {
      const chunks = [];
      resIn.on('data', (ch) => chunks.push(ch));
      resIn.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = (resIn.headers['content-type'] || '').toLowerCase();
        const isPdf = ct.includes('pdf') || buf.slice(0, 5).toString() === '%PDF-';
        if (isPdf) {
          try {
            const pdfParse = require('pdf-parse');
            pdfParse(buf).then((data) => {
              append((data.text || '').trim() || '(no text extracted)');
              send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'pdf', pages: data.numpages }));
            }).catch((e) => send(res, 500, JSON.stringify({ error: 'PDF extract: ' + e.message })));
          } catch (e) {
            send(res, 500, JSON.stringify({ error: 'pdf-parse not installed: npm install pdf-parse' }));
          }
        } else {
          append(buf.toString('utf8').slice(0, 50000));
          send(res, 200, JSON.stringify({ ok: true, action: 'file_capture', source: 'url' }));
        }
      });
    }).on('error', (e) => send(res, 502, JSON.stringify({ error: 'Fetch failed: ' + e.message }))).setTimeout(15000, function () { this.destroy(); send(res, 504, JSON.stringify({ error: 'Fetch timeout' })); }).end();
    return;
  }

  if (action === 'calendar_snapshot') {
    const events = body.events || body.eventsToday || [];
    if (!Array.isArray(events)) return send(res, 400, JSON.stringify({ error: 'events must be an array' }));
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const snapshotPath = path.join(DATA_DIR, 'calendar-snapshot.json');
      const payload = { updatedAt: new Date().toISOString(), source: body.source || source, events: events.slice(0, 100) };
      fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'calendar_snapshot', count: events.length }));
  }

  if (action === 'files_recent') {
    const fileNames = Array.isArray(body.fileNames) ? body.fileNames : (body.files && Array.isArray(body.files) ? body.files : []);
    const combined = fileNames.join(' ').toLowerCase();
    const suggestedTopics = [];
    const pdfCount = collapseWhitespace(combined).split(' ').filter((w) => toLowerAsciiish(w).includes('.pdf')).length;
    if (pdfCount >= 3) suggestedTopics.push('Weekly deep dives');
    if ((hasWord(toLowerAsciiish(combined), 'agent') || includesAny(toLowerAsciiish(combined), ['coordination', 'distributed']))) suggestedTopics.push('agent coordination', 'distributed systems');
    if (includesAny(toLowerAsciiish(combined), ['research', 'paper', 'arxiv'])) suggestedTopics.push('research synthesis');
    return send(res, 200, JSON.stringify({ ok: true, action: 'files_recent', suggestedTopics: [...new Set(suggestedTopics)] }));
  }

  /** iOS Legion Tree → human override: update task status in Legion SQLite (`yolo_protocol.update_legion_task`). */
  if (action === 'legion_task_update') {
    const taskId = Number(body.task_id ?? body.taskId);
    const newStatus = String(body.new_status ?? body.newStatus ?? '').trim().toLowerCase();
    if (!Number.isFinite(taskId) || taskId < 1) {
      return send(res, 400, JSON.stringify({ error: 'task_id must be a positive integer' }));
    }
    const allowed = new Set(['active', 'pending', 'rejected', 'submitted', 'approved', 'cancelled', 'completed', 'done', 'reviewed', 'delegated']);
    if (!allowed.has(newStatus)) {
      return send(res, 400, JSON.stringify({ error: 'new_status not allowed', allowed: Array.from(allowed).sort() }));
    }
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(rootDir, '..')).trim();
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.update_legion_task_with_trigger(${taskId}, ${JSON.stringify(newStatus)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 45000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion update failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg }));
    }
    const regen = process.env.PIKO_MANIFEST_REGEN_AFTER_LEGION_UPDATE !== '0' && process.env.PIKO_MANIFEST_REGEN_AFTER_LEGION_UPDATE !== 'false';
    if (regen) {
      try {
        const py2 = 'import piko_core; piko_core.generate_app_manifest(25)';
        spawn(pyBin, ['-c', py2], { cwd: repo, detached: true, stdio: 'ignore', env: process.env }).unref();
      } catch (_) {}
    }
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_update',
      task_id: taskId,
      new_status: newStatus,
      result: parsed,
    }));
  }

  /** iOS → save file to PIKO_TOOL_DATA_ROOT/inbox for tool ingestion. */
  if (action === 'file_upload') {
    try {
      const out = pikoUpload.saveUpload({
        filename: body.filename || body.name,
        content_base64: body.content_base64 || body.base64,
        subdir: body.subdir || 'inbox',
      });
      return send(res, 200, JSON.stringify({ ok: true, action: 'file_upload', ...out }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
  }

  /** iOS → single Python tool registry (`yolo_protocol.execute_tool_yolo`). */
  if (action === 'yolo_tool') {
    const { gateMoneyHttp } = require('../lib/moneyPlaneGate');
    if (!gateMoneyHttp(req, res, send, {
      body,
      action: 'ios_hub_yolo_tool',
      pathname: '/api/ios-hub',
      dataDir: DATA_DIR || process.env.PIKO_DATA_DIR,
    })) {
      return true;
    }
    const toolName = String(body.name || body.tool_name || body.toolName || '').trim();
    if (!toolName) {
      return send(res, 400, JSON.stringify({ error: 'name (tool name) is required' }));
    }
    const args = body.arguments && typeof body.arguments === 'object'
      ? body.arguments
      : (body.args && typeof body.args === 'object' ? body.args : {});
    try {
      const result = yoloBridge.runYoloTool(toolName, args, { channel: 'ios' });
      const pending = toLowerAsciiish(result).includes('pending human approval');
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'yolo_tool',
        tool: toolName,
        pending_approval: pending,
        result,
      }));
    } catch (e) {
      const msg = (e && e.stderr && String(e.stderr)) || e.message || String(e);
      return send(res, 502, JSON.stringify({ ok: false, error: msg, tool: toolName }));
    }
  }

  /** iOS Command Deck → create Legion row + wiki log + manifest (``piko_core.create_legion_task_atomic``). */
  if (action === 'legion_task_create') {
    const title = String(body.title || '').trim();
    if (!title) {
      return send(res, 400, JSON.stringify({ error: 'title is required' }));
    }
    const description = String(body.description || body.desc || '').trim();
    const denarii = Number.isFinite(Number(body.denarii)) ? Math.max(0, Math.floor(Number(body.denarii))) : 0;
    const parentId = Number.isFinite(Number(body.parent_id ?? body.parentId)) ? Math.max(0, Math.floor(Number(body.parent_id ?? body.parentId))) : 0;
    const businessUnit = String(body.business_unit || body.businessUnit || '').trim();
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(rootDir, '..')).trim();
    const spec = JSON.stringify({
      title,
      description,
      denarii,
      parent_id: parentId,
      ...(businessUnit ? { business_unit: businessUnit } : {}),
    });
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.create_legion_task_atomic(${JSON.stringify(spec)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 60000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion task create failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg, result: parsed || undefined }));
    }
    const tid = parsed.dispatch && parsed.dispatch.id;
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_create',
      task_id: tid,
      message: tid ? `Task #${tid} has been dispatched to the Legion ledger.` : undefined,
      result: parsed,
    }));
  }

  /** iOS Command Deck → propose a Legion draft (no DB write) for confirmation. */
  if (action === 'legion_task_propose') {
    const text = String(body.text || body.message || '').trim();
    if (!text) {
      return send(res, 400, JSON.stringify({ error: 'text is required' }));
    }
    const businessUnit = String(body.business_unit || body.businessUnit || '').trim();
    const repo = String(process.env.PIKO_REPO_ROOT || path.join(rootDir, '..')).trim();
    const spec = JSON.stringify({
      text,
      ...(businessUnit ? { business_unit: businessUnit } : {}),
    });
    let out = '';
    let execErr = null;
    const pyBin = process.env.PIKO_PYTHON || (fs.existsSync(path.join(repo, '.venv-os/bin/python')) ? path.join(repo, '.venv-os/bin/python') : 'python3');
    try {
      const py = `import piko_core as c; print(c.propose_legion_task(${JSON.stringify(spec)}))`;
      out = execFileSync(pyBin, ['-c', py], { cwd: repo, encoding: 'utf8', timeout: 60000, env: process.env }).trim();
    } catch (e) {
      execErr = (e && e.stderr && String(e.stderr)) || e.message || String(e);
    }
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (_) {}
    if (execErr) {
      return send(res, 502, JSON.stringify({ ok: false, error: execErr }));
    }
    if (!parsed || parsed.ok !== true) {
      const msg = (parsed && parsed.error) || out || 'Legion task propose failed';
      return send(res, 502, JSON.stringify({ ok: false, error: msg, result: parsed || undefined }));
    }
    return send(res, 200, JSON.stringify({
      ok: true,
      action: 'legion_task_propose',
      message: parsed.message || '',
      draft: parsed.draft || null,
      result: parsed,
    }));
  }

  /** iOS — list scheduled mission activations (``legion_scheduled`` intents). */
  if (action === 'legion_schedule_list') {
    try {
      const taskId = body.task_id != null || body.taskId != null
        ? Number(body.task_id ?? body.taskId)
        : null;
      const rows = listLegionScheduleIntents(
        taskId != null && Number.isFinite(taskId) ? { task_id: taskId } : {},
      );
      const items = rows.map((s) => ({
        id: s.id,
        task_id: s.task_id || s.taskId || null,
        title: s.title || s.description || '',
        schedule: s.schedule || null,
        dueAt: s.dueAt || null,
        lastFiredAt: s.lastFiredAt || null,
        mode: s.mode || 'require_approval',
        business_unit: s.business_unit || null,
      }));
      return send(res, 200, JSON.stringify({ ok: true, action: 'legion_schedule_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'legion_schedule_list failed' }));
    }
  }

  /** iOS — register when a mission MUST run (intent-poller → same path as manual START). */
  if (action === 'legion_schedule_create') {
    const taskId = Number(body.task_id ?? body.taskId);
    const schedule = String(body.schedule || '').trim();
    if (!Number.isFinite(taskId) || taskId < 1) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'task_id must be a positive integer' }));
    }
    if (!schedule) {
      return send(res, 400, JSON.stringify({
        ok: false,
        error: 'schedule is required (daily HH:MM, weekly HH:MM, hourly HH:MM-HH:MM, cron …, or in N minutes)',
      }));
    }
    try {
      const out = createLegionScheduleIntent({
        task_id: taskId,
        title: String(body.title || body.objective || '').trim(),
        objective: String(body.objective || body.title || '').trim(),
        schedule,
        mode: body.mode || body.activation_mode || 'require_approval',
        business_unit: String(body.business_unit || body.businessUnit || '').trim(),
        source,
        sessionId,
      });
      const boundTaskId = out.intent.task_id || taskId;
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'legion_schedule_create',
        task_id: boundTaskId,
        duplicate: !!out.duplicate,
        message: boundTaskId ? `Task #${boundTaskId}: schedule registered.` : undefined,
        intent: {
          id: out.intent.id,
          task_id: boundTaskId,
          schedule: out.intent.schedule,
          dueAt: out.intent.dueAt,
          mode: out.intent.mode,
          business_unit: out.intent.business_unit || null,
        },
      }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'legion_schedule_create failed' }));
    }
  }

  /** iOS — cancel a scheduled mission activation by intent id. */
  if (action === 'legion_schedule_cancel') {
    const intentId = String(body.intent_id || body.intentId || body.id || '').trim();
    if (!intentId) {
      return send(res, 400, JSON.stringify({ ok: false, error: 'intent_id is required' }));
    }
    const updated = updateIntent(intentId, { status: 'cancelled' });
    if (!updated) {
      return send(res, 404, JSON.stringify({ ok: false, error: 'Schedule not found' }));
    }
    if (updated.type !== 'legion_scheduled') {
      return send(res, 400, JSON.stringify({ ok: false, error: 'That intent is not a mission schedule' }));
    }
    return send(res, 200, JSON.stringify({ ok: true, action: 'legion_schedule_cancel', intent_id: intentId }));
  }

  /** List daily Product Change Summary times (``digest_schedules.json``). */
  if (action === 'digest_schedule_list') {
    try {
      const { loadSchedules } = require('../lib/tripwireEngine');
      const rows = loadSchedules();
      const items = rows.map((s) => ({
        id: s.time,
        time: s.time,
        last_sent_date: s.lastSentDate || null,
        title: 'Product Change Summary',
        channel: 'telegram',
      }));
      return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'digest_schedule_list failed' }));
    }
  }

  /** Cancel one digest by time (HH:MM) or remove all when ``clear_all`` is true. */
  if (action === 'digest_schedule_cancel') {
    try {
      const { removeDigestSchedule, clearDigestSchedule } = require('../lib/tripwireEngine');
      if (body.clear_all === true || String(body.mode || '').toLowerCase() === 'all') {
        const ok = clearDigestSchedule();
        return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_cancel', cleared_all: ok }));
      }
      const time = String(body.time || body.id || '').trim();
      if (!time) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'time (HH:MM) is required, or set clear_all: true' }));
      }
      const removed = removeDigestSchedule(time);
      if (!removed) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'Digest schedule not found for that time' }));
      }
      return send(res, 200, JSON.stringify({ ok: true, action: 'digest_schedule_cancel', time }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'digest_schedule_cancel failed' }));
    }
  }

  // iOS Sovereign HUD → optional local shell (same host as webchat) or Telegram ping only.
  const sovereignHub = {
    sovereign_legion_audit: { envKey: 'PIKO_SOV_CMD_AUDIT', label: 'Legion audit', emoji: '🔍' },
    sovereign_remediate_stale: { envKey: 'PIKO_SOV_CMD_REMEDIATE', label: 'Remediate stale', emoji: '⚡️' },
    sovereign_evaluate_quality: { envKey: 'PIKO_SOV_CMD_QUALITY_GATE', label: 'Quality gate', emoji: '✂️' },
    sovereign_hierarchy_audit: { envKey: 'PIKO_SOV_CMD_HIERARCHY_AUDIT', label: 'Hierarchy integrity', emoji: '🧭' },
    sovereign_housekeeping: { envKey: 'PIKO_SOV_CMD_HOUSEKEEPING', label: 'Wiki housekeeping', emoji: '🧹' },
  };
  if (sovereignHub[action]) {
    const cfg = sovereignHub[action];
    const cmd = String(process.env[cfg.envKey] || '').trim();
    const cwd = process.env.PIKO_REPO_ROOT || path.join(rootDir, '..');
    let ran = false;
    let output = null;
    let cmdError = null;
    if (cmd) {
      try {
        output = execSync(cmd, { encoding: 'utf8', timeout: 120000, shell: true, cwd, env: process.env }).trim().slice(0, 12000);
        ran = true;
      } catch (e) {
        ran = true;
        cmdError = (e && e.stderr && String(e.stderr)) || e.message || String(e);
        output = String(cmdError).slice(0, 4000);
      }
    }
    telegramNotify(`${cfg.emoji} iOS HUD: ${cfg.label} requested.`).catch(() => {});
    return send(res, 200, JSON.stringify({
      ok: cmdError == null,
      action,
      ran,
      output,
      note: cmd ? null : `Set ${cfg.envKey} (shell one-liner) and optionally PIKO_REPO_ROOT on the server to run ${cfg.label} here; otherwise use Telegram menu on Mac.`,
      error: cmdError || undefined,
    }));
  }

  if (action === 'notification_list') {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(body.limit, 10) || 40));
      const { readMergedNotifications } = require('../lib/notificationFeed');
      const items = readMergedNotifications(limit);
      return send(res, 200, JSON.stringify({ ok: true, action: 'notification_list', items, count: items.length }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_list failed' }));
    }
  }

  if (action === 'notification_config_get') {
    try {
      const { getConfigForDashboard } = require('../lib/configManager');
      const { getCategoryMeta } = require('../lib/notificationFeed');
      return send(res, 200, JSON.stringify({
        ok: true,
        action: 'notification_config_get',
        config: getConfigForDashboard(),
        categories: getCategoryMeta(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_config_get failed' }));
    }
  }

  if (action === 'notification_config_update') {
    try {
      const { updateConfig } = require('../lib/configManager');
      const key = String(body.key || '').trim();
      if (!key) return send(res, 400, JSON.stringify({ ok: false, error: 'key is required' }));
      if (body.value === undefined) return send(res, 400, JSON.stringify({ ok: false, error: 'value is required' }));
      const result = updateConfig(key, body.value);
      const ok = !String(result).startsWith('Error:');
      return send(res, ok ? 200 : 400, JSON.stringify({
        ok,
        action: 'notification_config_update',
        message: result,
        config: require('../lib/configManager').getConfigForDashboard(),
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'notification_config_update failed' }));
    }
  }

  return send(res, 400, JSON.stringify({ error: 'Unknown action. Use: reminder, calendar, notes_capture, inquiry, file_capture, calendar_snapshot, files_recent, legion_task_propose, legion_task_create, legion_task_update, legion_schedule_list, legion_schedule_create, legion_schedule_cancel, digest_schedule_list, digest_schedule_cancel, notification_list, notification_config_get, notification_config_update, sovereign_legion_audit, sovereign_remediate_stale, sovereign_evaluate_quality, sovereign_hierarchy_audit, sovereign_housekeeping' }));
}

module.exports = {
  tryHandleIosHub,
  registerIosHubRoutes,
  isIosHubPath,
  handleIosHub,
  parseConversationActions,
  parseIosHubDue,
};
