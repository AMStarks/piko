/**
 * Phase 2.1: Belief loop tests. Run with: node --test tests/beliefLoop.test.js
 * runBeliefConsolidation with empty pending should not throw. applyBehaviourSignals should not throw.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.PIKO_DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');

const { describe, it } = require('node:test');
const assert = require('node:assert');
const beliefLoop = require('../lib/beliefLoop');

describe('beliefLoop', () => {
  it('runBeliefConsolidation does not throw when pending is empty or small', async () => {
    await assert.doesNotReject(async () => {
      await beliefLoop.runBeliefConsolidation();
    });
  });

  it('applyBehaviourSignals does not throw with empty or normal args', () => {
    assert.doesNotThrow(() => {
      beliefLoop.applyBehaviourSignals('test-session', '', '');
    });
    assert.doesNotThrow(() => {
      beliefLoop.applyBehaviourSignals('test-session', 'yes exactly', 'Glad that helped.');
    });
  });
});
