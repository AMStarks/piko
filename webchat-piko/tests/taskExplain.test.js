const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTaskExplainQuery,
  isTaskExplainByIdQuery,
  isTaskDetailQuery,
  parseTaskIdFromMessage,
  parseTaskLabelFromExplainMessage,
  findIntentByLabel,
  formatTaskExplainReply,
  formatTaskExplainByIdReply,
} = require('../lib/taskRead');

const SAMPLE_INTENTS = [
  {
    task_id: 4,
    status: 'pending',
    schedule: 'daily 06:00',
    mode: 'auto',
    briefFields: { objective: 'sales sync' },
  },
  {
    task_id: 5,
    status: 'pending',
    schedule: 'daily 08:00',
    mode: 'auto',
    briefFields: { objective: 'smoke low stock scan' },
  },
  {
    task_id: 6,
    status: 'pending',
    schedule: 'daily 09:00',
    mode: 'auto',
    briefFields: { objective: 'low stock scan' },
  },
];

test('detects explain questions', () => {
  assert.equal(isTaskExplainQuery('Can you explain what smoke low stock scan (daily 08:00) is?'), true);
  assert.equal(isTaskExplainQuery('Schedule low stock scan daily at 9am'), false);
});

test('rejects bare pronoun explain without task context', () => {
  const msg =
    'Is there anything else you do? I noticed you have a Proactive Update you typed at 6am. What is that?';
  assert.equal(isTaskExplainQuery(msg), false);
});

test('Task #N uses ID path not label explain', () => {
  assert.equal(parseTaskIdFromMessage('Can you explain Task #6 for me.'), 6);
  assert.equal(isTaskExplainQuery('Can you explain Task #6 for me.'), false);
  assert.equal(isTaskExplainByIdQuery('Can you explain Task #6 for me.'), true);
  assert.equal(isTaskDetailQuery('Task #6 - what is it?'), true);
});

test('formatTaskExplainByIdReply for Task #6', () => {
  const reply = formatTaskExplainByIdReply(6, SAMPLE_INTENTS, require('path').join(__dirname, '..'));
  assert.match(reply, /Task #6/);
  assert.match(reply, /low stock scan/i);
  assert.match(reply, /What it does:/i);
});

test('parses task label from explain phrasing', () => {
  assert.equal(
    parseTaskLabelFromExplainMessage('Can you explain what smoke low stock scan (daily 08:00) is?'),
    'smoke low stock scan',
  );
});

test('finds queued intent by label', () => {
  const intent = findIntentByLabel('smoke low stock scan', SAMPLE_INTENTS);
  assert.equal(intent.task_id, 5);
});

test('formats explain reply without scheduling', () => {
  const reply = formatTaskExplainReply(
    'Can you explain what smoke low stock scan (daily 08:00) is?',
    SAMPLE_INTENTS,
    require('path').join(__dirname, '..'),
  );
  assert.match(reply, /Task #5/);
  assert.match(reply, /smoke low stock scan/i);
  assert.match(reply, /daily 08:00/i);
  assert.doesNotMatch(reply, /scheduled:/i);
});
