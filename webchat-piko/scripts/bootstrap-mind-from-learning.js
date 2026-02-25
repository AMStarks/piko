#!/usr/bin/env node
/**
 * One-time (or periodic) bootstrap: sync existing data/learning/*.md into the mind.
 * Reads tensions.md, sticky-ideas.md, rabbit-hole-notes.md and pushes them as
 * a single observation so update_mind can classify and populate beliefs/tensions/goals.
 * Run: node scripts/bootstrap-mind-from-learning.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { bootstrapFromMarkdown, updateMind } = require('../lib/mind');

const LEARNING_DIR = process.env.PIKO_LEARNING_DIR || path.join(__dirname, '..', 'data', 'learning');

async function main() {
  const observation = bootstrapFromMarkdown(LEARNING_DIR);
  if (!observation) {
    console.log('[bootstrap-mind] No learning markdown found at', LEARNING_DIR);
    process.exit(0);
  }
  console.log('[bootstrap-mind] Pushing learning content into mind...');
  const result = await updateMind(observation);
  console.log('[bootstrap-mind] Applied:', result.applied?.length || 0, result.applied || []);
  if (result.error) console.error('[bootstrap-mind] Error:', result.error);
}

main().catch((e) => {
  console.error('[bootstrap-mind]', e.message);
  process.exitCode = 1;
});
