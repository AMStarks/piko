const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isConfigExplainQuery,
  shouldSynthesizeRoute,
  resolveAnswerLocal,
} = require('../lib/answerLocal');
const { shouldFireWorkLaneAck } = require('../lib/policyGate');
const { localSynthesisEnabled } = require('../lib/frontDesk');
const { finalizeLocalAnswer, getLocalSynthMode, parseTelegramChatId } = require('../lib/localAnswerHandler');

const rootDir = path.join(__dirname, '..');

test('isConfigExplainQuery detects permission questions', () => {
  assert.equal(isConfigExplainQuery('Am I able to adjust the background tasks?'), true);
  assert.equal(isConfigExplainQuery('How do I change the proactive update time?'), true);
  assert.equal(isConfigExplainQuery('Schedule low stock scan daily at 9am'), false);
});

test('resolveAnswerLocal config_explain includes facts not just template', () => {
  const out = resolveAnswerLocal('Am I able to adjust the background tasks?', {
    rootDir,
    intents: [],
  });
  assert.equal(out.route, 'config_explain');
  assert.equal(out.synthesize, true);
  assert.match(out.reply, /confirm before applying|Turn off proactive/i);
  assert.ok(out.facts.operations);
  assert.ok(out.facts.configGuidance?.chatMutations?.length);
});

test('queue read stays deterministic without synthesis', () => {
  const out = resolveAnswerLocal("what's in the queue?", { rootDir, intents: [] });
  assert.equal(out.route, 'queue_read');
  assert.equal(out.synthesize, false);
});

test('shouldFireWorkLaneAck blocks mis-triaged config questions', () => {
  assert.equal(
    shouldFireWorkLaneAck('Am I able to adjust the background tasks?', { route: 'SCHEDULE_WORK' }),
    false,
  );
});

test('local synthesis enabled by default', () => {
  assert.equal(localSynthesisEnabled(), true);
});

test('shouldSynthesizeRoute synthesizes operations from facts', () => {
  assert.equal(shouldSynthesizeRoute('operations_read', 'What background jobs are running?'), true);
  assert.equal(shouldSynthesizeRoute('operations_read', 'How can I change background tasks?'), true);
});

test('isCapabilitiesQuery catches agent deploy questions', () => {
  const { isCapabilitiesQuery } = require('../lib/answerLocal');
  assert.equal(isCapabilitiesQuery('Can you confirm if you can deploy agents to do work for you?'), true);
  assert.equal(isCapabilitiesQuery('Do you have named agents?'), true);
  assert.equal(isCapabilitiesQuery('How are sales today?'), false);
});

test('capabilities_read includes agentOrchestration facts when orch on', () => {
  const prev = process.env.PIKO_AGENT_ORCH;
  process.env.PIKO_AGENT_ORCH = '1';
  try {
    const out = resolveAnswerLocal('Can you confirm if you can deploy agents to do work for you?', {
      rootDir,
      intents: [],
    });
    assert.equal(out.route, 'capabilities_read');
    assert.equal(out.synthesize, true);
    assert.ok(out.facts);
    assert.equal(out.facts.agentOrchestration?.enabled, true);
    assert.ok(Array.isArray(out.facts.agentOrchestration?.agents));
  } finally {
    if (prev === undefined) delete process.env.PIKO_AGENT_ORCH;
    else process.env.PIKO_AGENT_ORCH = prev;
  }
});

