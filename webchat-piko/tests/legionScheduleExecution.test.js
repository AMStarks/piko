const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  inferScheduleCapability,
  buildScheduleCapabilityFields,
  resolveScheduleExecution,
} = require('../lib/legionScheduleExecution');

test('inferScheduleCapability maps low stock scan', () => {
  const r = inferScheduleCapability('low stock scan');
  assert.equal(r.capability, 'inventory.low_stock.scan');
  assert.ok(r.input.include_raw);
});

test('inferScheduleCapability maps load recent data to runbook', () => {
  const r = inferScheduleCapability('load recent data');
  assert.equal(r.capability, 'ausmaker.runbook.execute');
  assert.equal(r.runbook_id, 'load_recent_data');
});

test('buildScheduleCapabilityFields returns storable fields', () => {
  const fields = buildScheduleCapabilityFields('refresh forecast');
  assert.equal(fields.capability, 'ausmaker.runbook.execute');
  assert.equal(fields.runbook_id, 'refresh_forecast');
});

test('resolveScheduleExecution prefers stored capability on intent', () => {
  const r = resolveScheduleExecution({
    capability: 'inventory.low_stock.scan',
    adapterId: 'ausmakersupplies',
    title: 'something else',
  });
  assert.equal(r.capability, 'inventory.low_stock.scan');
  assert.ok(r.input.include_raw);
});

test('createLegionScheduledWithTask stores capability', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-sched-cap-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = dataDir;
  try {
    const { createLegionScheduledWithTask, loadIntents } = require('../lib/intents');
    const out = createLegionScheduledWithTask({
      schedule: 'in 30',
      objective: 'low stock scan',
      mode: 'auto',
      task_id: 99,
      _creationSource: 'test',
    });
    assert.ok(out.intent);
    assert.equal(out.intent.capability, 'inventory.low_stock.scan');
    const found = loadIntents().find((i) => i.id === out.intent.id);
    assert.equal(found.capability, 'inventory.low_stock.scan');
  } finally {
    if (prev !== undefined) process.env.PIKO_DATA_DIR = prev;
    else delete process.env.PIKO_DATA_DIR;
  }
});
