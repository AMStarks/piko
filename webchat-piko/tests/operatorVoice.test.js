const test = require('node:test');
const assert = require('node:assert/strict');
const { polishOutbound } = require('../lib/operatorVoice');
const { formatDispatchAck, formatProgressChatReply, formatReviewChatReply } = require('../lib/legateChat');

test('strips Job: lines but keeps functional stop commands', () => {
  const raw = 'On it.\n\nJob: job_1c2d3e4f-aa11-bb22-cc33-dd44ee55ff66\nStatus: /agents status · Stop: /agent stop job_1c2d3e4f-aa11-bb22-cc33-dd44ee55ff66';
  const out = polishOutbound(raw);
  assert.ok(!/^Job:/m.test(out), 'job line removed');
  assert.ok(out.includes('/agent stop job_1c2d3e4f'), 'stop command preserved');
  assert.ok(!/Status: \/agents status/.test(out), 'status telemetry removed');
});

test('scrubs job UUIDs from prose', () => {
  const out = polishOutbound('I queued job_9f8e7d6c-1234-5678-9abc-def012345678 for you.');
  assert.ok(!out.includes('job_9f8e7d6c'), 'uuid gone');
  assert.ok(out.includes('this job'));
  assert.equal(
    polishOutbound('Cancel requested for running job job_9f8e7d6c-1234-5678-9abc-def012345678. It will stop shortly.'),
    'Cancel requested for running job. It will stop shortly.',
  );
});

test('strips worker tags but keeps markdown links', () => {
  const raw = '[ei-worker / shared tool belt]\nFound the volume.\n[Read it here](https://example.org/x.pdf)';
  const out = polishOutbound(raw);
  assert.ok(!out.includes('[ei-worker'), 'worker tag removed');
  assert.ok(out.includes('[Read it here](https://example.org/x.pdf)'), 'markdown link intact');
});

test('drops planner telemetry lines and de-jargons mission-fit', () => {
  const raw = 'Planner: LLM failed (invalid tools) — deterministic fallback\nMission-fit review (find Dunn):\nkeep=1 · drop=2 · unsure=0';
  const out = polishOutbound(raw);
  assert.ok(!/Planner:/.test(out));
  assert.ok(/relevance check/i.test(out));
  assert.ok(!/mission-fit/i.test(out));
});

test('naturalizes legacy review blocks and inline review stamps', () => {
  const raw = 'Legate review — ei-worker on “find the Dunn book”\nVerdict: accept\nKept one matching PDF.\nJob: job_abc12345-1111-2222-3333-444455556666';
  const out = polishOutbound(raw);
  assert.ok(!/Legate review —/.test(out));
  assert.ok(!/^Verdict:/m.test(out));
  assert.ok(out.includes('Kept one matching PDF.'));

  assert.equal(polishOutbound('[Piko review: accept] All good.'), 'All good.');
  assert.ok(polishOutbound('[Piko review: revise] Missing volume 2.').startsWith('Note: '));
});

test('dispatch ack reads naturally and keeps cancel hint', () => {
  const ack = formatDispatchAck({ reply: 'On it — sending my researcher after that book.' }, { job: { id: 'job_x1' } });
  assert.ok(ack.includes("I'll post updates here"));
  assert.ok(ack.includes('/agent stop job_x1'));
  assert.ok(!/^Job:/m.test(ack));
});

test('progress + review formatters have no agent ids or verdict labels', () => {
  const prog = formatProgressChatReply({ id: 'job_x', payload: { agent_id: 'ei-worker' } }, { message: 'searching for the PDF', ok: true });
  assert.ok(prog.startsWith('Update — '));
  assert.ok(!prog.includes('ei-worker'));
  assert.ok(!prog.includes('job_x'));

  const review = formatReviewChatReply(
    { id: 'job_x', payload: { agent_id: 'ei-worker', operator_message: 'find the Dunn book' } },
    { ok: true, run: { review: { verdict: 'accept', summary: 'Kept one matching PDF.' } } }
  );
  assert.ok(!/Verdict:/.test(review));
  assert.ok(!/Legate review/.test(review));
  assert.ok(review.includes('Kept one matching PDF.'));
  assert.ok(/happy with the result/.test(review));

  const failed = formatReviewChatReply(
    { id: 'job_x', payload: { operator_message: 'find the Dunn book' } },
    { ok: false, error: 'no matching PDF found' }
  );
  assert.ok(/ran into trouble/.test(failed));
  assert.ok(!/job_x/.test(failed));
});

test('kill switch and passthrough', () => {
  process.env.PIKO_OPERATOR_VOICE = 'off';
  assert.equal(polishOutbound('Job: job_abc12345-1111-2222-3333-444455556666'), 'Job: job_abc12345-1111-2222-3333-444455556666');
  delete process.env.PIKO_OPERATOR_VOICE;
  assert.equal(polishOutbound('A perfectly normal reply.'), 'A perfectly normal reply.');
  assert.equal(polishOutbound(''), '');
  assert.equal(polishOutbound(null), null);
});

test('polishNotificationText strips tracebacks, endpoints, eval ids', () => {
  const { polishNotificationText } = require('../lib/operatorVoice');
  const raw = [
    '⚠️ **Nightly Quant Agent:** The forecast run encountered an issue.',
    'Quant Agent Analysis Failed after 3 attempts. Last Python Error: Execution Error',
    'Traceback (most recent call last):',
    '  File "/home/chief/webchat-piko/.venv/lib/python3.14/site-packages/pandas/io/sql.py", line 2702, in execute',
    '    cur.execute(sql)',
  ].join('\n');
  const out = polishNotificationText(raw);
  assert.ok(out.includes('The forecast run encountered an issue'));
  assert.ok(!/Traceback/i.test(out));
  assert.ok(!out.includes('/home/chief'));
  assert.ok(!/Last Python Error/i.test(out));
});

test('polishNotificationText humanises eval ids and strips approve endpoints', () => {
  const { polishNotificationText } = require('../lib/operatorVoice');
  const raw = '3 engineering fix task(s) queued from eval eval_20260728T173001.iqkbs. Approve at /ei-eval or POST /api/ei/engineering/tasks/:id/approve';
  const out = polishNotificationText(raw);
  assert.ok(!out.includes('eval_20260728'));
  assert.ok(!out.includes('/api/ei/engineering'));
  assert.ok(out.includes('an automated check'));
});

test('polishNotificationText caps length and keeps clean text intact', () => {
  const { polishNotificationText } = require('../lib/operatorVoice');
  const clean = 'Platform check passed — all sites healthy.';
  assert.equal(polishNotificationText(clean), clean);
  const long = 'x'.repeat(1000);
  assert.ok(polishNotificationText(long).length <= 401);
});
