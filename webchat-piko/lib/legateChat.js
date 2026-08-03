/**
 * Piko Legate chat path (EI / culture first).
 * The conversational LLM reads the ask, then either answers or dispatches an agent,
 * and later judges the agent result. No actionRouter / web_research short-circuit.
 *
 * Routing rule: regex may veto (demote dispatch → answer), never volunteer work.
 */
const path = require('path');
const crypto = require('crypto');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { withUniversalIdentity, getLegateIdentityAddon } = require('./pikoIdentity');
const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
const {
  isAgentOrchEnabled,
  enqueueAgentJob,
  listAgents,
} = require('./agentOrchestrator');
const {
  normalizeLookups,
  runLookups,
  formatLookupReply,
  synthesizeLookupReply,
  buildCampaignStateBlock,
  bustCampaignStateBlockCache,
} = require('./legateTools');
const { friendlyAgentName } = require('./operatorVoice');
const { acquireSessionLock } = require('./sessionLock');
const {
  startsWithIgnoreCase,
  includesAny,
  toLowerAsciiish,
} = require('./text');

function replaceEiWorkerLabel(text) {
  const friendly = friendlyAgentName('ei-worker');
  let s = String(text || '');
  // Case-insensitive replace of "ei-worker" without regex
  const needle = 'ei-worker';
  let out = '';
  let i = 0;
  const lower = toLowerAsciiish(s);
  while (i < s.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, idx) + friendly;
    i = idx + needle.length;
  }
  return out;
}

function containsEiWorker(text) {
  return toLowerAsciiish(text).includes('ei-worker');
}

const DEFAULT_WORKER = 'ei-worker';
/** Planner-backed agents only — raw legion agents stay registered for /agent run, not decide menu. */
const LEGATE_DISPATCH_AGENTS = new Set([
  'ei-worker',
  'ei-qa',
  'ei-text-scout',
  'ei-corpus-reviewer',
]);

const DECIDE_FAIL_REPLY = "I didn't parse that cleanly — want me to treat it as a work order?";
const CONTROL_ACTIONS = new Set(['start', 'pause', 'resume', 'stop', 'run_now']);

let floorModule = null;
let floorsAvailable = false;
try {
  floorModule = require('./eiGoalParse');
  floorsAvailable = true;
} catch (e) {
  floorsAvailable = false;
  console.error('[legateChat] floor module unavailable at boot:', e && e.message ? e.message : e);
}

