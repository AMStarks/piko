/**
 * Proactive webhook fanout helpers (P6.4 extract from server.js).
 */
const fs = require('fs');
const path = require('path');
const url = require('url');
const http = require('http');
const https = require('https');

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function createProactiveWebhookHelpers(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const pendingFile = opts.pendingNotificationsFile || path.join(dataDir, 'pending-notifications.txt');
  const webhookUrl = String(opts.webhookUrl != null ? opts.webhookUrl : (process.env.PIKO_PROACTIVE_WEBHOOK_URL || '')).trim();
  const whatsappUrl = String(opts.whatsappUrl != null ? opts.whatsappUrl : (process.env.PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL || '')).trim();
  const imessageUrl = String(opts.imessageUrl != null ? opts.imessageUrl : (process.env.PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL || '')).trim();
  const bearer = String(opts.bearer != null ? opts.bearer : (process.env.PIKO_PROACTIVE_WEBHOOK_BEARER || '')).trim();

  function appendPendingNotification(line) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(pendingFile, String(line || '').slice(0, 2000) + '\n', 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  function resolveProactiveWebhookUrl(meta) {
    const rawTarget = String((meta && meta.target) || '').trim();
    const target = rawTarget.toLowerCase();
    if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) return rawTarget;
    if (target === 'whatsapp_bridge' && whatsappUrl) return whatsappUrl;
    if (target === 'imessage_bridge' && imessageUrl) return imessageUrl;
    return webhookUrl;
  }

  async function sendProactiveWebhook(message, meta) {
    const target = String((meta && meta.target) || '').toLowerCase();
    const endpoint = resolveProactiveWebhookUrl(meta);
    if (target === 'whatsapp_bridge' && !whatsappUrl && !webhookUrl) {
      throw new Error('Missing PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL (or global webhook fallback)');
    }
    if (target === 'imessage_bridge' && !imessageUrl && !webhookUrl) {
      throw new Error('Missing PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL (or global webhook fallback)');
    }
    if (!endpoint) throw new Error('No proactive webhook endpoint configured');
    let parsed;
    try {
      parsed = new url.URL(endpoint);
    } catch (_) {
      throw new Error('Invalid proactive webhook URL');
    }
    const body = JSON.stringify({
      source: 'piko_proactive',
      at: new Date().toISOString(),
      channel: meta && meta.channel ? String(meta.channel).slice(0, 60) : 'webhook',
      target: meta && meta.target ? String(meta.target).slice(0, 60) : 'webhook',
      urgency: meta && meta.urgency ? String(meta.urgency).slice(0, 20) : 'normal',
      message: String(message || '').slice(0, 2000),
    });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'piko-proactive/1.0',
    };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'POST',
      headers,
    };
    const requester = parsed.protocol === 'http:' ? httpRequest : httpsRequest;
    const { statusCode, data } = await requester(reqOpts, body);
    if (statusCode < 200 || statusCode >= 300) {
      const payload = String(data || '').slice(0, 200);
      throw new Error(`Webhook dispatch failed (${statusCode}): ${payload}`);
    }
    return { ok: true };
  }

  return {
    appendPendingNotification,
    resolveProactiveWebhookUrl,
    sendProactiveWebhook,
  };
}

module.exports = {
  createProactiveWebhookHelpers,
};
