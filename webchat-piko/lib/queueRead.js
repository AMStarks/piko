/**
 * Deterministic queue read vs cancel — shared by circuit breakers and intent manage.
 */
const {
  normalizeApostrophes,
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  collapseWhitespace,
} = require('./text');

function isQueueReadQuery(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  if (!t) return false;
  if (hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop', 'clear', 'unschedule'])) return false;
  return includesAny(t, [
    "what's in the queue",
    'whats in the queue',
    'what is in the queue',
    "what's in your queue",
    'whats in your queue',
    'what is in your queue',
    "what's the queue",
    'whats the queue',
    'what is the queue',
    "what's your queue",
    'whats your queue',
    'what is your queue',
    'what are in the queue',
    'tell me what is in the queue',
    "tell me what's in the queue",
    'tell me whats in the queue',
    "what's on your list",
    'whats on your list',
    'what is on your list',
    "what's in your list",
    'whats in your list',
    "what's on your schedule",
    'whats on your schedule',
    'what is on your schedule',
    "what's in your schedule",
    'whats in your schedule',
    'queue status',
    "what's pending",
    'whats pending',
    'what is pending',
    'anything in the queue',
    'anything the queue',
    'anything queue',
    'anything scheduled',
    "what's scheduled",
    'whats scheduled',
    'what is scheduled',
    'what are scheduled',
    'what have we got in the queue',
    'show queue',
    'list queue',
    'tell me queue',
    'show scheduled',
    'list scheduled',
    'tell me scheduled',
    'show pending jobs',
    'list pending jobs',
    'tell me pending jobs',
    'show pending job',
    'list pending job',
  ]);
}

function isQueueCancelQuery(message) {
  const t = collapseWhitespace(toLowerAsciiish(normalizeApostrophes(String(message || ''))));
  return hasAnyWord(t, ['cancel', 'delete', 'remove', 'stop', 'clear', 'unschedule']);
}

function formatQueueReadReply(intents) {
  const pending = (intents || []).filter((i) => i.status === 'pending' || !i.status);
  const cleanIntents = pending.map((i) => {
    const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
    const schedule = i.schedule || (i.dueAt || i.time || i.run ? String(i.dueAt || i.time || i.run).slice(0, 16) : null) || 'Pending';
    const ref = i.task_id || i.taskId;
    const refStr = ref ? ` [Task #${ref}]` : '';
    return { task: String(task).slice(0, 60), schedule, refStr };
  });
  if (cleanIntents.length === 0) return "Queue is empty mate. Nothing scheduled.";
  if (cleanIntents.length <= 5) {
    const parts = cleanIntents.map((c) => `${c.task}${c.refStr} (${c.schedule})`);
    return `You've got ${parts.length} in the queue: ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}. Let me know if you want to cancel any.`;
  }
  const shown = cleanIntents.slice(0, 10);
  const parts = shown.map((c) => `${c.task}${c.refStr} (${c.schedule})`);
  const more = cleanIntents.length - 10;
  return `You've got ${cleanIntents.length} in the queue: ${parts.join('; ')}${more > 0 ? ` … plus ${more} more.` : ''} Let me know if you want to cancel any.`;
}

module.exports = {
  normalizeApostrophes,
  isQueueReadQuery,
  isQueueCancelQuery,
  formatQueueReadReply,
};
