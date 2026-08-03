/**
 * Intent-first agent brief — goal → Piko interprets tool plan → confirm → ei-worker.
 * Operator does not pick specialist agents in normal chat.
 */
const fs = require('fs');
const path = require('path');
const { enqueueAgentJob, isAgentOrchEnabled } = require('./agentOrchestrator');
const { isCollationGoal, parseHarvestConstraints, formatConstraintsSummary } = require('./eiResearchGoal');
const { planWork, formatPlanSummary } = require('./eiWorkPlanner');
const {
  toLowerAsciiish,
  collapseWhitespace,
  startsWithIgnoreCase,
} = require('./text');

const STALE_MS = 15 * 60 * 1000;
const WORKER_ID = 'ei-worker';

function resolveDataDir(explicit) {
  if (explicit) return explicit;
  const env = String(process.env.PIKO_DATA_DIR || '').trim();
  if (env) return env;
  return path.join(__dirname, '..', 'data');
}

function sessionsPath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'agent-brief-sessions.json');
}

function loadAll(dataDir) {
  try {
    const p = sessionsPath(dataDir);
    if (!fs.existsSync(p)) return {};
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveAll(dataDir, all) {
  const dir = resolveDataDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionsPath(dir), JSON.stringify(all, null, 2), 'utf8');
}

function getAgentBrief(dataDir, sessionKey) {
  const all = loadAll(dataDir);
  const s = all[sessionKey];
  if (!s) return null;
  const updated = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
  if (Date.now() - updated > STALE_MS) {
    delete all[sessionKey];
    saveAll(dataDir, all);
    return null;
  }
  return s;
}

function setAgentBrief(dataDir, sessionKey, session) {
  const all = loadAll(dataDir);
  all[sessionKey] = {
    ...session,
    sessionKey,
    updatedAt: new Date().toISOString(),
  };
  saveAll(dataDir, all);
  return all[sessionKey];
}

function clearAgentBrief(dataDir, sessionKey) {
  const all = loadAll(dataDir);
  delete all[sessionKey];
  saveAll(dataDir, all);
}

function isAgentBriefSlash(t) {
  const s = String(t || '').trim();
  const low = toLowerAsciiish(s);
  if (low === '/brief agent' || low === '/agentbrief') return true;
  if (!startsWithIgnoreCase(s, '/agent')) return false;
  const rest = collapseWhitespace(s.slice('/agent'.length)).toLowerCase();
  return rest === 'brief' || rest.startsWith('brief ');
}

function requestsAgentBrief(message) {
  const t = String(message || '').trim();
  if (!t || t.startsWith('/')) {
    return isAgentBriefSlash(t);
  }
  const low = toLowerAsciiish(t);
  if (['cancel', 'no', 'never mind', 'nevermind', 'stop'].includes(low)) return false;
  // Natural-language work asks go through classifyEiFrontDoor (LLM), not keyword tripwires.
  return false;
}

function extractGoal(message) {
  let g = String(message || '').trim();
  if (startsWithIgnoreCase(g, '/agent')) {
    const rest = collapseWhitespace(g.slice('/agent'.length));
    if (startsWithIgnoreCase(rest, 'brief')) {
      g = collapseWhitespace(rest.slice('brief'.length));
    }
  }
  const low = toLowerAsciiish(g);
  const stripLeads = [
    'please brief an agent to ', 'please brief an agent on ',
    'please brief a agent to ', 'please brief a agent on ',
    'please brief agent to ', 'please brief agent on ',
    'please assign an agent to ', 'please assign an agent on ',
    'please deploy an agent to ', 'please put an agent to ',
    'please send an agent to ',
    'brief an agent to ', 'brief an agent on ',
    'brief a agent to ', 'brief a agent on ',
    'brief agent to ', 'brief agent on ',
    'assign an agent to ', 'assign an agent on ',
    'deploy an agent to ', 'put an agent to ', 'send an agent to ',
    'i want an agent to ', 'i want an agent on ',
    'i need an agent to ', 'i need an agent on ',
    'have an agent to ', 'have an agent on ',
    'get an agent to ', 'get an agent on ',
    'can you get an agent to ', 'can you get an agent on ',
    'can you have an agent to ', 'can you put an agent to ',
  ];
  for (const lead of stripLeads) {
    if (low.startsWith(lead)) {
      g = g.slice(lead.length).trim();
      break;
    }
  }
  return g.trim() || String(message || '').trim();
}

function isAffirm(text) {
  const t = toLowerAsciiish(String(text || '').trim());
  const phrases = [
    'y', 'yes', 'yep', 'yeah', 'ok', 'okay', 'sure', 'go', 'go ahead',
    'proceed', 'confirm', 'approved', 'do it', 'start', 'ship it',
  ];
  for (const p of phrases) {
    if (t === p || t.startsWith(p + ' ')) return true;
  }
  return false;
}

function isCancel(text) {
  const t = toLowerAsciiish(String(text || '').trim());
  const phrases = ['cancel', 'no', 'nope', 'never mind', 'nevermind', 'stop', 'abort', 'discard'];
  for (const p of phrases) {
    if (t === p || t.startsWith(p + ' ')) return true;
  }
  return false;
}

function isGoSkipClarify(text) {
  const t = toLowerAsciiish(String(text || '').trim());
  return [
    'go', 'go ahead', 'just go', 'start', 'proceed',
    "that's enough", 'thats enough', 'no constraints', 'none',
  ].includes(t);
}

function buildBriefText(session) {
  const parts = [session.goal];
  if (session.clarification) parts.push(`Success / constraints: ${session.clarification}`);
  return parts.join('\n').slice(0, 4000);
}

async function startBrief(message, rootDir, sessionKey, dataDir) {
  const goal = extractGoal(message);
  if (!goal || goal.length < 3) {
    return {
      reply: [
        'Tell me what you want done, in plain language.',
        'Example: “Find all Flinders Petrie texts for Abydos, Heliopolis, and Giza.”',
        'Or: /agent brief search the corpus for Anubis',
      ].join('\n'),
    };
  }

  setAgentBrief(dataDir, sessionKey, {
    step: 'clarify',
    goal,
    agentId: WORKER_ID,
    useMission: false,
    clarification: null,
    plan: null,
    planSummary: null,
    createdAt: new Date().toISOString(),
  });

  const collation = isCollationGoal(goal);
  return {
    reply: [
      'Got it — I’ll interpret that into a tool plan and deploy a worker (shared EI tool belt).',
      collation ? 'This looks like the early-period three-site research goal.' : null,
      '',
      'One clarifying question: any constraints?',
      'Examples: `literature only` · `limit 20` · `skip Heliopolis` · `then flag the corpus`',
      'Reply with that detail, or just **go** to start.',
      '',
      'Say **cancel** to abort.',
    ].filter(Boolean).join('\n'),
  };
}

function confirmReply(session) {
  const combined = [session.goal, session.clarification].filter(Boolean).join('\n');
  const constraints = parseHarvestConstraints(combined);
  const summary = formatConstraintsSummary(constraints);
  const lines = [
    'Ready to deploy **ei-worker**:',
    `• Goal: ${session.goal}`,
    session.clarification
      ? `• Clarification: ${session.clarification}`
      : '• Clarification: (none — using your original ask)',
  ];
  if (summary) lines.push(`• Parsed constraints: ${summary}`);
  if (session.planSummary) {
    lines.push('', session.planSummary);
  }
  lines.push('', 'Reply **yes** to start, or **cancel**.');
  return { reply: lines.join('\n') };
}

async function handleTurn(message, rootDir, sessionKey, dataDir) {
  const session = getAgentBrief(dataDir, sessionKey);
  if (!session) return null;

  const text = String(message || '').trim();
  if (isCancel(text) || toLowerAsciiish(collapseWhitespace(text)) === '/agent brief cancel') {
    clearAgentBrief(dataDir, sessionKey);
    return { reply: 'Agent brief cancelled.' };
  }

  if (session.step === 'clarify') {
    if (!isGoSkipClarify(text) && !isAffirm(text)) {
      session.clarification = text.slice(0, 2000);
    }
    // Interpret plan now (so confirm shows tools, not agent picker)
    try {
      const plan = await planWork(session.goal, {
        clarification: session.clarification || '',
        rootDir,
      });
      session.plan = plan;
      session.planSummary = formatPlanSummary(plan);
    } catch (e) {
      session.plan = null;
      session.planSummary = `(Planner fallback failed: ${e.message || e})`;
    }
    session.step = 'confirm';
    session.agentId = WORKER_ID;
    setAgentBrief(dataDir, sessionKey, session);
    return confirmReply(session);
  }

  if (session.step === 'confirm') {
    if (!isAffirm(text) && !isGoSkipClarify(text)) {
      if (text.length > 2) {
        session.clarification = text.slice(0, 2000);
        try {
          const plan = await planWork(session.goal, {
            clarification: session.clarification,
            rootDir,
          });
          session.plan = plan;
          session.planSummary = formatPlanSummary(plan);
        } catch (_) { /* keep prior plan */ }
        setAgentBrief(dataDir, sessionKey, session);
        return confirmReply(session);
      }
      return { reply: 'Reply **yes** to start the worker, or **cancel**.' };
    }

    const brief = buildBriefText(session);
    const queued = enqueueAgentJob('agent_run', {
      agent_id: WORKER_ID,
      brief,
      plan: session.plan || undefined,
    }, { rootDir });
    clearAgentBrief(dataDir, sessionKey);
    if (!queued.ok) {
      return { reply: queued.error || 'Failed to queue worker.' };
    }
    return {
      reply: [
        'Started **ei-worker** (shared tool belt).',
        `Job: ${queued.job.id}`,
        session.planSummary ? session.planSummary : `Brief: ${brief.slice(0, 200)}${brief.length > 200 ? '…' : ''}`,
        '',
        'Watch: /agents status · Stop: /agent stop ' + queued.job.id,
      ].join('\n'),
    };
  }

  clearAgentBrief(dataDir, sessionKey);
  return { reply: 'Agent brief reset — say what you want done.' };
}

/**
 * @returns {Promise<{ reply: string } | null>}
 */
async function tryHandleAgentBrief(message, rootDir, opts = {}) {
  if (!isAgentOrchEnabled(rootDir)) return null;
  const sessionKey = opts.sessionKey || 'main';
  const dataDir = opts.dataDir || resolveDataDir();

  const active = getAgentBrief(dataDir, sessionKey);
  if (active) {
    return handleTurn(message, rootDir, sessionKey, dataDir);
  }

  if (requestsAgentBrief(message) || isAgentBriefSlash(String(message || '').trim())) {
    return startBrief(message, rootDir, sessionKey, dataDir);
  }

  // LLM front-door: culture work asks → brief a worker
  try {
    const { classifyEiFrontDoor } = require('./eiIntentGate');
    const door = await classifyEiFrontDoor(message, { llm: opts.llm });
    if (door.lane === 'work') {
      return startBrief(message, rootDir, sessionKey, dataDir);
    }
    if (door.lane === 'clarify') {
      return {
        reply: [
          'I want to make sure I do the right thing. Do you want me to:',
          '1) **Find / download sources** (deploy a worker), or',
          '2) **Change Flag keep/drop rules** for the corpus?',
          '',
          'Reply with 1 or 2 (or restate in plain language).',
        ].join('\n'),
      };
    }
  } catch (_) { /* fall through */ }

  return null;
}

module.exports = {
  tryHandleAgentBrief,
  requestsAgentBrief,
  getAgentBrief,
  clearAgentBrief,
  startBrief,
  handleTurn,
  WORKER_ID,
};
