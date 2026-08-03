/**
 * Deterministic ANSWER_LOCAL replies — capabilities, operations, identity.
 * Avoids social-chat hallucination for "what else do you do?" style questions.
 */
const path = require('path');
const { normalizeApostrophes, isQueueReadQuery, formatQueueReadReply } = require('./queueRead');
const {
  isTaskDetailQuery,
  isTaskExplainQuery,
  isTaskExplainByIdQuery,
  parseTaskIdFromMessage,
  formatTaskDetailReply,
  formatTaskExplainReply,
  formatTaskExplainByIdReply,
} = require('./taskRead');
const { loadOperations } = require('./operations');
const {
  includesAny,
  toLowerAsciiish,
  collapseWhitespace,
  squeezeBlankLines,
  stripTrailingPunct,
  isAsciiLetter,
  isAsciiDigit,
} = require('./text');

function normLocal(message) {
  return collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || '')))).trim();
}

function isWordChar(ch) {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === '_';
}

function hasWord(haystack, word) {
  const h = String(haystack || '');
  const w = String(word || '');
  if (!w) return false;
  let from = 0;
  while (from <= h.length - w.length) {
    const idx = h.indexOf(w, from);
    if (idx < 0) return false;
    const before = idx === 0 ? '' : h[idx - 1];
    const after = idx + w.length >= h.length ? '' : h[idx + w.length];
    const leftOk = !before || !isWordChar(before);
    const rightOk = !after || !isWordChar(after);
    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
  return false;
}

function hasAnyWord(haystack, words) {
  for (const w of words || []) {
    if (hasWord(haystack, w)) return true;
  }
  return false;
}

function isIdentityQuery(message) {
  const t = normLocal(message);
  return includesAny(t, [
    'who are you',
    'what are you',
    'introduce yourself',
    "what's your name",
    'what is your name',
  ]);
}

function isCapabilitiesQuery(message) {
  const t = normLocal(message);
  if (isQueueReadQuery(message)) return false;
  if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop']) && !hasAnyWord(t, ['agent', 'agents'])) {
    return false;
  }
  if (
    includesAny(t, [
      'what can you do',
      "what's your capabilities",
      'what is your capabilities',
      'what are your capabilities',
      'what can you help with',
      'what can you help me with',
      "what's you able to",
      'what is you able to',
      'what are you able to',
      "what's you capable to",
      'what is you capable to',
      'what are you capable to',
      'what sort of work do you',
      'what sort of things do you',
      'what sort of thing do you',
      'what kind of work do you',
      'what kind of things do you',
      'what kind of thing do you',
      'what do you do',
      'tell me what you do',
      'what else do you',
      'what else can you do',
      'what else do you do',
      'is there anything else you',
      'anything else you do',
      'any other task',
      'any other tasks',
      'other task or',
      'other tasks or',
      'other task you',
      'other tasks you',
      'other task that',
      'other tasks that',
      'things you complete',
      'other things you',
      "what's there besides",
      'what is there besides',
      "what's besides",
      'what is besides',
      'how can you help',
      'proactive update',
      "what's a proactive",
      'what is a proactive',
      "what's the proactive",
      'what is the proactive',
      "what's proactive",
      'what is proactive',
      'deploy agents',
      'deploy agent',
    ])
  ) {
    return true;
  }
  if (includesAny(t, ['are there any other']) && hasAnyWord(t, ['task', 'job', 'work', 'thing'])) {
    return true;
  }
  if (
    includesAny(t, [
      'what else can you',
      'what else do you',
      'what other can you',
      'what other do you',
    ])
  ) {
    return true;
  }
  // apart from / other than / in addition to … what|do you|task(s)|job(s)
  if (
    (includesAny(t, ['apart from', 'other than', 'in addition to']) &&
      (includesAny(t, ['do you', 'what']) || hasAnyWord(t, ['task', 'tasks', 'job', 'jobs'])))
  ) {
    return true;
  }
  // agent deploy / have named agents
  if (
    includesAny(t, [
      'spin up agents',
      'spin up agent',
      'named agents',
      'named agent',
      'have agents',
      'have agent',
      'have any agents',
      'have any agent',
      'got agents',
      'got agent',
      'got any agents',
      'got any agent',
      'use agents',
      'use agent',
      'use any agents',
      'use named agents',
      'agents to do',
      'agent to do',
      'agents doing',
      'agent doing',
      'agents for work',
      'agent for work',
      'agents for task',
      'agents for tasks',
      'agent for task',
      'agent for tasks',
    ])
  ) {
    return true;
  }
  if (
    (hasAnyWord(t, ['can', 'could', 'do']) &&
      includesAny(t, ['you ']) &&
      (includesAny(t, ['deploy agent', 'deploy agents', 'run agent', 'run agents', 'start agent', 'start agents', 'use agent', 'use agents', 'spin up agent', 'spin up agents'])))
  ) {
    return true;
  }
  return false;
}