function envFlag(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Legate chat is on for culture spines by default, or when PIKO_LEGATE_CHAT=1.
 * Explicit PIKO_LEGATE_CHAT=0 disables even on culture.
 */
function isLegateChatEnabled(rootDir) {
  const off = String(process.env.PIKO_LEGATE_CHAT || '').trim().toLowerCase();
  if (off === '0' || off === 'false' || off === 'off') return false;
  if (envFlag('PIKO_LEGATE_CHAT')) return true;
  try {
    const p = getTenantBackgroundProfile(rootDir || path.join(__dirname, '..'));
    return p.isCulture === true;
  } catch (_) {
    return false;
  }
}

function agentsForLegateDecide(agents) {
  const filtered = (agents || []).filter((a) => a && LEGATE_DISPATCH_AGENTS.has(a.id));
  if (filtered.length) return filtered;
  return [{ id: DEFAULT_WORKER, label: 'EI Worker' }];
}

function resolveDispatchAgentId(rawId, agents) {
  const allowed = agentsForLegateDecide(agents);
  let agentId = String(rawId || DEFAULT_WORKER).trim() || DEFAULT_WORKER;
  if (!LEGATE_DISPATCH_AGENTS.has(agentId) || !allowed.some((a) => a.id === agentId)) {
    agentId = allowed.some((a) => a.id === DEFAULT_WORKER) ? DEFAULT_WORKER : allowed[0].id;
  }
  return agentId;
}

function buildLegateDecidePrompt(agents, stateBlock = '') {
  const allowed = agentsForLegateDecide(agents);
  const ids = allowed.map((a) => a.id).slice(0, 16);
  const agentList = ids.length ? ids.join(', ') : DEFAULT_WORKER;
  const state = String(stateBlock || '').trim();
  return withUniversalIdentity(`${getLegateIdentityAddon()}

You handle ONE operator message on the Egyptian Insights spine.

${state ? `${state}\n` : ''}
STEP 1 — READ (mandatory):
- Understand THIS message alone: who/what, exact title if any, singular vs plural, constraints.
- Do NOT import goals from earlier turns. Prior chat is context only, not a template to copy.
- Do NOT widen scope (one book ≠ "PDFs, articles, and books"; one title ≠ an author's whole corpus) unless THIS message says all/every/any/works.
- A standing research campaign may already be running (see LIVE RESEARCH STATE). Do not claim you have not started searching when the state block shows ACTIVE cycles/keeps.

STEP 2 — DECIDE:
Return JSON ONLY:
{"mode":"answer"|"dispatch"|"control","reply":"...","lookups":["campaign"|"learning"|"activity"|"scorecard"|"authors"|"stats"|"jobs"],"agent_id":"${DEFAULT_WORKER}","control_action":"start"|"pause"|"resume"|"stop"|"run_now"|null,"work_confirm":false,"understood":"one faithful sentence of THIS ask","reason":"short"}

Lookup menu (use when answering with facts):
- campaign — research campaign status/progress (enabled/paused, cycles, keeps, last_24h, next cycle)
- learning — digest notes, dossiers, articles, expertise-by-thread, recent note titles
- scorecard — learning trends (notes/keep ratio, attributed-keep %, reflection survival, dead threads)
- activity — recent campaign cycles + recent kept items
- authors / stats — corpus inventory (who/how many / what's kept)
- jobs — currently running/queued agent jobs only

Rules:
- mode=answer: greetings, clarifications, opinions, musings, or questions answerable from local tools / conversation / state block.
- Status / progress / learning / "what have you learned" / "how is learning trending" / "how is ingestion going" / "are you finding good sources" / campaign update → mode=answer + lookups campaign and/or learning and/or scorecard and/or activity. Prefer these over jobs.
- The bare phrase "campaign status" (and any phrasing of "status of the campaign" / "how's research going") is a STATUS QUESTION → mode=answer + lookups:["campaign"]. NEVER dispatch it — there is no work to do.
- Corpus inventory ONLY when they explicitly ask what's in the corpus (authors / how many / what's kept) → mode=answer + lookups authors and/or stats. NEVER answer a find/add/get request with an inventory dump.
- Agent/job status ONLY when they explicitly ask about running workers/jobs → mode=answer + lookups:["jobs"]. An empty job queue does NOT mean the campaign is idle — use campaign/activity for that.
- Trivial status asks answerable entirely from LIVE RESEARCH STATE may use mode=answer with lookups:[] and a grounded reply (numbers only from the state block).
- Opinions, reflections, ideas, general discussion (even on the research domain) → mode=answer with lookups:[] — NEVER dump inventory at someone thinking out loud.
- Musing is NOT a work order. "I've been thinking about…", "what do you reckon/think…", "I might get into…" → mode=answer. When unsure, answer and ask if they want you to go get it.
- "What do you make of X?" / "your thoughts on X?" / "how do you read X?" / "do you think we should find…" are OPINION questions → ALWAYS mode=answer with lookups:[] — discuss from what you know. NEVER dispatch an opinion question.
- "Please find …", "add to Corpus …", "get me …'s book", "find all X articles dealing with Y" → mode=dispatch. These are work orders, not inventory questions. Set work_confirm:true when dispatching.
- Campaign CONTROL ("pause/start/resume/stop the campaign", "run a cycle now") → mode=control with control_action set. Do NOT use mode=dispatch for campaign control.
- When lookups is non-empty: "reply" is a short bridge only (or empty). NEVER invent counts or lists.
- mode=dispatch: operator wants worker research done. Pick agent_id from the available list only. Short ack in "reply" that mirrors THEIR scope (singular if they asked singular). Do NOT claim work is already done.
- The system sends the operator's exact message to the worker — you do NOT write a replacement brief. "understood" must paraphrase THIS ask without expanding it.
- NEVER invent "successfully located" / fake ingest. NEVER substitute web-link summaries for dispatch.
- Plain, brief tone. Available agents: ${agentList}. Prefer ${DEFAULT_WORKER} for find/add/seek/harvest/corpus work.`);
}

/** Drop progress/review noise so prior job templates do not reshape the next decide. */
function historyForDecide(history) {
  const rows = Array.isArray(history) ? history : [];
  return rows
    .filter((m) => {
      const c = String((m && m.content) || '');
      if (startsWithIgnoreCase(c, 'Progress —') || startsWithIgnoreCase(c, 'Progress -')) return false;
      if (startsWithIgnoreCase(c, 'Update —') || startsWithIgnoreCase(c, 'Update -')) return false;
      if (startsWithIgnoreCase(c, 'Legate review —') || startsWithIgnoreCase(c, 'Legate review -')) return false;
      if (startsWithIgnoreCase(c, 'Job:') && c.length < 80 && toLowerAsciiish(c).includes('job_')) return false;
      return true;
    })
    .slice(-6);
}

/**
 * Work order is the operator message. LLM may only choose mode/agent — never a wider brief.
 */
function dispatchWorkOrder(operatorMessage, decision = {}) {
  const op = String(operatorMessage || '').trim();
  if (!op) return '';
  void decision;
  return op.slice(0, 4000);
}

function msgHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12);
}

