const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('captureTurn writes JSONL events into monthly file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-cap-'));
  process.env.PIKO_DATA_DIR = tmp;
  process.env.PIKO_TENANT_ID = 'customer-03';
  delete process.env.PIKO_TRANSCRIPT_CAPTURE;
  const { captureTurn, captureDir } = require('../lib/transcriptCapture');

  assert.equal(captureTurn('sess-1', 'user', 'find the Dunn book'), true);
  assert.equal(captureTurn('sess-1', 'assistant', 'On it — my researcher is looking now.'), true);
  assert.equal(captureTurn('sess-1', 'system', 'internal'), false, 'system turns skipped');
  assert.equal(captureTurn('sess-1', 'assistant', '   '), false, 'empty skipped');

  // appendFile is async fire-and-forget; poll rather than assuming timing.
  let files = [];
  for (let i = 0; i < 40; i++) {
    try {
      files = fs.readdirSync(captureDir());
      if (files.length && fs.readFileSync(path.join(captureDir(), files[0]), 'utf8').trim().split('\n').length >= 2) break;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(files.length, 1);
  assert.match(files[0], /^transcripts-\d{6}\.jsonl$/);
  const lines = fs.readFileSync(path.join(captureDir(), files[0]), 'utf8').trim().split('\n').map(JSON.parse)
    .filter((l) => l && l.session === 'sess-1');
  assert.ok(lines.length >= 2);
  const user = lines.find((l) => l.role === 'user');
  const assistant = lines.find((l) => l.role === 'assistant');
  assert.ok(user, 'user turn captured');
  assert.ok(assistant, 'assistant turn captured');
  assert.equal(assistant.tenant, 'customer-03');
  assert.ok(assistant.ts);

  process.env.PIKO_TRANSCRIPT_CAPTURE = 'off';
  assert.equal(captureTurn('sess-1', 'user', 'nope'), false);
  delete process.env.PIKO_TRANSCRIPT_CAPTURE;
  fs.rmSync(tmp, { recursive: true, force: true });
});
