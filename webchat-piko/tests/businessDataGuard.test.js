const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isBusinessDataAction,
  shouldForceWorkFromChat,
  groundingRefusalReply,
} = require('../lib/businessDataGuard');

describe('businessDataGuard', () => {
  it('treats stock_on_hand_get as business data', () => {
    assert.equal(isBusinessDataAction({ actionType: 'stock_on_hand_get', sku: '48SCOTCH-MED' }), true);
  });

  it('treats inventory capabilities as business data', () => {
    assert.equal(isBusinessDataAction({ actionType: 'run_capability', capability: 'inventory.low_stock.scan' }), true);
    assert.equal(isBusinessDataAction({ actionType: 'run_capability', capability: 'sales.analysis.run' }), true);
  });

  it('does not treat casual none as business data', () => {
    assert.equal(isBusinessDataAction({ actionType: 'none' }), false);
  });

  it('forces work when chat triage meets business action', () => {
    assert.equal(
      shouldForceWorkFromChat(
        { route: 'CHAT_FAST' },
        { actionType: 'stock_on_hand_get', sku: '48SCOTCH-MED' },
      ),
      true,
    );
    assert.equal(
      shouldForceWorkFromChat(
        { route: 'WORK_NOW' },
        { actionType: 'stock_on_hand_get', sku: '48SCOTCH-MED' },
      ),
      false,
    );
    assert.equal(
      shouldForceWorkFromChat({ route: 'CHAT_FAST' }, { actionType: 'none' }),
      false,
    );
  });

  it('refusal has no invented quantity', () => {
    const reply = groundingRefusalReply();
    assert.doesNotMatch(reply, /\b\d+\s+units\b/i);
    assert.doesNotMatch(reply, /dozen/i);
  });
});
