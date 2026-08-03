const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyEiFrontDoor,
  looksLikeSourceWorkAsk,
  looksLikeFlagPolicyAsk,
} = require('../lib/eiIntentGate');

const PETRIE_ASK = 'Ok, Piko, I want you to research Flinder Petrie bibliography, then find pdf copies of all his works.';

test('heuristic stubs are inert (no keyword tripwires)', () => {
  assert.equal(looksLikeSourceWorkAsk(PETRIE_ASK), false);
  assert.equal(looksLikeFlagPolicyAsk('always keep petrie'), false);
});

test('classifyEiFrontDoor with llm:false does not fake work via regex', async () => {
  const door = await classifyEiFrontDoor(PETRIE_ASK, { llm: false });
  assert.equal(door.lane, 'chat');
  assert.equal(door.source, 'none');
});
