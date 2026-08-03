const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isProtectedPagePath,
  isProtectedApiPath,
  isOperatorOnlyPagePath,
  isOperatorOnlyApiPath,
  isOperatorOnlyCampaignAction,
} = require('../lib/adminAuth');

test('WP1.1: /api/ei and /api/cultures are session-protected', () => {
  assert.equal(isProtectedApiPath('/api/ei/engineering/tasks', 'GET'), true);
  assert.equal(isProtectedApiPath('/api/ei/engineering/tasks/x/approve', 'POST'), true);
  assert.equal(isProtectedApiPath('/api/ei/eval/latest', 'GET'), true);
  assert.equal(isProtectedApiPath('/api/cultures/campaign', 'GET'), true);
  assert.equal(isProtectedApiPath('/api/cultures/campaign', 'POST'), true);
  assert.equal(isProtectedApiPath('/api/chat/inject', 'POST'), true);
});

test('WP1.1: engineering + inject are operator-only; cultures GET is not', () => {
  assert.equal(isOperatorOnlyApiPath('/api/ei/engineering/tasks'), true);
  assert.equal(isOperatorOnlyApiPath('/api/ei/engineering/tasks/abc/approve'), true);
  assert.equal(isOperatorOnlyApiPath('/api/chat/inject'), true);
  assert.equal(isOperatorOnlyApiPath('/api/cultures/campaign'), false);
  assert.equal(isOperatorOnlyApiPath('/api/ei/eval/latest'), false);
});

test('WP1.1: campaign mutating actions are operator-only; reads are not', () => {
  for (const a of ['start', 'stop', 'pause', 'resume', 'run_now', 'flag_duplicate_urls', 'add_leads', 'backfill_learning']) {
    assert.equal(isOperatorOnlyCampaignAction(a), true, a);
  }
  for (const a of ['scorecard', 'findings', 'status', '']) {
    assert.equal(isOperatorOnlyCampaignAction(a), false, a);
  }
});

test('WP1.4: /ei-eval and /corpus are protected operator pages', () => {
  assert.equal(isProtectedPagePath('/ei-eval'), true);
  assert.equal(isProtectedPagePath('/corpus'), true);
  assert.equal(isOperatorOnlyPagePath('/ei-eval'), true);
  assert.equal(isOperatorOnlyPagePath('/corpus'), true);
  assert.equal(isOperatorOnlyPagePath('/ios-dashboard'), false);
});