function logFloorOverride({ message, llmMode, floorMode, floor }) {
  console.log(JSON.stringify({
    event: 'floor_override',
    msg_hash: msgHash(message),
    llm_mode: llmMode,
    floor_mode: floorMode,
    floor,
  }));
}

function isValidDecidePayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const mode = String(parsed.mode || '').toLowerCase().trim();
  if (mode !== 'answer' && mode !== 'dispatch' && mode !== 'control') return false;
  if (mode === 'control') {
    const action = String(parsed.control_action || '').toLowerCase().trim();
    return CONTROL_ACTIONS.has(action);
  }
  return true;
}

function decideFailResult(reason) {
  return {
    mode: 'answer',
    reply: DECIDE_FAIL_REPLY,
    agent_id: null,
    brief: null,
    control_action: null,
    understood: null,
    lookups: [],
    reason: String(reason || 'decide_fail').slice(0, 200),
    source: 'decide_fail',
  };
}

function dispatchAckLine(agentId) {
  return `Understood — putting ${friendlyAgentName(agentId)} on that now. I'll review the result when it finishes.`;
}

/**
 * Veto-only floors: may demote dispatch → answer. Never promote to dispatch/control.
 */
function applyVetoFloors(text, mode, parsed, opts = {}) {
  const llmMode = mode;
  let next = mode;
  let forcedStatusAnswer = false;
  let forcedOpinionAnswer = false;
  let forcedMusingAnswer = false;
  let floorsOk = floorsAvailable && floorModule;

  if (!floorsOk) {
    try {
      const mod = require('./eiGoalParse');
      if (typeof mod.isCampaignStatusQuestion !== 'function'
        || typeof mod.isOpinionQuestion !== 'function') {
        throw new Error('floor exports incomplete');
      }
      floorModule = mod;
      floorsAvailable = true;
      floorsOk = true;
    } catch (e) {
      floorsAvailable = false;
      floorsOk = false;
      floorModule = null;
      console.error('[legateChat] floor module load failed this turn:', e && e.message ? e.message : e);
    }
  }

  if (!floorsOk) {
    // Belt-and-braces: without floors, dispatch requires explicit LLM work_confirm.
    if (next === 'dispatch' && parsed.work_confirm !== true && parsed.work_confirm !== 'true') {
      logFloorOverride({
        message: text,
        llmMode,
        floorMode: 'answer',
        floor: 'floors_unavailable_no_work_confirm',
      });
      next = 'answer';
      parsed.reply = DECIDE_FAIL_REPLY;
      parsed.lookups = [];
      return {
        mode: next,
        forcedStatusAnswer,
        forcedOpinionAnswer,
        forcedMusingAnswer,
        floorsOk: false,
        reason: 'floors_unavailable_no_work_confirm',
      };
    }
    return {
      mode: next,
      forcedStatusAnswer,
      forcedOpinionAnswer,
      forcedMusingAnswer,
      floorsOk: false,
      reason: null,
    };
  }

  // WP8.2: prefer understand() intents; phrase floors are fail-closed backup.
  let status = false;
  let opinion = false;
  let musing = false;
  let floorName = 'phrases';
  try {
    const { floorsFromUnderstanding, floorsFromPhrases } = require('./eiFloors');
    const u = opts.understanding;
    if (u && !u.failed) {
      const f = floorsFromUnderstanding(u);
      status = f.status;
      opinion = f.opinion;
      musing = f.musing;
      floorName = 'understand';
    } else if (u && u.failed && opts.authoritative === true) {
      // Fail closed: never dispatch when comprehension failed.
      if (next === 'dispatch' || next === 'control') {
        logFloorOverride({
          message: text,
          llmMode,
          floorMode: 'answer',
          floor: 'understand_failed_fail_closed',
        });
        next = 'answer';
        parsed.reply = DECIDE_FAIL_REPLY;
        parsed.lookups = [];
        return {
          mode: next,
          forcedStatusAnswer: false,
          forcedOpinionAnswer: false,
          forcedMusingAnswer: false,
          floorsOk: true,
          reason: 'understand_failed_fail_closed',
        };
      }
      const f = floorsFromPhrases(text);
      status = f.status;
      opinion = f.opinion;
      musing = f.musing;
      floorName = 'phrases_after_fail';
    } else {
      const f = floorsFromPhrases(text);
      status = f.status;
      opinion = f.opinion;
      musing = f.musing;
    }
  } catch (_) {
    status = floorModule.isCampaignStatusQuestion(text);
    opinion = floorModule.isOpinionQuestion(text);
    musing = floorModule.isSoftMusing(text);
  }

  if (status) {
    if (llmMode !== 'answer') {
      logFloorOverride({ message: text, llmMode, floorMode: 'answer', floor: `campaign_status:${floorName}` });
    }
    next = 'answer';
    forcedStatusAnswer = true;
  } else if (opinion) {
    // Opinion always wins — even when the phrasing mentions find/research.
    if (llmMode !== 'answer') {
      logFloorOverride({ message: text, llmMode, floorMode: 'answer', floor: `opinion:${floorName}` });
    }
    next = 'answer';
    forcedOpinionAnswer = true;
    parsed.reply = '';
    parsed.lookups = [];
  } else if (next === 'dispatch' && musing) {
    logFloorOverride({ message: text, llmMode, floorMode: 'answer', floor: `soft_musing:${floorName}` });
    next = 'answer';
    forcedMusingAnswer = true;
    parsed.reply = '';
    parsed.lookups = [];
  }

  // WP7.8: after veto floors, dispatch still requires work_confirm on the normal path.
  let reason = forcedStatusAnswer
    ? 'campaign_status_floor'
    : forcedOpinionAnswer
      ? 'opinion_floor'
      : forcedMusingAnswer
        ? 'soft_musing_floor'
        : null;
  if (next === 'dispatch' && parsed.work_confirm !== true && parsed.work_confirm !== 'true') {
    logFloorOverride({
      message: text,
      llmMode,
      floorMode: 'answer',
      floor: 'no_work_confirm',
    });
    next = 'answer';
    if (!parsed.reply || !String(parsed.reply).trim()) {
      parsed.reply = DECIDE_FAIL_REPLY;
    }
    reason = 'no_work_confirm';
  }

  void opts;
  return {
    mode: next,
    forcedStatusAnswer,
    forcedOpinionAnswer,
    forcedMusingAnswer,
    floorsOk: true,
    reason,
  };
}

