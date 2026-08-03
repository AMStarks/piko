const PHASE0_CONTRACT_VERSION = 'phase0.v1';

const PHASE0_TASK_EVENT_TYPES = [
  'task_queued',
  'task_started',
  'task_blocked',
  'task_submitted',
  'task_approved',
  'task_rejected',
  'artifact_ready',
  'run_failed',
];

const PHASE0_DECISION_REQUEST_TYPES = [
  'approve_execution',
  'approve_publish',
  'handle_blocker',
  'risk_escalation',
  // Backward-compatible alias observed in existing smoke checks.
  'execute',
];

const PHASE0_DECISION_VALUES = ['approve', 'reject', 'pause', 'needs_input'];
const PHASE0_COMMAND_TYPES = ['approve_task', 'reject_task', 'pause_legion', 'resume_legion', 'request_summary'];
const PHASE0_RISK_LEVELS = ['low', 'medium', 'high'];

module.exports = {
  PHASE0_CONTRACT_VERSION,
  PHASE0_TASK_EVENT_TYPES,
  PHASE0_DECISION_REQUEST_TYPES,
  PHASE0_DECISION_VALUES,
  PHASE0_COMMAND_TYPES,
  PHASE0_RISK_LEVELS,
};
