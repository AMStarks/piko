const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('enrichMessageWithAttachments saves text and embeds content', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-attach-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  try {
    const { enrichMessageWithAttachments } = require('../lib/chatAttachments');
    const b64 = Buffer.from('Hello Anubis notes').toString('base64');
    const out = await enrichMessageWithAttachments('Please review', [{
      filename: 'notes.txt',
      content_base64: b64,
    }]);
    assert.match(out.message, /Please review/);
    assert.match(out.message, /Attached: notes\.txt/);
    assert.match(out.message, /Hello Anubis notes/);
    assert.equal(out.saved.length, 1);
    assert.ok(fs.existsSync(out.saved[0].path));
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('attachments alone become a review prompt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-attach2-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  try {
    const { enrichMessageWithAttachments } = require('../lib/chatAttachments');
    const out = await enrichMessageWithAttachments('', [{
      filename: 'a.md',
      content_base64: Buffer.from('# Title').toString('base64'),
    }]);
    assert.match(out.message, /Please review the attached/);
    assert.match(out.message, /# Title/);
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
