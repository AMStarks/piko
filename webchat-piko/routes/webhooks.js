/**
 * Webhook routes (P3.1b — first extraction from server.js).
 * Auth fail-closed when secret unset (P0.2).
 */
const { toLowerAsciiish } = require('../lib/text');

function checkWebhookAuth(req, secret) {
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const key = (req.headers['x-webhook-key'] || '').trim();
  return bearer === secret || key === secret;
}

/**
 * Register webhook routes on a routeRegistry (optional — used as extractions grow).
 */
function registerWebhookRoutes(registry, ctx) {
  const handler = (req, res, routeCtx) => tryHandleWebhooks(req, res, { ...ctx, ...routeCtx });
  registry.add('POST', '/api/webhooks/events', handler, { group: 'webhooks', auth: 'webhook' });
  registry.add('POST', '/api/webhooks/ausmaker', handler, { group: 'webhooks', auth: 'webhook' });
  registry.add('POST', '/webhook/cin7', handler, { group: 'webhooks', auth: 'webhook' });
  registry.add('POST', '/webhook/inventory-alert', handler, { group: 'webhooks', auth: 'webhook' });
  registry.add('POST', '/api/webhook/alert', handler, { group: 'webhooks', auth: 'webhook' });
  registry.add('POST', '/webhook/alert', handler, { group: 'webhooks', auth: 'webhook' });
}

/**
 * @returns {boolean|Promise<boolean>} true if this request was a webhook path (response sent).
 */
