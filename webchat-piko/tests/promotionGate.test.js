const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluatePromotionGate } = require('../lib/modelops/promotionGate');

test('promotion gate emits deterministic continuity reason codes', () => {
  const out = evaluatePromotionGate({
    continuity: { passRate: 0.5, avgTotal: 3.0, scenarioCount: 10, passCount: 5 },
    reliability: { totalDeliveries: 0, totalDeadLetters: 0, successfulDeliveries: 0 },
    thresholds: {
      passRateMin: 0.8,
      avgTotalMin: 3.8,
      enforceReliability: false,
    },
  });
  assert.equal(out.pass, false);
  assert.equal(out.reasonCodes.includes('GATE_CONTINUITY_PASS_RATE_BELOW_MIN'), true);
  assert.equal(out.reasonCodes.includes('GATE_CONTINUITY_AVG_TOTAL_BELOW_MIN'), true);
});

test('promotion gate applies reliability checks when eligible', () => {
  const out = evaluatePromotionGate({
    continuity: { passRate: 0.95, avgTotal: 4.2, scenarioCount: 10, passCount: 9 },
    reliability: { totalDeliveries: 10, totalDeadLetters: 2, successfulDeliveries: 7 },
    thresholds: {
      passRateMin: 0.8,
      avgTotalMin: 3.8,
      minDeliverySuccessRate: 0.9,
      maxDeadLetterRate: 0.1,
      minDeliveriesForReliability: 1,
      enforceReliability: true,
    },
  });
  assert.equal(out.pass, false);
  assert.equal(out.reasonCodes.includes('GATE_RELIABILITY_DELIVERY_SUCCESS_BELOW_MIN'), true);
  assert.equal(out.reasonCodes.includes('GATE_RELIABILITY_DEADLETTER_ABOVE_MAX'), true);
});

test('promotion gate passes when continuity and reliability meet thresholds', () => {
  const out = evaluatePromotionGate({
    continuity: { passRate: 0.9, avgTotal: 4.0, scenarioCount: 12, passCount: 11 },
    reliability: { totalDeliveries: 20, totalDeadLetters: 1, successfulDeliveries: 19 },
    thresholds: {
      passRateMin: 0.8,
      avgTotalMin: 3.8,
      minDeliverySuccessRate: 0.9,
      maxDeadLetterRate: 0.1,
      minDeliveriesForReliability: 1,
      enforceReliability: true,
    },
  });
  assert.equal(out.pass, true);
  assert.equal(out.reasonCodes.length, 0);
});

