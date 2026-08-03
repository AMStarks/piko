const { createDispatcher } = require('./proactive/dispatch');
const { evaluatePolicy } = require('./proactive/policyEvaluator');
const { createProactiveStore } = require('./proactive/store');
const path = require('path');
const { detectDeadlineRisk } = require('./proactive/events/deadline');
const { detectCalendarConflicts } = require('./proactive/events/calendarConflicts');
const { detectImportantComms } = require('./proactive/events/importantComms');
const { detectProjectGap } = require('./proactive/events/projectGap');
const { detectSecurityAlerts } = require('./proactive/events/securityAlerts');
const { loadManifest } = require('./knowledgeManifest');
const { getDetector, getDetectorMeta } = require('./proactive/detectorRegistry');
const {
  normalizeCandidate,
  toLifecycleStatus,
  toSuppressionReason,
} = require('./proactive/contracts');

const MAX_EVENTS = 500;
const MAX_HISTORY = 500;
const MAX_DELIVERIES = 1000;
const MAX_DEAD_LETTERS = 1000;

const {
  isAllAsciiDigits,
} = require('./text');

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function resolveDeliveryMode(policy, category, confidence, forceDraft) {
  const catModes = policy && policy.categoryModes && typeof policy.categoryModes === 'object'
    ? policy.categoryModes
    : {};
  const globalMode = String((policy && policy.mode) || 'draft_only');
  const effectiveMode = String(catModes[category] || globalMode);
  const autoThreshold = Number(policy && policy.thresholds && policy.thresholds.auto) || 0.85;
  if (forceDraft) return 'draft';
  if (effectiveMode === 'full_auto' && confidence >= autoThreshold) return 'auto';
  if (effectiveMode === 'hybrid' && confidence >= autoThreshold) return 'auto';
  return 'draft';
}

function createMessageForCandidate(candidate) {
  const category = candidate && (candidate.category || candidate.eventType);
  if (category === 'deadlineRisk') {
    const when = candidate.hoursLabel ? ` ${candidate.hoursLabel}` : ' soon';
    return `Deadline risk: "${candidate.subject}" is due${when}.`;
  }
  if (category === 'calendarConflicts') {
    return `Calendar conflict: ${candidate.subject}.`;
  }
  if (category === 'projectGap') {
    return `Project gap: ${candidate.subject}.`;
  }
  if (category === 'securityAlerts') {
    return `Security alert: ${candidate.subject}.`;
  }
  if (category === 'importantComms') {
    return `Important comms: ${candidate.subject}.`;
  }
  const meta = getDetectorMeta(category);
  if (meta.envelopeLabel) {
    return `Business: ${candidate.subject}.`;
  }
  return candidate.subject || 'Proactive alert triggered.';
}

function shouldCategoryRun(policy, category) {
  return !!(policy && policy.categories && policy.categories[category]);
}

