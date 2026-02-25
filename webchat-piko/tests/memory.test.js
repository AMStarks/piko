/**
 * Phase 2.1: Memory tests. Run with: node --test tests/memory.test.js
 * Uses real data dir; getUserBeliefs/setPendingBeliefs are read/write. We only read in tests and optionally add/remove one pending.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.PIKO_DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');

const { describe, it } = require('node:test');
const assert = require('node:assert');
const memory = require('../lib/memory');

describe('memory', () => {
  it('getUserBeliefs returns an array', () => {
    const list = memory.getUserBeliefs();
    assert.ok(Array.isArray(list));
  });

  it('getPendingBeliefs returns an array', () => {
    const list = memory.getPendingBeliefs();
    assert.ok(Array.isArray(list));
  });

  it('getInteractions returns an array', () => {
    const list = memory.getInteractions();
    assert.ok(Array.isArray(list));
  });

  it('getEpisodic returns an array', () => {
    const list = memory.getEpisodic();
    assert.ok(Array.isArray(list));
  });

  it('getMemoryBlockForPrompt returns string (possibly empty)', () => {
    const block = memory.getMemoryBlockForPrompt(5, 3);
    assert.ok(typeof block === 'string');
  });

  it('addPendingBelief then getPendingBeliefs includes new item (then remove to avoid polluting)', () => {
    const before = memory.getPendingBeliefs().length;
    memory.addPendingBelief('Test belief for Phase 2 test.', 'Test evidence.', 0.3);
    const after = memory.getPendingBeliefs();
    assert.ok(after.length >= before);
    const added = after.find((b) => (b.proposition || '').includes('Test belief for Phase 2 test'));
    assert.ok(added);
    const remaining = after.filter((b) => !(b.proposition || '').includes('Test belief for Phase 2 test'));
    memory.setPendingBeliefs(remaining);
  });
});
