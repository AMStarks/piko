/**
 * Auth helpers for Piko: bot configuration and task eligibility.
 * Used to decide if the bot can run (token) and if /task is allowed (Cursor API key).
 */

/**
 * True if the bot has a non-placeholder Telegram token configured.
 * @returns {boolean}
 */
function isBotConfigured() {
  const token =
    process.env.TELEGRAM_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    '';
  const t = String(token).trim();
  return t.length > 0 && t !== 'YOUR_BOT_TOKEN';
}

/**
 * True if Cursor Agent /task is allowed (API key set).
 * @returns {boolean}
 */
function isTaskAllowed() {
  const key =
    process.env.CURSOR_API_KEY ||
    process.env.CURSOR_API_KEY_BOT ||
    '';
  return String(key).trim().length > 0;
}

module.exports = {
  isBotConfigured,
  isTaskAllowed,
};