function getLegateOllamaBaseUrl() {
  const raw = String(process.env.PIKO_LEGATE_OLLAMA_URL || '').trim();
  return raw || undefined;
}

async function callDecideModel(model, msgs) {
  const opts = {
    format: 'json',
    temperature: 0,
    max_tokens: 400,
    num_ctx: Number(process.env.PIKO_LEGATE_NUM_CTX || 4096),
    timeoutMs: Math.max(5000, Number(process.env.PIKO_LEGATE_TIMEOUT_MS || 60000)),
    priority: 'user',
    lane: 'chat',
  };
  const base = getLegateOllamaBaseUrl();
  if (base) opts.ollamaBaseUrl = base;
  const raw = await ollamaNativeChat(model, msgs, opts);
  return extractJsonObject(raw);
}

/**
 * @returns {Promise<object>}
 */
async function decideLegateTurn(message, opts = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return {
      mode: 'answer',
      reply: 'Say that again?',
      agent_id: null,
      brief: null,
      control_action: null,
      lookups: [],
      reason: 'empty',
      source: 'empty',
    };
  }

  const root = opts.rootDir || path.join(__dirname, '..');
  const model = opts.model
    || process.env.PIKO_LEGATE_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';
  const agents = isAgentOrchEnabled(root) ? listAgents(root) : [];
  let stateBlock = '';
  try { stateBlock = buildCampaignStateBlock(); } catch (_) { stateBlock = ''; }

  const history = historyForDecide(opts.history);
  const msgs = [
    { role: 'system', content: buildLegateDecidePrompt(agents, stateBlock) },
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 800),
    })),
    {
      role: 'user',
      content: [
        'Operator message (read carefully — this is the only work request):',
        text.slice(0, 2000),
      ].join('\n'),
    },
  ];

  try {
    let parsed = await callDecideModel(model, msgs);
    if (!isValidDecidePayload(parsed)) {
      parsed = await callDecideModel(model, msgs);
    }
    if (!isValidDecidePayload(parsed)) {
      return decideFailResult('invalid_decide_json');
    }

    let mode = String(parsed.mode || '').toLowerCase().trim();
    let controlAction = mode === 'control'
      ? String(parsed.control_action || '').toLowerCase().trim()
      : null;
    if (mode === 'control' && !CONTROL_ACTIONS.has(controlAction)) {
      return decideFailResult('invalid_control_action');
    }

    let agentId = resolveDispatchAgentId(parsed.agent_id, agents);
    const understood = String(parsed.understood || '').trim().slice(0, 500) || null;

    const floor = applyVetoFloors(text, mode, parsed, {
      understanding: opts.understanding || null,
      authoritative: opts.authoritative === true,
    });
    mode = floor.mode;
    if (mode !== 'control') controlAction = null;
    if (mode !== 'dispatch') agentId = resolveDispatchAgentId(DEFAULT_WORKER, agents);

    const brief = mode === 'dispatch' ? dispatchWorkOrder(text, parsed) : null;
    let reply = String(parsed.reply || '').trim();
    let lookups = mode === 'answer' ? normalizeLookups(parsed.lookups) : [];
    if (floor.forcedStatusAnswer && !lookups.includes('campaign')) {
      lookups = ['campaign', ...lookups];
    }

    if (mode === 'dispatch') {
      if (!isAgentOrchEnabled(root)) {
        return {
          mode: 'answer',
          reply: 'I would put a worker on that, but agent orchestration is not enabled on this spine.',
          agent_id: null,
          brief: null,
          control_action: null,
          understood,
          lookups: [],
          reason: 'orch_disabled',
          source: 'llm',
        };
      }
      if (!reply) reply = dispatchAckLine(agentId);
      else if (containsEiWorker(reply)) {
        reply = replaceEiWorkerLabel(reply);
      }
    } else if (mode === 'control') {
      if (!reply) {
        reply = controlAction === 'run_now'
          ? 'Queuing a research cycle now.'
          : `Updating the campaign (${controlAction}).`;
      }
    } else if (!reply && !lookups.length && floor.reason) {
      // Floor-forced answer with no bridge — let the lookup / fall-through speak.
      reply = '';
    }

    return {
      mode,
      reply: reply.slice(0, 4000),
      agent_id: mode === 'dispatch' ? agentId : null,
      brief: mode === 'dispatch' ? brief : null,
      control_action: mode === 'control' ? controlAction : null,
      understood,
      lookups,
      reason: floor.reason || String(parsed.reason || mode).slice(0, 200),
      source: 'llm',
      floors_ok: floor.floorsOk,
    };
  } catch (e) {
    // Honest failure — never silently dispatch, never silently "Got it."
    return decideFailResult(`decide_fail:${e.message || 'llm_fail'}`);
  }
}

