/**
 * Telegram notifier — sends messages to admin via Bot API.
 * Requires: TELEGRAM_TOKEN, PIKO_ADMIN_CHAT_ID (or TELEGRAM_ADMIN_CHAT_ID)
 */
const https = require('https');

/**
 * Low-level Telegram send (no dashboard feed).
 * @param {string} text
 * @param {{ parseMode?: 'Markdown' | 'HTML' | 'none' | false, category?: string, title?: string, severity?: string, source?: string, skipFeed?: boolean }} [opts]
 */
function sendTelegramMessage(text, opts = {}) {
  const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    opts.chatId ||
    process.env.PIKO_ADMIN_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegramNotifier] TELEGRAM_TOKEN and chat id required. Skipping send.');
    return Promise.resolve(false);
  }

  const useParseMode = opts.parseMode !== 'none' && opts.parseMode !== false;
  const parseMode = useParseMode ? (opts.parseMode === 'HTML' ? 'HTML' : 'Markdown') : null;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });

    const reqOpts = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      family: 4,
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[telegramNotifier] Sent to admin.');
          resolve(true);
        } else {
          console.error('[telegramNotifier] Send failed:', res.statusCode, data.slice(0, 200));
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[telegramNotifier] Request error:', e.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Send to admin Telegram and log to the unified notification feed.
 * @param {string} text
 * @param {Object} [opts]
 */
function sendToAdmin(text, opts = {}) {
  const { notifyAdmin } = require('./notifyAdmin');
  return notifyAdmin(text, {
    category: opts.category || 'system',
    title: opts.title,
    severity: opts.severity || 'info',
    source: opts.source || 'telegramNotifier',
    meta: opts.meta,
    skipFeed: opts.skipFeed === true,
    skipTelegram: false,
    parseMode: opts.parseMode,
    telegram: opts.telegram,
  }).then((r) => r.telegram === 'sent');
}

/** Send to a specific Telegram chat (e.g. async local-answer follow-up). */
function sendTelegramToChat(chatId, text, opts = {}) {
  return sendTelegramMessage(text, { ...opts, chatId: String(chatId) });
}

module.exports = { sendToAdmin, sendTelegramMessage, sendTelegramToChat };
