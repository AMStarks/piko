/**
 * Plan-and-Execute Orchestrator — breaks compound requests into sequential steps,
 * executes each via the action router, and synthesizes a final response.
 */
const { ollamaNativeChat } = require('./llm');
const { routeToAction } = require('./actionRouter');
const { executeRoute } = require('./routeExecutor');

const PLANNER_MODEL = process.env.PIKO_HEAVY_MODEL || process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';
const MAX_PLAN_STEPS = 6;

/**
 * @param {string} userPrompt - The compound user request
 * @param {object} opts - { sessionModel, message, dataDir, ausmakerBaseUrl, dispatchLegionBrief, legionAdapterApiBase }
 * @returns {Promise<string|null>} - Synthesized response, or null to fall back to single-shot routing
 */
const {
  stripCodeFences,
} = require('./text');

async function planAndExecute(userPrompt, opts = {}) {
  const {
    sessionModel = PLANNER_MODEL,
    message = userPrompt,
    dataDir,
    ausmakerBaseUrl,
    dispatchLegionBrief,
    legionAdapterApiBase,
    sessionId,
    reqSource,
  } = opts;

  const { executeDeterministicWorkflow } = require('./compoundWorkflows');
  const deterministic = await executeDeterministicWorkflow(userPrompt, {
    sessionModel,
    message,
    dataDir,
    ausmakerBaseUrl,
    legionAdapterApiBase,
    sessionId,
    reqSource,
  });
  if (deterministic) {
    console.log('[ORCHESTRATOR] Deterministic compound workflow completed.');
    return deterministic;
  }

  console.log('[ORCHESTRATOR] Initiating Plan-and-Execute for compound task...');

  const { fireProgressAck } = require('./frontDesk');
  await fireProgressAck({ actionType: 'compound_task' }, userPrompt, { sessionId, reqSource });

  const plannerPrompt = `You are the Task Planner. Break the following complex user request into a strict JSON array of sequential, atomic sub-tasks. Each step must be a single, clear action.

User Request: "${userPrompt}"

Output Format STRICTLY as JSON array (no markdown, no explanation):
[
  { "step": 1, "description": "Gather 30-day business metrics" },
  { "step": 2, "description": "Run forecast for HARDBRICK" },
  { "step": 3, "description": "Email the summary to the user" }
]

Rules:
- 2 to ${MAX_PLAN_STEPS} steps only.
- Each description must be a single, actionable sub-task.
- Output ONLY the JSON array.`;

  let plan = [];
  try {
    const planResponse = await ollamaNativeChat(PLANNER_MODEL, [{ role: 'user', content: plannerPrompt }], {
      max_tokens: 400,
      temperature: 0.1,
    });
    const cleanJson = stripCodeFences(planResponse || '');
    const parsed = JSON.parse(cleanJson);
    plan = Array.isArray(parsed) ? parsed : [];
    if (plan.length < 2) {
      console.log('[ORCHESTRATOR] Plan has <2 steps. Falling back to single-shot.');
      return null;
    }
    plan = plan.slice(0, MAX_PLAN_STEPS);
    console.log(`[ORCHESTRATOR] Generated plan with ${plan.length} steps.`);
  } catch (e) {
    console.error('[ORCHESTRATOR] Planner failed to generate valid JSON. Falling back to single-shot.', e.message);
    return null;
  }

  let scratchpad = `Initial Request: ${userPrompt}\n\n`;

  for (const task of plan) {
    console.log(`[ORCHESTRATOR] Executing Step ${task.step}: ${task.description}`);

    const routerContext = `Context from previous steps:\n${scratchpad}\n\nCurrent step to execute: ${task.description}`;

    const route = await routeToAction(task.description, sessionModel, {
      lastAssistantMessage: scratchpad.slice(-800),
    });

    let stepResult = '';

    if (route.actionType === 'none') {
      stepResult = await ollamaNativeChat(PLANNER_MODEL, [
        { role: 'user', content: `Based on this context, complete the step: "${task.description}"\n\nContext:\n${scratchpad.slice(-600)}` },
      ], { max_tokens: 200, temperature: 0.3 });
      stepResult = (stepResult || '').trim() || 'Step acknowledged.';
    } else if (route.actionType === 'clarification_needed') {
      stepResult = route.fallbackMessage || 'Could not determine action for this step.';
    } else {
      const execOpts = {
        message: task.description,
        sessionModel,
        dataDir,
        ausmakerBaseUrl,
        dispatchLegionBrief,
        legionAdapterApiBase,
      };
      const reply = await executeRoute(route, execOpts);
      stepResult = reply || `Tool executed (${route.actionType}).`;
    }

    scratchpad += `--- Step ${task.step} Result ---\nTask: ${task.description}\nResult: ${stepResult}\n\n`;
  }

  console.log('[ORCHESTRATOR] All steps completed. Synthesizing final response...');

  const synthesisPrompt = `You are Piko. The user asked: "${userPrompt}"

Here is the step-by-step data gathered to fulfill this request:

${scratchpad}

Synthesize this raw data into a clear, cohesive, and conversational response for the user. Be concise. No meta-commentary about steps or tools.`;

  const synthesized = await ollamaNativeChat(PLANNER_MODEL, [{ role: 'user', content: synthesisPrompt }], {
    max_tokens: 1024,
    temperature: 0.4,
  });

  return (synthesized || '').trim() || 'I ran the steps but could not synthesize a response.';
}

module.exports = { planAndExecute };
