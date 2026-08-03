/**
 * Phase 4 — LLM usage aggregation + rotation helpers.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('llmUsage', () => {
  let dir;
  let filePath;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-usage-'));
    filePath = path.join(dir, 'llm-usage.jsonl');
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it('aggregateLlmUsage sums by model and tag within window', () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    fs.writeFileSync(filePath, [
      JSON.stringify({ ts: now, model: 'm1', prompt_tokens: 10, completion_tokens: 5, tag: 'eiWorkPlanner' }),
      JSON.stringify({ ts: now, model: 'm1', prompt_tokens: 20, completion_tokens: 7, tag: 'eiCorpusNotes' }),
      JSON.stringify({ ts: old, model: 'm1', prompt_tokens: 999, completion_tokens: 999, tag: 'old' }),
      'not-json',
      '',
    ].join('\n') + '\n');

    const { aggregateLlmUsage } = require('../lib/llmUsage');
    const out = aggregateLlmUsage({ hours: 24, filePath });
    assert.equal(out.calls, 2);
    assert.equal(out.total_prompt, 30);
    assert.equal(out.total_completion, 12);
    assert.equal(out.by_model.m1.calls, 2);
    assert.equal(out.by_tag.eiWorkPlanner.prompt, 10);
    assert.equal(out.by_tag.eiCorpusNotes.completion, 7);
    assert.equal(out.by_tag.old, undefined);
  });

  it('rotateIfNeeded renames oversized file', () => {
    const big = path.join(dir, 'big.jsonl');
    fs.writeFileSync(big, 'x'.repeat(100));
    const { rotateIfNeeded } = require('../lib/llmUsage');
    // Force tiny threshold by temporarily writing over MAX — call with monkeypatch
    const usage = require('../lib/llmUsage');
    const orig = usage.MAX_FILE_BYTES;
    // rotateIfNeeded uses module-level MAX_FILE_BYTES constant — rewrite file large enough
    // We can't change const; instead test that small files are left alone
    rotateIfNeeded(big);
    assert.ok(fs.existsSync(big));
    // Simulate: write huge file then call with patched require by writing >20MB is slow.
    // Unit-test the rename path by temporarily requiring a local copy behavior:
    const oversized = path.join(dir, 'over.jsonl');
    fs.writeFileSync(oversized, Buffer.alloc(21 * 1024 * 1024));
    rotateIfNeeded(oversized);
    assert.equal(fs.existsSync(oversized), false);
    assert.ok(fs.existsSync(path.join(dir, 'over.1.jsonl')));
  });
});
