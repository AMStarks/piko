const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildHistoryDumpText, dumpHistory } = require('../lib/historyDump');

test('WP6.1 dumpHistory reads sessionStore, not dead sessions map', () => {
  const store = {
    listSessionIds: () => ['sess-a', 'sess-b', 'sess-empty'],
    getHistory: (id) => {
      if (id === 'sess-a') {
        return [
          { role: 'user', content: 'Hello\nworld' },
          { role: 'assistant', content: 'Hi there' },
        ];
      }
      if (id === 'sess-b') return [{ role: 'user', content: 'Second' }];
      return [];
    },
  };
  const text = buildHistoryDumpText('2026-08-02', store);
  assert.match(text, /# Piko history dump for 2026-08-02/);
  assert.match(text, /=== Session: sess-a ===/);
  assert.match(text, /User: Hello\n {2}world/);
  assert.match(text, /Piko: Hi there/);
  assert.match(text, /=== Session: sess-b ===/);
  assert.doesNotMatch(text, /sess-empty/);
  assert.doesNotMatch(text, /sessions\.entries/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-hist-'));
  try {
    const file = dumpHistory('2026-08-02', dir, store);
    const written = fs.readFileSync(file, 'utf8');
    assert.match(written, /=== Session: sess-a ===/);
    assert.match(written, /Piko: Hi there/);
    assert.match(written, /=== Session: sess-b ===/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WP6.1 server dumpHistory has no sessions.entries reference', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /sessions\.entries\s*\(/);
  assert.match(src, /lib\/historyDump/);
});
