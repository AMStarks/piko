const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.PIKO_DATA_DIR
  ? path.resolve(String(process.env.PIKO_DATA_DIR))
  : path.join(__dirname, '..', 'data');
const MOBILE_STATE_FILE = path.join(DATA_DIR, 'mobile-state.json');
const MAX_PUSH_ACKS = 2000;

function loadState() {
  const fallback = {
    updatedAt: null,
    devices: {},
    pushAcks: [],
  };
  try {
    if (!fs.existsSync(MOBILE_STATE_FILE)) return fallback;
    const raw = fs.readFileSync(MOBILE_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      updatedAt: parsed.updatedAt || null,
      devices: parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
      pushAcks: Array.isArray(parsed.pushAcks) ? parsed.pushAcks : [],
    };
  } catch (_) {
    return fallback;
  }
}

function saveState(state) {
  const out = {
    updatedAt: new Date().toISOString(),
    devices: state.devices || {},
    pushAcks: Array.isArray(state.pushAcks) ? state.pushAcks.slice(-MAX_PUSH_ACKS) : [],
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MOBILE_STATE_FILE, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function upsertDeviceHeartbeat(input) {
  const state = loadState();
  const deviceId = String((input && input.deviceId) || '').trim();
  if (!deviceId) {
    const err = new Error('Missing deviceId');
    err.code = 'MISSING_DEVICE_ID';
    throw err;
  }
  const nowIso = new Date().toISOString();
  const existing = state.devices[deviceId] || {};
  const pushToken = input && input.pushToken ? String(input.pushToken).trim().slice(0, 400) : '';
  const nextPushToken = pushToken || existing.pushToken || '';
  state.devices[deviceId] = {
    deviceId,
    platform: input.platform ? String(input.platform).slice(0, 40) : (existing.platform || ''),
    appVersion: input.appVersion ? String(input.appVersion).slice(0, 40) : (existing.appVersion || ''),
    osVersion: input.osVersion ? String(input.osVersion).slice(0, 40) : (existing.osVersion || ''),
    build: input.build ? String(input.build).slice(0, 40) : (existing.build || ''),
    pushTokenState: input.pushTokenState ? String(input.pushTokenState).slice(0, 40) : (existing.pushTokenState || 'unknown'),
    network: input.network ? String(input.network).slice(0, 40) : (existing.network || ''),
    networkExpensive: input.networkExpensive === true,
    networkConstrained: input.networkConstrained === true,
    batteryLevel: Number.isFinite(Number(input.batteryLevel)) ? Math.max(0, Math.min(1, Number(input.batteryLevel))) : (existing.batteryLevel != null ? existing.batteryLevel : null),
    appState: input.appState ? String(input.appState).slice(0, 40) : (existing.appState || ''),
    cadenceReason: input.cadenceReason ? String(input.cadenceReason).slice(0, 80) : (existing.cadenceReason || ''),
    cadenceUrgency: input.cadenceUrgency ? String(input.cadenceUrgency).slice(0, 40) : (existing.cadenceUrgency || ''),
    cadenceIntentLoad: Number.isFinite(Number(input.cadenceIntentLoad)) ? Math.max(0, Math.min(1000, Number(input.cadenceIntentLoad))) : (existing.cadenceIntentLoad != null ? existing.cadenceIntentLoad : null),
    cadenceServerHintSec: Number.isFinite(Number(input.cadenceServerHintSec)) ? Math.max(60, Math.min(86400, Number(input.cadenceServerHintSec))) : (existing.cadenceServerHintSec != null ? existing.cadenceServerHintSec : null),
    cadenceDesiredPollSec: Number.isFinite(Number(input.cadenceDesiredPollSec)) ? Math.max(60, Math.min(86400, Number(input.cadenceDesiredPollSec))) : (existing.cadenceDesiredPollSec != null ? existing.cadenceDesiredPollSec : null),
    cadenceEffectivePollSec: Number.isFinite(Number(input.cadenceEffectivePollSec)) ? Math.max(60, Math.min(86400, Number(input.cadenceEffectivePollSec))) : (existing.cadenceEffectivePollSec != null ? existing.cadenceEffectivePollSec : null),
    pushToken: nextPushToken,
    pushTokenLast4: nextPushToken ? nextPushToken.slice(-4) : '',
    pushTokenUpdatedAt: pushToken ? nowIso : (existing.pushTokenUpdatedAt || null),
    lastSeenAt: nowIso,
    lastBackgroundSyncAt: input.backgroundSync ? nowIso : (existing.lastBackgroundSyncAt || null),
    quietHoursBypass: input.quietHoursBypass === true,
  };
  const saved = saveState(state);
  return saved.devices[deviceId];
}

function registerPushToken(input) {
  const state = loadState();
  const deviceId = String((input && input.deviceId) || '').trim();
  const token = String((input && input.token) || '').trim();
  if (!deviceId) {
    const err = new Error('Missing deviceId');
    err.code = 'MISSING_DEVICE_ID';
    throw err;
  }
  if (!token) {
    const err = new Error('Missing token');
    err.code = 'MISSING_PUSH_TOKEN';
    throw err;
  }
  const nowIso = new Date().toISOString();
  const existing = state.devices[deviceId] || {};
  state.devices[deviceId] = {
    deviceId,
    ...existing,
    pushTokenState: input && input.pushTokenState ? String(input.pushTokenState).slice(0, 40) : 'registered',
    pushToken: token.slice(0, 400),
    pushTokenLast4: token.slice(-4),
    pushTokenUpdatedAt: nowIso,
    lastSeenAt: nowIso,
  };
  const saved = saveState(state);
  return saved.devices[deviceId];
}

function recordPushAck(input) {
  const state = loadState();
  const ack = {
    id: String((input && input.id) || `${Date.now()}_${Math.floor(Math.random() * 1000)}`),
    deviceId: input && input.deviceId ? String(input.deviceId).slice(0, 120) : '',
    channel: input && input.channel ? String(input.channel).slice(0, 40) : 'push',
    deliveryId: input && input.deliveryId ? String(input.deliveryId).slice(0, 120) : '',
    acknowledgedAt: new Date().toISOString(),
    status: input && input.status ? String(input.status).slice(0, 40) : 'delivered',
  };
  state.pushAcks.push(ack);
  saveState(state);
  return ack;
}

function listDevices(limit) {
  const take = Math.max(1, Math.min(500, Number(limit) || 100));
  const state = loadState();
  const devices = Object.values(state.devices || {})
    .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
    .slice(0, take);
  return {
    updatedAt: state.updatedAt,
    devices,
    totalDevices: Object.keys(state.devices || {}).length,
  };
}

function getMobileReliabilityMetrics(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const nowMs = Date.now();
  const activeWithinMin = Math.max(5, Math.min(24 * 60, Number(opts.activeWithinMin) || 60));
  const staleAfterMin = Math.max(10, Math.min(7 * 24 * 60, Number(opts.staleAfterMin) || 6 * 60));
  const ackSinceHours = Math.max(1, Math.min(24 * 30, Number(opts.ackSinceHours) || 24));

  const activeCutoffMs = nowMs - activeWithinMin * 60 * 1000;
  const staleCutoffMs = nowMs - staleAfterMin * 60 * 1000;
  const ackCutoffMs = nowMs - ackSinceHours * 60 * 60 * 1000;

  const state = loadState();
  const devices = Object.values(state.devices || {});
  const pushAcks = Array.isArray(state.pushAcks) ? state.pushAcks : [];

  let activeDevices = 0;
  let staleDevices = 0;
  let pushTokenRegistered = 0;
  let pushTokenMissing = 0;
  let cadenceOutliers = 0;
  let constrainedDevices = 0;
  let expensiveNetworkDevices = 0;
  let offlineDevices = 0;
  let lowBatteryDevices = 0;
  let newestSeenMs = 0;
  const staleList = [];

  devices.forEach((d) => {
    const seenMs = Date.parse(String(d && d.lastSeenAt ? d.lastSeenAt : ''));
    const hasToken = !!(d && d.pushToken);
    if (hasToken) pushTokenRegistered += 1;
    if (!hasToken) pushTokenMissing += 1;
    if (d && d.networkConstrained === true) constrainedDevices += 1;
    if (d && d.networkExpensive === true) expensiveNetworkDevices += 1;
    const network = String(d && d.network ? d.network : '').toLowerCase();
    if (network === 'offline' || network === 'none') offlineDevices += 1;
    const battery = Number(d && d.batteryLevel);
    if (Number.isFinite(battery) && battery <= 0.15) lowBatteryDevices += 1;
    if (Number.isFinite(seenMs)) {
      if (seenMs >= activeCutoffMs) activeDevices += 1;
      if (seenMs < staleCutoffMs) {
        staleDevices += 1;
        staleList.push({
          deviceId: String(d && d.deviceId ? d.deviceId : '').slice(0, 120),
          lastSeenAt: d && d.lastSeenAt ? d.lastSeenAt : '',
          platform: d && d.platform ? d.platform : '',
        });
      }
      if (seenMs > newestSeenMs) newestSeenMs = seenMs;
    }
    const effectivePoll = Number(d && d.cadenceEffectivePollSec);
    if (Number.isFinite(effectivePoll) && effectivePoll > 3600) cadenceOutliers += 1;
  });

  const ackByStatus = {};
  let pushAckCount = 0;
  let lastAckAt = '';
  pushAcks.forEach((a) => {
    const ts = Date.parse(String(a && a.acknowledgedAt ? a.acknowledgedAt : ''));
    if (!Number.isFinite(ts) || ts < ackCutoffMs) return;
    pushAckCount += 1;
    const status = String(a && a.status ? a.status : 'unknown');
    ackByStatus[status] = (ackByStatus[status] || 0) + 1;
    if (!lastAckAt || String(a.acknowledgedAt) > lastAckAt) lastAckAt = String(a.acknowledgedAt);
  });

  staleList.sort((a, b) => String(a.lastSeenAt || '').localeCompare(String(b.lastSeenAt || '')));

  return {
    updatedAt: state.updatedAt,
    activeWithinMin,
    staleAfterMin,
    ackSinceHours,
    totalDevices: devices.length,
    activeDevices,
    staleDevices,
    pushTokenRegistered,
    pushTokenMissing,
    cadenceOutliers,
    constrainedDevices,
    expensiveNetworkDevices,
    offlineDevices,
    lowBatteryDevices,
    pushAckCount,
    ackByStatus,
    lastSeenAt: newestSeenMs ? new Date(newestSeenMs).toISOString() : '',
    lastAckAt,
    staleDeviceSamples: staleList.slice(0, 20),
  };
}

module.exports = {
  MOBILE_STATE_FILE,
  loadState,
  upsertDeviceHeartbeat,
  registerPushToken,
  recordPushAck,
  listDevices,
  getMobileReliabilityMetrics,
};