function isLegionTaskPermissionQuery(message, dialogue = {}) {
  const t = normLocal(message);
  if (!t) return false;

  const isPerm =
    dialogue.speechAct === 'permission' ||
    dialogue.speechAct === 'howto' ||
    ((hasAnyWord(t, ['can', 'could', 'may i']) ||
      includesAny(t, ['am i able', 'is it possible', 'are we able', 'how do i', 'how can i'])) &&
      hasAnyWord(t, ['move', 'reschedule', 'cancel', 'schedule', 'unschedule']));

  if (!isPerm) return false;

  if (parseTaskIdFromMessage(message) != null) return true;
  if (dialogue.topic === 'task' || dialogue.topic === 'queue') return true;
  if (
    hasAnyWord(t, ['task', 'queue', 'legion', 'mission']) &&
    hasAnyWord(t, ['move', 'reschedule', 'cancel', 'schedule'])
  ) {
    return true;
  }
  return false;
}

function isConfigExplainQuery(message) {
  const t = normLocal(message);
  if (!t) return false;
  if (isLegionTaskPermissionQuery(message)) return false;
  const permission =
    (hasAnyWord(t, ['can', 'could', 'may i']) ||
      includesAny(t, ['am i able to', 'is it possible', 'are we able to'])) &&
    (hasAnyWord(t, [
      'adjust',
      'change',
      'modify',
      'edit',
      'configure',
      'customize',
      'enable',
      'disable',
      'tweak',
      'move',
      'reschedule',
      'cancel',
      'turn off',
    ]) ||
      includesAny(t, ['turn off']));
  const howTo =
    includesAny(t, ['how do i', 'how can i']) &&
    (hasAnyWord(t, [
      'adjust',
      'change',
      'modify',
      'edit',
      'configure',
      'customize',
      'move',
      'reschedule',
      'cancel',
      'schedule',
      'setup',
    ]) ||
      includesAny(t, ['set up', 'setup']));
  const target = hasAnyWord(t, [
    'background',
    'cron',
    'proactive',
    'operation',
    'operations',
    'job',
    'jobs',
    'task',
    'tasks',
    'schedule',
    'automation',
    'routine',
    'update',
  ]);
  return (permission || howTo) && target;
}

function isOperationsQuery(message) {
  const t = normLocal(message);
  if (isQueueReadQuery(message) || isCapabilitiesQuery(message) || isConfigExplainQuery(message)) return false;
  const bareOps = stripTrailingPunct(t);
  if (bareOps === 'operations status') return true;
  return includesAny(t, [
    "what's running",
    'what is running',
    'what are running',
    'what jobs are you run',
    'what job are you run',
    'what jobs do you run',
    'what job do you run',
    'what jobs are you running',
    'what job are you running',
    'what jobs do you running',
    'background jobs',
    'background job',
    'background tasks',
    'background task',
    'background cron',
    'cron jobs',
    'cron job',
    'cron list',
    "what's in the background",
    'what is in the background',
    "what's on the background",
    'what is on the background',
    "what's in background",
    'what is in background',
    "what's on background",
    'what is on background',
    'list cron jobs',
    'list cron job',
    'list background jobs',
    'list background job',
    "what's the operations status",
    'what is the operations status',
    "what's operations status",
    'what is operations status',
    'operations status',
  ]);
}

