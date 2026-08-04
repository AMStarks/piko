/**
 * Mobile sync / push / preferences routes (P3.1b).
 */
function registerMobileRoutes(registry, ctx) {
  const wrap = (fn) => async (req, res, routeCtx) => {
    const handled = await fn(req, res, { ...ctx, ...routeCtx });
    return handled !== false;
  };
  registry.add('GET', '/api/mobile/discovery', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('GET', '/api/mobile/summary', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('POST', '/api/mobile/device-heartbeat', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('POST', '/api/mobile/push-token', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('POST', '/api/mobile/push-ack', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('GET', '/api/mobile/live-activity', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('GET', '/api/mobile/proactive-policy', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('POST', '/api/mobile/proactive-policy', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('GET', '/api/mobile/preferences', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
  registry.add('PUT', '/api/mobile/preferences', wrap(tryHandleMobile), { group: 'mobile', auth: 'api_auth' });
}

function isMobilePath(pathname) {
  return pathname.startsWith('/api/mobile/');
}

async function tryHandleMobile(req, res, ctx = {}) {
  const pathname = ctx.pathname || '';
  if (!isMobilePath(pathname)) return false;

  const {
    send,
    readBody,
    parseUrl,
    healthApiKey,
    port,
    ollamaModel,
    getMobileLanBaseURL,
    getMobilePublicBaseURL,
    buildIntentSnapshot,
    loadState,
    getCachedOllamaHealth,
    decideMobilePoll,
    proactiveEngine,
    getMobileReliabilityMetrics,
    upsertDeviceHeartbeat,
    registerPushToken,
    recordPushAck,
    toLiveActivityPayload,
    loadProactivePolicy,
    saveProactivePolicy,
    makeWeakEtag,
    parseIfMatchVersion,
    buildMobilePolicyPatch,
    loadMobilePreferences,
    saveMobilePreferences,
  } = ctx;

  if (req.method === 'GET' && pathname === '/api/mobile/discovery') {
    const lan = getMobileLanBaseURL();
    const pub = getMobilePublicBaseURL();
    send(res, 200, JSON.stringify({
      ok: true,
      lanBaseURL: lan,
      publicBaseURL: pub,
      legacyLAN: ['http://192.168.0.121:3000'],
      port,
    }));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/summary') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (healthApiKey && key !== healthApiKey) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return true;
    }
    const now = new Date();
    const intent = buildIntentSnapshot(now);
    const deviceId = query && query.deviceId ? String(query.deviceId).slice(0, 120) : '';
    const state = loadState();
    const device = (deviceId && state && state.devices && state.devices[deviceId]) ? state.devices[deviceId] : null;
    const ollamaHealth = await getCachedOllamaHealth();
    const cadence = decideMobilePoll({
      intentSnapshot: intent,
      device,
      serviceHealth: { modelReachable: ollamaHealth.ok },
    });
    const proactive = proactiveEngine.getStatus(5);
    const summary = proactive && proactive.summary ? proactive.summary : null;
    const mobileReliability = getMobileReliabilityMetrics({ activeWithinMin: 60, staleAfterMin: 6 * 60, ackSinceHours: 24 });
    send(res, 200, JSON.stringify({
      ok: true,
      now: now.toISOString(),
      model: ollamaModel,
      pollAfterSec: cadence.pollAfterSec,
      cadence: {
        urgency: cadence.urgency,
        reason: cadence.cadenceReason,
        degraded: cadence.degraded,
        degradedReasons: cadence.degradedReasons,
      },
      service: {
        modelReachable: ollamaHealth.ok,
        modelCheckedAt: ollamaHealth.checkedAt,
      },
      device: device ? {
        id: device.deviceId || deviceId,
        appState: device.appState || '',
        network: device.network || '',
        networkConstrained: device.networkConstrained === true,
        networkExpensive: device.networkExpensive === true,
        batteryLevel: Number.isFinite(Number(device.batteryLevel)) ? Number(device.batteryLevel) : null,
        cadenceEffectivePollSec: Number.isFinite(Number(device.cadenceEffectivePollSec)) ? Number(device.cadenceEffectivePollSec) : null,
      } : null,
      intent,
      proactive: summary ? {
        mode: summary.mode,
        at: summary.at,
        drafted: summary.drafted || 0,
        sent: summary.sent || 0,
        failed: summary.failed || 0,
      } : null,
      reliability: {
        activeDevices: mobileReliability.activeDevices || 0,
        staleDevices: mobileReliability.staleDevices || 0,
        pushTokenRegistered: mobileReliability.pushTokenRegistered || 0,
        pushTokenMissing: mobileReliability.pushTokenMissing || 0,
      },
    }));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/device-heartbeat') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (healthApiKey && key !== healthApiKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const device = upsertDeviceHeartbeat(parsed || {});
          return send(res, 200, JSON.stringify({ ok: true, device }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid heartbeat payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save heartbeat' })));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/push-token') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (healthApiKey && key !== healthApiKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const device = registerPushToken(parsed || {});
          return send(res, 200, JSON.stringify({ ok: true, device }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid push-token payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save push token' })));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/push-ack') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (healthApiKey && key !== healthApiKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const ack = recordPushAck(parsed || {});
          let deliveryAck = null;
          const deliveryId = parsed && parsed.deliveryId ? String(parsed.deliveryId) : '';
          if (deliveryId) {
            deliveryAck = proactiveEngine.acknowledgeDelivery(deliveryId, {
              source: 'mobile_push_ack',
              channel: parsed && parsed.channel ? parsed.channel : 'push',
              status: parsed && parsed.status ? parsed.status : 'delivered',
              ackId: ack.id,
              deviceId: parsed && parsed.deviceId ? parsed.deviceId : '',
              note: parsed && parsed.note ? parsed.note : '',
            });
          }
          return send(res, 200, JSON.stringify({ ok: true, ack, deliveryAck }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid ack payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save ack' })));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/live-activity') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (healthApiKey && key !== healthApiKey) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return true;
    }
    const now = new Date();
    const intent = buildIntentSnapshot(now);
    const ollamaHealth = await getCachedOllamaHealth();
    const cadence = decideMobilePoll({
      intentSnapshot: intent,
      serviceHealth: { modelReachable: ollamaHealth.ok },
    });
    const statusText = intent.nextReminder
      ? `Next reminder: ${intent.nextReminder.text}`
      : intent.queueLength > 0
        ? `${intent.queueLength} tasks queued`
        : 'All clear';
    send(res, 200, JSON.stringify(toLiveActivityPayload({
      status: statusText.slice(0, 180),
      queueLength: intent.queueLength,
      remindersCount: intent.remindersCount,
      nextReminderAt: intent.nextReminder ? intent.nextReminder.at : null,
      refreshAfterSec: cadence.pollAfterSec,
      cadence: {
        urgency: cadence.urgency,
        reason: cadence.cadenceReason,
        degraded: cadence.degraded,
      },
      service: {
        modelReachable: ollamaHealth.ok,
        modelCheckedAt: ollamaHealth.checkedAt,
      },
    }, {
      generatedAt: now.toISOString(),
      refreshAfterSec: cadence.pollAfterSec,
    })));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/proactive-policy') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (healthApiKey && key !== healthApiKey) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return true;
    }
    try {
      const policy = loadProactivePolicy();
      const version = String(policy && policy.updatedAt ? policy.updatedAt : '');
      const etag = makeWeakEtag(version);
      res.setHeader('ETag', etag);
      send(res, 200, JSON.stringify({ ok: true, policy, version, etag }));
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to load mobile policy' }));
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/proactive-policy') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (healthApiKey && key !== healthApiKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const expectedUpdatedAt = (parsed && parsed.expectedUpdatedAt)
            ? String(parsed.expectedUpdatedAt)
            : parseIfMatchVersion(req.headers['if-match']);
          const current = loadProactivePolicy();
          const merged = buildMobilePolicyPatch(current, parsed && parsed.patch ? parsed.patch : {});
          const next = saveProactivePolicy(merged, { expectedUpdatedAt });
          const version = String(next && next.updatedAt ? next.updatedAt : '');
          const etag = makeWeakEtag(version);
          res.setHeader('ETag', etag);
          return send(res, 200, JSON.stringify({ ok: true, policy: next, version, etag }));
        } catch (e) {
          if (e && e.code === 'POLICY_CONFLICT') {
            const current = e.current || loadProactivePolicy();
            const version = String(current && current.updatedAt ? current.updatedAt : '');
            const etag = makeWeakEtag(version);
            res.setHeader('ETag', etag);
            return send(res, 409, JSON.stringify({
              ok: false,
              code: e.code,
              error: 'Policy version conflict',
              current,
              version,
              etag,
            }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid mobile policy patch' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to update mobile policy' })));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/preferences') {
    const { query } = parseUrl(req.url);
    const key = query && query.key ? String(query.key) : '';
    if (healthApiKey && key !== healthApiKey) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return true;
    }
    const prefs = loadMobilePreferences();
    const version = String(prefs && prefs.updatedAt ? prefs.updatedAt : '');
    const etag = makeWeakEtag(version);
    res.setHeader('ETag', etag);
    send(res, 200, JSON.stringify({ ok: true, preferences: prefs, version, etag }));
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/mobile/preferences') {
    readBody(req)
      .then((body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const key = parsed && parsed.key ? String(parsed.key) : '';
          if (healthApiKey && key !== healthApiKey) {
            return send(res, 401, JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
          const expectedUpdatedAt = (parsed && parsed.expectedUpdatedAt)
            ? String(parsed.expectedUpdatedAt)
            : parseIfMatchVersion(req.headers['if-match']);
          const next = saveMobilePreferences(parsed && parsed.preferences ? parsed.preferences : parsed, expectedUpdatedAt);
          const version = String(next && next.updatedAt ? next.updatedAt : '');
          const etag = makeWeakEtag(version);
          res.setHeader('ETag', etag);
          return send(res, 200, JSON.stringify({ ok: true, preferences: next, version, etag }));
        } catch (e) {
          if (e && e.code === 'PREFERENCES_CONFLICT') {
            const current = e.current || loadMobilePreferences();
            const version = String(current && current.updatedAt ? current.updatedAt : '');
            const etag = makeWeakEtag(version);
            res.setHeader('ETag', etag);
            return send(res, 409, JSON.stringify({
              ok: false,
              code: e.code,
              error: 'Preferences version conflict',
              current,
              version,
              etag,
            }));
          }
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid mobile preferences payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Failed to save mobile preferences' })));
    return true;
  }

  return false;
}

module.exports = {
  tryHandleMobile,
  registerMobileRoutes,
  isMobilePath,
};
