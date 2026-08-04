const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapRouteToPlane,
  mapChatLaneToPlane,
  assertPlaneAllowed,
  planesForRole,
} = require('../lib/privilegePlanes');

describe('lib/privilegePlanes', () => {
  it('maps routes and lanes', () => {
    assert.equal(mapRouteToPlane('/api/agents/jobs', 'POST'), 'work');
    assert.equal(mapRouteToPlane('/api/agents/jobs', 'GET'), 'chat');
    assert.equal(mapRouteToPlane('/api/control/webhook-rules', 'POST'), 'config');
    assert.equal(mapRouteToPlane('/api/yolo-tool', 'POST'), 'money');
    assert.equal(mapChatLaneToPlane('legate_dispatch'), 'work');
    assert.equal(mapChatLaneToPlane('opinion'), 'chat');
  });

  it('client cannot work; operator can; money needs confirm', () => {
    assert.deepEqual(planesForRole('client'), ['chat']);
    const denied = assertPlaneAllowed('work', { role: 'client' });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'plane_denied');

    const ok = assertPlaneAllowed('work', { role: 'operator' });
    assert.equal(ok.ok, true);

    const moneyNo = assertPlaneAllowed('money', { role: 'operator' });
    assert.equal(moneyNo.ok, false);
    assert.equal(moneyNo.needs_confirm, true);

    const moneyYes = assertPlaneAllowed('money', { role: 'operator', moneyConfirmed: true });
    assert.equal(moneyYes.ok, true);
  });
});
