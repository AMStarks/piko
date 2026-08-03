function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function decideMobilePoll(input) {
  const params = input && typeof input === 'object' ? input : {};
  const intent = params.intentSnapshot && typeof params.intentSnapshot === 'object' ? params.intentSnapshot : {};
  const device = params.device && typeof params.device === 'object' ? params.device : null;
  const health = params.serviceHealth && typeof params.serviceHealth === 'object' ? params.serviceHealth : {};

  const hasNextReminder = !!intent.nextReminder;
  const queueLength = clampInt(intent.queueLength, 0, 100000, 0);
  const scheduledCount = clampInt(intent.scheduledCount, 0, 100000, 0);

  let pollAfterSec = hasNextReminder ? 60 : queueLength > 0 ? 120 : 300;
  const reasons = [];
  const urgency = hasNextReminder ? 'high' : queueLength > 0 ? 'normal' : 'low';

  if (!hasNextReminder && queueLength === 0 && scheduledCount > 0) {
    pollAfterSec = Math.min(pollAfterSec, 180);
  }

  if (device) {
    const network = String(device.network || '').toLowerCase();
    const appState = String(device.appState || '').toLowerCase();
    const batteryLevel = Number(device.batteryLevel);
    if (network === 'offline' || network === 'none') {
      pollAfterSec = Math.max(pollAfterSec, 900);
      reasons.push('offline');
    } else if (device.networkConstrained === true) {
      pollAfterSec = Math.max(pollAfterSec, 600);
      reasons.push('network_constrained');
    } else if (device.networkExpensive === true) {
      pollAfterSec = Math.max(pollAfterSec, 420);
      reasons.push('network_expensive');
    }
    if (Number.isFinite(batteryLevel) && batteryLevel <= 0.15 && appState !== 'foreground') {
      pollAfterSec = Math.max(pollAfterSec, 900);
      reasons.push('low_battery_background');
    }
    if (appState === 'background' && urgency === 'low') {
      pollAfterSec = Math.max(pollAfterSec, 600);
      reasons.push('background_idle');
    }
    const desired = clampInt(device.cadenceDesiredPollSec, 60, 86400, 0);
    if (desired > 0) {
      const before = pollAfterSec;
      pollAfterSec = Math.max(pollAfterSec, desired);
      if (pollAfterSec !== before) reasons.push('device_requested_backoff');
    }
  }

  if (health.modelReachable === false) {
    pollAfterSec = Math.max(pollAfterSec, 600);
    reasons.push('llm_unreachable');
  }

  pollAfterSec = clampInt(pollAfterSec, 60, 3600, 300);
  return {
    pollAfterSec,
    urgency,
    degraded: reasons.length > 0,
    degradedReasons: reasons,
    cadenceReason: reasons[0] || (hasNextReminder ? 'next_reminder_due' : queueLength > 0 ? 'queue_pending' : 'idle'),
  };
}

module.exports = {
  decideMobilePoll,
};
