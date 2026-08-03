/**
 * ReAct Execution Engine — Think-Act-Reflect loop for 7B model.
 * Atomic LLM steps, truncated observations, max 4 steps, max 2 errors.
 */
const { ollamaNativeChat } = require('./llm');
const { loadCapabilityRegistry, getPikoNativeCapabilityIds } = require('./actionRouter');
const { loadManifest } = require('./knowledgeManifest');

const MAX_OBSERVATION_CHARS = 600;
const MAX_STEPS = 4;
const MAX_ERRORS = 2;

/** Safely truncate observation before feeding back to LLM. Prevents context poisoning. */
function truncateObservation(data) {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return str.length <= MAX_OBSERVATION_CHARS ? str : str.slice(0, MAX_OBSERVATION_CHARS) + '...[truncated]';
  } catch (_) {
    return '[observation parse error]';
  }
}

/** Build tools list for chooseAction prompt. */
const {
  stripCodeFences,
} = require('./text');

function getToolsForPrompt() {
  const registry = loadCapabilityRegistry();
  const native = getPikoNativeCapabilityIds();
  const byId = new Map(registry.map((c) => [c.id, c]));
  for (const id of native) {
    if (!byId.has(id)) {
      const manifest = loadManifest();
      const nc = (manifest.nativeCapabilities || []).find((n) => n.id === id);
      byId.set(id, { id, description: (nc && nc.description) || id });
    }
  }
  const tools = Array.from(byId.values()).map((c) => ({ action: c.id, description: c.description || c.id }));
  tools.push({ action: 'create_intent', description: 'Schedule a recurring task. parameters: { schedule: "daily 09:00" or "hourly 06:00-23:00", objective: "low stock scan" }' });
  tools.push({ action: 'create_reminder', description: 'Set a one-off reminder. parameters: { dueAt: "ISO date", objective: "call mum" }' });
  tools.push({ action: 'create_tripwire', description: 'Create a proactive inventory alert. parameters: { sku: "SKU", field: "stock", operator: "<" or ">" or "<=" or ">=" or "==", value: number }' });
  tools.push({ action: 'create_digest_schedule', description: 'Schedule the daily Product Change Summary. parameters: { time: "HH:MM" 24h, e.g. "16:00" for 4pm, "09:00" for 9am }' });
  tools.push({ action: 'forecast_get', description: 'Get forecast for a SKU. parameters: { sku: "SKU" }' });
  tools.push({ action: 'forecast_override_set', description: 'Set manual forecast override for a month. parameters: { sku: "SKU", year_month: "YYYY-MM", qty: number }' });
  tools.push({ action: 'sales_summary_get', description: 'Get sales performance data. parameters: { period: "today"|"week"|"month", sku: "optional SKU" }' });
  tools.push({ action: 'memory_core_update', description: 'Append high-level user preference to SOUL. parameters: { preference: "text to remember" }' });
  tools.push({ action: 'memory_subconscious_search', description: 'Search past conversation context. parameters: { query: "natural language search" }' });
  tools.push({ action: 'web_research_run', description: 'Search the live web. Use for: news, prices, market drivers, suppliers; AND when user says "dig deeper", "find more", "expand" — formulate a NEW, specific query. parameters: { query: "search terms" }' });
  tools.push({ action: 'python_execute', description: 'Execute Python for complex math, data analysis, or chart generation. parameters: { code: "raw Python script" }' });
  tools.push({ action: 'email_send', description: 'Send an email. parameters: { to: "email@example.com", subject: "Subject", body: "Body text" }' });
  tools.push({ action: 'document_parse', description: 'Extract text from a local PDF. parameters: { filePath: "data/catalog.pdf" or absolute path }' });
  tools.push({ action: 'browser_actuate', description: 'Perform actions on a webpage (click, type). parameters: { url: "https://...", actions: [{ action: "click", selector: "#id" }, { action: "type", selector: "#input", value: "text" }] }' });
  tools.push({ action: 'legion_deploy_agent', description: 'Deploy a specialized sub-agent. parameters: { role: "quant" (forecasting/math) or "researcher" (web research), taskContext: "task description" }' });
  tools.push({ action: 'business.metrics.aggregate', description: 'Get 30-day business KPIs (units sold, revenue). parameters: {}' });
  tools.push({ action: 'system.health.ping', description: 'Ping URLs for health check. parameters: { urls: ["url1","url2"] }' });
  tools.push({ action: 'performance.benchmark.run', description: 'Measure website latency. parameters: { url: "https://..." }' });
  tools.push({ action: 'finish', description: 'Return the answer to the user. Use when you have enough info. parameters: { answer: "your reply" }' });
  return tools;
}

/**
 * Think: brief internal monologue on what to do next.
 * @param {{ goal: string, steps: Array }} state
 * @param {string} model
 */