function isAnswerLocalQuery(message, sessionState = {}) {
  const { isSalesSyncStatusQuery } = require('./salesSyncStatus');
  const { resolveDialogueTurn } = require('./dialogueManager');
  const dialogue = resolveDialogueTurn(message, { sessionState });
  return (
    isLegionTaskPermissionQuery(message, dialogue) ||
    isQueueReadQuery(message) ||
    isConfigExplainQuery(message) ||
    isTaskExplainQuery(message) ||
    isTaskExplainByIdQuery(message) ||
    isTaskDetailQuery(message) ||
    isSalesSyncStatusQuery(message) ||
    isIdentityQuery(message) ||
    isCapabilitiesQuery(message) ||
    isOperationsQuery(message)
  );
}

function shouldSynthesizeRoute(route, message, dialogue = null) {
  if (dialogue && dialogue.responseClass === 'A') return false;
  if (dialogue && dialogue.responseClass === 'B') return true;
  if (route === 'config_explain' || route === 'capabilities_read') return true;
  if (route === 'task_explain_read' || route === 'task_detail_read') return true;
  // Operations: always synthesize from facts JSON (no brochure dump as primary voice)
  if (route === 'operations_read') return true;
  return false;
}

function getProactiveSystemsFacts() {
  let config = {};
  try {
    const { getConfig } = require('./configManager');
    config = getConfig();
  } catch (_) {}
  const idleHours = config.proactiveIntervalHours != null ? config.proactiveIntervalHours : 6;
  return {
    idleMemo: {
      id: 'proactive_thinker',
      displayName: 'Proactive Update (Last 30 Days)',
      plainEnglishDescription:
        'When you have been quiet for a while, Piko sends a short memo using last-30-day business metrics from the sales cache.',
      trigger: `Hourly check; sends after ${idleHours} hours without chat`,
      enabled: config.proactiveUpdatesEnabled !== false,
      editableKeys: ['proactiveUpdatesEnabled', 'proactiveIntervalHours'],
      configFile: 'data/piko_config.json',
    },
    businessHealth: {
      id: 'business_health',
      displayName: "Business Health Alert (Today's metrics)",
      plainEnglishDescription:
        'Separate proactive engine (~every 5 min) that alerts when the analyst finds a business anomaly (e.g. no sales today).',
      editableVia: 'data/proactive-policy.json (businessHealth category and mode)',
    },
  };
}

