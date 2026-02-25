/**
 * Skill: /notes add <text> | list — local only, no marketplace.
 */
const { NOTES_FILE, loadJson, saveJson } = require('./common');

module.exports = {
  name: 'Notes',
  pattern: '/notes',
  handler: (msg) => {
    const rest = (msg.slice(6) || '').trim();
    if (rest.startsWith('add ')) {
      const text = rest.slice(4).trim();
      if (!text) return 'Usage: /notes add <text>';
      const notes = loadJson(NOTES_FILE, []);
      const id = notes.length ? Math.max(...notes.map((n) => n.id || 0)) + 1 : 1;
      notes.push({ id, text, at: new Date().toISOString() });
      if (!saveJson(NOTES_FILE, notes)) return 'Failed to save note.';
      return 'Note added: ' + text.slice(0, 60) + (text.length > 60 ? '…' : '');
    }
    if (rest === 'list' || rest === '') {
      const notes = loadJson(NOTES_FILE, []);
      const last = notes.slice(-20).reverse();
      if (last.length === 0) return 'No notes. Use /notes add <text>.';
      return last.map((n) => `#${n.id} ${(n.text || '').slice(0, 80)}`).join('\n');
    }
    return 'Usage: /notes add <text> | list';
  },
};