function tryHandleWebhooks(req, res, ctx = {}) {
  const method = req.method;
  const pathname = ctx.pathname || '';
  const send = ctx.send;
  const readBody = ctx.readBody;
  const secret = ctx.webhookSecret;
  const telegramNotify = ctx.telegramNotify;
  const processWebhookEvent = ctx.processWebhookEvent;
  const postJsonToUrl = ctx.postJsonToUrl;
  const appendPendingNotification = ctx.appendPendingNotification;
  const legionBase = ctx.legionBase;
  const bearer = ctx.legionBearer;
  const log = ctx.log || (() => {});

  if (method !== 'POST') return false;

  // —— Webhook events (external systems POST here) ——
  if (pathname === '/api/webhooks/events' || pathname === '/api/webhooks/ausmaker') {
    if (!checkWebhookAuth(req, secret)) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
      return true;
    }
    readBody(req)
      .then(async (body) => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          const event = {
            source: pathname === '/api/webhooks/ausmaker' ? 'ausmaker' : (parsed.source || 'unknown'),
            eventType: String(parsed.eventType || parsed.event_type || '').trim() || 'unknown',
            payload: parsed.payload || parsed,
            timestamp: parsed.timestamp || new Date().toISOString(),
          };
          const result = await processWebhookEvent(event, {
            postJsonToUrl,
            sendTelegram: telegramNotify,
            appendPending: appendPendingNotification,
            legionBase,
            bearer,
          });
          const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          return send(res, 202, JSON.stringify({ id, status: 'processed', rulesMatched: result.rulesMatched }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid webhook payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' })));
    return true;
  }

  // —— /webhook/cin7: Cin7 Core webhooks (stock alerts, sale status, etc.) ——
  if (pathname === '/webhook/cin7') {
    if (!checkWebhookAuth(req, secret)) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
      return true;
    }
    readBody(req)
      .then(async (body) => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const eventType = (
            payload.eventType || payload.EventType || payload.type || payload.Type || 'Cin7'
          ).toString();
          const sku = (
            payload.sku || payload.SKU || payload.productSku || payload.ProductSKU || ''
          ).toString().trim();
          const status = (
            payload.status || payload.Status || payload.orderStatus || payload.OrderStatus
            || payload.new_status || ''
          ).toString().trim();
          const message = (
            payload.message || payload.Message || payload.alert || payload.summary || ''
          ).toString().trim();
          const lines = ['📦 **Cin7 webhook**', `Event: ${eventType}`];
          if (sku) lines.push(`SKU: ${sku}`);
          if (status) lines.push(`Status: ${status}`);
          if (message) lines.push(message);
          const detail = payload.data || payload.Data || payload.payload;
          if (detail && typeof detail === 'object') {
            lines.push('```');
            lines.push(JSON.stringify(detail, null, 2).slice(0, 1200));
            lines.push('```');
          } else if (detail) {
            lines.push(String(detail).slice(0, 800));
          }
          const text = lines.join('\n').slice(0, 3900);
          const { sendToAdmin } = require('../lib/telegramNotifier');
          try {
            await sendToAdmin(text);
          } catch (e) {
            console.warn('[WEBHOOK] cin7 sendToAdmin failed, falling back:', e.message);
            await telegramNotify(text);
          }
          return send(res, 200, JSON.stringify({ ok: true, notified: true }));
        } catch (e) {
          console.error('[WEBHOOK] cin7 failed:', e.message);
          return send(res, 400, JSON.stringify({ ok: false, error: e.message || 'Invalid payload' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook failed' })));
    return true;
  }

  // —— /webhook/inventory-alert: AusMaker real-time inventory alerts ——
  if (pathname === '/webhook/inventory-alert') {
    if (!checkWebhookAuth(req, secret)) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
      return true;
    }
    readBody(req)
      .then(async (body) => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const { sku, name, old_status, new_status, soh, forecast, active_method } = payload;
          if (new_status === 'Reorder' || new_status === 'Review') {
            const { sendToAdmin } = require('../lib/telegramNotifier');
            const { enqueueInventoryAlert } = require('../lib/inventoryAlertBatcher');
            await enqueueInventoryAlert(
              { sku, name, old_status, new_status, soh, forecast, active_method },
              sendToAdmin,
            );
          }
          return send(res, 200, 'OK');
        } catch (e) {
          console.error('[WEBHOOK] inventory-alert failed:', e.message);
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ error: e.message || 'Webhook failed' })));
    return true;
  }

  // —— /api/webhook/alert + /webhook/alert: LLM-evaluated push alerts ——
  if (pathname === '/api/webhook/alert' || pathname === '/webhook/alert') {
    if (!checkWebhookAuth(req, secret)) {
      send(res, 401, JSON.stringify({ ok: false, error: 'Webhook auth required' }));
      return true;
    }
    readBody(req)
      .then(async (body) => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const alertSource = payload.source || 'External System';
          const alertMessage = payload.message || (payload.data ? JSON.stringify(payload.data) : JSON.stringify(payload));
          if (process.env.PIKO_LOG_PLANNER === '1') {
            console.log('[WEBHOOK] Received external alert:', alertSource, alertMessage.slice(0, 200));
          }
          const { ollamaNativeChat } = require('../lib/llm');
          const model = process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';
          const prompt = `You are Piko. An urgent webhook alert just arrived from ${alertSource}.
Alert details: ${String(alertMessage).slice(0, 1500)}
Draft a concise, urgent Telegram message to the user notifying them of this event. If it is trivial or noise, return exactly "IGNORE". Otherwise return only the message text.`;
          const pikoResponse = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
            max_tokens: 150,
            temperature: 0.3,
          });
          const trimmed = (pikoResponse && typeof pikoResponse === 'string' ? pikoResponse : String(pikoResponse || '')).trim();
          if (trimmed && toLowerAsciiish(trimmed) !== 'ignore') {
            await telegramNotify(`🚨 **Automated Alert**\n${trimmed}`);
          }
          return send(res, 200, JSON.stringify({ success: true, processed: true }));
        } catch (e) {
          log('error', 'webhook_alert', { message: e.message });
          return send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' }));
        }
      })
      .catch((e) => send(res, 500, JSON.stringify({ ok: false, error: e.message || 'Webhook processing failed' })));
    return true;
  }

  return false;
}

module.exports = {
  checkWebhookAuth,
  tryHandleWebhooks,
  registerWebhookRoutes,
};