function dispatchFromLegate(decision, opts = {}) {
  const root = opts.rootDir || path.join(__dirname, '..');
  const agentId = (decision && decision.agent_id) || DEFAULT_WORKER;
  const operatorMessage = String(opts.message || '').trim();
  const brief = dispatchWorkOrder(operatorMessage, decision)
    || String((decision && decision.brief) || '').trim();
  if (!brief) return { ok: false, error: 'missing brief' };

  return enqueueAgentJob('agent_run', {
    agent_id: agentId,
    brief,
    operator_message: operatorMessage || brief,
    understood: (decision && decision.understood) || null,
    plan: opts.plan || null,
    chat_origin: true,
    session_id: opts.sessionKey || opts.session_id || null,
    legate_reason: (decision && decision.reason) || null,
  }, { rootDir: root });
}

function formatDispatchAck(decision, queued) {
  const jobId = queued && queued.job && queued.job.id;
  let base = String((decision && decision.reply) || "On it — I've set that in motion.").trim();
  if (containsEiWorker(base)) {
    base = replaceEiWorkerLabel(base);
  }
  if (!jobId) return base;
  return `${base}\n\nI'll post updates here as the work comes in, then give you my read on the result. (To cancel: /agent stop ${jobId})`;
}

function formatProgressChatReply(job, event = {}) {
  const msg = String(event.message || event.stage || 'working…').trim().slice(0, 400);
  const agent = friendlyAgentName((job && job.payload && job.payload.agent_id) || '');
  if (event.ok === false) return `Update — ${agent} hit a snag: ${msg}`;
  return `Update — ${msg}`;
}