function createProactiveEngine(options) {
  const {
    dataDir,
    loadPolicy,
    loadIntents,
    sendTelegram,
    appendPending,
    sendWebhook,
    log,
  } = options;

  const store = createProactiveStore(dataDir, {
    maxEvents: MAX_EVENTS,
    maxHistory: MAX_HISTORY,
    maxDeliveries: MAX_DELIVERIES,
    maxDeadLetters: MAX_DEAD_LETTERS,
  });
  const dispatcher = createDispatcher({
    sendTelegram,
    appendPending,
    sendWebhook,
  });

  function applyEscalation(runtime, candidate) {
    const key = candidate.dedupeKey;
    const current = Number(runtime.escalation[key] || 0) + 1;
    runtime.escalation[key] = current;
    let urgency = candidate.urgency;
    if (current >= 6 && candidate.urgency !== 'high') urgency = 'high';
    else if (current >= 3 && candidate.urgency === 'low') urgency = 'normal';
    const stage = current >= 6 ? 'critical_repeat' : current >= 3 ? 'repeat' : 'base';
    return { urgency, count: current, stage };
  }

  function channelLadder(mode, urgency, escalationState, baseChannels) {
    if (mode === 'draft') return ['pending_file'];
    const base = new Set(baseChannels && baseChannels.length ? baseChannels : ['telegram', 'pending_file']);
    const out = [];
    if (urgency === 'low') {
      out.push('pending_file');
    } else if (urgency === 'normal') {
      if (base.has('telegram')) out.push('telegram');
      if (base.has('webhook')) out.push('webhook');
      if (base.has('whatsapp_bridge')) out.push('whatsapp_bridge');
      if (base.has('imessage_bridge')) out.push('imessage_bridge');
      out.push('pending_file');
    } else {
      if (base.has('telegram')) out.push('telegram');
      if (base.has('webhook')) out.push('webhook');
      if (base.has('whatsapp_bridge')) out.push('whatsapp_bridge');
      if (base.has('imessage_bridge')) out.push('imessage_bridge');
      out.push('pending_file');
      if (escalationState && escalationState.count >= 6 && base.has('telegram')) out.push('telegram');
    }
    return [...new Set(out)];
  }

  function createDeliveryRecord(params) {
    const rand = Math.floor(Math.random() * 100000);
    return {
      id: `pd_${Date.now()}_${rand}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: params.source,
      category: params.category,
      urgency: params.urgency,
      confidence: params.confidence,
      mode: params.mode,
      dedupeKey: params.dedupeKey,
      channels: params.channels,
      message: params.message,
      status: 'pending',
      attempts: [],
      dispatch: null,
      replayCount: 0,
      ack: null,
      deadLetterId: null,
    };
  }

  function createDeadLetterRecord(delivery, dispatch, source) {
    const rand = Math.floor(Math.random() * 100000);
    const failedAttempt = (dispatch && Array.isArray(dispatch.attempts))
      ? dispatch.attempts.find((a) => a && a.ok === false)
      : null;
    const failure = dispatch && dispatch.failure && typeof dispatch.failure === 'object' ? dispatch.failure : null;
    return {
      id: `dl_${Date.now()}_${rand}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'open',
      source: source || delivery.source || 'unknown',
      deliveryId: delivery.id,
      dedupeKey: delivery.dedupeKey || '',
      category: delivery.category || '',
      urgency: delivery.urgency || '',
      mode: delivery.mode || '',
      message: delivery.message || '',
      replayCount: Number(delivery.replayCount || 0),
      reason: (failedAttempt && failedAttempt.error) || 'dispatch_failed',
      failureCode: (failure && failure.code) || (failedAttempt && failedAttempt.errorCode) || 'DISPATCH_FAILED',
      failureMessage: (failure && failure.message) || (failedAttempt && failedAttempt.error) || 'dispatch_failed',
      failedChannels: failure && Array.isArray(failure.failedChannels) ? failure.failedChannels : [],
      channels: dispatch && Array.isArray(dispatch.channels) ? dispatch.channels : [],
      attempts: dispatch && Array.isArray(dispatch.attempts) ? dispatch.attempts : [],
      firstFailedAt: new Date().toISOString(),
      lastFailedAt: new Date().toISOString(),
      resolvedAt: null,
      lastReplayAt: null,
      lastReplayStatus: null,
    };
  }

  function createLifecycleEvent(baseEvent, decision, extra) {
    return {
      ...baseEvent,
      decision,
      status: toLifecycleStatus(decision),
      suppressionReason: toSuppressionReason(decision),
      ...(extra || {}),
    };
  }

  async function attemptDelivery(delivery, deadLetters, source, dispatchConfig) {
    const dispatch = await dispatcher.dispatchWithRetry({
      channels: delivery.channels,
      message: delivery.message,
      urgency: delivery.urgency,
      channelConfig: dispatchConfig && dispatchConfig.channelConfig ? dispatchConfig.channelConfig : {},
    });
    delivery.updatedAt = new Date().toISOString();
    delivery.dispatch = dispatch.channels;
    delivery.attempts = (delivery.attempts || []).concat(dispatch.attempts || []);
    delivery.retryUsed = !!dispatch.retryUsed;
    delivery.status = dispatch.ok ? (delivery.mode === 'draft' ? 'drafted' : 'sent') : 'failed';
    if (dispatch.ok) {
      delivery.deadLetterId = null;
      return { dispatch, deadLetter: null };
    }
    const deadLetter = createDeadLetterRecord(delivery, dispatch, source);
    if (Array.isArray(deadLetters)) deadLetters.push(deadLetter);
    delivery.deadLetterId = deadLetter.id;
    return { dispatch, deadLetter };
  }

  async function runCycle(context) {
    const now = new Date();
    const source = context && context.source ? String(context.source) : 'unknown';
    const policy = loadPolicy();
    const runtime = store.loadRuntime();
    const events = store.loadEvents();
    const deliveries = store.loadDeliveries();
    const deadLetters = store.loadDeadLetters();
    const summary = {
      source,
      at: now.toISOString(),
      mode: policy.mode,
      candidates: 0,
      drafted: 0,
      sent: 0,
      failed: 0,
      deadLettered: 0,
      retried: 0,
      suppressed: 0,
      skipped: 0,
    };

    if (policy.mode === 'off') {
      runtime.lastRunAt = now.toISOString();
      runtime.lastSummary = summary;
      store.saveRuntime(runtime);
      store.saveDeliveries(deliveries);
      store.saveDeadLetters(deadLetters);
      return summary;
    }

    const rootDir = dataDir ? path.dirname(dataDir) : path.join(__dirname, '..');
    const intents = loadIntents();
    const candidates = [];
    if (shouldCategoryRun(policy, 'deadlineRisk')) candidates.push(...detectDeadlineRisk({ intents, now }));
    if (shouldCategoryRun(policy, 'calendarConflicts')) candidates.push(...detectCalendarConflicts({ dataDir, now }));
    if (shouldCategoryRun(policy, 'projectGap')) candidates.push(...detectProjectGap({ intents, now }));
    if (shouldCategoryRun(policy, 'securityAlerts')) candidates.push(...detectSecurityAlerts({ dataDir, now }));
    if (shouldCategoryRun(policy, 'importantComms')) candidates.push(...detectImportantComms({ dataDir, now }));
    // Manifest-driven detectors (e.g. businessHealth); fallback when no manifest
    const manifest = loadManifest(rootDir);
    const manifestDetectors = (manifest.detectors && manifest.detectors.length > 0)
      ? manifest.detectors
      : [{ id: 'businessHealth', enabled: true }];
    for (const d of manifestDetectors) {
      if (!d.enabled || !shouldCategoryRun(policy, d.id)) continue;
      const fn = getDetector(d.id);
      if (fn) {
        const vals = await fn({ dataDir, now });
        candidates.push(...(Array.isArray(vals) ? vals : []));
      }
    }
    summary.candidates = candidates.length;

    const channels = Array.isArray(policy && policy.dispatch && policy.dispatch.defaultChannels)
      ? policy.dispatch.defaultChannels.map((s) => String(s || '').trim()).filter(Boolean)
      : (process.env.PIKO_PROACTIVE_CHANNELS || 'telegram,pending_file')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    let urgentSentThisRun = 0;

    for (const rawCandidate of candidates) {
      const candidate = normalizeCandidate(rawCandidate);
      const confidence = clamp(Number(candidate.confidence || 0), 0, 1);
      const dedupeKey = String(candidate.dedupeKey || `${candidate.eventType}:${candidate.subject}`).toLowerCase();
      const escalationState = applyEscalation(runtime, candidate);
      const urgency = escalationState.urgency;
      const category = candidate.eventType;

      const detectorMeta = getDetectorMeta(category, rootDir);
      let message;
      if (detectorMeta.synthesis && candidate.anomaly) {
        try {
          const { synthesizeMessage } = require('./proactive/synthesis');
          const synthesized = await synthesizeMessage(candidate.anomaly);
          message = synthesized || createMessageForCandidate({ ...candidate, urgency });
        } catch (_) {
          message = createMessageForCandidate({ ...candidate, urgency });
        }
      } else {
        message = createMessageForCandidate({ ...candidate, urgency });
      }
      const baseEvent = {
        at: now.toISOString(),
        source,
        category,
        confidence,
        urgency,
        escalationStage: escalationState.stage,
        escalationCount: escalationState.count,
        dedupeKey,
        subject: candidate.subject,
        reason: candidate.reason,
      };

      const evaluation = evaluatePolicy({
        candidate: { ...candidate, confidence, urgency, dedupeKey },
        runtime,
        policy,
        now,
        urgentSentThisRun,
      });
      const autoThreshold = Number(policy.thresholds && policy.thresholds.auto) || 0.85;
      if (!evaluation.allowed) {
        const decision = evaluation.decision || 'suppressed_rate_limit';
        if (decision === 'skipped_low_confidence') summary.skipped += 1;
        else summary.suppressed += 1;
        events.push(createLifecycleEvent(baseEvent, decision, { limits: evaluation.limits }));
        continue;
      }

      const deliveryMode = resolveDeliveryMode(policy, category, confidence, evaluation.forceDraft);

      const prefix = deliveryMode === 'draft' ? '[DRAFT proactive]' : '[PROACTIVE]';
      const envelope = detectorMeta.envelopeLabel
        ? `${deliveryMode === 'draft' ? '[DRAFT] ' : ''}⚠️ ${detectorMeta.envelopeLabel} (Today's metrics): ${message}`
        : `${prefix} (${category}, ${Math.round(confidence * 100)}%): ${message}`;
      const channelSet = channelLadder(deliveryMode, urgency, escalationState, channels);
      const delivery = createDeliveryRecord({
        source,
        category,
        urgency,
        confidence,
        mode: deliveryMode,
        dedupeKey,
        channels: channelSet,
        message: envelope,
      });
      const { dispatch, deadLetter } = await attemptDelivery(delivery, deadLetters, source, policy && policy.dispatch);
      deliveries.push(delivery);

      if (dispatch.ok) {
        runtime.keyHistory.push({ key: dedupeKey, category, at: now.getTime() });
        runtime.deliveries.push({ at: now.getTime(), mode: deliveryMode, category, urgency });
        if (urgency === 'high' && deliveryMode !== 'draft') urgentSentThisRun += 1;
        if (detectorMeta.pendingAction && deliveryMode !== 'draft') {
          try {
            const { inferSuggestedAction } = require('./proactive/synthesis');
            const { savePending } = require('./proactivePendingAction');
            const suggested = inferSuggestedAction(candidate.anomalyType);
            if (suggested) savePending(dataDir, suggested, { anomalyType: candidate.anomalyType });
          } catch (_) {}
        }
      }
      if (delivery.retryUsed) summary.retried += 1;
      if (!dispatch.ok) summary.failed += 1;
      if (deadLetter) summary.deadLettered += 1;

      if (deliveryMode === 'draft') summary.drafted += 1;
      if (deliveryMode !== 'draft' && dispatch.ok) summary.sent += 1;

      const decision = deliveryMode === 'draft' ? 'drafted' : (dispatch.ok ? 'sent' : 'delivery_failed');
      events.push(createLifecycleEvent(baseEvent, decision, {
        deliveryId: delivery.id,
        dispatch,
      }));
    }

    runtime.lastRunAt = now.toISOString();
    runtime.lastSummary = summary;
    store.saveRuntime(runtime);
    store.saveEvents(events);
    store.saveDeliveries(deliveries);
    store.saveDeadLetters(deadLetters);

    if (typeof log === 'function') {
      log('info', 'proactive_cycle', {
        source,
        mode: summary.mode,
        candidates: summary.candidates,
        drafted: summary.drafted,
        sent: summary.sent,
        failed: summary.failed,
        deadLettered: summary.deadLettered,
        retried: summary.retried,
        suppressed: summary.suppressed,
        skipped: summary.skipped,
      });
    }

    return summary;
  }

  function getStatus(input) {
    const opts = (input && typeof input === 'object')
      ? input
      : { limit: input };
    const events = store.loadEvents();
    const runtime = store.loadRuntime();
    const take = Math.max(1, Math.min(500, Number(opts.limit) || 100));
    const statusFilter = opts.status ? String(opts.status).trim().toLowerCase() : '';
    const typeFilter = opts.type ? String(opts.type).trim().toLowerCase() : '';
    const sinceRaw = opts.since ? String(opts.since).trim() : '';
    const sinceTs = sinceRaw
      ? (isAllAsciiDigits(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw))
      : NaN;
    const filtered = events.filter((e) => {
      if (!e || typeof e !== 'object') return false;
      if (statusFilter && String(e.status || '').toLowerCase() !== statusFilter) return false;
      if (typeFilter && String(e.category || '').toLowerCase() !== typeFilter) return false;
      if (Number.isFinite(sinceTs)) {
        const atTs = Date.parse(String(e.at || ''));
        if (!Number.isFinite(atTs) || atTs < sinceTs) return false;
      }
      return true;
    });
    return {
      runtime,
      total: filtered.length,
      events: filtered.slice(-take).reverse(),
      summary: runtime.lastSummary || null,
      filters: {
        limit: take,
        status: statusFilter || '',
        type: typeFilter || '',
        since: Number.isFinite(sinceTs) ? new Date(sinceTs).toISOString() : '',
      },
    };
  }

  function getDeliveries(limit, status) {
    const take = Math.max(1, Math.min(500, Number(limit) || 100));
    const deliveries = store.loadDeliveries().slice().reverse();
    const filtered = status
      ? deliveries.filter((d) => String(d.status || '').toLowerCase() === String(status).toLowerCase())
      : deliveries;
    return {
      total: filtered.length,
      deliveries: filtered.slice(0, take),
    };
  }

  function getDeadLetters(limit, status) {
    const take = Math.max(1, Math.min(500, Number(limit) || 100));
    const deadLetters = store.loadDeadLetters().slice().reverse();
    const filtered = status
      ? deadLetters.filter((d) => String(d.status || '').toLowerCase() === String(status).toLowerCase())
      : deadLetters;
    return {
      total: filtered.length,
      deadLetters: filtered.slice(0, take),
    };
  }

  function getReliabilityMetrics(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const sinceHours = Math.max(1, Math.min(24 * 30, Number(opts.sinceHours) || 24));
    const repeatThreshold = Math.max(2, Math.min(100, Number(opts.repeatThreshold) || 3));
    const sinceTs = Date.now() - sinceHours * 60 * 60 * 1000;
    const deliveries = store.loadDeliveries().filter((d) => {
      const ts = Date.parse(String(d && d.createdAt ? d.createdAt : ''));
      return Number.isFinite(ts) && ts >= sinceTs;
    });
    const deadLetters = store.loadDeadLetters().filter((d) => {
      const ts = Date.parse(String(d && d.createdAt ? d.createdAt : ''));
      return Number.isFinite(ts) && ts >= sinceTs;
    });

    const totalDeliveries = deliveries.length;
    const retries = deliveries.filter((d) => !!d.retryUsed).length;
    const acknowledged = deliveries.filter((d) => String(d.status || '') === 'acknowledged').length;
    const successful = deliveries.filter((d) => ['sent', 'drafted', 'acknowledged'].includes(String(d.status || ''))).length;
    const retryRate = totalDeliveries ? retries / totalDeliveries : 0;
    const ackRate = totalDeliveries ? acknowledged / totalDeliveries : 0;
    const deliverySuccessRate = totalDeliveries ? successful / totalDeliveries : 0;
    const deadLetterRate = totalDeliveries ? deadLetters.length / totalDeliveries : 0;

    const byChannel = {};
    for (const d of deliveries) {
      const attempts = Array.isArray(d && d.attempts) ? d.attempts : [];
      for (const a of attempts) {
        const channel = String((a && a.channel) || 'unknown');
        if (!byChannel[channel]) byChannel[channel] = { attempts: 0, successes: 0, failures: 0 };
        byChannel[channel].attempts += 1;
        if (a && a.ok) byChannel[channel].successes += 1;
        else byChannel[channel].failures += 1;
      }
    }
    Object.keys(byChannel).forEach((channel) => {
      const row = byChannel[channel];
      row.successRate = row.attempts ? row.successes / row.attempts : 0;
    });

    const dedupeRollup = {};
    for (const d of deliveries) {
      const key = String(d && d.dedupeKey ? d.dedupeKey : '').trim().toLowerCase();
      if (!key) continue;
      if (!dedupeRollup[key]) {
        dedupeRollup[key] = {
          dedupeKey: key,
          count: 0,
          category: String(d.category || ''),
          firstAt: d.createdAt || '',
          lastAt: d.createdAt || '',
          statuses: {},
        };
      }
      dedupeRollup[key].count += 1;
      if (d.createdAt && (!dedupeRollup[key].firstAt || d.createdAt < dedupeRollup[key].firstAt)) dedupeRollup[key].firstAt = d.createdAt;
      if (d.createdAt && (!dedupeRollup[key].lastAt || d.createdAt > dedupeRollup[key].lastAt)) dedupeRollup[key].lastAt = d.createdAt;
      const status = String(d.status || 'unknown');
      dedupeRollup[key].statuses[status] = (dedupeRollup[key].statuses[status] || 0) + 1;
    }
    const repeatedDedupeAlerts = Object.values(dedupeRollup)
      .filter((row) => row.count >= repeatThreshold)
      .sort((a, b) => b.count - a.count || String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
      .slice(0, 50);

    return {
      sinceHours,
      repeatThreshold,
      since: new Date(sinceTs).toISOString(),
      totalDeliveries,
      totalDeadLetters: deadLetters.length,
      retryRate,
      ackRate,
      deadLetterRate,
      deliverySuccessRate,
      byChannel,
      repeatedDedupeCount: repeatedDedupeAlerts.length,
      repeatedDedupeAlerts,
    };
  }

  function acknowledgeDelivery(deliveryId, details) {
    const id = String(deliveryId || '').trim();
    if (!id) throw new Error('Missing delivery id');
    const deliveries = store.loadDeliveries();
    const idx = deliveries.findIndex((d) => d && d.id === id);
    if (idx === -1) throw new Error('Delivery not found');
    const delivery = deliveries[idx];
    const now = new Date();
    const ack = {
      at: now.toISOString(),
      source: details && details.source ? String(details.source).slice(0, 60) : 'manual',
      channel: details && details.channel ? String(details.channel).slice(0, 40) : 'unknown',
      status: details && details.status ? String(details.status).slice(0, 40) : 'acknowledged',
      ackType: details && details.ackType ? String(details.ackType).slice(0, 40) : 'seen',
      ackId: details && details.ackId ? String(details.ackId).slice(0, 120) : '',
      deviceId: details && details.deviceId ? String(details.deviceId).slice(0, 120) : '',
      userResponse: details && details.userResponse ? String(details.userResponse).slice(0, 240) : '',
      note: details && details.note ? String(details.note).slice(0, 240) : '',
    };
    delivery.ack = ack;
    delivery.updatedAt = now.toISOString();
    delivery.status = 'acknowledged';
    deliveries[idx] = delivery;
    store.saveDeliveries(deliveries);

    const runtime = store.loadRuntime();
    runtime.ackHistory.push({
      key: String(delivery.dedupeKey || '').toLowerCase(),
      category: delivery.category || '',
      at: now.getTime(),
      deliveryId: delivery.id,
      status: ack.status,
      source: ack.source,
      channel: ack.channel,
      ackType: ack.ackType,
      userResponse: ack.userResponse,
    });
    store.saveRuntime(runtime);
    return {
      id,
      status: delivery.status,
      acknowledgedAt: ack.at,
      delivery,
    };
  }

  async function replayDelivery(deliveryId, replaySource) {
    const id = String(deliveryId || '').trim();
    if (!id) throw new Error('Missing delivery id');
    const deliveries = store.loadDeliveries();
    const idx = deliveries.findIndex((d) => d && d.id === id);
    if (idx === -1) throw new Error('Delivery not found');
    const delivery = deliveries[idx];
    if (delivery.status === 'acknowledged') {
      throw new Error('Cannot replay acknowledged delivery');
    }
    if (delivery.status === 'replay_pending') {
      const err = new Error('Replay already in progress');
      err.code = 'REPLAY_IN_PROGRESS';
      throw err;
    }
    const policy = loadPolicy();
    const replayCooldownSec = Math.max(0, Number(policy && policy.dispatch && policy.dispatch.replayCooldownSec) || 15);
    const nowMs = Date.now();
    const lastReplayTs = Date.parse(String(delivery.lastReplayAt || ''));
    if (replayCooldownSec > 0 && Number.isFinite(lastReplayTs) && (nowMs - lastReplayTs) < replayCooldownSec * 1000) {
      const waitMs = replayCooldownSec * 1000 - (nowMs - lastReplayTs);
      const err = new Error(`Replay cooldown active. Retry in ${Math.ceil(waitMs / 1000)}s`);
      err.code = 'REPLAY_COOLDOWN';
      err.retryAfterMs = waitMs;
      throw err;
    }
    const deadLetters = store.loadDeadLetters();
    delivery.updatedAt = new Date().toISOString();
    delivery.replayCount = Number(delivery.replayCount || 0) + 1;
    delivery.lastReplaySource = replaySource || 'manual';
    delivery.lastReplayAt = new Date().toISOString();
    delivery.status = 'replay_pending';
    deliveries[idx] = delivery;
    store.saveDeliveries(deliveries);
    const { dispatch } = await attemptDelivery(delivery, deadLetters, replaySource || 'manual_replay', policy && policy.dispatch);
    deliveries[idx] = delivery;
    store.saveDeliveries(deliveries);
    store.saveDeadLetters(deadLetters);
    return {
      id,
      status: delivery.status,
      replayCount: delivery.replayCount,
      dispatch,
      delivery,
    };
  }

  async function replayDeadLetter(deadLetterId, replaySource) {
    const id = String(deadLetterId || '').trim();
    if (!id) throw new Error('Missing dead-letter id');
    const deadLetters = store.loadDeadLetters();
    const idx = deadLetters.findIndex((d) => d && d.id === id);
    if (idx === -1) throw new Error('Dead-letter not found');
    const deadLetter = deadLetters[idx];
    const replay = await replayDelivery(deadLetter.deliveryId, replaySource || 'dead_letter_replay');
    deadLetter.updatedAt = new Date().toISOString();
    deadLetter.lastReplayAt = new Date().toISOString();
    deadLetter.replayCount = Number(deadLetter.replayCount || 0) + 1;
    deadLetter.lastReplayStatus = replay.status;
    if (replay.dispatch && replay.dispatch.ok) {
      deadLetter.status = 'resolved';
      deadLetter.resolvedAt = new Date().toISOString();
      deadLetter.failureCode = '';
      deadLetter.failureMessage = '';
      deadLetter.failedChannels = [];
    } else {
      deadLetter.status = 'retry_failed';
      deadLetter.lastFailedAt = new Date().toISOString();
      const failure = replay && replay.dispatch && replay.dispatch.failure ? replay.dispatch.failure : null;
      if (failure) {
        deadLetter.failureCode = failure.code || deadLetter.failureCode || 'DISPATCH_FAILED';
        deadLetter.failureMessage = failure.message || deadLetter.failureMessage || deadLetter.reason;
        deadLetter.failedChannels = Array.isArray(failure.failedChannels) ? failure.failedChannels : deadLetter.failedChannels;
      }
    }
    deadLetters[idx] = deadLetter;
    store.saveDeadLetters(deadLetters);
    return {
      id,
      deadLetter,
      replay,
    };
  }

  async function dispatchTest(input) {
    const payload = input && typeof input === 'object' ? input : {};
    const policy = loadPolicy();
    const channels = Array.isArray(payload.channels)
      ? payload.channels.map((c) => String(c || '').trim()).filter(Boolean)
      : [];
    const policyChannels = Array.isArray(policy && policy.dispatch && policy.dispatch.defaultChannels)
      ? policy.dispatch.defaultChannels.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const envChannels = (process.env.PIKO_PROACTIVE_CHANNELS || 'telegram,pending_file')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const selected = channels.length ? channels : (policyChannels.length ? policyChannels : envChannels);
    const urgency = payload.urgency ? String(payload.urgency) : 'normal';
    const message = String(payload.message || 'Proactive dispatch test from control API.').slice(0, 2000);
    const dispatch = await dispatcher.dispatchWithRetry({
      channels: selected,
      message,
      urgency,
      channelConfig: policy && policy.dispatch && policy.dispatch.channelConfig ? policy.dispatch.channelConfig : {},
    });
    return {
      ok: !!dispatch.ok,
      channels: selected,
      urgency,
      message,
      dispatch,
      at: new Date().toISOString(),
    };
  }

  return {
    runCycle,
    getStatus,
    getDeliveries,
    getDeadLetters,
    getReliabilityMetrics,
    acknowledgeDelivery,
    replayDelivery,
    replayDeadLetter,
    dispatchTest,
  };
}

module.exports = {
  createProactiveEngine,
  resolveDeliveryMode,
};
