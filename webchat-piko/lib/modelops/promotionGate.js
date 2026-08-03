function clampNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRatio(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return num / den;
}

function evaluatePromotionGate(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const continuity = cfg.continuity && typeof cfg.continuity === 'object' ? cfg.continuity : {};
  const reliability = cfg.reliability && typeof cfg.reliability === 'object' ? cfg.reliability : {};
  const thresholds = cfg.thresholds && typeof cfg.thresholds === 'object' ? cfg.thresholds : {};

  const passRate = clampNumber(continuity.passRate, 0);
  const avgTotal = clampNumber(continuity.avgTotal, 0);
  const scenarioCount = clampNumber(continuity.scenarioCount, 0);
  const passCount = clampNumber(continuity.passCount, 0);

  const totalDeliveries = clampNumber(reliability.totalDeliveries, 0);
  const totalDeadLetters = clampNumber(reliability.totalDeadLetters, 0);
  const successfulDeliveries = clampNumber(reliability.successfulDeliveries, 0);
  const deliverySuccessRate = totalDeliveries > 0
    ? toRatio(successfulDeliveries, totalDeliveries)
    : clampNumber(reliability.deliverySuccessRate, 0);
  const deadLetterRate = totalDeliveries > 0
    ? toRatio(totalDeadLetters, totalDeliveries)
    : clampNumber(reliability.deadLetterRate, 0);

  const passRateMin = clampNumber(thresholds.passRateMin, 0.8);
  const avgTotalMin = clampNumber(thresholds.avgTotalMin, 3.8);
  const minDeliverySuccessRate = clampNumber(thresholds.minDeliverySuccessRate, 0.9);
  const maxDeadLetterRate = clampNumber(thresholds.maxDeadLetterRate, 0.1);
  const minDeliveriesForReliability = Math.max(0, Math.trunc(clampNumber(thresholds.minDeliveriesForReliability, 1)));
  const enforceReliability = thresholds.enforceReliability !== false;

  const reasonCodes = [];
  const reasons = [];

  if (passRate < passRateMin) {
    reasonCodes.push('GATE_CONTINUITY_PASS_RATE_BELOW_MIN');
    reasons.push(`GATE_CONTINUITY_PASS_RATE_BELOW_MIN: passRate ${passRate.toFixed(3)} < ${passRateMin.toFixed(3)}`);
  }
  if (avgTotal < avgTotalMin) {
    reasonCodes.push('GATE_CONTINUITY_AVG_TOTAL_BELOW_MIN');
    reasons.push(`GATE_CONTINUITY_AVG_TOTAL_BELOW_MIN: avgTotal ${avgTotal.toFixed(3)} < ${avgTotalMin.toFixed(3)}`);
  }

  const reliabilityEligible = enforceReliability && totalDeliveries >= minDeliveriesForReliability;
  if (reliabilityEligible && deliverySuccessRate < minDeliverySuccessRate) {
    reasonCodes.push('GATE_RELIABILITY_DELIVERY_SUCCESS_BELOW_MIN');
    reasons.push(`GATE_RELIABILITY_DELIVERY_SUCCESS_BELOW_MIN: deliverySuccessRate ${deliverySuccessRate.toFixed(3)} < ${minDeliverySuccessRate.toFixed(3)}`);
  }
  if (reliabilityEligible && deadLetterRate > maxDeadLetterRate) {
    reasonCodes.push('GATE_RELIABILITY_DEADLETTER_ABOVE_MAX');
    reasons.push(`GATE_RELIABILITY_DEADLETTER_ABOVE_MAX: deadLetterRate ${deadLetterRate.toFixed(3)} > ${maxDeadLetterRate.toFixed(3)}`);
  }

  return {
    pass: reasonCodes.length === 0,
    reasonCodes,
    reasons,
    metrics: {
      passRate,
      avgTotal,
      scenarioCount,
      passCount,
      totalDeliveries,
      totalDeadLetters,
      successfulDeliveries,
      deliverySuccessRate,
      deadLetterRate,
      thresholds: {
        passRateMin,
        avgTotalMin,
        minDeliverySuccessRate,
        maxDeadLetterRate,
        minDeliveriesForReliability,
        enforceReliability,
      },
    },
  };
}

module.exports = {
  evaluatePromotionGate,
};