function gatherLocalFacts(route, message, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const intents = opts.intents || [];
  const dialogue = opts.dialogue || null;
  const sessionState = opts.sessionState || {};
  const pending = intents.filter((i) => i.status === 'pending' || !i.status);
  const ops = loadOperations(rootDir);

  const facts = {
    route,
    userQuestion: message,
    speechAct: dialogue?.speechAct || null,
    topic: dialogue?.topic || null,
    responseClass: dialogue?.responseClass || null,
    compound: dialogue?.compound || false,
    compoundUnits: (dialogue?.units || []).map((u) => ({
      text: u.text,
      speechAct: u.speechAct?.act,
      topic: u.speechAct?.topic,
    })),
    lastDiscussed: sessionState.lastDiscussed || null,
    operations: {
      cronJobs: ops.cronJobs || [],
      scripts: ops.scripts || [],
      configPath: 'knowledge/piko-operations.json',
      note: 'Server crons/scripts; edit on server and redeploy to change schedules.',
    },
    capabilities: clusterCapabilities(loadCapabilitySummaries(rootDir)),
    proactiveSystems: getProactiveSystemsFacts(),
    queue: {
      count: pending.length,
      jobs: pending.slice(0, 12).map((i) => ({
        taskId: i.task_id || i.taskId,
        objective:
          (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || '',
        schedule: i.schedule || '',
        mode: i.mode || 'require_approval',
      })),
      note: 'User-managed Legion scheduled jobs via chat (schedule, cancel, explain by Task #N).',
    },
  };

  try {
    const { getConfig } = require('./configManager');
    facts.pikoConfig = getConfig();
  } catch (_) {}

  // Agent orchestration state (EI / orch spines) — facts for LLM synthesis, not canned denial
  try {
    const { isAgentOrchEnabled, listAgents, getAgentStatus } = require('./agentOrchestrator');
    if (isAgentOrchEnabled(rootDir)) {
      const status = getAgentStatus({ rootDir, limit: 30 });
      facts.agentOrchestration = {
        enabled: true,
        agents: listAgents(rootDir).map((a) => ({
          id: a.id,
          label: a.label || a.id,
          description: a.description || '',
          runtime: a.runtime || null,
        })),
        counts: status.counts || {},
        activeJobs: (status.jobs || []).slice(0, 10).map((j) => ({
          id: j.id,
          status: j.status,
          type: j.type,
          agent_id: j.payload && j.payload.agent_id,
          brief: j.payload && (j.payload.brief || j.payload.goal),
        })),
        howTo: {
          brief: 'Say “I want an agent to …” or /agent brief <goal> — Piko asks one clarifying question then starts',
          list: '/agents',
          start: '/agent run <agent_id> <brief>  OR  "put <agent_id> on <task>"',
          status: '/agents status',
          stop: '/agent stop <job_id>',
          mission: '/mission <goal>',
          dashboard: 'Agents tab on the web dashboard',
        },
      };
      try {
        const { loadResearchGoal } = require('./eiResearchGoal');
        const rg = loadResearchGoal();
        facts.researchGoal = {
          id: rg.id,
          title: rg.title,
          summary: rg.summary,
          sites: (rg.sites || []).map((s) => ({ id: s.id, label: s.label })),
          startHint: 'Say “I want an agent to collate earliest hieroglyph sources for Abydos, Heliopolis, and Giza” or /mission with that goal',
        };
      } catch (_) { /* optional */ }
    } else {
      facts.agentOrchestration = { enabled: false };
    }
  } catch (_) {
    facts.agentOrchestration = { enabled: false, error: 'orch module unavailable' };
  }

  if (route === 'config_explain') {
    facts.configGuidance = {
      answerPriority:
        'For permission/how-to: YES — user can change proactive/runtime settings from chat (confirm first). Give chat mutation examples.',
      chatEditable: {
        proactiveIdleMemo: 'Say e.g. "Turn off proactive updates" or "Set proactive interval to 8 hours"',
        businessHealth: 'Say e.g. "Disable business health alerts" or "Set proactive mode to draft only"',
        legionQueue: 'Schedule/cancel/explain jobs in chat by Task #N',
      },
      legionQueueMutations: [
        'Move Task #6 to 10am',
        'Cancel Task #6',
      ],
      backgroundJobMutations: [
        'Disable intent poller',
        'Enable nightly wisdom',
        'Disable rabbit hole',
      ],
      doNotTellUserToEdit: 'knowledge/piko-operations.json (unless they explicitly ask about server cron deploy)',
      chatMutations: [
        'Turn off proactive updates',
        'Set proactive interval to 8 hours',
        'Disable business health alerts',
        'Set proactive mode to draft only',
      ],
    };
    facts.operations = {
      ...facts.operations,
      note: 'Catalog only — NOT changed from chat. User edits proactive settings via chat commands instead.',
      editableFromChat: false,
    };
  }

  return facts;
}

function formatLegionPermissionFallback(message, intents = []) {
  const { legionScheduleMutateHelpLines } = require('./legionScheduleMutate');
  const { findIntentByTaskId } = require('./taskRead');
  const taskId = parseTaskIdFromMessage(message);
  const lines = ['Yes — Legion queue jobs are managed from chat (I confirm before applying).', ''];

  if (taskId != null) {
    const intent = findIntentByTaskId(taskId, intents);
    if (!intent || intent.status === 'cancelled') {
      lines.push(
        `Task #${taskId} is not in the queue right now (it may have been cancelled).`,
        'Check with "what\'s in the queue?" or schedule a new job.',
        '',
      );
    } else {
      const objective =
        (intent.briefFields && intent.briefFields.objective) ||
        intent.title ||
        intent.description ||
        'scheduled mission';
      lines.push(
        `Task #${taskId} is currently scheduled ${intent.schedule || 'on a cadence'} — ${String(objective).slice(0, 80)}.`,
        '',
      );
    }
  }

  lines.push(...legionScheduleMutateHelpLines());
  lines.push(
    '',
    'To create a new scheduled job: "Schedule low stock scan daily at 9am"',
    '(Do not type bare "schedule" — use natural phrasing like above.)',
  );
  return lines.join('\n');
}

function formatConfigExplainFallback(rootDir) {
  const { configMutateHelpLines } = require('./configMutate');
  const ops = formatOperationsLines(rootDir);
  const lines = [
    'Yes — you can adjust several runtime settings from chat (I confirm before applying).',
    '',
    '• Proactive idle memo: proactiveUpdatesEnabled, proactiveIntervalHours',
    '• Business health alerts: proactive-policy.json (businessHealth, mode)',
    '• Legion queue jobs: schedule/cancel in chat by Task #N',
    '• Background jobs (intent-poller, nightly wisdom, etc.): disable/enable from chat',
  ];
  if (ops.length) {
    lines.push('', 'Current background jobs (catalog):', ...ops.slice(0, 6).map((l) => `• ${l}`));
  }
  lines.push('', ...configMutateHelpLines());
  return lines.join('\n');
}

const CAP_SHORT_LABELS = {
  'inventory.low_stock.scan': 'Low stock & reorder scans',
  'inventory.report.export': 'Full reorder list / CSV export',
  'inventory.csv.generate': 'Reorder CSV download',
  'sales.analysis.run': 'Sales sync, cache build & forecast',
  'sales.summary.get': 'Sales summaries (today / yesterday / week)',
  'purchase_order.draft.create': 'Purchase order drafts',
  'ausmaker.business.health.review': 'AusMaker business health review',
  'web.research.run': 'Web search',
  'business.metrics.aggregate': 'Business KPIs & revenue',
  'system.health.ping': 'Endpoint health checks',
  'performance.benchmark.run': 'Latency / performance checks',
};

function stripPikoNativePrefix(desc) {
  const raw = String(desc || '');
  const lower = toLowerAsciiish(raw);
  const prefix = 'piko-native:';
  if (!lower.startsWith(prefix)) return raw;
  let i = prefix.length;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i += 1;
  return raw.slice(i);
}

function shortCapLabel(entry) {
  if (entry && entry.id && CAP_SHORT_LABELS[entry.id]) return CAP_SHORT_LABELS[entry.id];
  const desc = stripPikoNativePrefix(entry.description || '');
  const cut = desc.indexOf(' Use for:');
  const core = (cut > 0 ? desc.slice(0, cut) : desc).trim();
  return core || entry.id;
}

function loadCapabilitySummaries(dataDir) {
  try {
    const { loadCapabilityRegistry } = require('./actionRouter');
    return loadCapabilityRegistry().map(shortCapLabel).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function clusterCapabilities(labels) {
  const groups = {
    'Sales & data': [],
    Inventory: [],
    Other: [],
  };
  for (const label of labels) {
    const low = toLowerAsciiish(label);
    if (includesAny(low, ['sales', 'forecast', 'revenue', 'metric', 'business health', 'sync', 'analysis'])) {
      groups['Sales & data'].push(label);
    } else if (includesAny(low, ['inventory', 'stock', 'reorder', 'purchase order', 'csv'])) {
      groups.Inventory.push(label);
    } else {
      groups.Other.push(label);
    }
  }
  return groups;
}

function formatOperationsLines(rootDir) {
  const ops = loadOperations(rootDir);
  const lines = [];
  for (const j of ops.cronJobs || []) {
    const purpose = j.purpose ? ` — ${j.purpose}` : '';
    lines.push(`${j.name} (${j.schedule})${purpose}`);
  }
  for (const s of ops.scripts || []) {
    const purpose = s.purpose ? ` — ${s.purpose}` : '';
    lines.push(`${s.name} (${s.schedule})${purpose}`);
  }
  return lines;
}

function formatCapabilitiesReply(opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const intents = opts.intents || [];
  const pending = intents.filter((i) => i.status === 'pending' || !i.status);
  const identity = isIdentityQuery(opts.message || '');
  // Fallback sketch only — primary voice is LLM synthesis over facts JSON
  const lines = [];

  if (identity) {
    lines.push("I'm Piko — I chat, remember context, and run Legion / business / culture work when you ask.");
  } else {
    lines.push("Here's a quick sketch of what I can do (ask for detail on any part):");
  }

  try {
    const { isAgentOrchEnabled, listAgents } = require('./agentOrchestrator');
    if (isAgentOrchEnabled(rootDir)) {
      const ids = listAgents(rootDir).map((a) => a.id);
      lines.push('');
      lines.push(`Named agents on this spine: ${ids.join(', ') || 'none'}.`);
      lines.push('Start one with /agent run <id> <brief> or the Agents dashboard tab.');
    }
  } catch (_) {}

  const bg = formatOperationsLines(rootDir);
  if (bg.length) {
    lines.push('');
    lines.push('Background (always on):');
    bg.slice(0, 8).forEach((l) => lines.push(`• ${l}`));
    if (bg.length > 8) lines.push(`• …plus ${bg.length - 8} more.`);
  }

  const caps = loadCapabilitySummaries(rootDir);
  const grouped = clusterCapabilities(caps);
  const onDemand = [];
  for (const [group, items] of Object.entries(grouped)) {
    if (items.length) onDemand.push(`${group}: ${items.slice(0, 3).join('; ')}`);
  }
  if (onDemand.length) {
    lines.push('');
    lines.push('On demand (when you ask):');
    onDemand.forEach((l) => lines.push(`• ${l}`));
  }

  if (pending.length) {
    lines.push('');
    lines.push(
      `Your queue has ${pending.length} scheduled job${pending.length === 1 ? '' : 's'} — ask "what's in the queue?" for those.`,
    );
  }

  lines.push('');
  lines.push('I only report what is configured here — I do not invent extra people or tasks.');
  return squeezeBlankLines(lines.join('\n')).trim();
}

function formatOperationsReply(rootDir) {
  const lines = formatOperationsLines(rootDir);
  if (!lines.length) {
    return 'No background operations are configured in piko-operations.json.';
  }
  return `Background jobs running:\n${lines.map((l) => `• ${l}`).join('\n')}`;
}

/**
 * @returns {{ reply: string, route: string, synthesize?: boolean, facts?: object } | null}
 */
function resolveAnswerLocal(message, opts = {}) {
  const rootDir = opts.rootDir || path.join(__dirname, '..');
  const intents = opts.intents || [];
  const sessionState = opts.sessionState || {};
  const { resolveDialogueTurn } = require('./dialogueManager');
  const dialogue = resolveDialogueTurn(message, { sessionState });

  function buildResult(route, reply, extraFacts = {}) {
    const facts = {
      ...gatherLocalFacts(route, message, { rootDir, intents, dialogue, sessionState }),
      ...extraFacts,
    };
    const synthesize = shouldSynthesizeRoute(route, message, dialogue);
    return { route, reply, synthesize, facts, dialogue };
  }

  const { isConfigMutateIntent } = require('./configMutate');
  const { isLegionScheduleMutateIntent } = require('./legionScheduleMutate');
  const { isOperationsMutateIntent } = require('./operationsMutate');
  if (isConfigMutateIntent(message) || isLegionScheduleMutateIntent(message) || isOperationsMutateIntent(message)) {
    return null;
  }

  if (isQueueReadQuery(message) || (dialogue.speechAct === 'list' && dialogue.topic === 'queue')) {
    return {
      reply: formatQueueReadReply(intents),
      route: 'queue_read',
      synthesize: false,
      facts: gatherLocalFacts('queue_read', message, { rootDir, intents, dialogue, sessionState }),
      dialogue,
    };
  }
  if (isLegionTaskPermissionQuery(message, dialogue)) {
    return {
      reply: formatLegionPermissionFallback(message, intents),
      route: 'legion_permission',
      synthesize: false,
      facts: gatherLocalFacts('legion_permission', message, { rootDir, intents, dialogue, sessionState }),
      dialogue,
    };
  }
  if (
    isConfigExplainQuery(message) ||
    dialogue.speechAct === 'permission' ||
    dialogue.speechAct === 'howto'
  ) {
    return buildResult('config_explain', formatConfigExplainFallback(rootDir));
  }
  if (
    isIdentityQuery(message) ||
    isCapabilitiesQuery(message) ||
    (dialogue.speechAct === 'explain' && (dialogue.topic === 'capabilities' || dialogue.topic === 'proactive')) ||
    (dialogue.speechAct === 'follow_up' && dialogue.topic === 'proactive')
  ) {
    return buildResult(
      'capabilities_read',
      formatCapabilitiesReply({ rootDir, intents, message }),
      dialogue.topic === 'proactive' ? { highlight: 'proactiveSystems' } : {},
    );
  }
  if (isTaskExplainByIdQuery(message) || isTaskExplainQuery(message)) {
    const taskId = parseTaskIdFromMessage(message);
    const reply =
      taskId != null
        ? formatTaskExplainByIdReply(taskId, intents, rootDir)
        : formatTaskExplainReply(message, intents, rootDir);
    return buildResult('task_explain_read', reply, { taskId: taskId || null });
  }
  if (isTaskDetailQuery(message)) {
    const taskId = parseTaskIdFromMessage(message);
    return buildResult('task_detail_read', formatTaskDetailReply(taskId, intents), { taskId });
  }
  if (isOperationsQuery(message) || (dialogue.speechAct === 'list' && dialogue.topic === 'operations')) {
    return buildResult('operations_read', formatOperationsReply(rootDir));
  }
  return null;
}

function recordLocalAnswerContext(sessionId, localAnswer, dataDir) {
  if (!sessionId || !localAnswer) return;
  try {
    const { recordDiscussedTopic } = require('./dialogueManager');
    const topic =
      localAnswer.dialogue?.topic ||
      (localAnswer.route === 'queue_read'
        ? 'queue'
        : localAnswer.route === 'config_explain'
          ? 'operations'
          : localAnswer.route === 'capabilities_read'
            ? 'capabilities'
            : localAnswer.route);
    recordDiscussedTopic(
      sessionId,
      {
        topic,
        route: localAnswer.route,
        entities: localAnswer.facts?.queue?.jobs?.map((j) => `task_${j.taskId}`).filter(Boolean) || [],
      },
      dataDir,
    );
  } catch (_) {}
}

module.exports = {
  CAP_SHORT_LABELS,
  isIdentityQuery,
  isCapabilitiesQuery,
  isConfigExplainQuery,
  isOperationsQuery,
  isAnswerLocalQuery,
  shouldSynthesizeRoute,
  gatherLocalFacts,
  formatCapabilitiesReply,
  formatOperationsReply,
  formatConfigExplainFallback,
  formatLegionPermissionFallback,
  isLegionTaskPermissionQuery,
  resolveAnswerLocal,
  recordLocalAnswerContext,
};