/**
 * Visible mid-job progress into the originating chat session (no Telegram spam).
 */
async function deliverLegateProgressToChat(job, event = {}, opts = {}) {
  const payload = (job && job.payload) || {};
  if (!payload.chat_origin) return { delivered: false, reason: 'not_chat_origin' };

  const reply = formatProgressChatReply(job, event);
  const sessionId = payload.session_id || null;

  const append = () => {
    if (!sessionId) return;
    try {
      const sessionStore = require('./sessionStore');
      sessionStore.append(sessionId, 'assistant', reply);
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legateChat] progress append', e.message);
    }
  };

  if (sessionId) {
    await acquireSessionLock(sessionId, async () => { append(); });
  } else {
    append();
  }

  if (job && job.id) {
    try {
      const { appendJobProgress } = require('./agentJobs');
      appendJobProgress(job.id, {
        stage: event.stage || 'step',
        message: event.message || '',
        tool: event.tool || null,
        ok: event.ok,
      });
    } catch (_) {}
  }

  if (opts.notifyFeed === true) {
    try {
      const { recordNotification } = require('./notificationFeed');
      recordNotification({
        category: 'legion',
        title: 'Agent progress',
        text: reply,
        severity: 'info',
        source: 'legateChatProgress',
        meta: {
          job_id: job && job.id,
          session_id: sessionId,
          agent_id: payload.agent_id,
          stage: event.stage || null,
          tool: event.tool || null,
        },
      });
    } catch (_) {}
  }

  return { delivered: !!sessionId, session_id: sessionId, reply };
}

function formatReviewChatReply(job, result) {
  const payload = (job && job.payload) || {};
  const brief = String(payload.operator_message || payload.brief || '').slice(0, 160);
  const run = result && result.run;
  const review = run && run.review;
  const verdict = review && review.verdict
    ? String(review.verdict)
    : (result && result.ok ? 'accept' : 'escalate');
  const summary = review && review.summary
    ? String(review.summary).slice(0, 600)
    : String((result && result.reply_snip) || (run && run.artifact_text) || result && result.error || 'No artifact.').slice(0, 600);

  let unsureNote = '';
  let coverageNote = '';
  try {
    const workerResult = (run && run.result) || (result && result.result) || result || {};
    const mf = workerResult.mission_fit
      || (workerResult.goal_fit && workerResult.goal_fit.mission_fit)
      || null;
    const unsures = ((mf && mf.judgments) || [])
      .filter((j) => j && j.verdict === 'unsure' && !j.purged);
    if (unsures.length) {
      const names = unsures
        .slice(0, 4)
        .map((j) => `“${String(j.work_title || j.title || 'untitled').slice(0, 60)}”`)
        .join(', ');
      unsureNote = `\n\nThere ${unsures.length === 1 ? 'is 1 item' : `are ${unsures.length} items`} I couldn't verify with confidence — ${names}. I've flagged ${unsures.length === 1 ? 'it' : 'them'} for review rather than guessing; tell me to keep or drop ${unsures.length === 1 ? 'it' : 'them'} and I'll do that.`;
    }
    const cov = workerResult.seek_coverage || null;
    const voice = workerResult.coverage_voice
      || (() => {
        try { return require('./eiAgentTools').coverageVoiceSummary(cov, mf); } catch (_) { return ''; }
      })();
    if (voice && includesAny(toLowerAsciiish(voice), ['shelf empty'])) {
      coverageNote = `\n\n${voice}`;
    } else if (verdict !== 'accept' && voice && Number((mf && mf.counts && mf.counts.keep) || 0) === 0) {
      coverageNote = `\n\n${voice}`;
    }
    const kw = (mf && mf.known_works) || workerResult.known_works;
    if (kw && kw.missing && kw.missing.length && verdict === 'accept') {
      coverageNote += `\n\nKnown-works checklist: ${kw.summary}`;
    }
  } catch (_) { /* cosmetic */ }

  const opening = brief ? `Done with “${brief}”.` : 'Done with that task.';
  if (verdict === 'accept') {
    return `${opening} ${summary}\n\nI've checked it over and I'm happy with the result.${unsureNote}${coverageNote}`;
  }
  if (verdict === 'revise') {
    return `${opening} ${summary}\n\nHonestly, it's not quite where I want it yet — I'd treat this as a first pass. Ask me to try again if you'd like a better cut.${unsureNote}${coverageNote}`;
  }
  return `I ran into trouble with ${brief ? `“${brief}”` : 'that task'}. ${summary}\n\nI'm not counting this one as complete.${unsureNote}${coverageNote}`;
}

