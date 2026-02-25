#!/usr/bin/env node
/**
 * One-week memory simulation: replays the proposal's week (depth/structure belief + counter-evidence)
 * to validate observable belief drift. Uses session "sim_week" and real ingest + consolidation.
 *
 * Run from webchat-piko: node scripts/memory_simulation_week.js
 * Requires: Ollama (or fallback) for ingest and consolidation LLM calls.
 *
 * Day 0: one pending belief "Andrew prefers depth and structure" @ 0.55
 * Day 1–5: inject exchanges, run ingest + consolidation each day.
 * End: assert one promoted belief with confidence ~0.7–0.85 and at least one counter_evidence entry.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sessionStore = require('../lib/sessionStore');
const memory = require('../lib/memory');
const beliefLoop = require('../lib/beliefLoop');

const SIM_SESSION = 'sim_week';

const DAYS = [
  null, // Day 0 = seed only
  {
    user: 'Can you critique the architecture of my React Native app in depth?',
    assistant: "Sure. Here's a detailed critique: state management is fragmented, consider consolidating with Context or a single store; component boundaries are unclear in the auth flow...",
  },
  {
    user: 'I value well-structured, in-depth analyses.',
    assistant: 'Noted. I\'ll lean that way when you ask for analysis.',
  },
  {
    user: 'Go deeper on the state management part—how would you structure it?',
    assistant: "I'd use a single store with slices: auth, UI, data. Each slice has selectors and async thunks. Here's how that would look...",
  },
  {
    user: 'Actually can you give me something quick and light this time?',
    assistant: 'Sure: use one global store, keep it simple.',
  },
  {
    user: 'When you have a choice, give me the detailed option.',
    assistant: 'Will do. I\'ll default to structured depth when you ask for it.',
  },
];

function seedPending() {
  const list = memory.getPendingBeliefs().filter((p) => !p.proposition || !p.proposition.toLowerCase().includes('depth'));
  list.push({
    id: 'pend_sim_001',
    proposition: 'Andrew prefers depth and structure over brevity.',
    confidence: 0.55,
    evidence: 'Day 0 simulation seed',
    created_at: new Date().toISOString(),
  });
  memory.setPendingBeliefs(list);
}

function appendDay(sessionId, day) {
  if (!day || !day.user || !day.assistant) return;
  sessionStore.append(sessionId, 'user', day.user);
  sessionStore.append(sessionId, 'assistant', day.assistant);
}

async function run() {
  console.log('[memory_simulation_week] Starting. Session:', SIM_SESSION);

  seedPending();
  console.log('[memory_simulation_week] Seeded one pending belief (depth/structure @ 0.55).');

  for (let d = 1; d <= 5; d++) {
    appendDay(SIM_SESSION, DAYS[d]);
    console.log('[memory_simulation_week] Day', d, '— appended exchange.');
    try {
      await beliefLoop.ingestRecentExperience(SIM_SESSION);
      await beliefLoop.runBeliefConsolidation();
    } catch (e) {
      console.error('[memory_simulation_week] Day', d, 'ingest/consolidation failed:', e.message);
    }
  }

  const beliefs = memory.getUserBeliefs();
  const depthBelief = beliefs.find(
    (b) => b.proposition && b.proposition.toLowerCase().includes('depth') && b.proposition.toLowerCase().includes('structure')
  );
  const pending = memory.getPendingBeliefs();

  console.log('[memory_simulation_week] Done. User beliefs:', beliefs.length);
  if (depthBelief) {
    console.log('[memory_simulation_week] Depth/structure belief: confidence', depthBelief.confidence, 'counter_evidence', (depthBelief.counter_evidence || []).length);
  }
  console.log('[memory_simulation_week] Pending remaining:', pending.length);

  const ok =
    depthBelief &&
    (depthBelief.confidence || 0) >= 0.65 &&
    (depthBelief.confidence || 0) <= 0.95 &&
    Array.isArray(depthBelief.counter_evidence) &&
    depthBelief.counter_evidence.length >= 1;

  if (ok) {
    console.log('[memory_simulation_week] PASS: belief promoted with nuance (counter-evidence present).');
  } else {
    console.log('[memory_simulation_week] CHECK: expected one promoted belief (depth/structure) with confidence 0.65–0.95 and ≥1 counter_evidence. Run with real LLM for full drift.');
  }
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error('[memory_simulation_week]', e);
  process.exit(1);
});
