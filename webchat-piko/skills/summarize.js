/**
 * Skill: /summarize <url> — fetch, strip HTML, first ~2000 chars. Local only.
 */
const { stripHtml, fetchUrl } = require('./common');

module.exports = {
  name: 'Summarize URL',
  pattern: '/summarize ',
  handler: async (msg) => {
    const urlStr = msg.slice(11).trim();
    if (!urlStr) return 'Usage: /summarize <url>';
    try {
      const html = await fetchUrl(urlStr);
      const text = stripHtml(html);
      const out = text.slice(0, 2000);
      return 'First ~2000 chars:\n' + (out || '(no text)') + (text.length > 2000 ? '\n… (truncated)' : '');
    } catch (e) {
      return 'Summarize failed: ' + (e.message || 'error');
    }
  },
};