async function runCampaignControlAction(action, opts = {}) {
  const { runTool } = require('./eiAgentTools');
  const out = await runTool('research_campaign', { action }, {
    rootDir: opts.rootDir,
    goal: opts.message,
  });
  try { bustCampaignStateBlockCache(); } catch (_) {}
  return out;
}

function wantsProgressLookup(text, understanding) {
  try {
    const { floorsFromUnderstanding, floorsFromPhrases } = require('./eiFloors');
    if (understanding && !understanding.failed) {
      const f = floorsFromUnderstanding(understanding);
      if (f.status || understanding.intent === 'learning_question') return true;
    }
    if (floorsFromPhrases(text).status) return true;
  } catch (_) {}
  const t = String(text || '').toLowerCase();
  const markers = [
    'how many', 'how much', 'progress', 'cycle', 'cycles',
    'pending lead', 'pending leads', 'what have you learned', 'what have you found',
  ];
  for (const m of markers) {
    if (t.includes(m)) return true;
  }
  return false;
}

/**
 * Full Legate turn for chat: decide → maybe lookups / control / dispatch → reply.
 */
async function handleLegateChatTurn(message, opts = {}) {
  const root = opts.rootDir || path.join(__dirname, '..');
  if (!isLegateChatEnabled(root)) return null;

  // WP8.2: when authoritative, understand() runs first and veto floors use it.
  // Shadow mode remains fire-and-forget (must not stall chat).
  let understanding = null;
  let authoritative = false;
  try {
    const { understand, isAuthoritative, isShadowEnabled } = require('./understand');
    authoritative = isAuthoritative();
    if (authoritative) {
      understanding = await understand(message, {
        is_operator: opts.isOperator === true,
        campaign_summary: opts.campaignSummary || '',
        last_assistant: opts.lastAssistant || '',
        model: opts.understandModel,
      });
    } else if (isShadowEnabled()) {
      understand(message, {
        is_operator: opts.isOperator === true,
        campaign_summary: opts.campaignSummary || '',
        last_assistant: opts.lastAssistant || '',
        model: opts.understandModel,
      }).catch((e) => {
        console.warn('[legateChat] understand shadow failed', e && e.message ? e.message : e);
      });
    }
  } catch (e) {
    console.warn('[legateChat] understand setup failed', e && e.message ? e.message : e);
  }

  // Decide always runs on the Legate model (PIKO_LEGATE_MODEL) — the session
  // chat model must not leak in, or decide silently downgrades to the 8B and
  // (post-WP9) drags it onto the 27B instance, evicting the resident qwen.
  const { model: _sessionChatModel, ...decideOpts } = opts;
  const decision = await module.exports.decideLegateTurn(message, {
    ...decideOpts,
    understanding,
    authoritative,
  });

  if (decision.mode === 'control') {
    // WP7.6: mutating campaign control requires an operator session (mirrors REST).
    try {
      const { isOperatorOnlyCampaignAction } = require('./adminAuth');
      if (isOperatorOnlyCampaignAction(decision.control_action) && opts.isOperator !== true) {
        return {
          reply: 'Campaign control needs an operator login — ask the operator or use the dashboard.',
          mode: 'control_denied',
          decision,
          understanding,
        };
      }
    } catch (_) {
      if (opts.isOperator !== true) {
        return {
          reply: 'Campaign control needs an operator login — ask the operator or use the dashboard.',
          mode: 'control_denied',
          decision,
          understanding,
        };
      }
    }
    try {
      const out = await runCampaignControlAction(decision.control_action, {
        rootDir: root,
        message,
      });
      const reply = String(
        (out && out.artifact)
        || decision.reply
        || 'Campaign updated.',
      ).slice(0, 4000);
      return { reply, mode: 'control', decision, control: out, understanding };
    } catch (e) {
      console.warn('[legateChat] control failed', e && e.message ? e.message : e);
      return {
        reply: 'I tried to adjust the campaign but hit a snag — try again in a moment.',
        mode: 'control_failed',
        decision,
        understanding,
      };
    }
  }

  if (decision.mode !== 'dispatch') {
    let lookups = decision.lookups && decision.lookups.length
      ? decision.lookups
      : [];
    // Progress/number-seeking with empty lookups → run a real lookup, never raw state dump.
    if (!lookups.length && wantsProgressLookup(message, understanding)) {
      lookups = ['campaign', 'activity'];
    }
    if (lookups.length) {
      const data = runLookups(lookups, { rootDir: root });
      const reply = await synthesizeLookupReply(message, data, {
        model: opts.model,
      });
      return {
        reply: reply || formatLookupReply(decision.reply, data),
        mode: 'answer',
        decision: { ...decision, lookups },
        lookup_data: data,
        inject_campaign_state: false,
        understanding,
      };
    }
    // Honest decide-failure stays visible — do not fall through and bury it.
    if (decision.source === 'decide_fail') {
      return { reply: decision.reply, mode: 'answer', decision, inject_campaign_state: false, understanding };
    }
    // Plain conversation: hand back to the main chat brain (full persona).
    // Fall-through must NOT inject LIVE RESEARCH STATE numbers.
    if (decision.source === 'llm') {
      return {
        reply: null,
        fallthrough: true,
        inject_campaign_state: false,
        decision,
        understanding,
      };
    }
    return { reply: decision.reply, mode: 'answer', decision, inject_campaign_state: false, understanding };
  }

  const queued = dispatchFromLegate(decision, {
    rootDir: root,
    sessionKey: opts.sessionKey,
    message,
    plan: opts.plan,
  });
  if (!queued.ok) {
    console.warn('[legateChat] enqueue failed', queued.error || 'unknown');
    return {
      reply: "I understood the ask but couldn't queue the work just now — try again in a moment.",
      mode: 'dispatch_failed',
      decision,
      understanding,
    };
  }
  return {
    reply: formatDispatchAck(decision, queued),
    mode: 'dispatch',
    job: queued.job,
    decision,
    understanding,
  };
}

