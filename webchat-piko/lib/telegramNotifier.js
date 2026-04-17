/**
 * Telegram notifier — sends messages to admin via Bot API.
 * Requires: TELEGRAM_TOKEN, PIKO_ADMIN_CHAT_ID (or TELEGRAM_ADMIN_CHAT_ID)
 */
const https = require('https');

/**
 * @param {string} text
 * @param {{ parseMode?: 'Markdown' | 'HTML' | 'none' | false }} [opts] - use 'none' or false for plain text (avoids Markdown breaking on SKUs with _)
 */
function sendToAdmin(text, opts = {}) {
  const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.PIKO_ADMIN_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegramNotifier] TELEGRAM_TOKEN and PIKO_ADMIN_CHAT_ID required. Skipping send.');
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

module.exports = { sendToAdmin };
