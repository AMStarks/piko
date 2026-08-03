/**
 * Chat slash + light NL for agent orchestration (EI / orch-enabled spines).
 * Returns { reply } when handled, or null to fall through to normal chat.
 */
const {
  isAgentOrchEnabled,
  listAgents,
  enqueueAgentJob,
  getAgentStatus,
  cancelMission,
} = require('./agentOrchestrator');
const { cancelJob } = require('./agentJobs');
const { parseSlashCommand, tokenize } = require('./slashCommands');
const { includesAny, toLowerAsciiish } = require('./text');

function usageReply() {
  return [
    'Agent commands (this spine):',
    '  /agents — list available agents',
    '  /agents status — who is working now',
    '  /agent brief <what you want> — guided brief (clarify → confirm → start)',
    '  /agent run <agent_id> <brief> — queue async work directly',
    '  /agent stop <job_id> — cancel a job',
    '  /mission <goal> — plan + run a multi-step mission',
    '  /mission cancel <mission_id> — cancel a mission',
    '',
    'Or say what you want in plain language — I’ll interpret a tool plan and deploy a worker.',
  ].join('\n');
}

function formatStatus(status) {
  const c = status.counts || {};
  const lines = [
    `Agents working: ${c.working || 0} (${c.running || 0} running · ${c.pending || 0} queued)`,
  ];
  const active = status.jobs || [];
  if (!active.length) {
    lines.push('No agents on a task right now.');
  } else {
    for (const j of active.slice(0, 12)) {
      const p = j.payload || {};
      const label = p.agent_id || p.goal || p.mission_id || j.type;
      const brief = String(p.brief || p.goal || '').slice(0, 80);
      lines.push(`• ${j.status} ${j.id} — ${label}${brief ? `: ${brief}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatAgentList(agents) {
  if (!agents.length) return 'No agents registered for this tenant.';
  return [
    'Available agents:',
    ...agents.map((a) => `• ${a.id} — ${a.label || a.description || a.runtime}`),
    '',
    'Easiest: say what you want done (“I want an agent to …”) and I’ll brief one.',
    'Or: /agent brief <goal> · Direct: /agent run <id> <brief>',
  ].join('\n');
}

async function handleSlash(raw, rootDir) {
  const message = String(raw || '').trim();
  const lower = message.toLowerCase();

  if (lower === '/agents' || lower === '/agent' || lower === '/agents help' || lower === '/agent help') {
    if (lower === '/agents' || lower === '/agent') {
      return { reply: formatAgentList(listAgents(rootDir)) };
    }
    return { reply: usageReply() };
  }

  if (lower === '/agents status' || lower === '/agent status' || lower === '/agents jobs') {
    return { reply: formatStatus(getAgentStatus({ rootDir })) };
  }

  const slash = parseSlashCommand(message);
  if (slash && slash.kind === 'agent_stop') {
    const id = slash.jobId;
    if (id.startsWith('m_')) {
      const out = cancelMission(id, { rootDir });
      if (!out.ok) return { reply: out.error || 'Could not cancel mission.' };
      return { reply: out.already ? `Mission ${id} was already cancelled.` : `Mission ${id} cancelled.` };
    }
    const out = cancelJob(id);
    if (!out.ok) return { reply: out.error || 'Could not cancel job.' };
    if (out.already) return { reply: `Job ${id} was already finished.` };
    if (out.pending_cancel) return { reply: `Cancel requested for running job ${id}. It will stop shortly.` };
    return { reply: `Job ${id} cancelled.` };
  }

  if (slash && slash.kind === 'agent_run') {
    const agentId = slash.agent;
    const brief = String(slash.brief || '').trim();
    const queued = enqueueAgentJob('agent_run', { agent_id: agentId, brief }, { rootDir });
    if (!queued.ok) return { reply: queued.error || 'Failed to queue agent.' };
    return {
      reply: `Queued ${agentId} on: ${brief.slice(0, 120)}\nJob: ${queued.job.id}\nCheck progress: /agents status · Stop: /agent stop ${queued.job.id}`,
    };
  }

  if (lower.startsWith('/mission cancel ') || lower.startsWith('/mission stop ')) {
    const id = tokenize(message)[2];
    if (!id) return { reply: 'Usage: /mission cancel <mission_id>' };
    const out = cancelMission(id, { rootDir });
    if (!out.ok) return { reply: out.error || 'Could not cancel mission.' };
    return { reply: out.already ? `Mission ${id} was already cancelled.` : `Mission ${id} cancelled.` };
  }

  if (lower.startsWith('/mission ')) {
    const goal = message.slice('/mission '.length).trim();
    if (!goal || goal === 'help') {
      return { reply: 'Usage: /mission <goal> — plans steps and runs them asynchronously.\nExample: /mission check spine health then search corpus for Anubis' };
    }
    const queued = enqueueAgentJob('mission', { goal }, { rootDir });
    if (!queued.ok) return { reply: queued.error || 'Failed to queue mission.' };
    return {
      reply: `Mission queued.\nJob: ${queued.job.id}\nGoal: ${goal.slice(0, 200)}\nWatch: /agents status · Cancel job: /agent stop ${queued.job.id}`,
    };
  }

  if (lower.startsWith('/agents') || lower.startsWith('/agent')) {
    return { reply: usageReply() };
  }
  return null;
}

async function handleNaturalLanguage(raw, rootDir) {
  const message = String(raw || '').trim();
  const lower = toLowerAsciiish(message);

  if (
    includesAny(lower, [
      'how many agents',
      'agents are working',
      'agents working',
      'agents are running',
      'agents running',
      'agents are active',
      'agents active',
      'agent is working',
      'agent working',
      'who\'s working',
      'who is working',
      'agent status',
    ])
  ) {
    return { reply: formatStatus(getAgentStatus({ rootDir })) };
  }

  const tokens = tokenize(message);
  const head = (tokens[0] || '').toLowerCase();
  let stopNlId = null;
  if (['stop', 'cancel', 'close'].includes(head)) {
    if ((tokens[1] || '').toLowerCase() === 'job' || (tokens[1] || '').toLowerCase() === 'agent') {
      stopNlId = tokens[2] || null;
    } else if ((tokens[1] || '').startsWith('job_') || (tokens[1] || '').startsWith('m_')) {
      stopNlId = tokens[1];
    }
  }
  if (stopNlId) {
    const id = stopNlId;
    if (id.startsWith('m_')) {
      const out = cancelMission(id, { rootDir });
      return { reply: out.ok ? (out.already ? `Mission ${id} already cancelled.` : `Mission ${id} cancelled.`) : (out.error || 'Cancel failed.') };
    }
    const out = cancelJob(id);
    if (!out.ok) return { reply: out.error || 'Cancel failed.' };
    if (out.pending_cancel) return { reply: `Cancel requested for ${id}.` };
    return { reply: `Job ${id} cancelled.` };
  }

  // "put scholar on …" / "ask scholar to …" — token parse, no regex
  const toks = tokenize(message);
  let agentId = null;
  let brief = null;
  const h0 = (toks[0] || '').toLowerCase();
  if (['put', 'start', 'run'].includes(h0) && toks.length >= 4) {
    let i = 1;
    if ((toks[i] || '').toLowerCase() === 'the') i += 1;
    agentId = toks[i];
    i += 1;
    if ((toks[i] || '').toLowerCase() === 'agent') i += 1;
    const prep = (toks[i] || '').toLowerCase();
    if (prep === 'on' || prep === 'to') {
      brief = toks.slice(i + 1).join(' ').trim();
    } else {
      agentId = null;
    }
  } else if (h0 === 'ask' && toks.length >= 4) {
    let i = 1;
    if ((toks[i] || '').toLowerCase() === 'the') i += 1;
    agentId = toks[i];
    i += 1;
    if ((toks[i] || '').toLowerCase() === 'agent') i += 1;
    if ((toks[i] || '').toLowerCase() === 'to') {
      brief = toks.slice(i + 1).join(' ').trim();
    } else {
      agentId = null;
    }
  }
  if (agentId && brief) {
    const agents = listAgents(rootDir);
    const match = agents.find((a) => a.id === agentId || a.id === `ei-${agentId}` || (a.label && a.label.toLowerCase().includes(agentId.toLowerCase())));
    if (match) agentId = match.id;
    else if (!agents.some((a) => a.id === agentId)) {
      return { reply: `Unknown agent “${agentId}”. Try /agents for the list.` };
    }
    const queued = enqueueAgentJob('agent_run', { agent_id: agentId, brief }, { rootDir });
    if (!queued.ok) return { reply: queued.error || 'Failed to queue.' };
    return {
      reply: `Started ${agentId}.\nJob: ${queued.job.id}\nBrief: ${brief.slice(0, 160)}\nStatus: /agents status · Stop: /agent stop ${queued.job.id}`,
    };
  }

  return null;
}

/**
 * @returns {Promise<{reply:string}|null>}
 */
async function tryHandleAgentChat(message, rootDir, opts = {}) {
  if (!isAgentOrchEnabled(rootDir)) return null;
  const trimmed = String(message || '').trim();
  if (!trimmed) return null;

  // Slash + status NL always available.
  const low = toLowerAsciiish(trimmed);
  if (low.startsWith('/agent') || low.startsWith('/agents') || low.startsWith('/mission')) {
    return handleSlash(trimmed, rootDir);
  }
  const nl = await handleNaturalLanguage(trimmed, rootDir);
  if (nl && nl.reply) return nl;

  // Brief wizard is superseded by Legate chat on culture spines.
  try {
    const { isLegateChatEnabled } = require('./legateChat');
    if (isLegateChatEnabled(rootDir)) return null;
  } catch (_) {}

  try {
    const { tryHandleAgentBrief } = require('./agentBriefWizard');
    const briefed = await tryHandleAgentBrief(trimmed, rootDir, opts);
    if (briefed && briefed.reply) return briefed;
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-brief]', e.message);
  }

  return null;
}

module.exports = {
  tryHandleAgentChat,
  usageReply,
  formatStatus,
  formatAgentList,
};
