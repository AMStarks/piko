const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compactJsonlFile, appendJsonlBounded, readJsonlTail } = require('../lib/jsonlBounded');

describe('lib/jsonlBounded', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-bounded-'));
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('compacts to last N lines', () => {
    const p = path.join(dir, 'a.jsonl');
    const lines = [];
    for (let i = 0; i < 20; i += 1) lines.push(JSON.stringify({ i }));
    fs.writeFileSync(p, `${lines.join('\n')}\n`, 'utf8');
    const out = compactJsonlFile(p, 5);
    assert.equal(out.kept, 5);
    assert.equal(out.trimmed, 15);
    const kept = fs.readFileSync(p, 'utf8').trim().split('\n');
    assert.equal(kept.length, 5);
    assert.equal(JSON.parse(kept[0]).i, 15);
  });

  it('appendJsonlBounded trims when over max+slack', () => {
    const p = path.join(dir, 'b.jsonl');
    for (let i = 0; i < 12; i += 1) {
      appendJsonlBounded(p, { i }, { maxLines: 5, slack: 2 });
    }
    const kept = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(kept.length <= 7, `expected <=7 got ${kept.length}`);
  });

  it('readJsonlTail returns last objects', () => {
    const p = path.join(dir, 'c.jsonl');
    const body = Array.from({ length: 30 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n';
    fs.writeFileSync(p, body, 'utf8');
    const rows = readJsonlTail(p, 3);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].i, 27);
    assert.equal(rows[2].i, 29);
  });
});
