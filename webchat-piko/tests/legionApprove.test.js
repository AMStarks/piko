const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLegionApproveAllowed,
  verifyAndStripApprovalPin,
} = require('../lib/legionApprove');

test('verifyAndStripApprovalPin passes when no pin configured', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  delete process.env.PIKO_LEGION_APPROVE_PIN;
  try {
    const out = verifyAndStripApprovalPin({ supplier: 'X', lines: [] });
    assert.equal(out.ok, true);
    assert.equal(out.payload.supplier, 'X');
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
  }
});

test('verifyAndStripApprovalPin requires pin when configured', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PIN;
  process.env.PIKO_LEGION_APPROVE_PIN = '1234';
  try {
    assert.equal(verifyAndStripApprovalPin({ supplier: 'X' }).ok, false);
    const ok = verifyAndStripApprovalPin({ supplier: 'X', _pin: '1234' });
    assert.equal(ok.ok, true);
    assert.equal(ok.payload._pin, undefined);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PIN = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PIN;
  }
});

test('isLegionApproveAllowed respects primary sources env', () => {
  const prev = process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES = 'webchat,app';
  try {
    assert.equal(isLegionApproveAllowed('webchat'), true);
    assert.equal(isLegionApproveAllowed('telegram'), false);
  } finally {
    if (prev !== undefined) process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES = prev;
    else delete process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES;
  }
});
