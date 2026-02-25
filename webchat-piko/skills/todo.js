/**
 * Skill: /todo add <text> | list | done <id> — local only, no marketplace.
 */
const { TODO_FILE, loadJson, saveJson } = require('./common');

module.exports = {
  name: 'Todo',
  pattern: '/todo',
  handler: (msg) => {
    const rest = (msg.slice(5) || '').trim();
    if (rest.startsWith('add ')) {
      const text = rest.slice(4).trim();
      if (!text) return 'Usage: /todo add <text>';
      const todos = loadJson(TODO_FILE, []);
      const id = todos.length ? Math.max(...todos.map((t) => t.id || 0)) + 1 : 1;
      todos.push({ id, text, done: false, at: new Date().toISOString() });
      if (!saveJson(TODO_FILE, todos)) return 'Failed to save todo.';
      return 'Todo #' + id + ' added: ' + text.slice(0, 50) + (text.length > 50 ? '…' : '');
    }
    if (rest.startsWith('done ')) {
      const id = parseInt(rest.slice(5).trim(), 10);
      if (isNaN(id)) return 'Usage: /todo done <id>';
      const todos = loadJson(TODO_FILE, []);
      const t = todos.find((x) => x.id === id);
      if (!t) return 'Todo #' + id + ' not found.';
      t.done = true;
      if (!saveJson(TODO_FILE, todos)) return 'Failed to update.';
      return 'Done: #' + id + ' ' + (t.text || '').slice(0, 50);
    }
    if (rest === 'list' || rest === '') {
      const todos = loadJson(TODO_FILE, []);
      const open = todos.filter((t) => !t.done);
      const closed = todos.filter((t) => t.done).slice(-10);
      if (open.length === 0 && closed.length === 0) return 'No todos. Use /todo add <text>.';
      let out = '';
      if (open.length) out += 'Open: ' + open.map((t) => '#' + t.id + ' ' + (t.text || '').slice(0, 50)).join('; ') + '\n';
      if (closed.length) out += 'Done: ' + closed.map((t) => '#' + t.id).join(', ');
      return out.trim();
    }
    return 'Usage: /todo add <text> | list | done <id>';
  },
};
