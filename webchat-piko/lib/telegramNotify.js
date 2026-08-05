/**
 * Thin Telegram/admin notify helper (P6.4 extract from server.js).
 */
function telegramNotify(text, meta = {}) {
  const opts = meta && typeof meta === 'object' ? meta : {};
  const { notifyAdmin } = require('./notifyAdmin');
  return notifyAdmin(String(text).slice(0, 4096), {
    category: opts.category || 'system',
    title: opts.title,
    severity: opts.severity || 'info',
    source: opts.source || 'telegramNotify',
    meta: opts.meta,
    parseMode: opts.parseMode,
  }).then((r) => ({ statusCode: r.telegram === 'sent' ? 200 : 500, ...r }));
}

module.exports = { telegramNotify };
