# Local skills (safe, no marketplace)

**Auto-load:** All `*.js` in this folder (except `index.js` and `common.js`) are loaded at server start. Add a file → add a skill. No remote install — **local only, you approve by adding files.**

## Format per file

Export either:

- **Single skill:** `{ name?, pattern, handler }`
- **Multiple:** `{ skills: [ { name?, pattern, handler }, ... ] }`

- **pattern** — String (e.g. `"/hello"`) for `message.startsWith(pattern)`, or a **RegExp**.
- **handler(message)** — Returns a **string** (reply) or **{ reply }**. Can be async.

Skills run after built-in commands and before Ollama chat. First matching skill wins.

## Bundled skills

- **notes.js** — `/notes add <text>` | `/notes list`
- **todo.js** — `/todo add <text>` | `/todo list` | `/todo done <id>`
- **summarize.js** — `/summarize <url>` (fetch, strip HTML, first ~2000 chars)

Shared helpers: `skills/common.js` (loadJson, saveJson, stripHtml, fetchUrl).

## Add a new skill

Create `skills/my-skill.js`:

```js
module.exports = {
  name: 'My Skill',
  pattern: '/greet',
  handler: (msg) => 'Hello! ' + (msg.slice(7) || 'world'),
};
```

Restart the server to load it. **No marketplace — security first.**
