const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadMobileStateWithTempDir(tempDir) {
  process.env.PIKO_DATA_DIR = tempDir;
  const modPath = require.resolve('../lib/mobileState');
  delete require.cache[modPath];
  return require('../lib/mobileState');
}

test('mobile reliability metrics reflect heartbeats, push tokens, and acks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-mobile-state-'));
  const mobileState = loadMobileStateWithTempDir(tempDir);

  mobileState.upsertDeviceHeartbeat({
    deviceId: 'ios-1',
    platform: 'ios',
    appState: 'foreground',
    cadenceEffectivePollSec: 120,
  });
  mobileState.upsertDeviceHeartbeat({
    deviceId: 'ios-2',
    platform: 'ios',
    appState: 'background',
    cadenceEffectivePollSec: 7200,
  });
  mobileState.registerPushToken({
    deviceId: 'ios-1',
    token: 'token-abc-123',
  });
  mobileState.recordPushAck({
    deviceId: 'ios-1',
    status: 'delivered',
    channel: 'push',
  });
  mobileState.recordPushAck({
    deviceId: 'ios-1',
    status: 'opened',
    channel: 'push',
  });

  const out = mobileState.getMobileReliabilityMetrics({
    activeWithinMin: 60,
    staleAfterMin: 1,
    ackSinceHours: 24,
  });

  assert.equal(out.totalDevices, 2);
  assert.equal(out.activeDevices, 2);
  assert.equal(out.pushTokenRegistered, 1);
  assert.equal(out.pushTokenMissing, 1);
  assert.equal(out.lowBatteryDevices >= 0, true);
  assert.equal(out.constrainedDevices >= 0, true);
  assert.equal(out.offlineDevices >= 0, true);
  assert.equal(out.pushAckCount, 2);
  assert.equal(out.ackByStatus.delivered, 1);
  assert.equal(out.ackByStatus.opened, 1);
  assert.equal(out.cadenceOutliers >= 1, true);
});