async function deliverLegateReviewToChat(job, result, opts = {}) {
  const payload = (job && job.payload) || {};
  if (!payload.chat_origin) return { delivered: false, reason: 'not_chat_origin' };

  const reply = formatReviewChatReply(job, result);
  const sessionId = payload.session_id || null;

  const append = () => {
    if (!sessionId) return;
    try {
      const sessionStore = require('./sessionStore');
      sessionStore.append(sessionId, 'assistant', reply);
    } catch (e) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legateChat] session append', e.message);
    }
  };

  if (sessionId) {
    await acquireSessionLock(sessionId, async () => { append(); });
  } else {
    append();
  }

  try {
    const { recordNotification } = require('./notificationFeed');
    recordNotification({
      category: 'legion',
      title: 'Legate agent review',
      text: reply,
      severity: (result && result.ok) ? 'info' : 'warn',
      source: 'legateChat',
      meta: {
        job_id: job && job.id,
        session_id: sessionId,
        agent_id: payload.agent_id,
        verdict: result && result.run && result.run.review && result.run.review.verdict,
      },
    });
  } catch (_) {}

  if (opts.notifyTelegram !== false) {
    try {
      const { notifyAdmin } = require('./notifyAdmin');
      const p = notifyAdmin(reply, {
        category: 'legion',
        title: 'Legate agent review',
        source: 'legateChat',
      });
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (_) {}
  }

  return { delivered: true, session_id: sessionId, reply };
}

/** Test-only: simulate floor module availability. */
function __testSetFloorModule(mod, available) {
  floorModule = mod || null;
  floorsAvailable = available === true;
}

module.exports = {
  isLegateChatEnabled,
  decideLegateTurn,
  dispatchFromLegate,
  dispatchWorkOrder,
  historyForDecide,
  formatDispatchAck,
  formatProgressChatReply,
  formatReviewChatReply,
  handleLegateChatTurn,
  deliverLegateProgressToChat,
  deliverLegateReviewToChat,
  agentsForLegateDecide,
  resolveDispatchAgentId,
  applyVetoFloors,
  isValidDecidePayload,
  getLegateOllamaBaseUrl,
  DECIDE_FAIL_REPLY,
  LEGATE_DISPATCH_AGENTS,
  __testSetFloorModule,
};