test('legion task permission uses focused template not schedule advice', async () => {
  const msg = 'Am I able to move Task #6?';
  const out = resolveAnswerLocal(msg, { rootDir, intents: [] });
  assert.equal(out.route, 'legion_permission');
  assert.equal(out.synthesize, false);
  assert.match(out.reply, /Move Task #6 to 10am/i);
  assert.doesNotMatch(out.reply, /type ['"]?schedule/i);
});

test('isAnswerLocalQuery catches legion permission when triage would miss', () => {
  const { isAnswerLocalQuery, isLegionTaskPermissionQuery } = require('../lib/answerLocal');
  const msg = 'Am I able to move Task #6?';
  assert.equal(isLegionTaskPermissionQuery(msg, { speechAct: 'permission', topic: 'task' }), true);
  assert.equal(isAnswerLocalQuery(msg), true);
});

test('config_explain prefers facts+synthesis path (template is fallback)', async () => {
  const prev = process.env.PIKO_LOCAL_SYNTH_MODE;
  process.env.PIKO_LOCAL_SYNTH_MODE = 'off';
  const msg = 'Am I able to adjust the background tasks?';
  const out = resolveAnswerLocal(msg, { rootDir, intents: [] });
  assert.equal(out.route, 'config_explain');
  assert.equal(out.synthesize, true);
  assert.ok(out.facts.configGuidance?.chatMutations?.length);
  const finalized = await finalizeLocalAnswer(out, msg, [], {
    reqSource: 'telegram',
    sessionId: 'telegram-12345',
  });
  if (prev === undefined) delete process.env.PIKO_LOCAL_SYNTH_MODE;
  else process.env.PIKO_LOCAL_SYNTH_MODE = prev;
  assert.equal(finalized.synthesized, false);
  assert.match(finalized.reply, /confirm before applying|Turn off proactive/i);
  assert.doesNotMatch(finalized.reply, /edit.*piko-operations/i);
});

test('universal identity header is present', () => {
  const { getUniversalIdentityHeader, withUniversalIdentity } = require('../lib/pikoIdentity');
  const h = getUniversalIdentityHeader(rootDir);
  assert.match(h, /SYSTEM IDENTITY/);
  assert.match(h, /Legion|agents|orchestrat/i);
  const wrapped = withUniversalIdentity('Hello body');
  assert.ok(wrapped.startsWith('SYSTEM IDENTITY:'));
  assert.match(wrapped, /Hello body/);
});

test('smart mode returns fast with synthesis pending on budget miss', async () => {
  const prev = process.env.PIKO_LOCAL_SYNTH_MODE;
  process.env.PIKO_LOCAL_SYNTH_MODE = 'smart';
  const out = resolveAnswerLocal(
    'Is there anything else you do? I noticed you have a Proactive Update you typed at 6am. What is that?',
    { rootDir, intents: [] },
  );
  const msg =
    'Is there anything else you do? I noticed you have a Proactive Update you typed at 6am. What is that?';
  const finalized = await finalizeLocalAnswer(out, msg, [], {
    reqSource: 'telegram',
    sessionId: 'telegram-12345',
  });
  if (prev === undefined) delete process.env.PIKO_LOCAL_SYNTH_MODE;
  else process.env.PIKO_LOCAL_SYNTH_MODE = prev;
  assert.ok(finalized.synthesisPending === true || finalized.synthesized === true);
  assert.ok(finalized.reply.length > 20);
});

test('speech act permission routes config explain', () => {
  const { classifySpeechAct } = require('../lib/dialogueManager');
  const act = classifySpeechAct('Am I able to adjust the background tasks?');
  assert.equal(act.act, 'permission');
});

test('parseTelegramChatId from sessionId', () => {
  assert.equal(parseTelegramChatId('telegram-998877'), '998877');
  assert.equal(parseTelegramChatId('web-default'), null);
});

test('getLocalSynthMode defaults telegram to smart', () => {
  const prev = process.env.PIKO_LOCAL_SYNTH_MODE;
  delete process.env.PIKO_LOCAL_SYNTH_MODE;
  assert.equal(getLocalSynthMode({ reqSource: 'telegram', sessionId: 'telegram-1' }), 'smart');
  if (prev === undefined) delete process.env.PIKO_LOCAL_SYNTH_MODE;
  else process.env.PIKO_LOCAL_SYNTH_MODE = prev;
});
