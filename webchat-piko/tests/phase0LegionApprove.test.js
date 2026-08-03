const test = require('node:test');
const assert = require('node:assert/strict');
const { isLegionApproveAllowed, verifyAndStripApprovalPin } = require('../lib/legionApprove');

test('isLegionApproveAllowed allows all when PRIMARY_SOURCES unset', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  delete process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  try {
    assert.equal(isLegionApproveAllowed('webchat'), true);
    assert.equal(isLegionApproveAllowed('telegram'), true);
    assert.equal(isLegionApproveAllowed('app'), true);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES = prev;
  }
});

test('isLegionApproveAllowed restricts to primary when set', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES = 'webchat,app';
  try {
    assert.equal(isLegionApproveAllowed('webchat'), true);
    assert.equal(isLegionApproveAllowed('app'), true);
    assert.equal(isLegionApproveAllowed('telegram'), false);
    assert.equal(isLegionApproveAllowed('discord'), false);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  }
});

test('verifyAndStripApprovalPin passes when PIN unset', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  delete process.env.PIKO_LEGION_APPROVE_PIN;
  try {
    const payload = { supplier: 'X', lines: [] };
    const out = verifyAndStripApprovalPin(payload);
    assert.equal(out.ok, true);
    assert.deepEqual(out.payload, payload);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
  }
});

test('verifyAndStripApprovalPin requires _pin when PIN set', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  process.env.PIKO_LEGION_APPROVE_PIN = 'secret123';
  try {
    const out = verifyAndStripApprovalPin({ supplier: 'X', lines: [] });
    assert.equal(out.ok, false);
    assert.match(out.error, /PIN/);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PIN;
  }
});

test('verifyAndStripApprovalPin rejects wrong PIN', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  process.env.PIKO_LEGION_APPROVE_PIN = 'secret123';
  try {
    const out = verifyAndStripApprovalPin({ supplier: 'X', _pin: 'wrong' });
    assert.equal(out.ok, false);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PIN;
  }
});

test('verifyAndStripApprovalPin strips _pin when correct', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  process.env.PIKO_LEGION_APPROVE_PIN = 'secret123';
  try {
    const payload = { supplier: 'X', lines: [], _pin: 'secret123' };
    const out = verifyAndStripApprovalPin(payload);
    assert.equal(out.ok, true);
    assert.equal(out.payload._pin, undefined);
    assert.equal(out.payload.supplier, 'X');
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PIN;
  }
});
