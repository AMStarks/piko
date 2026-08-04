const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('culturesDataRoot P3.3e', () => {
  let dir;
  let prevData;
  let prevEi;
  let prevEi2;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cultures-root-'));
    prevData = process.env.PIKO_DATA_DIR;
    prevEi = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    prevEi2 = process.env.PIKO_EGYPTIAN_DATA_DIR;
    delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    delete process.env.PIKO_EGYPTIAN_DATA_DIR;
  });

  after(() => {
    if (prevData === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevEi === undefined) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prevEi;
    if (prevEi2 === undefined) delete process.env.PIKO_EGYPTIAN_DATA_DIR;
    else process.env.PIKO_EGYPTIAN_DATA_DIR = prevEi2;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  });

  it('resolves under PIKO_DATA_DIR when present', () => {
    process.env.PIKO_DATA_DIR = dir;
    const under = path.join(dir, 'egyptian-insights');
    fs.mkdirSync(under, { recursive: true });
    delete require.cache[require.resolve('../lib/culturesCorpusApi')];
    const { culturesDataRoot } = require('../lib/culturesCorpusApi');
    assert.equal(culturesDataRoot(), under);
  });
});
