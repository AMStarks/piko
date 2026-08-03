const {
  createDeadLetter,
  getDeadLetter,
  updateDeadLetter,
} = require('./actionDeadLetters');

function toCommandType(decisionType, actionRoute) {
  if (actionRoute !== 'auto_execute') return '';
  if (decisionType === 'approve_execution' || decisionType === 'approve_publish' || decisionType === 'execute') return 'approve_task';
  if (decisionType === 'handle_blocker') return 'request_summary';
  if (decisionType === 'risk_escalation') return 'pause_legion';
  return '';
}

function buildLegionCommandFromDecision(input) {
  const src = input && typeof input === 'object' ? input : {};
  const actionRoute = String(src.action_route || src.actionRoute || '');
  const decisionType = String(src.decision_type || src.decisionType || '');
  const commandType = toCommandType(decisionType, actionRoute);
  if (!commandType) return null;

  const traceId = String(src.trace_id || src.traceId || '').trim();
  const legionId = String(src.legion_id || src.legionId || '').trim();
  const userId = String(src.user_id || src.userId || '').trim();
  const taskId = String(src.task_id || src.taskId || '').trim();
  if (!traceId || !legionId || !userId) return null;
  if ((commandType === 'approve_task' || commandType === 'request_summary') && !taskId) return null;

  return {
    command_id: `decact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    trace_id: traceId,
    legion_id: legionId,
    user_id: userId,
    task_id: taskId || undefined,
    type: commandType,
    payload: {
      source: 'phaseC_decision_route',
      decision_type: decisionType,
    },
  };
}

async function executeDecisionAction(input, deps = {}) {
  const sendLegionCommand = deps.sendLegionCommand;
  if (typeof sendLegionCommand !== 'function') {
    return { attempted: false, status: 'failed', reason: 'MISSING_SEND_LEGION_COMMAND' };
  }
  const dataDir = deps.dataDir || '';
  const command = buildLegionCommandFromDecision(input);
  if (!command) {
    return {
      attempted: false,
      status: 'skipped',
      reason: 'NO_ELIGIBLE_COMMAND',
    };
  }
  try {
    const ack = await sendLegionCommand(command, { dataDir });
    return {
      attempted: true,
      status: 'sent',
      commandType: command.type,
      commandId: command.command_id,
      ack: ack || {},
    };
  } catch (e) {
    const dead = createDeadLetter(dataDir, {
      trace_id: String(input && input.trace_id || ''),
      task_id: String(input && input.task_id || ''),
      legion_id: String(input && input.legion_id || ''),
      user_id: String(input && input.user_id || ''),
      decision_type: String(input && input.decision_type || ''),
      action_route: String(input && input.action_route || ''),
      command_type: command.type,
      command_payload: command,
      error: e && e.message ? e.message : 'EXECUTION_FAILED',
      code: e && e.code ? e.code : '',
    });
    return {
      attempted: true,
      status: 'failed',
      reason: e && e.message ? e.message : 'EXECUTION_FAILED',
      commandType: command.type,
      deadLetterId: dead.id,
    };
  }
}

async function replayDecisionActionDeadLetter(deadLetterId, deps = {}) {
  const sendLegionCommand = deps.sendLegionCommand;
  const dataDir = deps.dataDir || '';
  if (typeof sendLegionCommand !== 'function') throw new Error('Missing sendLegionCommand dependency');
  const letter = getDeadLetter(dataDir, deadLetterId);
  if (!letter) throw new Error('Dead letter not found');
  if (String(letter.status) === 'resolved') return { ok: true, deadLetter: letter, replay: { status: 'already_resolved' } };

  const cooldownSec = Math.max(0, Number(process.env.LEGION_ACTION_REPLAY_COOLDOWN_SEC || 15));
  const lastReplayAtMs = letter.lastReplayAt ? Date.parse(letter.lastReplayAt) : NaN;
  if (cooldownSec > 0 && Number.isFinite(lastReplayAtMs) && (Date.now() - lastReplayAtMs) < cooldownSec * 1000) {
    const waitMs = cooldownSec * 1000 - (Date.now() - lastReplayAtMs);
    const err = new Error(`Replay cooldown active (${Math.ceil(waitMs / 1000)}s remaining)`);
    err.code = 'REPLAY_COOLDOWN';
    throw err;
  }

  try {
    const ack = await sendLegionCommand(letter.command_payload || {}, { dataDir });
    const updated = updateDeadLetter(dataDir, letter.id, {
      status: 'resolved',
      replayCount: Number(letter.replayCount || 0) + 1,
      lastReplayAt: new Date().toISOString(),
      lastReplayStatus: 'sent',
      resolvedAt: new Date().toISOString(),
      lastAck: ack || {},
    });
    return { ok: true, deadLetter: updated, replay: { status: 'sent', ack: ack || {} } };
  } catch (e) {
    const updated = updateDeadLetter(dataDir, letter.id, {
      status: 'retry_failed',
      replayCount: Number(letter.replayCount || 0) + 1,
      lastReplayAt: new Date().toISOString(),
      lastReplayStatus: 'failed',
      lastReplayError: e && e.message ? e.message : 'REPLAY_FAILED',
    });
    const err = new Error(e && e.message ? e.message : 'Replay failed');
    err.code = e && e.code ? e.code : 'REPLAY_FAILED';
    err.deadLetter = updated;
    throw err;
  }
}

module.exports = {
  buildLegionCommandFromDecision,
  executeDecisionAction,
  replayDecisionActionDeadLetter,
};
