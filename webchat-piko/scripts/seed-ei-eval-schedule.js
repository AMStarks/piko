#!/usr/bin/env node
/**
 * Seed a legion_scheduled intent for nightly EI platform eval (Tier B).
 * Idempotent — skips if an enabled ei.platform.eval schedule already exists.
 */
const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);

const { loadIntents, saveIntents } = require('../lib/intents');
const { includesCollapsedPhrase } = require('../lib/text');

function main() {
  const intents = loadIntents();
  const exists = intents.some(
    (i) => i.type === 'legion_scheduled'
      && i.enabled !== false
      && (i.capability === 'ei.platform.eval' || includesCollapsedPhrase(String(i.title || i.objective || ''), 'platform eval')),
  );
  if (exists) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'schedule_exists' }));
    return;
  }
  const now = new Date().toISOString();
  const row = {
    id: `legion_sched_ei_eval_${Date.now()}`,
    type: 'legion_scheduled',
    status: 'pending',
    enabled: true,
    mode: 'auto',
    title: 'EI platform eval (smoke + golden harvest)',
    objective: 'Run EI platform QA eval — smoke registry/health and literature harvest rubric for Abydos, Heliopolis, Giza.',
    capability: 'ei.platform.eval',
    adapterId: 'egyptian-insights',
    schedule: '30 3 * * *',
    createdAt: now,
    updatedAt: now,
    tags: ['legion_scheduled', 'culture', 'ei_eval'],
    business_unit: 'Egyptian Insights',
  };
  intents.push(row);
  saveIntents(intents);
  console.log(JSON.stringify({ ok: true, intent: row }));
}

main();
