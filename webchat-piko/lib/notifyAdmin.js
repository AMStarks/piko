/**
 * Unified admin notification — log to dashboard feed and send Telegram when configured.
 */
const { sendTelegramMessage } = require('./telegramNotifier');
const { recordNotification } = require('./notificationFeed');

/**
 * @param {string} text
 * @param {Object} [opts]
 * @param {string} [opts.category]
 * @param {string} [opts.title]
 * @param {'info'|'warn'|'error'} [opts.severity]
 * @param {string} [opts.source]
 * @param {Object} [opts.meta]
 * @param {boolean} [opts.skipTelegram]
 * @param {boolean} [opts.skipFeed]
 * @param {Object} [opts.telegram]
 * @param {string|false} [opts.parseMode]
 */
async function notifyAdmin(text, opts = {}) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, telegram: 'skipped', feed: 'skipped' };

  let telegramStatus = 'skipped';
  if (!opts.skipTelegram) {
    const telegramOpts = opts.telegram || {};
    if (opts.parseMode !== undefined) telegramOpts.parseMode = opts.parseMode;
    const sent = await sendTelegramMessage(body, telegramOpts);
    telegramStatus = sent ? 'sent' : 'failed';
  }

  let entry = null;
  if (!opts.skipFeed) {
    entry = recordNotification({
      text: body,
      category: opts.category || 'system',
      title: opts.title,
      severity: opts.severity || 'info',
      source: opts.source,
      meta: opts.meta,
      channels: { telegram: telegramStatus },
    });
  }

  return {
    ok: telegramStatus === 'sent' || telegramStatus === 'skipped',
    telegram: telegramStatus,
    feed: entry ? 'logged' : 'skipped',
    id: entry && entry.id,
  };
}

module.exports = { notifyAdmin };