async function think(state, model) {
  const stepsText = state.steps.length === 0
    ? 'No steps taken yet.'
    : state.steps.map((s, i) => `Step ${i + 1}: ${s.thought} → ${s.action} → ${truncateObservation(s.observation)}`).join('\n');
  const prompt = `Goal: ${state.goal}

Previous steps:
${stepsText}

What should we do next? One short sentence.`;
  const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    temperature: 0.3,
    max_tokens: 80,
    priority: 'background',
    lane: 'worker',
  });
  return (raw || '').trim().slice(0, 200);
}

/**
 * Choose action. MUST use format json. Returns { action, parameters, confidence }.
 * @param {{ goal: string, steps: Array }} state
 * @param {string} thought
 * @param {string} model
 */
async function chooseAction(state, thought, model) {
  const tools = getToolsForPrompt();
  const toolsText = tools.map((t) => `- ${t.action}: ${t.description}`).join('\n');
  const prompt = `Goal: ${state.goal}
Thought: ${thought}

Available tools:
${toolsText}
- finish: Use when you have enough information to answer the user. Return the answer in "parameters.answer".

Return JSON: { "action": "tool_name_or_finish", "parameters": {}, "confidence": 0.0-1.0 }`;
  const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    format: 'json',
    temperature: 0.1,
    max_tokens: 500,
    priority: 'background',
    lane: 'worker',
  });
  const cleaned = stripCodeFences(raw || '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned || '{}');
  } catch (err) {
    console.warn('[agent-brain] JSON parse failed:', (cleaned || '').slice(0, 200));
    return {
      action: 'finish',
      parameters: { answer: "I encountered an error trying to process that." },
      confidence: 0,
    };
  }
  return {
    action: String(parsed.action || 'finish').trim(),
    parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
  };
}

/**
 * Execute action via injected executeTool. Wrapped in try/catch.
 * @param {{ action: string, parameters: object }} actionObj
 * @param {{ executeTool: (action, params) => Promise<any> }} context
 */
async function execute(actionObj, context) {
  try {
    const result = await context.executeTool(actionObj.action, actionObj.parameters);
    return result;
  } catch (e) {
    return { error: e.message || 'Tool execution failed' };
  }
}

/**
 * Reflect: was the step successful?
 * @param {{ goal: string, steps: Array }} state
 * @param {string} thought
 * @param {{ action: string }} actionObj
 * @param {string} observation
 * @param {string} model
 */
async function reflect(state, thought, actionObj, observation, model) {
  const prompt = `Goal: ${state.goal}
Thought: ${thought}
Action: ${actionObj.action}
Observation: ${observation}

Did this step succeed? Reply "yes" or "no" and one short reason.`;
  const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    temperature: 0,
    max_tokens: 30,
    priority: 'background',
    lane: 'worker',
  });
  const r = (raw || '').toLowerCase().trim();
  return r.startsWith('yes');
}

/**
 * Run ReAct loop. Returns final answer for the user.
 * @param {string} goal - User's task/message
 * @param {object} context - { executeTool, model, dataDir?, legionBaseUrl? }
 * @returns {Promise<string>}
 */
async function runAgent(goal, context = {}) {
  const model = context.model || process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';
  const executeTool = context.executeTool;
  if (typeof executeTool !== 'function') {
    return "Agent misconfigured — no executeTool provided.";
  }

  const state = { goal, steps: [], done: false, errorCount: 0 };
  let finalAnswer = '';

  while (!state.done && state.steps.length < MAX_STEPS && state.errorCount < MAX_ERRORS) {
    const thought = await think(state, model);
    const actionObj = await chooseAction(state, thought, model);

    if (actionObj.action === 'finish') {
      finalAnswer = (actionObj.parameters && actionObj.parameters.answer) || thought || 'Done.';
      state.done = true;
      break;
    }

    const observation = await execute(actionObj, context);
    const success = await reflect(state, thought, actionObj, observation, model);

    state.steps.push({ thought, action: actionObj.action, observation, success });
    if (!success) state.errorCount++;

    if (success && observation && !String(observation).includes('error')) {
      finalAnswer = observation;
      state.done = true;
    }
  }

  if (!finalAnswer && state.steps.length > 0) {
    const last = state.steps[state.steps.length - 1];
    finalAnswer = last.observation || 'Could not complete the task. Try rephrasing or use a slash command.';
  }
  if (!finalAnswer) finalAnswer = 'Could not complete the task. Try rephrasing or use a slash command.';

  // Return full answer — no truncation. Synthesis/capabilities already cap length; truncation was choking web research briefings.
  const str = typeof finalAnswer === 'string' ? finalAnswer : JSON.stringify(finalAnswer);
  return str;
}

module.exports = {
  runAgent,
  truncateObservation,
  think,
  chooseAction,
  execute,
  reflect,
  getToolsForPrompt,
};
