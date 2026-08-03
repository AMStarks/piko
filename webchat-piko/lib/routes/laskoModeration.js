const crypto = require('crypto');
const {
  moderateContent,
  verifyModerationSecret,
  isModerationEnabled,
} = require('../laskoModeration');

async function handleLaskoModerationRoute(req, res, pathname, deps = {}) {
  if (req.method !== 'POST' || pathname !== '/moderate') return false;
  const send = deps.send || ((r, c, b) => {
    r.writeHead(c, { 'Content-Type': 'application/json' });
    r.end(b);
  });

  if (!isModerationEnabled()) {
    return send(res, 503, JSON.stringify({
      error: 'Moderation disabled',
      message: 'Set MODERATION_SHARED_SECRET and PIKO_LASKO_MODERATION_ENABLED on Rodimus',
    }));
  }

  const auth = verifyModerationSecret(req);
  if (!auth.ok) {
    return send(res, 401, JSON.stringify({ error: 'Unauthorized', message: auth.error }));
  }

  let body = {};
  try {
    body = JSON.parse((await deps.readBody(req)) || '{}');
  } catch (_) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
  }

  const content = body.content;
  if (typeof content !== 'string' || !content.trim()) {
    return send(res, 400, JSON.stringify({ error: 'Invalid content' }));
  }

  try {
    const decision = await moderateContent(content, {
      postType: body.postType,
      contentHash: body.contentHash,
      phase: body.phase,
      actorAddress: body.actorAddress,
      parentSequentialCode: body.parentSequentialCode,
    });

    const receipt = {
      id: crypto.randomUUID(),
      contentHash: decision.contentHash,
      charterVersion: decision.charterVersion,
      modelId: decision.modelId,
      decision: decision.action,
      categories: decision.categories,
      latencyMs: decision.latencyMs,
      phase: body.phase || 'moderate',
      actorAddress: body.actorAddress || null,
      timestamp: new Date().toISOString(),
      source: 'piko-webchat-rodimus',
    };

    if (typeof deps.log === 'function') {
      deps.log('info', 'lasko_moderation', {
        action: decision.action,
        model: decision.modelId,
        latencyMs: decision.latencyMs,
        phase: body.phase,
      }, req.requestId);
    }

    return send(res, 200, JSON.stringify({ success: true, data: decision, receipt }));
  } catch (e) {
    if (typeof deps.log === 'function') {
      deps.log('error', 'lasko_moderation_failed', { message: e.message }, req.requestId);
    }
    return send(res, 503, JSON.stringify({
      error: 'Moderation failed',
      message: 'Review service unavailable. Try again.',
    }));
  }
}

module.exports = { handleLaskoModerationRoute };
